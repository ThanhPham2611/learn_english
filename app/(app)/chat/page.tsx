"use client";

import { useEffect, useRef, useState } from "react";
import { getLevel, setLevel } from "@/lib/profile";
import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";
import type { ChatTurn } from "@/lib/agents/tutor";
import type { WritingError } from "@/lib/agents/assessor";
import type { SentenceSuggestion } from "@/lib/agents/sentence-coach";
import { buildSegments } from "@/lib/highlight";
import { normalizeContext, normalizeWord } from "@/lib/text-normalize";
import { STARTERS } from "@/lib/chat-starters";

interface WordLookup {
  word: string;
  contextSentence: string; // dùng để khớp kết quả trả về từ lô dịch (flushLookups)
  meaning: string;
  example: string;
  pronunciation: string;
  top: number; // viewport-relative (dùng cho position: fixed)
  left: number;
  loading: boolean;
  added: boolean;
  error: string | null;
}

// ---- Cache dịch từ phía client (Map trong bộ nhớ + localStorage) ----
// Key = normalizeWord(word) + ":" + sha256(normalizeContext(contextSentence)) —
// khớp với cách server tính khoá cache (lib/translation-cache.ts) để tận dụng
// đúng những từ đã tra trước đó, kể cả ở phiên trình duyệt trước.
const WORD_CACHE_STORAGE_KEY = "wordLookupCache";
const WORD_CACHE_MAX_ENTRIES = 500;

interface CachedWordLookup {
  meaning: string;
  example: string;
  pronunciation: string;
}

const wordCacheMemory = new Map<string, CachedWordLookup>();
let wordCacheHydrated = false;

function hydrateWordCache() {
  if (wordCacheHydrated) return;
  wordCacheHydrated = true;
  try {
    const raw = localStorage.getItem(WORD_CACHE_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, CachedWordLookup][];
    for (const [key, value] of entries) wordCacheMemory.set(key, value);
  } catch {
    // localStorage hỏng/không có quyền — bỏ qua, chỉ mất cache warm, không hỏng chức năng chính
  }
}

function persistWordCache() {
  try {
    const entries = Array.from(wordCacheMemory.entries()).slice(-WORD_CACHE_MAX_ENTRIES);
    localStorage.setItem(WORD_CACHE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage đầy/bị chặn — bỏ qua
  }
}

function setWordCache(key: string, value: CachedWordLookup) {
  wordCacheMemory.set(key, value);
  if (wordCacheMemory.size > WORD_CACHE_MAX_ENTRIES) {
    const oldestKey = wordCacheMemory.keys().next().value;
    if (oldestKey !== undefined) wordCacheMemory.delete(oldestKey);
  }
  persistWordCache();
}

async function wordCacheKey(word: string, contextSentence: string): Promise<string> {
  const w = normalizeWord(word);
  const ctx = normalizeContext(contextSentence);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ctx));
  const hashHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${w}:${hashHex}`;
}

// Gạch chân đỏ lỗi ngữ pháp trong bong bóng chat của người dùng (tái dùng
// buildSegments đã có ở module Viết/Nói). Dùng overlay trắng mờ thay vì token
// accent vì nền bong bóng user (--user-bubble) là màu teal đặc, không đổi theo
// theme — accent/accent-text không được thiết kế để đặt trên nền đó.
function renderChatHighlight(text: string, errors: WritingError[]) {
  const { segments } = buildSegments(text, errors);
  return segments.map((seg, i) =>
    seg.error ? (
      <mark
        key={i}
        title={`${seg.error.correction} — ${seg.error.explanation}`}
        className="cursor-help rounded bg-white/20 px-0.5 underline decoration-white decoration-2 underline-offset-2"
      >
        {seg.text}
        <sup className="ml-0.5">{seg.error.idx + 1}</sup>
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    )
  );
}

export default function ChatPage() {
  const [level, setLvl] = useState<CefrLevel>("A2");
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Lỗi ngữ pháp chấm được cho từng tin nhắn user (theo index) — chỉ để hiển
  // thị, KHÔNG gộp vào ChatTurn[]/history để không lọt vào payload gửi Gemini.
  const [chatErrors, setChatErrors] = useState<Record<number, WritingError[]>>({});

  // Bản dịch tiếng Việt cho tin nhắn AI (theo index).
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translationErrors, setTranslationErrors] = useState<Record<number, string>>({});
  const [visibleTranslations, setVisibleTranslations] = useState<Set<number>>(new Set());
  const [translatingIdx, setTranslatingIdx] = useState<number | null>(null);

  const [wordLookup, setWordLookup] = useState<WordLookup | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // "Học theo câu": gợi ý cải thiện các câu user đã viết trong phiên, hiện
  // sau khi bấm "Kết thúc & Xem gợi ý". null = chưa mở panel.
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    (SentenceSuggestion & { added: boolean; addError: string | null })[] | null
  >(null);

  // Hàng đợi tra từ chưa gửi — gom các lượt tra trong ~500ms rồi gửi 1 request
  // duy nhất (POST /api/tutor/translate-words) thay vì 1 request/từ.
  const pendingLookups = useRef<Map<string, { word: string; contextSentence: string }>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hydrateWordCache();
  }, []);

  // Ưu tiên trình độ từ hồ sơ trong DB; nếu lỗi thì dùng localStorage.
  useEffect(() => {
    setLvl(getLevel());
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => {
        if (CEFR_LEVELS.includes(p?.overallLevel)) {
          setLvl(p.overallLevel);
          setLevel(p.overallLevel);
        }
      })
      .catch(() => {});
  }, []);

  // Khôi phục phiên chat gần nhất còn mở (nếu có) — tránh mất hội thoại khi
  // refresh/mở lại trang, vì tin nhắn giờ đã được lưu real-time phía server.
  useEffect(() => {
    fetch("/api/tutor/session")
      .then((r) => r.json())
      .then((data) => {
        const s = data?.session;
        if (s && Array.isArray(s.messages) && s.messages.length > 0) {
          setSessionId(s.sessionId);
          setMessages(s.messages);
        }
      })
      .catch(() => {});
  }, []);

  // Tự cuộn xuống tin nhắn mới nhất.
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, loading]);

  // Đóng popover tra từ khi click ra ngoài, nhấn Escape, hoặc cuộn khung chat
  // (không cố định lại vị trí theo scroll — đơn giản hoá hợp lý cho app cá nhân).
  useEffect(() => {
    if (!wordLookup) return;
    function onMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setWordLookup(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setWordLookup(null);
    }
    function onScroll() {
      setWordLookup(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    scrollRef.current?.addEventListener("scroll", onScroll);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      scrollRef.current?.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordLookup !== null]);

  async function send(text: string, isStarter = false) {
    const clean = text.trim();
    if (!clean || loading) return;

    const userIndex = messages.length;
    const history: ChatTurn[] = [...messages, { role: "user", text: clean }];
    setMessages(history);
    setInput("");
    setLoading(true);

    // Thêm 1 tin nhắn "model" rỗng để đổ dần chữ vào (streaming).
    setMessages((m) => [...m, { role: "model", text: "" }]);

    // Chấm ngữ pháp chạy SONG SONG với Tutor: gọi fetch ở đây, KHÔNG await,
    // trước khi gọi /api/tutor bên dưới, để 2 request cùng chạy trên network.
    // Bỏ qua tin mẫu (đã đúng sẵn) và tin quá ngắn — đỡ tốn 1 lượt gọi vô ích.
    if (!isStarter && clean.length >= 3) {
      fetch("/api/tutor/grammar-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean, level }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data.errors) && data.errors.length > 0) {
            setChatErrors((e) => ({ ...e, [userIndex]: data.errors }));
          }
        })
        .catch(() => {}); // làm giàu nền, lỗi thì bỏ qua
    }

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, history, sessionId }),
      });
      if (!res.body) throw new Error("Không nhận được phản hồi");

      const returnedSessionId = res.headers.get("X-Chat-Session-Id");
      if (returnedSessionId) setSessionId(Number(returnedSessionId));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "model",
            text: copy[copy.length - 1].text + chunk,
          };
          return copy;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lỗi kết nối";
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "model", text: `[Lỗi] ${msg}` };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  async function translateMsg(i: number) {
    setTranslatingIdx(i);
    try {
      const res = await fetch("/api/tutor/translate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: messages[i].text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi dịch");
      setTranslations((t) => ({ ...t, [i]: data.translation }));
      setTranslationErrors((e) => {
        const n = { ...e };
        delete n[i];
        return n;
      });
    } catch (err) {
      // KHÔNG ghi lỗi vào translations — nếu không, bấm "Dịch" lại sau sẽ coi
      // như đã có cache và không gọi lại API. Lỗi lưu riêng ở translationErrors.
      setTranslationErrors((e) => ({
        ...e,
        [i]: err instanceof Error ? err.message : "Lỗi dịch",
      }));
    } finally {
      setTranslatingIdx(null);
    }
  }

  function toggleTranslate(i: number) {
    if (visibleTranslations.has(i)) {
      setVisibleTranslations((s) => {
        const n = new Set(s);
        n.delete(i);
        return n;
      });
      return;
    }
    setVisibleTranslations((s) => new Set(s).add(i));
    if (translations[i] === undefined) translateMsg(i);
  }

  // Gom lượt tra này vào hàng đợi, đợi ~500ms xem có thêm lượt tra khác (bôi
  // đen nhiều từ liên tiếp lúc đọc) rồi gửi chung 1 request cho cả lô — xem
  // flushLookups(). Không hạ thấp UX: popover vẫn hiện "Đang tra…" ngay lập tức.
  function queueLookup(word: string, contextSentence: string) {
    pendingLookups.current.set(`${word} ${contextSentence}`, { word, contextSentence });
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flushLookups, 500);
  }

  async function flushLookups() {
    flushTimer.current = null;
    const items = Array.from(pendingLookups.current.values());
    pendingLookups.current.clear();
    if (items.length === 0) return;

    try {
      const res = await fetch("/api/tutor/translate-words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tra từ");

      const results: { word: string; meaning: string; example: string; pronunciation: string | null; error: string | null }[] =
        Array.isArray(data.results) ? data.results : [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const result = results[i];
        if (!result) continue;

        if (!result.error) {
          const key = await wordCacheKey(item.word, item.contextSentence);
          setWordCache(key, {
            meaning: result.meaning,
            example: result.example,
            pronunciation: result.pronunciation ?? "",
          });
        }

        // Chỉ cập nhật popover nếu nó vẫn đang hiện đúng từ+câu này — người dùng
        // có thể đã chọn từ khác hoặc đóng popover trong lúc chờ.
        setWordLookup((w) =>
          w && w.word === item.word && w.contextSentence === item.contextSentence
            ? result.error
              ? { ...w, loading: false, error: result.error }
              : {
                  ...w,
                  meaning: result.meaning,
                  example: result.example,
                  pronunciation: result.pronunciation ?? "",
                  loading: false,
                }
            : w
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi tra từ";
      for (const item of items) {
        setWordLookup((w) =>
          w && w.word === item.word && w.contextSentence === item.contextSentence
            ? { ...w, loading: false, error: message }
            : w
        );
      }
    }
  }

  async function handleSelectionMouseUp() {
    const sel = window.getSelection();
    const raw = sel?.toString().trim() ?? "";
    if (!raw || !sel || sel.rangeCount === 0) return;
    const word = raw.replace(/^[^\w]+|[^\w]+$/g, "").slice(0, 60);
    if (!word) return;

    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = (node.nodeType === 3 ? node.parentElement : (node as Element)) ?? null;
    const bubble = el?.closest('[data-role="model"]') as HTMLElement | null;
    if (!bubble || bubble.dataset.streaming === "true") return;
    if (el?.closest("[data-translation]")) return; // không tra từ trong chính đoạn dịch tiếng Việt

    const msgIndex = Number(bubble.dataset.msgIndex);
    const contextSentence = messages[msgIndex]?.text ?? word;
    const rect = range.getBoundingClientRect();

    const cacheKeyStr = await wordCacheKey(word, contextSentence);
    const cached = wordCacheMemory.get(cacheKeyStr);
    if (cached) {
      setWordLookup({
        word,
        contextSentence,
        meaning: cached.meaning,
        example: cached.example,
        pronunciation: cached.pronunciation,
        top: rect.bottom,
        left: rect.left,
        loading: false,
        added: false,
        error: null,
      });
      return;
    }

    setWordLookup({
      word,
      contextSentence,
      meaning: "",
      example: "",
      pronunciation: "",
      top: rect.bottom,
      left: rect.left,
      loading: true,
      added: false,
      error: null,
    });
    queueLookup(word, contextSentence);
  }

  async function addWordToDeck() {
    if (!wordLookup) return;
    try {
      const res = await fetch("/api/vocab/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: wordLookup.word,
          meaning: wordLookup.meaning,
          example: wordLookup.example,
          pronunciation: wordLookup.pronunciation,
        }),
      });
      if (!res.ok) throw new Error();
      setWordLookup((w) => (w ? { ...w, added: true } : w));
    } catch {
      setWordLookup((w) => (w ? { ...w, error: "Không thêm được, thử lại." } : w));
    }
  }

  async function endSessionAndAnalyze() {
    if (!sessionId || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/chat/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi phân tích");
      const list: SentenceSuggestion[] = Array.isArray(data.suggestions) ? data.suggestions : [];
      setSuggestions(list.map((s) => ({ ...s, added: false, addError: null })));
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Lỗi phân tích");
    } finally {
      setAnalyzing(false);
    }
  }

  async function addSuggestionToList(i: number) {
    const s = suggestions?.[i];
    if (!s) return;
    try {
      const res = await fetch("/api/sentences/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original: s.original,
          suggested: s.suggested,
          explanation: s.explanation,
          level: s.level,
        }),
      });
      if (!res.ok) throw new Error();
      setSuggestions((list) => (list ? list.map((it, idx) => (idx === i ? { ...it, added: true } : it)) : list));
    } catch {
      setSuggestions((list) =>
        list ? list.map((it, idx) => (idx === i ? { ...it, addError: "Không thêm được, thử lại." } : it)) : list
      );
    }
  }

  function closeSuggestions() {
    setSuggestions(null);
    setAnalyzeError(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="animate-fade-in-up">
          <h1 className="text-2xl font-semibold">Chat với AI</h1>
          <p className="text-sm text-muted">
            Trò chuyện tự nhiên bằng tiếng Anh. Gia sư sẽ sửa lỗi nhẹ nhàng ngay
            trong câu trả lời.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={endSessionAndAnalyze}
            disabled={!sessionId || messages.length === 0 || analyzing}
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors duration-200 hover:border-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzing ? "Đang phân tích…" : "Kết thúc & Xem gợi ý"}
          </button>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Trình độ</span>
            <select
              value={level}
              onChange={(e) => {
                const v = e.target.value as CefrLevel;
                setLvl(v);
                setLevel(v);
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {CEFR_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Khung hội thoại */}
      <div
        ref={scrollRef}
        onMouseUp={handleSelectionMouseUp}
        aria-live="polite"
        className="flex h-[55vh] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-card"
      >
        {messages.length === 0 && (
          <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
            <p className="text-muted">Bắt đầu bằng một câu gợi ý:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s, true)}
                  className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:border-primary hover:bg-primary/10"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isLastStreaming = loading && i === messages.length - 1;
          return (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                data-role={m.role}
                data-msg-index={i}
                data-streaming={m.role === "model" && isLastStreaming ? "true" : undefined}
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-[15px] ${
                  m.role === "user"
                    ? "bg-userbubble text-white"
                    : "border border-border bg-bg"
                }`}
              >
                {m.text ? (
                  m.role === "user" && chatErrors[i]?.length ? (
                    renderChatHighlight(m.text, chatErrors[i])
                  ) : (
                    m.text
                  )
                ) : isLastStreaming ? (
                  <span className="typing-dots" aria-label="Đang trả lời">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  ""
                )}

                {m.role === "model" && m.text && !isLastStreaming && (
                  <div className="mt-1.5">
                    <button
                      onClick={() => toggleTranslate(i)}
                      className="cursor-pointer text-xs text-primary-text hover:underline"
                    >
                      {visibleTranslations.has(i) ? "Ẩn bản dịch" : "Dịch"}
                    </button>
                    {visibleTranslations.has(i) && (
                      <p
                        data-translation="true"
                        className={`mt-1 border-t border-border/50 pt-1 text-[13px] italic ${
                          translationErrors[i] ? "text-danger-text" : "text-muted"
                        }`}
                      >
                        {translatingIdx === i
                          ? "Đang dịch…"
                          : translationErrors[i]
                            ? `Lỗi: ${translationErrors[i]}`
                            : translations[i]}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ô nhập */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          aria-label="Nhập câu tiếng Anh để gửi cho gia sư"
          placeholder="Nhập tiếng Anh… (Enter để gửi, Shift+Enter xuống dòng)"
          className="min-h-[48px] flex-1 resize-y rounded-xl border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="h-[48px] cursor-pointer rounded-xl bg-primary px-5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "…" : "Gửi"}
        </button>
      </form>

      {/* Popover tra từ — render ngoài khung cuộn để không bị overflow-y-auto cắt */}
      {wordLookup && (
        <div
          ref={popoverRef}
          className="fixed z-50 w-64 rounded-xl border border-border bg-surface p-3 text-sm shadow-card animate-fade-in-up"
          style={{
            top: wordLookup.top + 6,
            left: Math.min(wordLookup.left, Math.max(8, window.innerWidth - 272)),
          }}
        >
          <p className="mb-1 font-medium">
            {wordLookup.word}
            {wordLookup.pronunciation && (
              <span className="ml-1.5 font-normal text-muted">{wordLookup.pronunciation}</span>
            )}
          </p>
          {wordLookup.loading ? (
            <p className="text-muted">Đang tra…</p>
          ) : wordLookup.error ? (
            <p className="text-danger-text">{wordLookup.error}</p>
          ) : (
            <>
              <p className="text-muted">{wordLookup.meaning}</p>
              <button
                onClick={addWordToDeck}
                disabled={wordLookup.added}
                className="mt-2 inline-block cursor-pointer rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary-text transition-colors duration-200 hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {wordLookup.added ? "✓ Đã thêm" : "+ Thêm vào flashcard"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Panel gợi ý "Học theo câu" — hiện sau khi bấm "Kết thúc & Xem gợi ý" */}
      {(suggestions !== null || analyzeError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface p-5 shadow-card animate-fade-in-up">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Gợi ý câu học được từ phiên chat</h2>
              <button
                onClick={closeSuggestions}
                aria-label="Đóng"
                className="cursor-pointer text-muted hover:text-primary-text"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto">
              {analyzeError && <p className="text-danger-text">{analyzeError}</p>}
              {suggestions && suggestions.length === 0 && (
                <p className="text-muted">
                  Chưa có câu nào đáng học thêm trong phiên này — tiếp tục luyện tập nhé!
                </p>
              )}
              {suggestions && suggestions.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {suggestions.map((s, i) => (
                    <li key={i} className="rounded-lg border border-border p-3">
                      <p className="text-sm text-muted line-through">{s.original}</p>
                      <p className="mt-1 text-[15px] font-medium">{s.suggested}</p>
                      {s.explanation && <p className="mt-1 text-xs text-muted">{s.explanation}</p>}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-text">
                          {s.level}
                        </span>
                        <button
                          onClick={() => addSuggestionToList(i)}
                          disabled={s.added}
                          className="cursor-pointer rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary-text transition-colors duration-200 hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {s.added ? "✓ Đã thêm" : "+ Thêm vào danh sách học"}
                        </button>
                      </div>
                      {s.addError && <p className="mt-1 text-xs text-danger-text">{s.addError}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

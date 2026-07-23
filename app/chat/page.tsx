"use client";

import { useEffect, useRef, useState } from "react";
import { getLevel, setLevel } from "@/lib/profile";
import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";
import type { ChatTurn } from "@/lib/agents/tutor";
import type { WritingError } from "@/lib/agents/assessor";
import { buildSegments } from "@/lib/highlight";

// Gợi ý câu mở đầu để bớt "màn hình trắng" (pattern UX cho giao diện AI).
const STARTERS = [
  "Hi! Can we talk about my weekend?",
  "Let's practice ordering food at a restaurant.",
  "Ask me questions about my job.",
  "Teach me 3 useful words for work emails.",
];

interface WordLookup {
  word: string;
  meaning: string;
  example: string;
  top: number; // viewport-relative (dùng cho position: fixed)
  left: number;
  loading: boolean;
  added: boolean;
  error: string | null;
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
        body: JSON.stringify({ level, history }),
      });
      if (!res.body) throw new Error("Không nhận được phản hồi");

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

  async function lookupWord(word: string, contextSentence: string) {
    try {
      const res = await fetch("/api/tutor/translate-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, contextSentence }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tra từ");
      setWordLookup((w) =>
        w && w.word === word ? { ...w, meaning: data.meaning, example: data.example, loading: false } : w
      );
    } catch (err) {
      setWordLookup((w) =>
        w && w.word === word
          ? { ...w, loading: false, error: err instanceof Error ? err.message : "Lỗi" }
          : w
      );
    }
  }

  function handleSelectionMouseUp() {
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

    setWordLookup({
      word,
      meaning: "",
      example: "",
      top: rect.bottom,
      left: rect.left,
      loading: true,
      added: false,
      error: null,
    });
    lookupWord(word, contextSentence);
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
        }),
      });
      if (!res.ok) throw new Error();
      setWordLookup((w) => (w ? { ...w, added: true } : w));
    } catch {
      setWordLookup((w) => (w ? { ...w, error: "Không thêm được, thử lại." } : w));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Chat với AI</h1>
          <p className="text-sm text-muted">
            Trò chuyện tự nhiên bằng tiếng Anh. Gia sư sẽ sửa lỗi nhẹ nhàng ngay
            trong câu trả lời.
          </p>
        </div>
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

      {/* Khung hội thoại */}
      <div
        ref={scrollRef}
        onMouseUp={handleSelectionMouseUp}
        aria-live="polite"
        className="flex h-[55vh] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-4"
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
                        className="mt-1 border-t border-border/50 pt-1 text-[13px] italic text-muted"
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
          className="fixed z-50 w-64 rounded-xl border border-border bg-surface p-3 text-sm shadow-lg"
          style={{
            top: wordLookup.top + 6,
            left: Math.min(wordLookup.left, Math.max(8, window.innerWidth - 272)),
          }}
        >
          <p className="mb-1 font-medium">{wordLookup.word}</p>
          {wordLookup.loading ? (
            <p className="text-muted">Đang tra…</p>
          ) : wordLookup.error ? (
            <p className="text-accent-text">{wordLookup.error}</p>
          ) : (
            <>
              <p className="text-muted">{wordLookup.meaning}</p>
              <button
                onClick={addWordToDeck}
                disabled={wordLookup.added}
                className="mt-2 cursor-pointer text-xs text-primary-text hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {wordLookup.added ? "✓ Đã thêm" : "+ Thêm vào flashcard"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

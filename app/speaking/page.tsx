"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CefrLevel } from "@/lib/cefr";
import { buildSegments, InlineError } from "@/lib/highlight";
import type { ChatTurn } from "@/lib/agents/tutor";

type SpeakingMode = "prompt" | "conversation";

interface SpeakingPromptClient {
  id: number;
  title: string;
  instruction: string;
  minWords: number;
}

type SpeakingError = InlineError;

interface SpeakingResult {
  cefrLevel: CefrLevel;
  taskAchievement: string;
  grammarVocab: string;
  errors: SpeakingError[];
  strengths: string[];
  weaknesses: string[];
  transcript: string;
  wordCount: number;
  wpm: number | null;
  fillerCount: number;
  fillerRatio: number;
  assessorUsed: boolean;
}

const GRADING_STAGES = ["Đang nghe lại bài nói…", "Đang chấm theo CEFR…", "Đang tổng hợp nhận xét…"];

// Kiểu tối thiểu cho Web Speech API (không có sẵn trong lib.dom mặc định của TS)
// — chỉ khai báo đúng phần app dùng, tránh phải cài thêm package chỉ cho việc này.
interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}
interface SpeechErrorEventLike {
  error: string; // "not-allowed" | "no-speech" | "network" | "audio-capture" | ...
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function formatMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

export default function SpeakingPage() {
  const [mode, setMode] = useState<SpeakingMode>("prompt");
  const [prompt, setPrompt] = useState<SpeakingPromptClient | null>(null);
  const [level, setLevel] = useState<CefrLevel>("A2");
  const [sttSupported, setSttSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [durationSec, setDurationSec] = useState(0);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState<SpeakingResult | null>(null);
  const [error, setError] = useState("");
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const startedAtRef = useRef<number>(0);
  const transcriptRef = useRef(""); // giữ bản mới nhất để seed lại nếu ghi âm bị ngắt và bấm tiếp

  // ----- Chế độ "Trò chuyện tự do" -----
  const [convTurns, setConvTurns] = useState<ChatTurn[]>([]);
  const [convStarted, setConvStarted] = useState(false);
  const [convLoading, setConvLoading] = useState(false);
  const convScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  // Đồng hồ đếm giờ trực quan khi đang ghi âm — vừa xác nhận "mic đang nghe thật",
  // vừa cho người dùng canh thời lượng nói (chỉ số wpm phụ thuộc trực tiếp vào đây).
  // Cộng thêm durationSec đã tích lũy từ các lượt ghi trước (nếu có).
  useEffect(() => {
    if (!recording) return;
    const tick = () => setLiveElapsed(durationSec + Math.round((Date.now() - startedAtRef.current) / 1000));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  function loadPrompt() {
    setError("");
    setResult(null);
    setTranscript("");
    setDurationSec(0);
    fetch("/api/speaking")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setPrompt(d.prompt ?? null);
        setLevel(d.level ?? "A2");
      })
      .catch(() => setError("Không tải được đề bài."));
  }

  useEffect(() => {
    setSttSupported(!!getSpeechRecognitionCtor());
    loadPrompt(); // cũng lấy "level" dùng chung cho cả chế độ trò chuyện tự do
  }, []);

  useEffect(() => {
    if (!submitting) return;
    setStageIdx(0);
    const t = setInterval(() => setStageIdx((i) => Math.min(i + 1, GRADING_STAGES.length - 1)), 2500);
    return () => clearInterval(t);
  }, [submitting]);

  // Tự cuộn xuống lượt hội thoại mới nhất.
  useEffect(() => {
    convScrollRef.current?.scrollTo(0, convScrollRef.current.scrollHeight);
  }, [convTurns, convLoading]);

  // Gọi /api/tutor (style="casual-speaking") với lịch sử hiện tại, đổ dần chữ vào
  // lượt "model" cuối cùng (streaming) — cùng pattern với app/chat/page.tsx.
  // history rỗng -> AI tự mở lời bằng 1 câu hỏi đời thường.
  async function streamCompanionReply(history: ChatTurn[]) {
    setConvLoading(true);
    setConvTurns((t) => [...t, { role: "model", text: "" }]);
    let finalText = "";
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, history, style: "casual-speaking" }),
      });
      if (!res.body) throw new Error("Không nhận được phản hồi");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        finalText += chunk;
        setConvTurns((t) => {
          const copy = [...t];
          copy[copy.length - 1] = { role: "model", text: copy[copy.length - 1].text + chunk };
          return copy;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lỗi kết nối";
      finalText = `[Lỗi] ${msg}`;
      setConvTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = { role: "model", text: finalText };
        return copy;
      });
    } finally {
      setConvLoading(false);
    }
    if (finalText && !finalText.startsWith("[Lỗi]")) speak(finalText);
  }

  function startConversation() {
    setError("");
    setResult(null);
    setConvTurns([]);
    setTranscript("");
    setDurationSec(0);
    setConvStarted(true);
    streamCompanionReply([]);
  }

  // Gửi lượt nói của người học (transcript hiện tại) vào hội thoại, rồi lấy câu hỏi
  // tiếp theo của AI dựa trên câu trả lời đó.
  function submitUserTurn() {
    const clean = transcript.trim();
    if (!clean || convLoading || recording) return;
    const history: ChatTurn[] = [...convTurns, { role: "user", text: clean }];
    setConvTurns(history);
    setTranscript(""); // sẵn sàng ghi lượt tiếp theo — durationSec KHÔNG reset, cộng dồn cả buổi
    streamCompanionReply(history);
  }

  const convUserWordCount = convTurns
    .filter((t) => t.role === "user")
    .reduce((sum, t) => sum + (t.text.trim() ? t.text.trim().split(/\s+/).length : 0), 0);
  const canEndConversation =
    convTurns.some((t) => t.role === "user") && !convLoading && !recording && !submitting;

  // Kết thúc hội thoại: ghép toàn bộ lượt NÓI của người học + câu hỏi mở đầu của AI
  // (làm "chủ đề") gửi lên /api/speaking để chấm giống hệt chế độ theo đề bài.
  async function submitConversation() {
    if (!canEndConversation || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const userTranscript = convTurns
        .filter((t) => t.role === "user")
        .map((t) => t.text.trim())
        .join(" ");
      const topic = convTurns.find((t) => t.role === "model")?.text ?? "";
      const res = await fetch("/api/speaking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation: { topic, transcript: userTranscript }, durationSec }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi chấm bài");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setSubmitting(false);
    }
  }

  function resetConversation() {
    setConvStarted(false);
    setResult(null);
    startConversation();
  }

  useEffect(() => {
    if (result) resultHeadingRef.current?.focus();
  }, [result]);

  function startRecording() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    setError("");
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    // Seed từ transcript đã có (không phải ""!): trình duyệt có thể tự ngắt phiên nghe
    // (im lặng lâu, mất mạng) — nếu người dùng bấm "Bắt đầu nói" lại, phải NỐI TIẾP
    // chứ không được ghi đè, kẻo mất sạch nội dung đã nói trước đó.
    let finalText = transcriptRef.current ? transcriptRef.current + " " : "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setTranscript((finalText + interim).trim());
    };
    recognition.onerror = (event) => {
      setError(
        event?.error === "not-allowed"
          ? "Không có quyền truy cập micro. Vui lòng cấp quyền micro cho trang này rồi thử lại."
          : "Nhận diện giọng nói bị gián đoạn — nội dung đã nói vẫn được giữ, bấm \"Bắt đầu nói\" để nói tiếp."
      );
    };
    // Trình duyệt luôn gọi onend sau cùng (kể cả sau lỗi) -> cộng dồn thời lượng ở đây,
    // tránh cộng 2 lần nếu cả onerror lẫn onend cùng bắn.
    recognition.onend = () => {
      setDurationSec((d) => d + Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)));
      setRecording(false);
    };

    recognitionRef.current = recognition;
    startedAtRef.current = Date.now();
    setLiveElapsed(0);
    setRecording(true);
    recognition.start();
  }

  function stopRecording() {
    recognitionRef.current?.stop(); // onend sẽ tự chạy và cộng dồn thời lượng
  }

  // Đồng hồ thủ công cho trường hợp trình duyệt không hỗ trợ nhận diện giọng nói
  // (người dùng tự gõ những gì định nói) — vẫn tính được thời lượng để đo tốc độ nói.
  function startManualTimer() {
    startedAtRef.current = Date.now();
    setLiveElapsed(0);
    setRecording(true);
  }
  function stopManualTimer() {
    setDurationSec((d) => d + Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)));
    setRecording(false);
  }

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const canSubmit = !!prompt && wordCount > 0 && !recording;

  async function submit() {
    if (!canSubmit || !prompt || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/speaking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: prompt.id, transcript, durationSec }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi chấm bài");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setSubmitting(false);
    }
  }

  // ----- Màn kết quả (dùng chung cho cả 2 chế độ — Assessor trả về cùng 1 hình dạng dữ liệu) -----
  if (result) {
    const { segments, unmatchedCount } = buildSegments(result.transcript, result.errors);
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <h1 ref={resultHeadingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
          Kết quả bài nói
        </h1>

        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">Trình độ bài nói này thể hiện</p>
          <h2 className="font-heading my-1 text-5xl font-semibold text-primary">
            {result.cefrLevel}
          </h2>
          <p className="text-sm text-muted">
            {result.wordCount} từ · {result.errors.length} lỗi ngữ pháp
          </p>
        </div>

        {/* Chỉ số trôi chảy — đo trực tiếp, không qua AI, nên đây là bằng chứng khách quan nhất */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl border border-border bg-surface p-3 text-center">
            <p className="text-2xl font-semibold text-primary-text">{result.wpm ?? "—"}</p>
            <p className="text-xs text-muted">từ/phút</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3 text-center">
            <p className="text-2xl font-semibold text-primary-text">{result.fillerCount}</p>
            <p className="text-xs text-muted">từ đệm (um, uh…)</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3 text-center">
            <p className="text-2xl font-semibold text-primary-text">
              {Math.round(result.fillerRatio * 100)}%
            </p>
            <p className="text-xs text-muted">tỉ lệ từ đệm</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="mb-2 text-sm font-medium">Bạn đã nói (lỗi được đánh dấu)</p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
            {segments.map((seg, i) =>
              seg.error ? (
                <mark
                  key={i}
                  className="rounded bg-accent/20 px-0.5 text-text underline decoration-accent-text decoration-2 underline-offset-2"
                >
                  {seg.text}
                  <a
                    href={`#s-error-${seg.error.idx + 1}`}
                    aria-label={`Xem chi tiết lỗi số ${seg.error.idx + 1}`}
                    className="ml-0.5 inline-flex h-4 min-w-4 cursor-pointer items-center justify-center rounded-full bg-accent-text px-1 align-super text-[10px] font-medium text-white no-underline"
                  >
                    {seg.error.idx + 1}
                  </a>
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )}
          </p>
          {unmatchedCount > 0 && (
            <p className="mt-2 text-xs text-muted">
              {unmatchedCount} lỗi không xác định được vị trí chính xác — xem đầy đủ ở
              danh sách bên dưới.
            </p>
          )}
        </div>

        {result.errors.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="mb-2 text-sm font-medium">Chi tiết từng lỗi</p>
            <ol className="flex flex-col gap-2">
              {result.errors.map((e, i) => (
                <li
                  key={i}
                  id={`s-error-${i + 1}`}
                  className="scroll-mt-4 rounded-lg border border-accent/30 bg-accent/5 p-2 text-sm"
                >
                  <span className="font-medium text-accent-text">{i + 1}.</span>{" "}
                  <span className="line-through">{e.original}</span> →{" "}
                  <span className="font-medium text-primary-text">{e.correction}</span>
                  <span className="block text-muted">{e.explanation}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm">
            <span className="font-medium">Đáp ứng đề bài: </span>
            {result.taskAchievement}
          </p>
          <p className="mt-2 text-sm">
            <span className="font-medium">Ngữ pháp & từ vựng: </span>
            {result.grammarVocab}
          </p>
          {result.strengths.length > 0 && (
            <p className="mt-3 text-sm">
              <span className="font-medium text-primary-text">Điểm mạnh: </span>
              {result.strengths.join("; ")}
            </p>
          )}
          {result.weaknesses.length > 0 && (
            <p className="mt-1 text-sm">
              <span className="font-medium text-accent-text">Cần cải thiện: </span>
              {result.weaknesses.join("; ")}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={mode === "conversation" ? resetConversation : loadPrompt}
            className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
          >
            {mode === "conversation" ? "Trò chuyện mới" : "Nói đề khác"}
          </button>
          <Link
            href="/"
            className="cursor-pointer rounded-xl border border-border px-5 py-2.5 transition-colors duration-200 hover:border-primary"
          >
            Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

  function switchMode(next: SpeakingMode) {
    if (next === mode) return;
    setMode(next);
    setError("");
    setResult(null);
    setTranscript("");
    setDurationSec(0);
    if (next === "conversation" && !convStarted) startConversation();
  }

  // ----- Màn ghi âm/luyện nói -----
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Nói</h1>
        <p className="text-sm text-muted">
          {mode === "prompt"
            ? "Nói theo đề, AI chấm ngữ pháp + đo tốc độ nói và từ đệm."
            : "Trò chuyện tự nhiên với AI — AI hỏi chuyện đời thường và hỏi tiếp dựa trên câu trả lời của bạn."}
        </p>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Chế độ luyện Nói">
        <button
          role="tab"
          aria-selected={mode === "prompt"}
          onClick={() => switchMode("prompt")}
          className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-200 ${
            mode === "prompt"
              ? "bg-primary text-white"
              : "border border-border text-muted hover:border-primary hover:text-text"
          }`}
        >
          Theo đề bài
        </button>
        <button
          role="tab"
          aria-selected={mode === "conversation"}
          onClick={() => switchMode("conversation")}
          className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-200 ${
            mode === "conversation"
              ? "bg-primary text-white"
              : "border border-border text-muted hover:border-primary hover:text-text"
          }`}
        >
          Trò chuyện tự do
        </button>
      </div>

      {error && <p className="rounded-md bg-accent/10 p-3 text-sm text-accent-text">{error}</p>}

      {!sttSupported && (
        <p className="rounded-md bg-accent/10 p-3 text-xs text-accent-text">
          Trình duyệt này chưa hỗ trợ nhận diện giọng nói (hãy dùng Chrome/Edge để nói
          trực tiếp). Bạn vẫn có thể luyện bằng cách gõ những gì định nói bên dưới,
          bấm &quot;Bắt đầu&quot;/&quot;Dừng&quot; để tính thời gian.
        </p>
      )}

      {mode === "prompt" && (
        <>
          {prompt ? (
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <p className="font-medium">{prompt.title}</p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-text">
                  {level}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{prompt.instruction}</p>
              <p className="mt-1 text-xs text-muted">Gợi ý: tối thiểu ~{prompt.minWords} từ</p>
              <button
                onClick={() => speak(prompt.instruction)}
                className="mt-1 cursor-pointer text-xs text-primary-text hover:underline"
              >
                🔊 Nghe lại đề
              </button>

              <div className="mt-3 flex items-center gap-3">
                {sttSupported ? (
                  <button
                    onClick={recording ? stopRecording : startRecording}
                    aria-pressed={recording}
                    className={`cursor-pointer rounded-xl px-4 py-2 font-medium text-white transition-colors duration-200 ${
                      recording ? "bg-accent hover:bg-accent-text" : "bg-primary hover:bg-primary-dark"
                    }`}
                  >
                    {recording ? "⏹ Dừng" : "🎤 Bắt đầu nói"}
                  </button>
                ) : (
                  <button
                    onClick={recording ? stopManualTimer : startManualTimer}
                    aria-pressed={recording}
                    className={`cursor-pointer rounded-xl px-4 py-2 font-medium text-white transition-colors duration-200 ${
                      recording ? "bg-accent hover:bg-accent-text" : "bg-primary hover:bg-primary-dark"
                    }`}
                  >
                    {recording ? "⏹ Dừng" : "▶ Bắt đầu"}
                  </button>
                )}
                {recording && (
                  <span aria-live="polite" className="flex items-center gap-2 text-sm text-accent-text">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-accent-text" />
                    Đang {sttSupported ? "nghe" : "tính giờ"}… {formatMmSs(liveElapsed)}
                  </span>
                )}
              </div>

              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={6}
                disabled={submitting || (sttSupported && recording)}
                aria-label={sttSupported ? "Nội dung nhận diện được (có thể sửa nếu nghe nhầm)" : "Gõ nội dung bạn định nói"}
                placeholder={
                  sttSupported
                    ? "Nội dung nhận diện giọng nói sẽ hiện ở đây — bạn có thể sửa nếu bị nghe nhầm…"
                    : "Gõ những gì bạn định nói vào đây…"
                }
                className="mt-3 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>
                  {wordCount} từ{durationSec > 0 ? ` · ${formatMmSs(durationSec)}` : ""}
                </span>
                <button
                  onClick={loadPrompt}
                  disabled={submitting || recording}
                  className="cursor-pointer text-primary-text hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Đổi đề khác
                </button>
              </div>
            </div>
          ) : (
            !error && <p className="text-sm text-muted">Đang tải đề bài…</p>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="cursor-pointer rounded-xl bg-primary px-5 py-3 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Đang chấm…" : canSubmit ? "Nộp & xem kết quả" : "Hãy nói/nhập nội dung trước"}
          </button>
        </>
      )}

      {mode === "conversation" && (
        <>
          <div
            ref={convScrollRef}
            className="flex max-h-[420px] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-4"
          >
            {convTurns.length === 0 && !convLoading && (
              <p className="text-sm text-muted">Đang bắt đầu cuộc trò chuyện…</p>
            )}
            {convTurns.map((t, i) => (
              <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                    t.role === "user" ? "bg-[var(--user-bubble)] text-white" : "bg-bg"
                  }`}
                >
                  {t.text || (t.role === "model" && convLoading ? "…" : "")}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              {sttSupported ? (
                <button
                  onClick={recording ? stopRecording : startRecording}
                  disabled={convLoading}
                  aria-pressed={recording}
                  className={`cursor-pointer rounded-xl px-4 py-2 font-medium text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                    recording ? "bg-accent hover:bg-accent-text" : "bg-primary hover:bg-primary-dark"
                  }`}
                >
                  {recording ? "⏹ Dừng" : "🎤 Bắt đầu nói"}
                </button>
              ) : (
                <button
                  onClick={recording ? stopManualTimer : startManualTimer}
                  disabled={convLoading}
                  aria-pressed={recording}
                  className={`cursor-pointer rounded-xl px-4 py-2 font-medium text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                    recording ? "bg-accent hover:bg-accent-text" : "bg-primary hover:bg-primary-dark"
                  }`}
                >
                  {recording ? "⏹ Dừng" : "▶ Bắt đầu"}
                </button>
              )}
              {recording && (
                <span aria-live="polite" className="flex items-center gap-2 text-sm text-accent-text">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent-text" />
                  Đang {sttSupported ? "nghe" : "tính giờ"}… {formatMmSs(liveElapsed)}
                </span>
              )}
            </div>

            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={2}
              disabled={submitting || convLoading || (sttSupported && recording)}
              aria-label={sttSupported ? "Nội dung nhận diện được (có thể sửa nếu nghe nhầm)" : "Gõ nội dung bạn định nói"}
              placeholder={
                sttSupported
                  ? "Nội dung nhận diện giọng nói sẽ hiện ở đây…"
                  : "Gõ những gì bạn định nói vào đây…"
              }
              className="mt-3 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted">
                {convUserWordCount} từ đã nói{durationSec > 0 ? ` · ${formatMmSs(durationSec)}` : ""}
              </span>
              <button
                onClick={submitUserTurn}
                disabled={!transcript.trim() || recording || convLoading || submitting}
                className="cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                Gửi & nghe câu hỏi tiếp
              </button>
            </div>
          </div>

          <button
            onClick={submitConversation}
            disabled={!canEndConversation}
            className="cursor-pointer rounded-xl bg-accent px-5 py-3 font-medium text-white transition-colors duration-200 hover:bg-accent-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Đang chấm…" : "Kết thúc & chấm điểm"}
          </button>
        </>
      )}

      {submitting && (
        <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
          <span className="typing-dots">
            <span />
            <span />
            <span />
          </span>
          {GRADING_STAGES[stageIdx]}
        </p>
      )}
    </div>
  );
}

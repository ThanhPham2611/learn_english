"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CefrLevel } from "@/lib/cefr";

interface ListeningQuestionClient {
  id: number;
  prompt: string;
  options: string[];
}

interface ListeningPassageClient {
  id: number;
  level: CefrLevel;
  title: string;
  text: string;
  questions: ListeningQuestionClient[];
}

interface QuestionResult {
  id: number;
  prompt: string;
  chosenText: string;
  correctText: string;
  isCorrect: boolean;
}

interface ListeningResult {
  correct: number;
  total: number;
  cefrLevel: CefrLevel;
  questionResults: QuestionResult[];
}

function speak(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.95;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
  return true;
}

export default function ListeningPage() {
  const [passage, setPassage] = useState<ListeningPassageClient | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ListeningResult | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(true);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  function loadPassage() {
    setError("");
    setResult(null);
    setAnswers({});
    setShowTranscript(false);
    fetch("/api/listening")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setPassage(d.passage ?? null);
      })
      .catch(() => setError("Không tải được bài nghe."));
  }

  useEffect(() => {
    setTtsSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    loadPassage();
  }, []);

  useEffect(() => {
    if (result) resultHeadingRef.current?.focus();
  }, [result]);

  function playPassage() {
    if (!passage) return;
    setPlaying(true);
    const ok = speak(passage.text, () => setPlaying(false));
    if (!ok) {
      setPlaying(false);
      setShowTranscript(true); // không hỗ trợ TTS -> hiện transcript ngay để vẫn học được
    }
  }

  const answeredCount = passage ? passage.questions.filter((q) => q.id in answers).length : 0;
  const allAnswered = !!passage && answeredCount === passage.questions.length;

  async function submit() {
    if (!allAnswered || !passage || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/listening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passageId: passage.id, answers }),
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

  // ----- Màn kết quả -----
  if (result && passage) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <h1 ref={resultHeadingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
          Kết quả bài nghe
        </h1>

        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">Trình độ bài nghe này thể hiện</p>
          <h2 className="font-heading my-1 text-5xl font-semibold text-primary">
            {result.cefrLevel}
          </h2>
          <p className="text-sm text-muted">
            {result.correct}/{result.total} câu đúng
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="mb-2 text-sm font-medium">Chi tiết từng câu</p>
          <ul className="flex flex-col gap-2">
            {result.questionResults.map((q, i) => (
              <li
                key={q.id}
                className={`rounded-lg border p-2 text-sm ${
                  q.isCorrect ? "border-border" : "border-accent/40 bg-accent/5"
                }`}
              >
                <span className={q.isCorrect ? "text-primary-text" : "text-accent-text"}>
                  {q.isCorrect ? "✓" : "✗"}
                </span>{" "}
                Câu {i + 1}: {q.prompt}
                {!q.isCorrect && (
                  <span className="block text-muted">
                    Bạn chọn &quot;{q.chosenText}&quot; — đáp án đúng: &quot;{q.correctText}&quot;
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            onClick={loadPassage}
            className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
          >
            Nghe bài khác
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

  // ----- Màn nghe + trả lời -----
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nghe</h1>
        <p className="text-sm text-muted">
          Nghe đoạn hội thoại rồi trả lời câu hỏi bên dưới.
        </p>
      </div>

      {error && <p className="rounded-md bg-accent/10 p-3 text-sm text-accent-text">{error}</p>}

      {passage && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <p className="font-medium">{passage.title}</p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-text">
              {passage.level}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {ttsSupported && (
              <button
                onClick={playPassage}
                disabled={playing}
                className="cursor-pointer rounded-xl bg-primary px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {playing ? "🔊 Đang phát…" : "▶ Nghe đoạn hội thoại"}
              </button>
            )}
            <button
              onClick={() => setShowTranscript((s) => !s)}
              aria-pressed={showTranscript}
              className="cursor-pointer text-sm text-primary-text hover:underline"
            >
              {showTranscript ? "Ẩn transcript" : "Hiện transcript"}
            </button>
          </div>

          {!ttsSupported && (
            <p className="mt-2 text-xs text-accent-text">
              Trình duyệt này chưa hỗ trợ phát âm thanh tự động — đọc transcript bên dưới thay thế.
            </p>
          )}

          {showTranscript && (
            <p className="mt-3 rounded-lg bg-bg p-3 text-sm leading-relaxed">{passage.text}</p>
          )}
        </div>
      )}

      {passage && (
        <div
          className="sticky top-2 z-10 rounded-full border border-border bg-surface px-4 py-2 text-sm text-muted shadow-sm"
          aria-live="polite"
        >
          Đã trả lời: {answeredCount}/{passage.questions.length} câu
        </div>
      )}

      {passage?.questions.map((q, idx) => (
        <fieldset key={q.id} className="rounded-xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">
            Câu {idx + 1}. {q.prompt}
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {q.options.map((opt, oi) => (
              <label
                key={oi}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2 ${
                  answers[q.id] === oi
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary"
                }`}
              >
                <input
                  type="radio"
                  name={`lq${q.id}`}
                  checked={answers[q.id] === oi}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                  className="accent-primary"
                />
                {opt}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {!passage && !error && <p className="text-sm text-muted">Đang tải bài nghe…</p>}

      <button
        onClick={submit}
        disabled={!allAnswered || submitting}
        className="cursor-pointer rounded-xl bg-primary px-5 py-3 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? "Đang chấm…"
          : allAnswered
            ? "Nộp bài & xem kết quả"
            : `Hãy trả lời hết các câu (${answeredCount}/${passage?.questions.length ?? 0})`}
      </button>
    </div>
  );
}

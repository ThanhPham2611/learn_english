"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CefrLevel } from "@/lib/cefr";
import { escapeRegex } from "@/lib/highlight";

interface ReadingQuestionClient {
  id: number;
  prompt: string;
  options: string[];
}

interface ReadingVocab {
  word: string;
  meaning: string;
  example: string;
}

interface ReadingPassageClient {
  id: number;
  level: CefrLevel;
  title: string;
  text: string;
  vocab: ReadingVocab[];
  questions: ReadingQuestionClient[];
}

interface QuestionResult {
  id: number;
  prompt: string;
  chosenText: string;
  correctText: string;
  isCorrect: boolean;
}

interface ReadingResult {
  correct: number;
  total: number;
  cefrLevel: CefrLevel;
  questionResults: QuestionResult[];
  vocab: ReadingVocab[];
  newVocabAdded: number;
}

// Bôi đậm từ mới ngay trong bài đọc — giữ từ và nghĩa cùng ngữ cảnh câu gốc
// (thay vì tách rời hoàn toàn khỏi danh sách bên dưới), giúp ghi nhớ tốt hơn.
function renderWithVocabHighlight(text: string, vocab: ReadingVocab[]) {
  if (vocab.length === 0) return text;
  const pattern = vocab.map((v) => escapeRegex(v.word)).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  return parts.map((part, i) => {
    const isVocab = vocab.some((v) => v.word.toLowerCase() === part.toLowerCase());
    return isVocab ? (
      <mark
        key={i}
        className="rounded bg-primary/15 px-0.5 font-medium text-primary-text underline decoration-primary/40 underline-offset-2"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

export default function ReadingPage() {
  const [passage, setPassage] = useState<ReadingPassageClient | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReadingResult | null>(null);
  const [error, setError] = useState("");
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  function loadPassage() {
    setError("");
    setResult(null);
    setAnswers({});
    fetch("/api/reading")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setPassage(d.passage ?? null);
      })
      .catch(() => setError("Không tải được bài đọc."));
  }

  useEffect(loadPassage, []);

  useEffect(() => {
    if (result) resultHeadingRef.current?.focus();
  }, [result]);

  const answeredCount = passage ? passage.questions.filter((q) => q.id in answers).length : 0;
  const allAnswered = !!passage && answeredCount === passage.questions.length;

  async function submit() {
    if (!allAnswered || !passage || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/reading", {
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
          Kết quả bài đọc
        </h1>

        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">Trình độ bài đọc này thể hiện</p>
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

        {/* Từ mới đã đưa vào bộ ôn tập — đây là cầu nối sang SRS. */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="mb-2 text-sm font-medium">
            Từ mới trong bài{" "}
            {result.newVocabAdded > 0 && (
              <span className="text-xs font-normal text-primary-text">
                (+{result.newVocabAdded} từ vừa thêm vào bộ ôn)
              </span>
            )}
          </p>
          <ul className="flex flex-col gap-2">
            {result.vocab.map((v) => (
              <li key={v.word} className="rounded-lg bg-bg p-2 text-sm">
                <span className="font-medium">{v.word}</span> — {v.meaning}
                <span className="block text-muted">&quot;{v.example}&quot;</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            onClick={loadPassage}
            className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
          >
            Đọc bài khác
          </button>
          <Link
            href="/vocab"
            className="cursor-pointer rounded-xl border border-border px-5 py-2.5 transition-colors duration-200 hover:border-primary"
          >
            Ôn từ vựng ngay
          </Link>
        </div>
      </div>
    );
  }

  // ----- Màn đọc + trả lời -----
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Đọc</h1>
        <p className="text-sm text-muted">
          Đọc bài rồi trả lời câu hỏi. Từ mới trong bài sẽ được thêm vào bộ ôn tập.
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
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">
            {renderWithVocabHighlight(passage.text, passage.vocab)}
          </p>
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
                  name={`rq${q.id}`}
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

      {!passage && !error && <p className="text-sm text-muted">Đang tải bài đọc…</p>}

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

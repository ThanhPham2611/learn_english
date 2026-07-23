"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { setLevel } from "@/lib/profile";
import { CefrLevel } from "@/lib/cefr";

interface ClientQuestion {
  id: number;
  prompt: string;
  options: string[];
}

interface QuestionResult {
  id: number;
  prompt: string;
  chosenText: string;
  correctText: string;
  isCorrect: boolean;
}

interface PlacementResult {
  overallLevel: CefrLevel;
  writingLevel: CefrLevel;
  rationale: string;
  strengths: string[];
  weaknesses: string[];
  mcqCorrect: number;
  mcqTotal: number;
  assessorUsed: boolean;
  questionResults: QuestionResult[];
}

export default function PlacementPage() {
  const [questions, setQuestions] = useState<ClientQuestion[]>([]);
  const [writingPrompt, setWritingPrompt] = useState("");
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [writingSample, setWritingSample] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/placement")
      .then((r) => r.json())
      .then((d) => {
        setQuestions(d.questions ?? []);
        setWritingPrompt(d.writingPrompt ?? "");
      })
      .catch(() => setError("Không tải được bài test."));
  }, []);

  const answeredCount = questions.filter((q) => q.id in answers).length;
  const mcqDone = questions.length > 0 && answeredCount === questions.length;
  const writingDone = writingSample.trim().length > 0;
  const canSubmit = mcqDone && writingDone;

  let submitLabel = "Nộp bài & xem trình độ";
  if (!mcqDone) submitLabel = `Hãy trả lời hết các câu trắc nghiệm (${answeredCount}/${questions.length})`;
  else if (!writingDone) submitLabel = "Hãy viết ít nhất 1 câu ở phần Viết";

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/placement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, writingSample }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi chấm bài");
      setResult(data);
      setLevel(data.overallLevel); // đồng bộ để trang Chat dùng ngay
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setSubmitting(false);
    }
  }

  // ----- Màn kết quả -----
  if (result) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <h1 className="text-2xl font-semibold">Kết quả đầu vào</h1>

        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">Trình độ tổng của bạn</p>
          <h2 className="font-heading my-1 text-5xl font-semibold text-primary">
            {result.overallLevel}
          </h2>
          <p className="text-sm text-muted">
            Trắc nghiệm: {result.mcqCorrect}/{result.mcqTotal} đúng · Viết:{" "}
            {result.assessorUsed ? result.writingLevel : "chưa đánh giá"}
          </p>

          {!result.assessorUsed && (
            <p className="mt-3 rounded-md bg-accent/10 p-2 text-xs text-accent-text">
              Phần Viết chưa được AI chấm (thiếu/lỗi GEMINI_API_KEY) — trình độ trên
              chỉ dựa vào trắc nghiệm. Điền key vào .env.local rồi làm lại để có kết
              quả đầy đủ.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm">
            <span className="font-medium">Nhận xét: </span>
            {result.rationale}
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

        {/* Bằng chứng cụ thể từng câu — để người dùng tự kiểm tra, không chỉ tin lời AI. */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <button
            onClick={() => setShowDetail((s) => !s)}
            className="flex w-full cursor-pointer items-center justify-between text-left text-sm font-medium"
            aria-expanded={showDetail}
          >
            Xem chi tiết từng câu trắc nghiệm
            <span className="text-muted">{showDetail ? "▲" : "▼"}</span>
          </button>
          {showDetail && (
            <ul className="mt-3 flex flex-col gap-2">
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
                      Bạn chọn &quot;{q.chosenText}&quot; — đáp án đúng: &quot;
                      {q.correctText}&quot;
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-3">
          <Link
            href="/chat"
            className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
          >
            Bắt đầu học
          </Link>
          <button
            onClick={() => {
              setResult(null);
              setAnswers({});
              setWritingSample("");
              setShowDetail(false);
            }}
            className="cursor-pointer rounded-xl border border-border px-5 py-2.5 transition-colors duration-200 hover:border-primary"
          >
            Làm lại
          </button>
        </div>
      </div>
    );
  }

  // ----- Màn làm bài -----
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Bài test đầu vào</h1>
        <p className="text-sm text-muted">
          Chọn đáp án đúng cho mỗi câu, rồi viết vài câu ở cuối. Kết quả xác định
          trình độ CEFR ban đầu để cá nhân hóa việc học.
        </p>
      </div>

      {questions.length > 0 && (
        <div
          className="sticky top-2 z-10 rounded-full border border-border bg-surface px-4 py-2 text-sm text-muted shadow-sm"
          aria-live="polite"
        >
          Đã trả lời: {answeredCount}/{questions.length} câu trắc nghiệm
          {writingDone ? " · Đã viết phần Viết ✓" : ""}
        </div>
      )}

      {error && (
        <p className="rounded-md bg-accent/10 p-3 text-sm text-accent-text">{error}</p>
      )}

      {questions.map((q, idx) => (
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
                  name={`q${q.id}`}
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

      {questions.length > 0 && (
        <fieldset className="rounded-xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">
            Phần viết <span className="text-accent-text">(bắt buộc)</span>
          </legend>
          <p className="mb-2 text-sm text-muted">{writingPrompt}</p>
          <textarea
            value={writingSample}
            onChange={(e) => setWritingSample(e.target.value)}
            rows={4}
            aria-label="Đoạn viết mẫu (bắt buộc)"
            placeholder="Write here in English…"
            className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </fieldset>
      )}

      <button
        onClick={submit}
        disabled={!canSubmit || submitting}
        className="cursor-pointer rounded-xl bg-primary px-5 py-3 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Đang chấm…" : submitLabel}
      </button>
    </div>
  );
}

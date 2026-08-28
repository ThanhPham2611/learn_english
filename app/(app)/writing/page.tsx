"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CefrLevel } from "@/lib/cefr";
import { buildSegments, InlineError } from "@/lib/highlight";

interface WritingPromptClient {
  id: number;
  title: string;
  instruction: string;
  minWords: number;
}

type WritingError = InlineError;

interface WritingResult {
  cefrLevel: CefrLevel;
  taskAchievement: string;
  grammarVocab: string;
  errors: WritingError[];
  strengths: string[];
  weaknesses: string[];
  wordCount: number;
  assessorUsed: boolean;
  essay: string; // bản essay server đã thực sự chấm — dùng để highlight cho khớp
}

const GRADING_STAGES = ["Đang đọc bài…", "Đang chấm theo CEFR…", "Đang tổng hợp nhận xét…"];

export default function WritingPage() {
  const [prompt, setPrompt] = useState<WritingPromptClient | null>(null);
  const [level, setLevel] = useState<CefrLevel>("A2");
  const [essay, setEssay] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState<WritingResult | null>(null);
  const [error, setError] = useState("");
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  function loadPrompt() {
    setError("");
    setResult(null);
    fetch("/api/writing")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setPrompt(d.prompt ?? null);
        setLevel(d.level ?? "A2");
      })
      .catch(() => setError("Không tải được đề bài."));
  }

  useEffect(loadPrompt, []);

  // Chuyển động thông báo tiến trình trong lúc chờ AI chấm (cuộc gọi vài giây).
  useEffect(() => {
    if (!submitting) return;
    setStageIdx(0);
    const t = setInterval(() => setStageIdx((i) => Math.min(i + 1, GRADING_STAGES.length - 1)), 2500);
    return () => clearInterval(t);
  }, [submitting]);

  // Đưa focus tới tiêu đề kết quả khi bài được chấm xong, để người dùng dùng bàn
  // phím/trình đọc màn hình biết ngay là đã có kết quả mới.
  useEffect(() => {
    if (result) resultHeadingRef.current?.focus();
  }, [result]);

  const wordCount = essay.trim() ? essay.trim().split(/\s+/).length : 0;
  const canSubmit = !!prompt && wordCount > 0;

  async function submit() {
    if (!canSubmit || !prompt || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/writing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: prompt.id, essay }),
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
  if (result && prompt) {
    const { segments, unmatchedCount } = buildSegments(result.essay, result.errors);
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <h1
          ref={resultHeadingRef}
          tabIndex={-1}
          className="text-2xl font-semibold outline-none"
        >
          Kết quả bài viết
        </h1>

        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">Trình độ bài viết này thể hiện</p>
          <h2 className="font-heading my-1 text-5xl font-semibold text-primary">
            {result.cefrLevel}
          </h2>
          <p className="text-sm text-muted">
            {result.wordCount} từ · {result.errors.length} lỗi được chỉ ra
          </p>
          {!result.assessorUsed && (
            <p className="mt-3 rounded-md bg-accent/10 p-2 text-xs text-accent-text">
              Chưa chấm được bằng AI. Vui lòng thử lại.
            </p>
          )}
        </div>

        {/* Bài viết gốc, lỗi được highlight ngay trong ngữ cảnh; số nhỏ bấm được -> nhảy tới chi tiết */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="mb-2 text-sm font-medium">Bài của bạn (lỗi được đánh dấu)</p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
            {segments.map((seg, i) =>
              seg.error ? (
                <mark
                  key={i}
                  className="rounded bg-accent/20 px-0.5 text-text underline decoration-accent-text decoration-2 underline-offset-2"
                >
                  {seg.text}
                  <a
                    href={`#error-${seg.error.idx + 1}`}
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
              {unmatchedCount} lỗi không xác định được vị trí chính xác trong bài — xem
              đầy đủ ở danh sách bên dưới.
            </p>
          )}
        </div>

        {/* Danh sách lỗi — luôn hiện đủ tất cả, kể cả lỗi không map được vào bài. */}
        {result.errors.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="mb-2 text-sm font-medium">Chi tiết từng lỗi</p>
            <ol className="flex flex-col gap-2">
              {result.errors.map((e, i) => (
                <li
                  key={i}
                  id={`error-${i + 1}`}
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
            onClick={() => {
              setEssay("");
              loadPrompt();
            }}
            className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
          >
            Viết đề khác
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

  // ----- Màn viết bài -----
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Viết</h1>
        <p className="text-sm text-muted">
          Viết theo đề, AI sẽ chấm theo CEFR và chỉ ra lỗi cụ thể trong bài.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-accent/10 p-3 text-sm text-accent-text">{error}</p>
      )}

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

          <textarea
            value={essay}
            onChange={(e) => setEssay(e.target.value)}
            rows={10}
            disabled={submitting}
            aria-label="Bài viết của bạn"
            placeholder="Write your answer here in English…"
            className="mt-3 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>{wordCount} từ</span>
            <button
              onClick={loadPrompt}
              disabled={submitting}
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
        {submitting ? "Đang chấm…" : canSubmit ? "Nộp bài & xem kết quả" : "Hãy viết bài trước"}
      </button>

      {/* Thông báo tiến trình trong lúc chờ AI (cuộc gọi có thể mất vài giây). */}
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

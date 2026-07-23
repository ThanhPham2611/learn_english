"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ReviewQuality } from "@/lib/srs";
import { celebrate } from "@/components/Confetti";

interface VocabCard {
  id: number;
  word: string;
  level: string;
  repetition: number;
  intervalDays: number;
}

type VocabVerdict = "correct" | "close" | "wrong" | null;

interface CheckResult {
  verdict: VocabVerdict;
  feedback: string;
  meaning: string;
  example: string | null;
  aiError?: boolean;
}

// 4 màu khác hue rõ rệt (không chỉ khác độ đậm/nhạt) — đây là lựa chọn ảnh hưởng
// trực tiếp lịch ôn tiếp theo, bấm nhầm giữa 2 nút cạnh nhau sẽ khó nhận ra ngay.
const QUALITY_BUTTONS: { quality: ReviewQuality; label: string; key: string; className: string }[] = [
  { quality: "again", label: "Chưa nhớ", key: "1", className: "bg-red-600 hover:bg-red-700" },
  { quality: "hard", label: "Khó", key: "2", className: "bg-accent hover:bg-accent-text" },
  { quality: "good", label: "Nhớ được", key: "3", className: "bg-primary hover:bg-primary-dark" },
  { quality: "easy", label: "Dễ", key: "4", className: "bg-blue-600 hover:bg-blue-700" },
];

// Gợi ý mức đánh giá dựa trên verdict AI — chỉ là gợi ý trực quan (viền),
// người học vẫn tự bấm chọn, AI không quyết định thay lịch ôn tập.
const SUGGESTED_QUALITY: Record<Exclude<VocabVerdict, null>, ReviewQuality> = {
  correct: "good",
  close: "hard",
  wrong: "again",
};

const VERDICT_DISPLAY: Record<
  Exclude<VocabVerdict, null>,
  { label: string; className: string }
> = {
  correct: { label: "Chính xác!", className: "bg-primary/10 text-primary-text" },
  close: { label: "Gần đúng", className: "bg-accent/10 text-accent-text" },
  wrong: { label: "Chưa đúng", className: "bg-red-600/10 text-red-600" },
};

export default function VocabPage() {
  const [cards, setCards] = useState<VocabCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"input" | "checked">("input");
  const [userAnswer, setUserAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const doneHeadingRef = useRef<HTMLParagraphElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/vocab/due")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setCards(d.due ?? []);
        setTotal(d.total ?? 0);
        setRemaining(d.remaining ?? 0);
      })
      .catch(() => setError("Không tải được bộ ôn từ vựng."));
  }, []);

  // "Ôn thêm": lấy tiếp 1 lô thẻ mới, loại trừ các thẻ đã ôn trong phiên này.
  // ahead=true khi không còn thẻ nào đến hạn nhưng người học vẫn muốn ôn trước lịch.
  async function loadMore(ahead: boolean) {
    if (!cards || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const excludeIds = cards.map((c) => c.id).join(",");
      const params = new URLSearchParams({ exclude: excludeIds });
      if (ahead) params.set("mode", "ahead");
      const res = await fetch(`/api/vocab/due?${params.toString()}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const more: VocabCard[] = data.due ?? [];
      setCards([...cards, ...more]);
      setRemaining(ahead ? 0 : data.remaining ?? 0);
      setTotal(data.total ?? total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải thêm được từ.");
    } finally {
      setLoadingMore(false);
    }
  }

  const current = cards?.[index] ?? null;

  async function checkAnswer() {
    if (!current || checking) return;
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/vocab/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: current.id, userAnswer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi kiểm tra");
      setCheckResult(data);
      setPhase("checked");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setChecking(false);
    }
  }

  async function answer(quality: ReviewQuality) {
    if (!current || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/vocab/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: current.id, quality }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi lưu kết quả");
      setReviewedCount((c) => c + 1);
      setPhase("input");
      setUserAnswer("");
      setCheckResult(null);
      setIndex((i) => i + 1);
    } catch (e) {
      // Giữ nguyên thẻ hiện tại + tiến độ đã ôn — chỉ báo lỗi, không xóa cả phiên ôn.
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setSubmitting(false);
    }
  }

  // Phím tắt: 1-4 = đánh giá sau khi đã kiểm tra (đúng quy ước quen thuộc của Anki).
  // Bước "lật thẻ" cũ (Space) không còn — Enter với ô nhập trống đã thay thế.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!current || submitting || phase !== "checked") return;
      const btn = QUALITY_BUTTONS.find((b) => b.key === e.key);
      if (btn) answer(btn.quality);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, phase, submitting]);

  // Đưa focus tới thẻ mới / màn hoàn thành để trình đọc màn hình xác nhận thay đổi,
  // và tự focus ô nhập nghĩa khi sang thẻ mới.
  useEffect(() => {
    if (!current) {
      doneHeadingRef.current?.focus();
      if (cards && cards.length > 0) celebrate(); // chỉ chạy lại khi index/current đổi -> đúng 1 lần mỗi lượt hoàn thành
    } else if (phase === "input") answerInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, index, phase]);

  if (cards === null) {
    return <p className="mx-auto max-w-md text-center text-sm text-muted">Đang tải…</p>;
  }

  // ----- Chưa từng có thẻ nào (chưa học Đọc lần nào) -----
  if (cards.length === 0 && total === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Ôn từ vựng</h1>
        <div className="rounded-xl border border-border bg-surface p-8">
          <p className="text-lg font-medium text-primary-text">Bộ từ vựng đang trống</p>
          <p className="mt-2 text-sm text-muted">
            Hãy làm vài bài Đọc — từ mới trong bài sẽ tự động thêm vào đây để ôn tập.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/reading"
            className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
          >
            Đi học Đọc
          </Link>
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

  // ----- Có thẻ trong bộ nhưng chưa đến hạn ôn -----
  if (cards.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Ôn từ vựng</h1>
        <div className="rounded-xl border border-border bg-surface p-8">
          <p className="text-lg font-medium text-primary-text">
            Không có từ nào cần ôn hôm nay 🎉
          </p>
          <p className="mt-2 text-sm text-muted">
            Bạn đang có {total} từ trong bộ ôn tập. Quay lại khi có từ đến hạn.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {total > 0 && (
            <button
              onClick={() => loadMore(true)}
              disabled={loadingMore}
              className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? "Đang tải…" : "Ôn thêm từ chưa đến hạn"}
            </button>
          )}
          <Link
            href="/vocab/difficult"
            className="cursor-pointer rounded-xl border border-border px-5 py-2.5 transition-colors duration-200 hover:border-primary"
          >
            Xem từ khó / chưa nhớ
          </Link>
          <Link
            href="/"
            className="cursor-pointer rounded-xl border border-border px-5 py-2.5 transition-colors duration-200 hover:border-primary"
          >
            Về trang chủ
          </Link>
        </div>
        {error && <p className="rounded-md bg-accent/10 p-3 text-sm text-accent-text">{error}</p>}
      </div>
    );
  }

  // ----- Đã ôn hết thẻ đến hạn hôm nay -----
  if (!current) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Ôn từ vựng</h1>
        <div className="rounded-xl border border-border bg-surface p-8">
          <p ref={doneHeadingRef} tabIndex={-1} className="text-lg font-medium text-primary-text outline-none">
            Hoàn thành! Bạn đã ôn {reviewedCount} từ.
          </p>
          <p className="mt-2 text-sm text-muted">
            {remaining > 0
              ? `Còn ${remaining} từ khác đã đến hạn — muốn ôn tiếp không?`
              : "Hẹn gặp lại vào lượt ôn tiếp theo."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {remaining > 0 ? (
            <button
              onClick={() => loadMore(false)}
              disabled={loadingMore}
              className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? "Đang tải…" : `Ôn thêm ${Math.min(remaining, 20)} từ`}
            </button>
          ) : total > cards.length ? (
            <button
              onClick={() => loadMore(true)}
              disabled={loadingMore}
              className="cursor-pointer rounded-xl border border-border px-5 py-2.5 font-medium transition-colors duration-200 hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? "Đang tải…" : "Ôn thêm từ chưa đến hạn"}
            </button>
          ) : null}
          <Link
            href="/vocab/difficult"
            className="cursor-pointer rounded-xl border border-border px-5 py-2.5 font-medium transition-colors duration-200 hover:border-primary"
          >
            Xem từ khó / chưa nhớ
          </Link>
          <Link
            href="/"
            className="cursor-pointer rounded-xl border border-border px-5 py-2.5 font-medium transition-colors duration-200 hover:border-primary"
          >
            Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

  const suggested = checkResult?.verdict ? SUGGESTED_QUALITY[checkResult.verdict] : null;
  const verdictDisplay = checkResult?.verdict ? VERDICT_DISPLAY[checkResult.verdict] : null;

  // ----- Màn flashcard -----
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ôn từ vựng</h1>
        <div className="flex items-center gap-3">
          <Link href="/vocab/difficult" className="text-sm text-muted hover:text-primary-text hover:underline">
            Từ khó
          </Link>
          <span aria-live="polite" className="text-sm text-muted">
            {index + 1}/{cards.length}
          </span>
        </div>
      </div>

      {error && <p className="rounded-md bg-accent/10 p-3 text-sm text-accent-text">{error}</p>}

      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-border bg-surface p-8 text-center">
        <p className="font-heading text-4xl font-semibold">{current.word}</p>

        {phase === "input" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              checkAnswer();
            }}
            className="mt-4 flex w-full flex-col items-center gap-2"
          >
            <input
              ref={answerInputRef}
              type="text"
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              disabled={checking}
              placeholder="Nhập nghĩa tiếng Việt của từ này…"
              aria-label="Nhập nghĩa của từ"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-center focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={checking}
              className="cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? "Đang kiểm tra…" : "Kiểm tra"}
            </button>
            <p className="text-xs text-muted">Để trống rồi bấm Kiểm tra nếu muốn xem đáp án luôn.</p>
          </form>
        ) : (
          <div className="mt-4 w-full">
            {verdictDisplay && (
              <span className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${verdictDisplay.className}`}>
                {verdictDisplay.label}
              </span>
            )}
            {checkResult?.aiError && (
              <span className="inline-block rounded-full bg-muted/10 px-3 py-1 text-sm font-medium text-muted">
                Không chấm được bằng AI lúc này
              </span>
            )}
            {checkResult?.feedback && (
              <p className="mt-2 text-xs text-muted">{checkResult.feedback}</p>
            )}
            <p className="mt-3 text-lg text-primary-text">{checkResult?.meaning}</p>
            {checkResult?.example && (
              <p className="mt-2 text-sm italic text-muted">&quot;{checkResult.example}&quot;</p>
            )}
          </div>
        )}
      </div>

      {phase === "checked" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUALITY_BUTTONS.map((b) => (
            <button
              key={b.quality}
              onClick={() => answer(b.quality)}
              disabled={submitting}
              className={`min-h-[44px] cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${b.className} ${
                suggested === b.quality ? "ring-2 ring-offset-2 ring-offset-bg ring-primary" : ""
              }`}
            >
              {b.label} <span className="opacity-70">({b.key})</span>
            </button>
          ))}
        </div>
      )}

      {phase === "input" && (
        <p className="text-center text-xs text-muted">
          Gõ nghĩa bạn nhớ được rồi bấm &quot;Kiểm tra&quot; — AI sẽ chấm đúng/gần đúng/sai.
        </p>
      )}
    </div>
  );
}

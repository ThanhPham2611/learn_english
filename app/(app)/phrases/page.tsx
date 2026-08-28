"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ReviewQuality } from "@/lib/srs";
import { celebrate } from "@/components/Confetti";
import { speak } from "@/lib/speech";
import { POINTS_PER_ACTIVITY } from "@/lib/points-constants";

interface PhraseCard {
  id: number;
  level: string;
  repetition: number;
  displayPhrase: string;
  phrase?: string; // chỉ có khi repetition===0 (bước "Học")
  meaning?: string;
  example?: string;
}

interface CheckResult {
  correct: boolean;
  phrase: string;
  meaning: string;
  example: string;
  blankWord: string;
}

// Y hệt bảng nút của app/(app)/vocab/page.tsx — giữ đồng nhất trải nghiệm ôn tập
// giữa từ vựng và cụm câu (cùng thuật toán SM-2 ở lib/srs.ts).
const QUALITY_BUTTONS: { quality: ReviewQuality; label: string; key: string; className: string }[] = [
  { quality: "again", label: "Chưa nhớ", key: "1", className: "bg-red-600 hover:bg-red-700" },
  { quality: "hard", label: "Khó", key: "2", className: "bg-accent hover:bg-accent-text" },
  { quality: "good", label: "Nhớ được", key: "3", className: "bg-primary hover:bg-primary-dark" },
  { quality: "easy", label: "Dễ", key: "4", className: "bg-blue-600 hover:bg-blue-700" },
];

const SUGGESTED_QUALITY: Record<"correct" | "wrong", ReviewQuality> = {
  correct: "good",
  wrong: "again",
};

type Phase = "learn" | "input" | "checked";

export default function PhrasesPage() {
  const [cards, setCards] = useState<PhraseCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("input");
  const [userAnswer, setUserAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const doneHeadingRef = useRef<HTMLParagraphElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  // Điểm thưởng — đổi lấy 2 đặc quyền: xem đáp án / bỏ qua thẻ (xem lib/points.ts).
  const [points, setPoints] = useState<number | null>(null);
  const [spending, setSpending] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => {
        if (typeof p?.points === "number") setPoints(p.points);
      })
      .catch(() => {});
  }, []);

  async function spendPoints(amount: number): Promise<boolean> {
    if (spending) return false;
    setSpending(true);
    setError("");
    try {
      const res = await fetch("/api/points/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không đủ điểm");
      setPoints(data.points);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đủ điểm");
      return false;
    } finally {
      setSpending(false);
    }
  }

  async function revealAnswer() {
    const ok = await spendPoints(5);
    if (ok) checkAnswer();
  }

  async function skipCard() {
    if (!current || submitting) return;
    const ok = await spendPoints(10);
    if (!ok) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/phrases/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: current.id, skip: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi bỏ qua thẻ");
      setUserAnswer("");
      setCheckResult(null);
      setIndex((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadDue() {
    setError("");
    try {
      const res = await fetch("/api/phrases/due");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const due: PhraseCard[] = data.due ?? [];
      // Hàng đợi rỗng hoàn toàn (chưa có cụm câu nào) -> tự sinh 1 lô mới rồi tải lại.
      if (due.length === 0 && (data.total ?? 0) === 0) {
        setGenerating(true);
        const genRes = await fetch("/api/phrases/generate", { method: "POST" });
        const genData = await genRes.json();
        setGenerating(false);
        if (genData.error) throw new Error(genData.error);
        const res2 = await fetch("/api/phrases/due");
        const data2 = await res2.json();
        if (data2.error) throw new Error(data2.error);
        setCards(data2.due ?? []);
        setTotal(data2.total ?? 0);
        setRemaining(data2.remaining ?? 0);
        return;
      }
      setCards(due);
      setTotal(data.total ?? 0);
      setRemaining(data.remaining ?? 0);
    } catch (e) {
      setGenerating(false);
      setError(e instanceof Error ? e.message : "Không tải được bộ cụm câu.");
    }
  }

  useEffect(() => {
    loadDue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMore(ahead: boolean) {
    if (!cards || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const excludeIds = cards.map((c) => c.id).join(",");
      const params = new URLSearchParams({ exclude: excludeIds });
      if (ahead) params.set("mode", "ahead");
      const res = await fetch(`/api/phrases/due?${params.toString()}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const more: PhraseCard[] = data.due ?? [];
      setCards([...cards, ...more]);
      setRemaining(ahead ? 0 : data.remaining ?? 0);
      setTotal(data.total ?? total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải thêm được cụm câu.");
    } finally {
      setLoadingMore(false);
    }
  }

  const current = cards?.[index] ?? null;

  // Thẻ mới (chưa học lần nào) -> hiện bước "Học" trước; thẻ đã học rồi -> vào quiz luôn.
  useEffect(() => {
    if (!current) return;
    setPhase(current.repetition === 0 && current.phrase ? "learn" : "input");
  }, [current]);

  async function checkAnswer() {
    if (!current || checking) return;
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/phrases/check", {
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
      const res = await fetch("/api/phrases/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: current.id, quality }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi lưu kết quả");
      setReviewedCount((c) => c + 1);
      setPoints((p) => (p ?? 0) + POINTS_PER_ACTIVITY.phraseReview);
      setUserAnswer("");
      setCheckResult(null);
      setIndex((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setSubmitting(false);
    }
  }

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

  useEffect(() => {
    if (!current) {
      doneHeadingRef.current?.focus();
      if (cards && cards.length > 0) celebrate();
    } else if (phase === "input") answerInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, index, phase]);

  if (cards === null || generating) {
    return (
      <p className="mx-auto max-w-md text-center text-sm text-muted">
        {generating ? "Đang tạo cụm câu mới…" : "Đang tải…"}
      </p>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Học cụm câu</h1>
        <div className="rounded-xl border border-border bg-surface p-8">
          <p className="text-lg font-medium text-primary-text">
            Không có cụm câu nào cần ôn hôm nay 🎉
          </p>
          <p className="mt-2 text-sm text-muted">
            Bạn đang có {total} cụm câu trong bộ. Quay lại khi có cụm đến hạn.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {total > 0 && (
            <button
              onClick={() => loadMore(true)}
              disabled={loadingMore}
              className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? "Đang tải…" : "Ôn thêm cụm chưa đến hạn"}
            </button>
          )}
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

  if (!current) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Học cụm câu</h1>
        <div className="rounded-xl border border-border bg-surface p-8">
          <p ref={doneHeadingRef} tabIndex={-1} className="text-lg font-medium text-primary-text outline-none">
            Hoàn thành! Bạn đã ôn {reviewedCount} cụm câu.
          </p>
          <p className="mt-2 text-sm text-muted">
            {remaining > 0
              ? `Còn ${remaining} cụm khác đã đến hạn — muốn ôn tiếp không?`
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
              {loadingMore ? "Đang tải…" : `Ôn thêm ${Math.min(remaining, 20)} cụm`}
            </button>
          ) : total > cards.length ? (
            <button
              onClick={() => loadMore(true)}
              disabled={loadingMore}
              className="cursor-pointer rounded-xl border border-border px-5 py-2.5 font-medium transition-colors duration-200 hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? "Đang tải…" : "Ôn thêm cụm chưa đến hạn"}
            </button>
          ) : null}
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

  const suggested = checkResult ? SUGGESTED_QUALITY[checkResult.correct ? "correct" : "wrong"] : null;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Học cụm câu</h1>
        <div className="flex items-center gap-3">
          {points !== null && <span className="text-sm text-muted">🪙 {points}</span>}
          <span aria-live="polite" className="text-sm text-muted">
            {index + 1}/{cards.length}
          </span>
        </div>
      </div>

      {error && <p className="rounded-md bg-accent/10 p-3 text-sm text-accent-text">{error}</p>}

      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-border bg-surface p-8 text-center">
        {phase === "learn" && current.phrase ? (
          <>
            <p className="font-heading text-2xl font-semibold">{current.phrase}</p>
            <button
              onClick={() => speak(current.phrase!)}
              className="mt-1 cursor-pointer text-xs text-primary-text hover:underline"
            >
              🔊 Nghe
            </button>
            <p className="mt-3 text-lg text-primary-text">{current.meaning}</p>
            {current.example && (
              <p className="mt-2 text-sm italic text-muted">&quot;{current.example}&quot;</p>
            )}
            <button
              onClick={() => setPhase("input")}
              className="mt-5 cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
            >
              Thực hành
            </button>
          </>
        ) : (
          <>
            <p className="font-heading text-2xl font-semibold">{current.displayPhrase}</p>

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
                  placeholder="Điền từ còn thiếu…"
                  aria-label="Điền từ còn thiếu trong cụm câu"
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
                <div className="mt-1 flex gap-3">
                  <button
                    type="button"
                    onClick={revealAnswer}
                    disabled={spending || checking || (points ?? 0) < 5}
                    className="cursor-pointer text-xs text-primary-text hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    🪙 Xem đáp án (-5 điểm)
                  </button>
                  <button
                    type="button"
                    onClick={skipCard}
                    disabled={spending || submitting || (points ?? 0) < 10}
                    className="cursor-pointer text-xs text-muted hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    🪙 Bỏ qua thẻ (-10 điểm)
                  </button>
                </div>
              </form>
            ) : (
              checkResult && (
                <div className="mt-4 w-full">
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
                      checkResult.correct ? "bg-primary/10 text-primary-text" : "bg-red-600/10 text-red-600"
                    }`}
                  >
                    {checkResult.correct ? "Chính xác!" : "Chưa đúng"}
                  </span>
                  <p className="mt-3 text-lg font-medium">{checkResult.phrase}</p>
                  <p className="mt-1 text-primary-text">{checkResult.meaning}</p>
                  <p className="mt-2 text-sm italic text-muted">&quot;{checkResult.example}&quot;</p>
                </div>
              )
            )}
          </>
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
          Gõ từ bạn nhớ được rồi bấm &quot;Kiểm tra&quot;.
        </p>
      )}
    </div>
  );
}

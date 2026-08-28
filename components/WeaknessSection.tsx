"use client";

import { useState } from "react";
import type { WeaknessSummaryItem } from "@/lib/weakness";

interface DrillItem {
  sentence: string;
  hint: string;
}

interface DrillCheckResult {
  correct: boolean;
  correction: string;
  explanation: string;
}

// Hiện top điểm yếu (nhóm theo loại lỗi từ Viết/Nói/Chat) + bấm "Luyện ngay" mở
// modal luyện tập nhắm đúng loại lỗi đó. Bài luyện sinh mới mỗi lần (không lưu DB).
export function WeaknessSection({ items }: { items: WeaknessSummaryItem[] }) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [openLabel, setOpenLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drills, setDrills] = useState<DrillItem[] | null>(null);
  const [drillIdx, setDrillIdx] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<DrillCheckResult | null>(null);

  if (items.length === 0) return null;

  async function openDrill(category: string, label: string) {
    setOpenCategory(category);
    setOpenLabel(label);
    setDrills(null);
    setDrillIdx(0);
    setUserAnswer("");
    setCheckResult(null);
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/weakness/drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tạo bài luyện");
      setDrills(data.drills ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    setOpenCategory(null);
    setDrills(null);
  }

  async function checkDrill() {
    const drill = drills?.[drillIdx];
    if (!drill || checking) return;
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/weakness/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence: drill.sentence, userAnswer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi kiểm tra");
      setCheckResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setChecking(false);
    }
  }

  function nextDrill() {
    setUserAnswer("");
    setCheckResult(null);
    setDrillIdx((i) => i + 1);
  }

  const currentDrill = drills?.[drillIdx] ?? null;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="mb-1 text-sm font-medium">Điểm yếu cần luyện</p>
      <p className="mb-3 text-xs text-muted">
        Tổng hợp từ các lỗi hay mắc khi Viết, Nói, và Chat.
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.category}
            className="flex items-center justify-between gap-3 rounded-lg bg-bg px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">
                {item.label}{" "}
                <span className="text-xs text-muted">({item.count} lần)</span>
              </p>
              {item.examples[0] && (
                <p className="mt-0.5 text-xs text-muted">
                  <span className="line-through">{item.examples[0].original}</span> →{" "}
                  {item.examples[0].correction}
                </p>
              )}
            </div>
            <button
              onClick={() => openDrill(item.category, item.label)}
              className="shrink-0 cursor-pointer rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-text transition-colors duration-200 hover:bg-primary/20"
            >
              Luyện ngay
            </button>
          </li>
        ))}
      </ul>

      {openCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Luyện: {openLabel}</h2>
              <button
                onClick={closeModal}
                aria-label="Đóng"
                className="cursor-pointer text-muted hover:text-primary-text"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto">
              {loading && <p className="text-sm text-muted">Đang tạo bài luyện…</p>}
              {error && <p className="text-sm text-danger-text">{error}</p>}

              {currentDrill && (
                <div>
                  <p className="text-xs text-muted">
                    Câu {drillIdx + 1}/{drills?.length ?? 0}
                  </p>
                  <p className="mt-1 text-[15px] font-medium">{currentDrill.sentence}</p>
                  {currentDrill.hint && (
                    <p className="mt-1 text-xs italic text-muted">Gợi ý: {currentDrill.hint}</p>
                  )}

                  {!checkResult ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        checkDrill();
                      }}
                      className="mt-3 flex flex-col gap-2"
                    >
                      <input
                        type="text"
                        value={userAnswer}
                        onChange={(e) => setUserAnswer(e.target.value)}
                        disabled={checking}
                        placeholder="Sửa lại câu cho đúng…"
                        aria-label="Sửa lại câu cho đúng"
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                      />
                      <button
                        type="submit"
                        disabled={checking || !userAnswer.trim()}
                        className="cursor-pointer self-start rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {checking ? "Đang kiểm tra…" : "Kiểm tra"}
                      </button>
                    </form>
                  ) : (
                    <div className="mt-3">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
                          checkResult.correct
                            ? "bg-primary/10 text-primary-text"
                            : "bg-red-600/10 text-red-600"
                        }`}
                      >
                        {checkResult.correct ? "Chính xác!" : "Chưa đúng"}
                      </span>
                      <p className="mt-2 text-sm font-medium">{checkResult.correction}</p>
                      <p className="mt-1 text-xs text-muted">{checkResult.explanation}</p>
                      {drills && drillIdx < drills.length - 1 ? (
                        <button
                          onClick={nextDrill}
                          className="mt-3 cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
                        >
                          Câu tiếp theo
                        </button>
                      ) : (
                        <button
                          onClick={closeModal}
                          className="mt-3 cursor-pointer rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors duration-200 hover:border-primary"
                        >
                          Xong
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

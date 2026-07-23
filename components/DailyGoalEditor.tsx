"use client";

import { useState } from "react";

// Ô "Mục tiêu hôm nay" — hiển thị tiến độ X/Y + cho chỉnh Y (dailyGoal) tại chỗ.
// Là client component riêng vì cần gọi API cập nhật, còn phần còn lại của
// Dashboard là server component (đọc thẳng từ DB, không cần state).
export function DailyGoalEditor({ done, initialGoal }: { done: number; initialGoal: number }) {
  const [goal, setGoal] = useState(initialGoal);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(initialGoal));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      setError("Mục tiêu phải từ 1 đến 20");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/profile/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyGoal: n }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi lưu mục tiêu");
      setGoal(data.dailyGoal);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không rõ");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-center">
        <input
          type="number"
          min={1}
          max={20}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Mục tiêu số hoạt động luyện tập mỗi ngày"
          className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-center text-lg font-semibold"
        />
        <div className="mt-2 flex justify-center gap-2 text-xs">
          <button
            onClick={save}
            disabled={saving}
            className="cursor-pointer rounded-md bg-primary px-2 py-1 text-white hover:bg-primary-dark disabled:opacity-50"
          >
            Lưu
          </button>
          <button
            onClick={() => {
              setDraft(String(goal));
              setEditing(false);
              setError("");
            }}
            className="cursor-pointer rounded-md border border-border px-2 py-1 hover:border-primary"
          >
            Huỷ
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-accent-text">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="cursor-pointer rounded-xl border border-border bg-surface p-4 text-center transition-colors duration-200 hover:border-primary"
      title="Bấm để đổi mục tiêu"
    >
      <p className="text-3xl font-semibold text-primary-text">
        {done}/{goal}
      </p>
      <p className="text-xs text-muted">Mục tiêu hôm nay</p>
    </button>
  );
}

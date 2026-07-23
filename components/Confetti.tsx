"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";
import { localDateKey } from "@/lib/date";

// Màu theo theme app (teal/cam) thay vì màu mặc định sặc sỡ của thư viện.
const COLORS = ["#0d9488", "#2dd4bf", "#ea580c", "#fb923c"];

export function celebrate() {
  confetti({
    particleCount: 90,
    spread: 70,
    origin: { y: 0.6 },
    colors: COLORS,
  });
}

// Đánh dấu đã ăn mừng 1 sự kiện trong ngày hôm nay — tránh bắn confetti lặp lại
// mỗi lần load/refresh trang cùng ngày. Dùng sessionStorage (không phải server)
// vì đây thuần là UI feedback, không cần chính xác tuyệt đối/đồng bộ nhiều thiết bị.
function alreadyCelebratedToday(key: string): boolean {
  if (typeof window === "undefined") return true;
  const flagKey = `celebrated:${key}:${localDateKey(new Date())}`;
  if (sessionStorage.getItem(flagKey)) return true;
  sessionStorage.setItem(flagKey, "1");
  return false;
}

// Theo dõi streak + tiến độ mục tiêu ngày để tự bắn confetti đúng lúc:
// - streak vừa chạm đúng 1 mốc (3/7/14/30 ngày)
// - vừa đạt đủ mục tiêu hôm nay
// Không render gì cả — chỉ là 1 hiệu ứng phụ khi mount/khi props đổi.
export function StreakCelebrationWatcher({
  streak,
  todayDone,
  todayGoal,
}: {
  streak: number;
  todayDone: number;
  todayGoal: number;
}) {
  useEffect(() => {
    if ([3, 7, 14, 30].includes(streak) && !alreadyCelebratedToday(`streak-${streak}`)) {
      celebrate();
      return;
    }
    if (todayDone > 0 && todayDone >= todayGoal && !alreadyCelebratedToday("daily-goal")) {
      celebrate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streak, todayDone, todayGoal]);

  return null;
}

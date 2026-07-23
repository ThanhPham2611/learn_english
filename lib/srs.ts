// Thuật toán lặp lại ngắt quãng SM-2 (kiểu Anki) — quyết định bao lâu nữa mới
// cho ôn lại 1 từ, dựa trên việc người học nhớ tốt hay không ở lần ôn gần nhất.

export type ReviewQuality = "again" | "hard" | "good" | "easy";

// Quy đổi sang thang 0-5 chuẩn của SM-2 gốc.
const QUALITY_SCORE: Record<ReviewQuality, number> = {
  again: 0, // quên hẳn
  hard: 3, // nhớ được nhưng khó
  good: 4, // nhớ bình thường
  easy: 5, // nhớ dễ dàng
};

export interface SrsState {
  repetition: number;
  easeFactor: number;
  intervalDays: number;
}

export interface SrsResult extends SrsState {
  dueDate: Date;
}

export function nextReview(state: SrsState, quality: ReviewQuality, now: Date = new Date()): SrsResult {
  const q = QUALITY_SCORE[quality];
  let { repetition, easeFactor, intervalDays } = state;

  // easeFactor cập nhật ở MỌI mức đánh giá (kể cả quên) — đúng công thức SM-2 gốc.
  // Quên nhiều lần liên tiếp phải làm easeFactor giảm dần, để sau khi nhớ lại,
  // khoảng ôn giãn ra chậm hơn so với từ chưa từng bị quên.
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  if (q < 3) {
    // Quên -> học lại từ đầu, ôn lại sau 1 ngày.
    repetition = 0;
    intervalDays = 1;
  } else {
    if (repetition === 0) intervalDays = 1;
    else if (repetition === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
    repetition += 1;
  }

  const dueDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  return { repetition, easeFactor, intervalDays, dueDate };
}

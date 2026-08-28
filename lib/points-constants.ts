// Tách riêng khỏi lib/points.ts (import prisma, server-only) để dùng được ở cả
// client component (hiện điểm tăng ngay sau khi hoàn thành, không cần chờ refetch).
export const POINTS_PER_ACTIVITY = {
  vocabReview: 2,
  phraseReview: 2,
  writing: 10,
  speaking: 10,
  reading: 10,
  listening: 10,
  dictation: 10,
  placement: 15,
} as const;

// Thang trình độ CEFR (A1 thấp nhất → C2 cao nhất) dùng xuyên suốt app.
// Dùng cho: prompt của Tutor (điều chỉnh độ khó), rubric của Assessor (chấm điểm),
// và Dashboard (hiển thị tiến độ).

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

// Mô tả ngắn từng cấp — nhúng vào prompt để AI biết cần nói/viết ở mức nào.
export const CEFR_DESCRIPTIONS: Record<CefrLevel, string> = {
  A1: "Beginner. Basic words and very simple present-tense sentences.",
  A2: "Elementary. Everyday phrases, simple past/future, short sentences.",
  B1: "Intermediate. Can handle familiar work/travel topics with some complexity.",
  B2: "Upper-intermediate. Fluent on most topics, clear arguments, some nuance.",
  C1: "Advanced. Flexible, natural, professional register with idiomatic range.",
  C2: "Mastery. Near-native precision and subtlety.",
};

// Đổi cấp CEFR sang số (A1=1 ... C2=6) để tính trung bình / vẽ biểu đồ.
export function cefrToNumber(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level) + 1;
}

export function numberToCefr(n: number): CefrLevel {
  const idx = Math.min(Math.max(Math.round(n) - 1, 0), CEFR_LEVELS.length - 1);
  return CEFR_LEVELS[idx];
}

// Quy đổi CEFR sang thang điểm TOEIC (Nghe & Đọc, 10-990) — dựa trên bảng đối
// chiếu tham khảo phổ biến của ETS. Đây là ước tính, KHÔNG thay thế điểm thi
// TOEIC thật — mục đích chỉ để người học hình dung trình độ hiện tại tương ứng
// khoảng điểm nào.
export const CEFR_TOEIC_RANGE: Record<CefrLevel, [number, number]> = {
  A1: [10, 245],
  A2: [250, 545],
  B1: [550, 780],
  B2: [785, 940],
  C1: [945, 990],
  C2: [945, 990],
};

export function cefrToToeicRange(level: CefrLevel): [number, number] {
  return CEFR_TOEIC_RANGE[level];
}

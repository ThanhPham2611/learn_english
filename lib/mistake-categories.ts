// Nhãn phân loại lỗi dùng chung cho Viết/Nói/Chat (WritingError.category ở
// lib/agents/assessor.ts) — nguồn dữ liệu cho tính năng "Điểm yếu" (lib/weakness.ts).

export const MISTAKE_CATEGORIES = [
  "tense",
  "subject_verb_agreement",
  "preposition",
  "article",
  "word_order",
  "plural",
  "word_choice",
  "spelling",
  "other",
] as const;

export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

export const MISTAKE_CATEGORY_LABEL: Record<MistakeCategory, string> = {
  tense: "Chia thì",
  subject_verb_agreement: "Hợp chủ ngữ - động từ",
  preposition: "Giới từ",
  article: "Mạo từ (a/an/the)",
  word_order: "Trật tự từ",
  plural: "Số ít/số nhiều",
  word_choice: "Dùng từ chưa đúng ngữ cảnh",
  spelling: "Chính tả",
  other: "Khác",
};

export function coerceMistakeCategory(v: unknown): MistakeCategory {
  return MISTAKE_CATEGORIES.includes(v as MistakeCategory) ? (v as MistakeCategory) : "other";
}

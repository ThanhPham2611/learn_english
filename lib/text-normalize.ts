// Chuẩn hoá từ/câu dùng chung cho cache dịch (client + server) — tách riêng module
// này (không phụ thuộc node:crypto hay Prisma) để dùng được cả trong component
// "use client" lẫn route server, tránh 2 nơi tự viết luật chuẩn hoá rồi lệch nhau.

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

// Chỉ chuẩn hoá khoảng trắng/hoa-thường/kiểu ngoặc kép — KHÔNG bỏ dấu câu, vì dấu
// câu (vd. dấu hỏi) có thể ảnh hưởng đến nghĩa của từ trong câu.
export function normalizeContext(sentence: string): string {
  return sentence
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
}

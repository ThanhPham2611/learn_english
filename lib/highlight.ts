// Dùng chung cho Viết & Nói: định vị các cụm lỗi trong văn bản gốc để highlight
// đúng ngữ cảnh, thay vì chỉ liệt kê lỗi tách rời.

export interface InlineError {
  original: string;
  correction: string;
  explanation: string;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Tìm vị trí cụm lỗi trong văn bản, chịu được sai khác nhỏ (dấu ngoặc kép cong/thẳng,
// nhiều khoảng trắng liền nhau) mà Gemini đôi khi trả về khác bản gốc 1-2 ký tự.
export function findIndex(text: string, original: string): number {
  const exact = text.indexOf(original);
  if (exact !== -1) return exact;

  const normalized = original.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const pattern = escapeRegex(normalized).replace(/\s+/g, "\\s+");
  try {
    const match = text.match(new RegExp(pattern));
    return match?.index ?? -1;
  } catch {
    return -1;
  }
}

export interface Segment<E> {
  text: string;
  error?: E & { idx: number };
}

// Cắt văn bản thành các đoạn, đánh dấu đúng những cụm bị lỗi (không chồng lấn).
// Lỗi nào không định vị được (AI diễn đạt lại thay vì trích nguyên văn) sẽ KHÔNG
// bị ẩn khỏi danh sách chi tiết ở nơi gọi — chỉ là không có đánh dấu inline — để
// số thứ tự luôn khớp giữa 2 nơi hiển thị.
export function buildSegments<E extends InlineError>(text: string, errors: E[]) {
  const withIndex = errors.map((e, idx) => ({ ...e, idx, at: findIndex(text, e.original) }));
  const found = withIndex.filter((e) => e.at !== -1).sort((a, b) => a.at - b.at);

  const segments: Segment<E>[] = [];
  let cursor = 0;
  for (const e of found) {
    if (e.at < cursor) continue; // vị trí chồng lấn -> bỏ đánh dấu inline (vẫn còn trong danh sách)
    if (e.at > cursor) segments.push({ text: text.slice(cursor, e.at) });
    segments.push({ text: text.slice(e.at, e.at + e.original.length), error: e });
    cursor = e.at + e.original.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });

  const unmatchedCount = errors.length - found.length;
  return { segments, unmatchedCount };
}

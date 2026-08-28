import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toDisplayPhrase(phrase: string, blankWord: string): string {
  const boundary = new RegExp(`\\b${blankWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  return phrase.replace(boundary, "___");
}

// Trả về các cụm câu đã đến hạn ôn (dueDate <= hiện tại) — thẻ mới (repetition=0)
// LUÔN coi như đến hạn (vừa tạo, dueDate=now) nên tự động lọt vào đây, không cần
// endpoint "học mới" riêng. Cùng tham số exclude/mode=ahead như /api/vocab/due.
export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const excludeIds = (searchParams.get("exclude") ?? "")
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n));
    const ahead = searchParams.get("mode") === "ahead";

    const now = new Date();
    const where = {
      userId,
      ...(ahead ? {} : { dueDate: { lte: now } }),
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    };

    const [due, total, remaining] = await Promise.all([
      prisma.phraseCard.findMany({
        where,
        orderBy: { dueDate: "asc" },
        take: 20,
        select: { id: true, phrase: true, blankWord: true, meaning: true, example: true, level: true, repetition: true },
      }),
      prisma.phraseCard.count({ where: { userId } }),
      prisma.phraseCard.count({ where }),
    ]);

    // Thẻ mới (repetition=0): gửi kèm phrase đầy đủ + nghĩa/ví dụ để hiện bước "Học"
    // trước khi quiz (displayPhrase gửi kèm luôn cho bước quiz theo ngay sau đó —
    // không lộ gì thêm vì phrase đầy đủ ở trên đã cho thấy toàn bộ nội dung rồi).
    // Thẻ đã học rồi (repetition>0): CHỈ gửi displayPhrase (đã ẩn từ), giấu phrase/
    // nghĩa/ví dụ — chỉ lộ qua /api/phrases/check sau khi trả lời, cùng nguyên tắc
    // chống "nhìn trước đáp án" như VocabCard.
    const cards = due.map((c) => ({
      id: c.id,
      level: c.level,
      repetition: c.repetition,
      displayPhrase: toDisplayPhrase(c.phrase, c.blankWord),
      ...(c.repetition === 0 ? { phrase: c.phrase, meaning: c.meaning, example: c.example } : {}),
    }));

    return Response.json({ due: cards, total, remaining: remaining - due.length });
  } catch (err) {
    console.error("[phrases/due] lỗi:", err);
    return Response.json({ error: "Không tải được bộ cụm câu" }, { status: 500 });
  }
}

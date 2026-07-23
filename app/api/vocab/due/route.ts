import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Trả về các thẻ từ đã đến hạn ôn (dueDate <= hiện tại), tối đa 20 thẻ/lượt
// để buổi ôn không quá dài. Kèm tổng số thẻ trong bộ để hiển thị thống kê.
//
// Query param "exclude": danh sách id (phân tách bởi dấu phẩy) cần loại trừ —
// dùng khi bấm "Ôn thêm" để lấy tiếp lô thẻ mới, không lặp lại thẻ đã ôn trong phiên.
// Query param "mode=ahead": khi không còn thẻ nào đến hạn nhưng người học vẫn muốn
// ôn thêm, lấy các thẻ CHƯA đến hạn, ưu tiên thẻ gần đến hạn nhất (ôn trước lịch).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const excludeIds = (searchParams.get("exclude") ?? "")
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n));
    const ahead = searchParams.get("mode") === "ahead";

    const now = new Date();
    const where = {
      ...(ahead ? {} : { dueDate: { lte: now } }),
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    };

    const [due, total, remaining] = await Promise.all([
      prisma.vocabCard.findMany({
        where,
        orderBy: { dueDate: "asc" },
        take: 20,
        // Không gửi meaning/example trước khi người học tự gõ nghĩa — nghĩa chỉ
        // lộ ra qua response của POST /api/vocab/check (xem route đó).
        select: { id: true, word: true, level: true, repetition: true, intervalDays: true },
      }),
      prisma.vocabCard.count(),
      prisma.vocabCard.count({ where }),
    ]);
    // Số thẻ còn lại (cùng điều kiện where) sau khi đã lấy lô này — cho biết còn
    // "ôn thêm" được nữa không mà không cần front-end tự đếm.
    return Response.json({ due, total, remaining: remaining - due.length });
  } catch (err) {
    console.error("[vocab/due] lỗi:", err);
    return Response.json({ error: "Không tải được bộ ôn từ vựng" }, { status: 500 });
  }
}

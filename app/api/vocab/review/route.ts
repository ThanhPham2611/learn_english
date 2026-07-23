import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { nextReview, ReviewQuality } from "@/lib/srs";
import { recordStudyActivity } from "@/lib/profile-db";

export const runtime = "nodejs";

const VALID_QUALITIES: ReviewQuality[] = ["again", "hard", "good", "easy"];

// POST: người học tự đánh giá mức nhớ 1 thẻ -> áp dụng SM-2 -> cập nhật lịch ôn.
export async function POST(req: NextRequest) {
  let cardId: number;
  let quality: ReviewQuality;
  try {
    const body = (await req.json()) as { cardId?: number; quality?: string };
    if (typeof body.cardId !== "number") {
      return Response.json({ error: "Thiếu id thẻ" }, { status: 400 });
    }
    if (!VALID_QUALITIES.includes(body.quality as ReviewQuality)) {
      return Response.json({ error: "Mức đánh giá không hợp lệ" }, { status: 400 });
    }
    cardId = body.cardId;
    quality = body.quality as ReviewQuality;
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const card = await prisma.vocabCard.findUnique({ where: { id: cardId } });
    if (!card) {
      return Response.json({ error: "Không tìm thấy thẻ" }, { status: 400 });
    }

    const result = nextReview(
      { repetition: card.repetition, easeFactor: card.easeFactor, intervalDays: card.intervalDays },
      quality
    );

    const updated = await prisma.vocabCard.update({
      where: { id: cardId },
      data: {
        repetition: result.repetition,
        easeFactor: result.easeFactor,
        intervalDays: result.intervalDays,
        dueDate: result.dueDate,
      },
    });

    try {
      await recordStudyActivity();
    } catch (err) {
      // Không để lỗi cập nhật streak (phụ) làm hỏng thông báo thành công của kết quả chính (đã lưu).
      console.error("[streak] lỗi khi cập nhật (không nghiêm trọng):", err);
    }

    return Response.json({ card: updated });
  } catch (err) {
    console.error("[vocab/review] lỗi:", err);
    return Response.json({ error: "Có lỗi khi lưu kết quả ôn tập" }, { status: 500 });
  }
}

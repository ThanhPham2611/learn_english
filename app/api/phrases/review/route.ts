import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { nextReview, ReviewQuality } from "@/lib/srs";
import { recordStudyActivity } from "@/lib/profile-db";
import { getCurrentUserId } from "@/lib/auth";
import { awardPoints, POINTS_PER_ACTIVITY } from "@/lib/points";

export const runtime = "nodejs";

const VALID_QUALITIES: ReviewQuality[] = ["again", "hard", "good", "easy"];

// POST: người học tự đánh giá mức nhớ 1 cụm câu -> áp dụng SM-2 -> cập nhật lịch ôn.
// Y hệt app/api/vocab/review/route.ts, chỉ đổi sang PhraseCard.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let cardId: number;
  let quality: ReviewQuality | null = null;
  let skip = false;
  try {
    const body = (await req.json()) as { cardId?: number; quality?: string; skip?: boolean };
    if (typeof body.cardId !== "number") {
      return Response.json({ error: "Thiếu id thẻ" }, { status: 400 });
    }
    cardId = body.cardId;
    skip = body.skip === true;
    if (!skip) {
      if (!VALID_QUALITIES.includes(body.quality as ReviewQuality)) {
        return Response.json({ error: "Mức đánh giá không hợp lệ" }, { status: 400 });
      }
      quality = body.quality as ReviewQuality;
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const card = await prisma.phraseCard.findUnique({ where: { id: cardId, userId } });
    if (!card) {
      return Response.json({ error: "Không tìm thấy thẻ" }, { status: 400 });
    }

    // "Bỏ qua thẻ" (đặc quyền đổi điểm) — không tính là quên, giữ nguyên SM-2,
    // chỉ nudge dueDate +1 ngày để thẻ tạm không hiện lại ngay hôm nay.
    if (skip) {
      const updated = await prisma.phraseCard.update({
        where: { id: cardId, userId },
        data: { dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      return Response.json({ card: updated });
    }

    const result = nextReview(
      { repetition: card.repetition, easeFactor: card.easeFactor, intervalDays: card.intervalDays },
      quality as ReviewQuality
    );

    const updated = await prisma.phraseCard.update({
      where: { id: cardId, userId },
      data: {
        repetition: result.repetition,
        easeFactor: result.easeFactor,
        intervalDays: result.intervalDays,
        dueDate: result.dueDate,
      },
    });

    try {
      await recordStudyActivity(userId);
      await awardPoints(userId, POINTS_PER_ACTIVITY.phraseReview);
    } catch (err) {
      console.error("[streak/points] lỗi khi cập nhật (không nghiêm trọng):", err);
    }

    return Response.json({ card: updated });
  } catch (err) {
    console.error("[phrases/review] lỗi:", err);
    return Response.json({ error: "Có lỗi khi lưu kết quả ôn tập" }, { status: 500 });
  }
}

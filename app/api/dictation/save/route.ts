/**
 * app/api/dictation/save/route.ts
 *
 * POST JSON: lưu kết quả 1 phiên luyện Nghe-Viết vào DB.
 *
 * Body:
 *   { totalWords: number, correctWords: number, accuracyPct: number }
 *
 * Logic chấm điểm → CEFR (deterministic, không dùng AI):
 *   accuracy ≥ 90% → B2+
 *   accuracy ≥ 75% → B1
 *   accuracy ≥ 55% → A2
 *   accuracy < 55%  → A1
 *
 * Lưu vào Attempt với skill = "dictation" để Dashboard hiển thị trong
 * "Bằng chứng gần đây" (tương tự listening).
 */

import { NextRequest } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cefrToNumber, CefrLevel } from "@/lib/cefr";
import { applyListeningLevel, recordStudyActivity } from "@/lib/profile-db";
import { awardPoints, POINTS_PER_ACTIVITY } from "@/lib/points";

export const runtime = "nodejs";

function accuracyToCefr(pct: number): CefrLevel {
  if (pct >= 90) return "B2";
  if (pct >= 75) return "B1";
  if (pct >= 55) return "A2";
  return "A1";
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  let body: { totalWords?: number; correctWords?: number; accuracyPct?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }

  const { totalWords, correctWords, accuracyPct } = body;
  if (
    typeof totalWords !== "number" ||
    typeof correctWords !== "number" ||
    typeof accuracyPct !== "number"
  ) {
    return Response.json({ error: "Thiếu thông tin kết quả" }, { status: 400 });
  }

  const cefrLevel = accuracyToCefr(accuracyPct);

  try {
    await prisma.attempt.create({
      data: {
        userId,
        skill: "dictation",
        cefr: cefrLevel,
        score: cefrToNumber(cefrLevel),
        detail: JSON.stringify({ totalWords, correctWords, accuracyPct }),
      },
    });

    // Cập nhật trình độ listening (dictation là dạng nghe, đóng góp vào kỹ năng này)
    await applyListeningLevel(userId, cefrLevel);

    try {
      await recordStudyActivity(userId);
      await awardPoints(userId, POINTS_PER_ACTIVITY.dictation);
    } catch (err) {
      console.error("[dictation/save] lỗi streak/points (không nghiêm trọng):", err);
    }

    return Response.json({ cefrLevel, correct: correctWords, total: totalWords });
  } catch (err) {
    console.error("[dictation/save] lỗi lưu DB:", err);
    return Response.json(
      { error: "Có lỗi khi lưu kết quả. Hãy thử lại." },
      { status: 500 }
    );
  }
}

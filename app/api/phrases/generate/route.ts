import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";
import { getProfile } from "@/lib/profile-db";
import { generatePhrases } from "@/lib/agents/phrase-coach";
import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";

export const runtime = "nodejs";

// POST: sinh thêm 1 lô cụm câu mới cho user (repetition=0, dueDate=now — vào
// hàng đợi /api/phrases/due ngay). Client chỉ gọi khi /due trả rỗng.
export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const profile = await getProfile(userId);
    const level: CefrLevel = CEFR_LEVELS.includes(profile.overallLevel as CefrLevel)
      ? (profile.overallLevel as CefrLevel)
      : "A2";

    const existing = await prisma.phraseCard.findMany({ where: { userId }, select: { phrase: true } });
    const excludePhrases = existing.map((p) => p.phrase);

    const suggestions = await generatePhrases(level, excludePhrases, 5);
    if (suggestions.length === 0) {
      return Response.json({ error: "Không tạo được cụm câu mới, thử lại." }, { status: 502 });
    }

    const now = new Date();
    await prisma.phraseCard.createMany({
      data: suggestions.map((s) => ({
        userId,
        phrase: s.phrase,
        meaning: s.meaning,
        example: s.example,
        blankWord: s.blankWord,
        level,
        dueDate: now,
      })),
      skipDuplicates: true,
    });

    return Response.json({ ok: true, count: suggestions.length });
  } catch (err) {
    console.error("[phrases/generate] lỗi:", err);
    return Response.json({ error: "Không tạo được cụm câu mới" }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";
import { getProfile } from "@/lib/profile-db";
import { CEFR_LEVELS, CefrLevel } from "@/lib/cefr";
import { MISTAKE_CATEGORIES, MistakeCategory } from "@/lib/mistake-categories";
import { generateWeaknessDrill } from "@/lib/agents/weakness-coach";

export const runtime = "nodejs";

// POST: sinh bài luyện (3 câu) nhắm đúng 1 loại lỗi hay mắc — bấm "Luyện ngay"
// ở Dashboard. Không lưu DB, sinh mới mỗi lần.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let category: MistakeCategory;
  try {
    const body = (await req.json()) as { category?: string };
    if (!MISTAKE_CATEGORIES.includes(body.category as MistakeCategory)) {
      return Response.json({ error: "Loại lỗi không hợp lệ" }, { status: 400 });
    }
    category = body.category as MistakeCategory;
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const profile = await getProfile(userId);
    const level: CefrLevel = CEFR_LEVELS.includes(profile.overallLevel as CefrLevel)
      ? (profile.overallLevel as CefrLevel)
      : "A2";

    const examples = await prisma.mistakeRecord.findMany({
      where: { userId, category },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { original: true, correction: true },
    });

    const drills = await generateWeaknessDrill(category, examples, level);
    return Response.json({ drills });
  } catch (err) {
    console.error("[weakness/drill] lỗi:", err);
    return Response.json({ error: "Không tạo được bài luyện lúc này" }, { status: 500 });
  }
}

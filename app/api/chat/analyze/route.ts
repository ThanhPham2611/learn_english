import { NextRequest } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";
import { analyzeSentencesForLearning, SentenceSuggestion } from "@/lib/agents/sentence-coach";
import { normalizeContext } from "@/lib/text-normalize";
import { STARTERS } from "@/lib/chat-starters";

export const runtime = "nodejs";

const MAX_INPUT_MESSAGES = 20;
const MIN_WORDS = 4;
const STARTER_SET = new Set(STARTERS.map((s) => normalizeContext(s)));

// POST: chạy (hoặc trả về cache của) tính năng "Học theo câu" cho 1 phiên chat —
// xem lại các câu người học đã viết và gợi ý câu diễn đạt tốt hơn. Kết quả được
// cache trên ChatSession (analyzedAt/suggestionsJson) để mở lại không tốn thêm
// 1 lượt gọi Gemini.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let sessionId: number;
  try {
    const body = (await req.json()) as { sessionId?: number };
    if (!body.sessionId) return Response.json({ error: "Thiếu sessionId" }, { status: 400 });
    sessionId = body.sessionId;
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) return Response.json({ error: "Không tìm thấy phiên chat" }, { status: 404 });

  if (session.analyzedAt && session.suggestionsJson) {
    const cached = JSON.parse(session.suggestionsJson) as SentenceSuggestion[];
    return Response.json({ suggestions: cached });
  }

  try {
    const userMessages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: "user" },
      orderBy: { createdAt: "asc" },
      select: { content: true },
    });

    const candidates = userMessages
      .map((m) => m.content.trim())
      .filter((text) => text.split(/\s+/).length >= MIN_WORDS)
      .filter((text) => !STARTER_SET.has(normalizeContext(text)))
      .slice(-MAX_INPUT_MESSAGES);

    const level: CefrLevel = CEFR_LEVELS.includes(session.level as CefrLevel)
      ? (session.level as CefrLevel)
      : "A2";
    const suggestions = await analyzeSentencesForLearning(candidates, level);

    await prisma.chatSession.update({
      where: { id: session.id },
      data: {
        endedAt: session.endedAt ?? new Date(),
        analyzedAt: new Date(),
        suggestionsJson: JSON.stringify(suggestions),
      },
    });

    return Response.json({ suggestions });
  } catch (err) {
    console.error("[chat/analyze] lỗi:", err);
    return Response.json({ error: "Không phân tích được phiên chat" }, { status: 500 });
  }
}

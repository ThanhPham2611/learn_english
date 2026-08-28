import { NextRequest } from "next/server";
import { suggestAnswer } from "@/lib/agents/tutor";
import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";

// POST: gợi ý cách trả lời câu hỏi AI vừa hỏi trong lúc luyện Nói (Trò chuyện tự
// do). Stateless, giống app/api/tutor/translate-message/route.ts — không phụ
// thuộc lịch sử/DB, chỉ cần câu hỏi hiện tại.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let question: string;
  let level: CefrLevel;
  try {
    const body = (await req.json()) as { question?: string; level?: string };
    question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
    level = CEFR_LEVELS.includes(body.level as CefrLevel) ? (body.level as CefrLevel) : "A2";
    if (!question) return Response.json({ error: "Thiếu câu hỏi" }, { status: 400 });
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const result = await suggestAnswer(question, level);
    return Response.json(result);
  } catch (err) {
    console.error("[tutor/suggest-answer] lỗi:", err);
    return Response.json({ error: "Không gợi ý được lúc này, thử lại." }, { status: 500 });
  }
}

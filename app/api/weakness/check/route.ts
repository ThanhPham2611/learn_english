import { NextRequest } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { checkWeaknessDrillAnswer } from "@/lib/agents/weakness-coach";

export const runtime = "nodejs";

// POST: chấm câu người học đã sửa lại trong bài luyện điểm yếu (xem /api/weakness/drill).
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let sentence: string;
  let userAnswer: string;
  try {
    const body = (await req.json()) as { sentence?: string; userAnswer?: string };
    sentence = typeof body.sentence === "string" ? body.sentence.trim().slice(0, 300) : "";
    userAnswer = typeof body.userAnswer === "string" ? body.userAnswer.trim().slice(0, 300) : "";
    if (!sentence || !userAnswer) {
      return Response.json({ error: "Thiếu câu hoặc câu trả lời" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const result = await checkWeaknessDrillAnswer(sentence, userAnswer);
    return Response.json(result);
  } catch (err) {
    console.error("[weakness/check] lỗi:", err);
    return Response.json({ error: "Không chấm được lúc này" }, { status: 500 });
  }
}

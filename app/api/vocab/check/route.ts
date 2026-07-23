import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { checkVocabAnswer } from "@/lib/agents/vocab-checker";

export const runtime = "nodejs";

// POST: chấm nghĩa người học tự gõ. KHÔNG tin nghĩa đúng từ client — luôn tra
// lại VocabCard.meaning theo cardId từ DB, vì /due không còn gửi meaning/example
// trước bước tự kiểm tra này (xem app/api/vocab/due/route.ts).
export async function POST(req: NextRequest) {
  let cardId: number;
  let userAnswer: string;
  try {
    const body = (await req.json()) as { cardId?: number; userAnswer?: string };
    if (typeof body.cardId !== "number") {
      return Response.json({ error: "Thiếu id thẻ" }, { status: 400 });
    }
    userAnswer = typeof body.userAnswer === "string" ? body.userAnswer.trim().slice(0, 200) : "";
    cardId = body.cardId;
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  const card = await prisma.vocabCard.findUnique({ where: { id: cardId } });
  if (!card) {
    return Response.json({ error: "Không tìm thấy thẻ" }, { status: 400 });
  }

  if (!userAnswer) {
    // Bỏ trống = coi như chưa nhớ, khỏi tốn 1 lượt gọi Gemini để chấm câu rỗng.
    return Response.json({
      verdict: "wrong",
      feedback: "Bạn chưa nhập nghĩa.",
      meaning: card.meaning,
      example: card.example,
    });
  }

  try {
    const result = await checkVocabAnswer({
      word: card.word,
      correctMeaning: card.meaning,
      userAnswer,
    });
    return Response.json({ ...result, meaning: card.meaning, example: card.example });
  } catch (err) {
    console.error("[vocab/check] lỗi AI:", err);
    // Ôn từ vựng diễn ra nhiều lần/phiên, không nên bị chặn bởi lỗi AI tạm thời
    // (mạng/quota) — trả về nghĩa đúng luôn để người học tự đối chiếu bằng mắt,
    // đúng như hành vi "Hiện nghĩa" cũ, thay vì chặn cả buổi ôn.
    return Response.json({
      verdict: null,
      feedback: "Không chấm được bằng AI lúc này, hãy tự đối chiếu.",
      meaning: card.meaning,
      example: card.example,
      aiError: true,
    });
  }
}

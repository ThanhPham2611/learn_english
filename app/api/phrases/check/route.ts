import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";

// POST: chấm điền-từ-còn-thiếu — so khớp trực tiếp với blankWord (không cần AI,
// rẻ và tức thời). Luôn tra lại DB theo cardId, không tin dữ liệu từ client.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let cardId: number;
  let userAnswer: string;
  try {
    const body = (await req.json()) as { cardId?: number; userAnswer?: string };
    if (typeof body.cardId !== "number") {
      return Response.json({ error: "Thiếu id thẻ" }, { status: 400 });
    }
    userAnswer = typeof body.userAnswer === "string" ? body.userAnswer.trim().slice(0, 100) : "";
    cardId = body.cardId;
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  const card = await prisma.phraseCard.findUnique({ where: { id: cardId, userId } });
  if (!card) {
    return Response.json({ error: "Không tìm thấy thẻ" }, { status: 400 });
  }

  const correct = userAnswer.toLowerCase() === card.blankWord.toLowerCase();
  return Response.json({
    correct,
    phrase: card.phrase,
    meaning: card.meaning,
    example: card.example,
    blankWord: card.blankWord,
  });
}

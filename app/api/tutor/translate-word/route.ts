import { NextRequest } from "next/server";
import { translateWord } from "@/lib/agents/translator";

export const runtime = "nodejs";

// POST: tra nghĩa 1 từ/cụm theo đúng ngữ cảnh câu chứa nó (bôi đen trong chat).
export async function POST(req: NextRequest) {
  let word: string;
  let contextSentence: string;
  try {
    const body = (await req.json()) as { word?: string; contextSentence?: string };
    word = typeof body.word === "string" ? body.word.trim().slice(0, 60) : "";
    contextSentence =
      typeof body.contextSentence === "string" ? body.contextSentence.trim().slice(0, 1000) : "";
    if (!word) {
      return Response.json({ error: "Thiếu từ cần tra" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const { meaning } = await translateWord(word, contextSentence || word);
    return Response.json({ meaning, example: contextSentence });
  } catch (err) {
    console.error("[tutor/translate-word] lỗi AI:", err);
    return Response.json({ error: "Không tra được nghĩa lúc này, thử lại sau." }, { status: 500 });
  }
}

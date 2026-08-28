import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getProfile } from "@/lib/profile-db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";

// POST: thêm từ vào bộ ôn khi người học tra nghĩa trong lúc Chat.
// sourceSkill cố định "chat" (server tự gán, không nhận từ client) — field này
// hiện chỉ mang tính thông tin, chưa nơi nào đọc/rẽ nhánh theo giá trị của nó.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let word: string;
  let meaning: string;
  let example: string;
  let pronunciation: string;
  try {
    const body = (await req.json()) as { word?: string; meaning?: string; example?: string; pronunciation?: string };
    word = typeof body.word === "string" ? body.word.trim().slice(0, 60) : "";
    meaning = typeof body.meaning === "string" ? body.meaning.trim().slice(0, 300) : "";
    example = typeof body.example === "string" ? body.example.trim().slice(0, 500) : "";
    pronunciation = typeof body.pronunciation === "string" ? body.pronunciation.trim().slice(0, 100) : "";
    if (!word || !meaning) {
      return Response.json({ error: "Thiếu từ hoặc nghĩa" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const profile = await getProfile(userId);
    const before = await prisma.vocabCard.findUnique({ where: { userId_word: { userId, word } } });
    await prisma.vocabCard.upsert({
      where: { userId_word: { userId, word } },
      update: {}, // giữ nguyên tiến độ ôn nếu từ đã tồn tại
      create: {
        userId,
        word,
        meaning,
        example: example || null,
        pronunciation: pronunciation || null,
        level: profile.overallLevel,
        sourceSkill: "chat",
      },
    });
    return Response.json({ ok: true, alreadyExisted: !!before });
  } catch (err) {
    console.error("[vocab/add] lỗi:", err);
    return Response.json({ error: "Không thêm được vào bộ từ vựng" }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";
import { normalizeContext, contextHash } from "@/lib/translation-cache";

export const runtime = "nodejs";

// POST: lưu 1 câu gợi ý (từ tính năng "Học theo câu") vào danh sách học cá nhân
// khi người học bấm "+ Thêm" — chỉ lưu khi được xác nhận, không lưu mọi gợi ý AI đưa ra.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let original: string;
  let suggested: string;
  let explanation: string;
  let level: string;
  try {
    const body = (await req.json()) as {
      original?: string;
      suggested?: string;
      explanation?: string;
      level?: string;
    };
    original = typeof body.original === "string" ? body.original.trim().slice(0, 500) : "";
    suggested = typeof body.suggested === "string" ? body.suggested.trim().slice(0, 500) : "";
    explanation = typeof body.explanation === "string" ? body.explanation.trim().slice(0, 500) : "";
    level = typeof body.level === "string" ? body.level.trim().slice(0, 10) : "A2";
    if (!original || !suggested) {
      return Response.json({ error: "Thiếu câu gốc hoặc câu gợi ý" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const sentenceHash = contextHash(normalizeContext(original));
    const before = await prisma.learningSentence.findUnique({
      where: { userId_sentenceHash: { userId, sentenceHash } },
    });
    await prisma.learningSentence.upsert({
      where: { userId_sentenceHash: { userId, sentenceHash } },
      update: {}, // giữ nguyên nếu câu đã có (vd. tiến độ ôn ở status)
      create: { userId, original, suggested, explanation, level, sentenceHash },
    });
    return Response.json({ ok: true, alreadyExisted: !!before });
  } catch (err) {
    console.error("[sentences/add] lỗi:", err);
    return Response.json({ error: "Không thêm được vào danh sách học" }, { status: 500 });
  }
}

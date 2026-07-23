import { NextRequest } from "next/server";
import { assessChatMessage } from "@/lib/agents/assessor";
import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";

export const runtime = "nodejs";

// POST: chấm ngữ pháp 1 tin nhắn chat, chạy SONG SONG với /api/tutor (không chặn
// luồng trả lời). Luôn trả 200 kể cả khi AI lỗi — tin nhắn đã hiển thị xong rồi,
// đây chỉ là làm giàu thêm, không được phép chặn hay báo lỗi to.
export async function POST(req: NextRequest) {
  let message: string;
  let level: CefrLevel;
  try {
    const body = (await req.json()) as { message?: string; level?: string };
    message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
    level = CEFR_LEVELS.includes(body.level as CefrLevel) ? (body.level as CefrLevel) : "A2";
    if (!message) {
      return Response.json({ error: "Thiếu nội dung tin nhắn" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const { errors } = await assessChatMessage({ learnerLevel: level, message });
    return Response.json({ errors });
  } catch (err) {
    console.error("[tutor/grammar-check] lỗi AI:", err);
    return Response.json({ errors: [], aiError: true });
  }
}

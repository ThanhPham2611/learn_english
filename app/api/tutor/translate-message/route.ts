import { NextRequest } from "next/server";
import { translateMessage } from "@/lib/agents/translator";

export const runtime = "nodejs";

// POST: dịch nguyên 1 tin nhắn AI sang tiếng Việt. Đây là hành động người dùng
// chủ động bấm và đang chờ kết quả -> báo lỗi thật (khác grammar-check chạy nền).
export async function POST(req: NextRequest) {
  let text: string;
  try {
    const body = (await req.json()) as { text?: string };
    text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
    if (!text) {
      return Response.json({ error: "Thiếu nội dung cần dịch" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const translation = await translateMessage(text);
    return Response.json({ translation });
  } catch (err) {
    console.error("[tutor/translate-message] lỗi AI:", err);
    return Response.json({ error: "Không dịch được lúc này, thử lại sau." }, { status: 500 });
  }
}

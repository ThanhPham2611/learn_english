import { NextRequest } from "next/server";
import { streamTutorReply, ChatTurn } from "@/lib/agents/tutor";
import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";

// API nói chuyện với Tutor. Chạy phía server nên API key không lộ ra client.
// Trả về text stream để UI hiển thị dần.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      level?: string;
      history?: ChatTurn[];
      style?: string;
    };

    const level: CefrLevel = CEFR_LEVELS.includes(body.level as CefrLevel)
      ? (body.level as CefrLevel)
      : "A2";
    const style: "chat" | "casual-speaking" = body.style === "casual-speaking" ? "casual-speaking" : "chat";
    const allHistory = Array.isArray(body.history) ? body.history : [];

    // Chế độ "trò chuyện tự do" (luyện Nói) cho phép history rỗng ở lượt đầu — AI
    // phải tự mở lời trước. Chat vẫn luôn seed 1 tin nhắn user nên không đổi hành vi cũ.
    if (allHistory.length === 0 && style !== "casual-speaking") {
      return Response.json({ error: "history trống" }, { status: 400 });
    }

    // Chỉ giữ ~12 lượt gần nhất để không vượt token / tốn quota khi hội thoại dài.
    // Tutor vốn chỉ trả lời ngắn theo chủ đề đang nói (xem tutorSystemPrompt), không
    // cần nhớ xa hơn ~6 lượt hỏi-đáp gần nhất — nếu thấy hay quên, tăng số này lên.
    const history = allHistory.slice(-12);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const piece of streamTutorReply(level, history, style)) {
            controller.enqueue(encoder.encode(piece));
          }
        } catch (err) {
          // Đẩy lỗi (ví dụ thiếu API key / vượt hạn mức) vào stream để UI hiện được.
          const msg = err instanceof Error ? err.message : "Lỗi không rõ";
          controller.enqueue(encoder.encode(`\n[Lỗi] ${msg}`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }
}

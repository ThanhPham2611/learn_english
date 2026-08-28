import { NextRequest } from "next/server";
import { streamTutorReply, ChatTurn } from "@/lib/agents/tutor";
import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

// API nói chuyện với Tutor. Chạy phía server nên API key không lộ ra client.
// Trả về text stream để UI hiển thị dần. Đồng thời lưu mỗi lượt (user + model)
// vào ChatSession/ChatMessage ngay khi hoàn tất — real-time, không đợi kết thúc
// phiên — để không mất dữ liệu nếu người dùng đóng tab giữa chừng.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const body = (await req.json()) as {
      level?: string;
      history?: ChatTurn[];
      style?: string;
      sessionId?: number;
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

    // Tái dùng session cũ nếu client gửi kèm sessionId hợp lệ (thuộc đúng user),
    // ngược lại tạo phiên mới — trang Chat luôn gửi sessionId sau lượt đầu tiên.
    const existing = body.sessionId
      ? await prisma.chatSession.findFirst({ where: { id: body.sessionId, userId } })
      : null;
    const session =
      existing ?? (await prisma.chatSession.create({ data: { userId, level, style } }));

    // Client luôn gửi TOÀN BỘ history mỗi lượt, nhưng các lượt trước đã lưu ở lần
    // gọi trước đó rồi — chỉ lượt user mới nhất (phần tử cuối) là dữ liệu mới.
    const newestTurn = allHistory[allHistory.length - 1];
    if (newestTurn?.role === "user" && newestTurn.text) {
      await prisma.chatMessage.create({
        data: { sessionId: session.id, userId, role: "user", content: newestTurn.text },
      });
    }

    const encoder = new TextEncoder();
    let fullReply = "";
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const piece of streamTutorReply(level, history, style)) {
            fullReply += piece;
            controller.enqueue(encoder.encode(piece));
          }
        } catch (err) {
          // Đẩy lỗi (ví dụ thiếu API key / vượt hạn mức) vào stream để UI hiện được.
          const msg = err instanceof Error ? err.message : "Lỗi không rõ";
          controller.enqueue(encoder.encode(`\n[Lỗi] ${msg}`));
        } finally {
          controller.close();
          if (fullReply) {
            await prisma.chatMessage.create({
              data: { sessionId: session.id, userId, role: "model", content: fullReply },
            });
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Chat-Session-Id": String(session.id),
      },
    });
  } catch {
    return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }
}

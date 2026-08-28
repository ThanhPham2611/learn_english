import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET: khôi phục phiên chat gần nhất còn mở (chưa "Kết thúc") của user, để trang
// Chat load lại đúng hội thoại đang dở thay vì luôn bắt đầu trống khi mở lại trang.
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const session = await prisma.chatSession.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!session) return Response.json({ session: null });

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  return Response.json({
    session: {
      sessionId: session.id,
      level: session.level,
      style: session.style,
      messages: messages.map((m) => ({ role: m.role, text: m.content })),
    },
  });
}

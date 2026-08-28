import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["not_reviewed", "reviewing", "mastered"];

// GET: danh sách câu đã lưu vào "Học theo câu" của user. Query param "status"
// (tuỳ chọn) lọc theo trạng thái ôn — not_reviewed | reviewing | mastered.
export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const sentences = await prisma.learningSentence.findMany({
    where: { userId, ...(status && VALID_STATUSES.includes(status) ? { status } : {}) },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ sentences });
}

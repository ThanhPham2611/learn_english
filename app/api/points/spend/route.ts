import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";

// POST: trừ điểm thưởng để đổi lấy 1 đặc quyền (xem đáp án / bỏ qua thẻ ở Vocab,
// Phrases...). Dùng transaction để tránh trừ âm khi bấm nhanh 2 lần liên tiếp.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let amount: number;
  try {
    const body = (await req.json()) as { amount?: number };
    if (typeof body.amount !== "number" || body.amount <= 0) {
      return Response.json({ error: "Số điểm không hợp lệ" }, { status: 400 });
    }
    amount = Math.round(body.amount);
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const profile = await tx.profile.upsert({
        where: { userId },
        update: {},
        create: { userId, overallLevel: "A2" },
      });
      if (profile.points < amount) {
        throw new Error("INSUFFICIENT_POINTS");
      }
      return tx.profile.update({
        where: { userId },
        data: { points: { decrement: amount } },
      });
    });
    return Response.json({ ok: true, points: updated.points });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_POINTS") {
      return Response.json({ error: "Không đủ điểm" }, { status: 400 });
    }
    console.error("[points/spend] lỗi:", err);
    return Response.json({ error: "Không trừ được điểm" }, { status: 500 });
  }
}

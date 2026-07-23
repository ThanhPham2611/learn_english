import { NextRequest } from "next/server";
import { setDailyGoal } from "@/lib/profile-db";

export const runtime = "nodejs";

// POST: cập nhật mục tiêu số hoạt động luyện tập muốn hoàn thành mỗi ngày (1-20).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { dailyGoal?: number };
    const dailyGoal = Math.round(Number(body.dailyGoal));
    if (!Number.isFinite(dailyGoal) || dailyGoal < 1 || dailyGoal > 20) {
      return Response.json({ error: "Mục tiêu phải từ 1 đến 20" }, { status: 400 });
    }
    const profile = await setDailyGoal(dailyGoal);
    return Response.json({ dailyGoal: profile.dailyGoal });
  } catch (err) {
    console.error("[profile/goal] lỗi:", err);
    return Response.json({ error: "Không lưu được mục tiêu" }, { status: 500 });
  }
}

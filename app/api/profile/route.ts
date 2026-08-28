import { getProfile } from "@/lib/profile-db";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";

// Trả về hồ sơ hiện tại (trình độ, đã làm placement chưa...).
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  try {
    const profile = await getProfile(userId);
    return Response.json(profile);
  } catch {
    return Response.json({ error: "Không đọc được hồ sơ" }, { status: 500 });
  }
}

import { getProfile } from "@/lib/profile-db";

export const runtime = "nodejs";

// Trả về hồ sơ hiện tại (trình độ, đã làm placement chưa...).
export async function GET() {
  try {
    const profile = await getProfile();
    return Response.json(profile);
  } catch {
    return Response.json({ error: "Không đọc được hồ sơ" }, { status: 500 });
  }
}

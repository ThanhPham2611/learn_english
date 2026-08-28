import { createClient } from "@/lib/supabase/server";

// Trả về id (uuid) của user đang đăng nhập, hoặc null nếu chưa đăng nhập.
// Route Handler dùng để trả 401; Server Component dùng để redirect("/login").
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

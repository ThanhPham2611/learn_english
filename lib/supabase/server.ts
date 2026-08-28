import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Dùng trong Server Component / Route Handler. Server Component không được phép
// set cookie (chỉ đọc) — nuốt lỗi ở setAll vì middleware đã lo việc refresh token.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Gọi từ Server Component (không phải Route Handler) -> bỏ qua,
            // middleware đã đảm nhiệm refresh session.
          }
        },
      },
    }
  );
}

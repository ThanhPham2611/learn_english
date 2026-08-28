import { Nav } from "@/components/Nav";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <Nav userEmail={user?.email} />
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10">{children}</main>
    </>
  );
}

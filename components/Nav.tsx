"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MODULES } from "@/lib/modules";
import { createClient } from "@/lib/supabase/client";

// Thanh điều hướng trái theo nghiên cứu (left-aligned), luôn hiện các kỹ năng.
export function Nav({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const links = [
    { slug: "", title: "Trang chủ" },
    { slug: "dashboard", title: "Tiến độ" },
    ...MODULES.map((m) => ({ slug: m.slug, title: m.title })),
    { slug: "vocab", title: "Ôn từ vựng" },
    { slug: "phrases", title: "Cụm câu" },
    { slug: "sentences", title: "Câu đã học" },
  ];

  return (
    <header className="border-b border-border bg-surface">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          <Link href="/" className="mr-3 font-heading text-lg font-semibold text-primary">
            English Learning
          </Link>
          {links.map((l) => {
            const href = l.slug ? `/${l.slug}` : "/";
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-200 ${
                  active
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-primary/10 hover:text-text"
                }`}
              >
                {l.title}
              </Link>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {userEmail && <span className="text-sm text-muted">{userEmail}</span>}
          <button
            onClick={handleLogout}
            className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors duration-200 hover:bg-primary/10 hover:text-text"
          >
            Đăng xuất
          </button>
        </div>
      </nav>
    </header>
  );
}

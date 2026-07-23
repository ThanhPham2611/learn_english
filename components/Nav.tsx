"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODULES } from "@/lib/modules";

// Thanh điều hướng trái theo nghiên cứu (left-aligned), luôn hiện các kỹ năng.
export function Nav() {
  const pathname = usePathname();

  const links = [
    { slug: "", title: "Trang chủ" },
    { slug: "dashboard", title: "Tiến độ" },
    ...MODULES.map((m) => ({ slug: m.slug, title: m.title })),
    { slug: "vocab", title: "Ôn từ vựng" },
  ];

  return (
    <header className="border-b border-border bg-surface">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-4 py-3">
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
      </nav>
    </header>
  );
}

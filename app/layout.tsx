import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

// Font đã chốt: Fraunces (tiêu đề, có cá tính) + IBM Plex Sans (nội dung, rất dễ đọc).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["400", "500", "600", "700"],
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "English Learning — Học tiếng Anh cá nhân",
  description: "Học Chat, Viết, Nói, Đọc, Nghe với AI. Theo dõi tiến độ theo CEFR.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className={`${fraunces.variable} ${plexSans.variable} antialiased`}>
        <Nav />
        <main className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10">
          {children}
        </main>
      </body>
    </html>
  );
}

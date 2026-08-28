import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  not_reviewed: "Chưa ôn",
  reviewing: "Đang ôn",
  mastered: "Đã thuộc",
};

// Danh sách câu đã lưu từ tính năng "Học theo câu" (gợi ý sau mỗi phiên Chat).
// Học theo CẢ CÂU, không phải từ vựng rời rạc — xem app/api/chat/analyze.
export default async function SentencesPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const sentences = await prisma.learningSentence.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Câu đã học</h1>
          <p className="mt-1 text-sm text-muted">
            Các câu được gợi ý cải thiện từ những lần Chat, bạn đã lưu lại để ôn.
          </p>
        </div>
        <Link
          href="/chat"
          className="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors duration-200 hover:border-primary"
        >
          ← Về Chat
        </Link>
      </div>

      {sentences.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-lg font-medium text-primary-text">Chưa có câu nào được lưu</p>
          <p className="mt-2 text-sm text-muted">
            Sau khi chat, bấm &quot;Kết thúc &amp; Xem gợi ý&quot; rồi &quot;+ Thêm vào danh sách học&quot;
            để lưu câu vào đây.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {sentences.map((s) => (
            <li key={s.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-text">
                  {s.level}
                </span>
                <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent-text">
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted line-through">{s.original}</p>
              <p className="mt-1 text-[15px] font-medium text-primary-text">{s.suggested}</p>
              {s.explanation && <p className="mt-1 text-sm italic text-muted">{s.explanation}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

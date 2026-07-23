import Link from "next/link";
import { getDifficultWords } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

// Từ "khó" ở đây nghĩa là: easeFactor thấp (hay bấm Khó/Chưa nhớ) hoặc chưa từng
// ôn đúng lần nào (repetition = 0) — xem ngưỡng cụ thể ở lib/dashboard.ts.
export default async function DifficultVocabPage() {
  const words = await getDifficultWords();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Từ khó / chưa nhớ</h1>
          <p className="mt-1 text-sm text-muted">
            Các từ hay trả lời sai/khó, hoặc chưa từng ôn đúng lần nào.
          </p>
        </div>
        <Link
          href="/vocab"
          className="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors duration-200 hover:border-primary"
        >
          ← Về ôn từ vựng
        </Link>
      </div>

      {words.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-lg font-medium text-primary-text">Chưa có từ nào khó cả 🎉</p>
          <p className="mt-2 text-sm text-muted">
            Từ sẽ xuất hiện ở đây khi bạn bấm &quot;Khó&quot;/&quot;Chưa nhớ&quot; lúc ôn tập.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {words.map((w) => (
            <li
              key={w.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-heading text-lg font-semibold">{w.word}</span>
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-text">
                    {w.level}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    w.repetition === 0
                      ? "bg-red-600/10 text-red-600"
                      : "bg-accent/10 text-accent-text"
                  }`}
                >
                  {w.repetition === 0 ? "Chưa nhớ lần nào" : `Độ dễ nhớ ${w.easeFactor.toFixed(1)}`}
                </span>
              </div>
              <p className="mt-2 text-sm text-primary-text">{w.meaning}</p>
              {w.example && <p className="mt-1 text-sm italic text-muted">&quot;{w.example}&quot;</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from "next/link";
import { MODULES } from "@/lib/modules";
import { getProfile } from "@/lib/profile-db";
import { getTodayProgress } from "@/lib/dashboard";
import { prisma } from "@/lib/db";
import { StreakCelebrationWatcher } from "@/components/Confetti";

// Đọc trình độ từ DB mỗi lần vào → render động (không tạo tĩnh lúc build).
export const dynamic = "force-dynamic";

// Trang chủ: giới thiệu ngắn + trình độ hiện tại + lối vào 5 kỹ năng.
// Xem đầy đủ biểu đồ tiến độ ở /dashboard (milestone M6).
export default async function Home() {
  const [profile, dueVocabCount] = await Promise.all([
    getProfile(),
    prisma.vocabCard.count({ where: { dueDate: { lte: new Date() } } }),
  ]);
  const todayProgress = await getTodayProgress(profile.dailyGoal);

  return (
    <div className="flex flex-col gap-8">
      <StreakCelebrationWatcher
        streak={profile.streak}
        todayDone={todayProgress.done}
        todayGoal={todayProgress.goal}
      />
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold md:text-4xl">
          Học tiếng Anh để đi làm, có lộ trình đo được
        </h1>
        <p className="mt-3 text-muted">
          Luyện đủ 5 kỹ năng với AI. Mỗi bài được chấm theo thang CEFR (A1–C2) kèm
          dẫn chứng cụ thể, để bạn biết mình tiến bộ thật — không phải cảm tính.
        </p>
      </section>

      {/* Thẻ trình độ + bài test đầu vào */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <p className="text-sm text-muted">Trình độ hiện tại</p>
          <p className="text-3xl font-semibold text-primary">
            {profile.overallLevel}
          </p>
          <p className="text-xs text-muted">
            {profile.placementDone
              ? "Đã làm bài test đầu vào."
              : "Chưa làm bài test đầu vào — hãy làm để xác định đúng trình độ."}
          </p>
        </div>

        {/* Streak + mục tiêu hôm nay — khích lệ nhẹ nhàng, không tiêu cực khi streak = 0 */}
        <div className="text-center">
          <p className="text-sm text-muted">
            {profile.streak > 0 ? "Chuỗi ngày học" : "Bắt đầu chuỗi ngày học"}
          </p>
          <p className="text-3xl font-semibold text-accent-text">
            🔥 {profile.streak}
          </p>
          <p className="mt-1 text-xs text-muted">
            {todayProgress.done >= todayProgress.goal
              ? "Đã đạt mục tiêu hôm nay! 🎉"
              : `${todayProgress.done}/${todayProgress.goal} hoạt động hôm nay`}
          </p>
          <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.min(100, Math.round((todayProgress.done / Math.max(1, todayProgress.goal)) * 100))}%`,
              }}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <Link
            href="/dashboard"
            className="cursor-pointer rounded-xl border border-border px-5 py-2.5 font-medium transition-colors duration-200 hover:border-primary"
          >
            Xem tiến độ
          </Link>
          <Link
            href="/placement"
            className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
          >
            {profile.placementDone ? "Làm lại test đầu vào" : "Làm bài test đầu vào"}
          </Link>
        </div>
      </section>

      {/* Nhắc ôn từ vựng — chỉ hiện khi có từ đến hạn, tránh làm phiền khi bộ ôn trống */}
      {dueVocabCount > 0 && (
        <Link
          href="/vocab"
          className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 p-4 transition-colors duration-200 hover:border-primary"
        >
          <span className="text-sm">
            <span className="font-medium text-primary-text">{dueVocabCount} từ</span> đang chờ ôn tập
          </span>
          <span className="text-sm text-primary-text">Ôn ngay →</span>
        </Link>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => {
          const card = (
            <div
              className={`h-full rounded-xl border border-border bg-surface p-5 transition-colors duration-200 ${
                m.ready ? "hover:border-primary cursor-pointer" : "opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">{m.title}</h2>
                {!m.ready && (
                  <span className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
                    Sắp có
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted">{m.desc}</p>
            </div>
          );
          return m.ready ? (
            <Link key={m.slug} href={`/${m.slug}`}>
              {card}
            </Link>
          ) : (
            <div key={m.slug}>{card}</div>
          );
        })}
      </section>
    </div>
  );
}

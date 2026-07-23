import Link from "next/link";
import { getProfile } from "@/lib/profile-db";
import {
  skillLevels,
  getVocabStats,
  getAttemptTrend,
  getAttemptCount,
  getRecentAttempts,
  getTodayProgress,
} from "@/lib/dashboard";
import { getAchievements } from "@/lib/achievements";
import { SkillLevelBars, ProgressTrend } from "@/components/DashboardCharts";
import { DailyGoalEditor } from "@/components/DailyGoalEditor";
import { CEFR_LEVELS, CEFR_TOEIC_RANGE, CefrLevel } from "@/lib/cefr";

export const dynamic = "force-dynamic";

const SKILL_VI: Record<string, string> = {
  placement: "Test đầu vào",
  writing: "Viết",
  speaking: "Nói",
  reading: "Đọc",
  listening: "Nghe",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default async function DashboardPage() {
  const [profile, vocab, trend, recent, attemptCount] = await Promise.all([
    getProfile(),
    getVocabStats(),
    getAttemptTrend(),
    getRecentAttempts(10),
    getAttemptCount(),
  ]);
  const todayProgress = await getTodayProgress(profile.dailyGoal);
  const achievements = getAchievements({
    streak: profile.streak,
    vocabMastered: vocab.mastered,
    attemptCount,
  });

  const levels = skillLevels(profile);
  const hasAnyAttempt = trend.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tiến độ của bạn</h1>
        <p className="text-sm text-muted">
          Mọi số liệu ở đây lấy từ các bài luyện tập thật — không phải cảm tính.
        </p>
      </div>

      {/* Chỉ số tổng quan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <p className="text-3xl font-semibold text-primary">{profile.overallLevel}</p>
          <p className="text-xs text-muted">Trình độ tổng</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <p className="text-3xl font-semibold text-accent-text">🔥 {profile.streak}</p>
          <p className="text-xs text-muted">Ngày học liên tục</p>
        </div>
        <DailyGoalEditor done={todayProgress.done} initialGoal={todayProgress.goal} />
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <p className="text-3xl font-semibold text-primary-text">{vocab.mastered}</p>
          <p className="text-xs text-muted">Từ đã thuộc / {vocab.total}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <p className="text-3xl font-semibold text-primary-text">{recent.length}</p>
          <p className="text-xs text-muted">Lượt luyện gần đây</p>
        </div>
      </div>

      {/* Xu hướng theo thời gian — trả lời trước câu hỏi chính "có đang tiến bộ không" */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="mb-2 text-sm font-medium">Xu hướng theo thời gian</p>
        <ProgressTrend data={trend} />
      </div>

      {/* Trình độ từng kỹ năng — chi tiết bổ sung "đang đứng ở đâu" */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="mb-1 text-sm font-medium">Trình độ theo từng kỹ năng</p>
        <p className="mb-2 text-xs text-muted">
          Kỹ năng nào chưa luyện lần nào sẽ hiện &quot;—&quot; (chưa có dữ liệu).
        </p>
        <SkillLevelBars data={levels} />
      </div>

      {/* Thành tích — cột mốc tính lại từ dữ liệu thật (streak/từ vựng/lượt luyện), không lưu trạng thái riêng */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="mb-3 text-sm font-medium">Thành tích</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {achievements.map((a) => (
            <div
              key={a.id}
              className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-opacity duration-200 ${
                a.achieved ? "border-primary/30 bg-primary/5" : "border-border opacity-40"
              }`}
            >
              <span className="text-2xl">{a.icon}</span>
              <span className="text-xs">{a.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quy đổi TOEIC — ước tính tham khảo dựa trên trình độ CEFR tổng, không phải điểm thi thật */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="mb-1 text-sm font-medium">Bảng quy đổi điểm TOEIC (ước tính)</p>
        <p className="mb-3 text-xs text-muted">
          Quy đổi tham khảo từ trình độ CEFR — không phải điểm thi TOEIC thật.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4 font-medium">CEFR</th>
                <th className="py-2 pr-4 font-medium">Điểm TOEIC ước tính</th>
                <th className="py-2 font-medium">Trình độ của bạn</th>
              </tr>
            </thead>
            <tbody>
              {CEFR_LEVELS.map((level) => {
                const [min, max] = CEFR_TOEIC_RANGE[level as CefrLevel];
                const isCurrent = profile.overallLevel === level;
                return (
                  <tr
                    key={level}
                    className={`border-b border-border last:border-0 ${
                      isCurrent ? "bg-primary/10" : ""
                    }`}
                  >
                    <td className="py-2 pr-4 font-medium">{level}</td>
                    <td className="py-2 pr-4 text-muted">{min}–{max}</td>
                    <td className="py-2">
                      {isCurrent && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-white">
                          Hiện tại
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bằng chứng thô — để tự soát lại, không chỉ tin số liệu tổng hợp */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="mb-2 text-sm font-medium">Bằng chứng gần đây</p>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">
            Chưa có lượt luyện tập nào.{" "}
            <Link href="/chat" className="text-primary-text hover:underline">
              Bắt đầu ngay
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((a) => (
              <li key={a.id} className="rounded-lg bg-bg px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    <span className="font-medium">{SKILL_VI[a.skill] ?? a.skill}</span>
                    <span className="ml-2 text-muted">{formatDate(a.createdAt)}</span>
                  </span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-text">
                    {a.cefr}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{a.evidence}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!hasAnyAttempt && (
        <div className="rounded-xl border border-border bg-surface p-5 text-center">
          <p className="text-sm text-muted">
            Biểu đồ sẽ có dữ liệu sau khi bạn làm bài luyện tập đầu tiên.
          </p>
          <Link
            href="/placement"
            className="mt-3 inline-block cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-dark"
          >
            Làm bài test đầu vào
          </Link>
        </div>
      )}
    </div>
  );
}

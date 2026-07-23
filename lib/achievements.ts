// Huy hiệu/cột mốc — tính lại mỗi lần render từ dữ liệu đã có sẵn (streak, số từ
// đã thuộc, số lượt luyện), KHÔNG lưu trạng thái "đã mở khoá" riêng. Đơn giản hơn
// và không bao giờ lệch với dữ liệu thật, đổi ngưỡng cũng không cần migrate DB.

export interface Achievement {
  id: string;
  label: string;
  icon: string;
  achieved: boolean;
}

const STREAK_MILESTONES = [3, 7, 14, 30];
const VOCAB_MILESTONES = [20, 50, 100];
const ATTEMPT_MILESTONES = [10, 50, 100];

export function getAchievements(params: {
  streak: number;
  vocabMastered: number;
  attemptCount: number;
}): Achievement[] {
  const { streak, vocabMastered, attemptCount } = params;

  return [
    ...STREAK_MILESTONES.map((n) => ({
      id: `streak-${n}`,
      label: `${n} ngày liên tục`,
      icon: "🔥",
      achieved: streak >= n,
    })),
    ...VOCAB_MILESTONES.map((n) => ({
      id: `vocab-${n}`,
      label: `${n} từ đã thuộc`,
      icon: "📚",
      achieved: vocabMastered >= n,
    })),
    ...ATTEMPT_MILESTONES.map((n) => ({
      id: `attempt-${n}`,
      label: `${n} lượt luyện tập`,
      icon: "🏅",
      achieved: attemptCount >= n,
    })),
  ];
}

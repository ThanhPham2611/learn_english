import { prisma } from "@/lib/db";
import { CEFR_LEVELS, CefrLevel } from "@/lib/cefr";
import { localDateKey, startOfDay } from "@/lib/date";

// Tổng hợp dữ liệu cho Dashboard — chỉ đọc, không ghi. Tách riêng khỏi
// profile-db.ts vì đây là các truy vấn phục vụ hiển thị, không phải cập nhật hồ sơ.

export interface SkillLevelPoint {
  skill: string;
  label: string;
  level: CefrLevel | null;
}

// Trình độ hiện tại của từng kỹ năng — dùng vẽ biểu đồ cột "đang ở đâu trên thang CEFR".
export function skillLevels(profile: {
  overallLevel: string;
  writing: string | null;
  speaking: string | null;
  reading: string | null;
  listening: string | null;
}): SkillLevelPoint[] {
  const asLevel = (v: string | null): CefrLevel | null =>
    v && CEFR_LEVELS.includes(v as CefrLevel) ? (v as CefrLevel) : null;
  return [
    { skill: "overall", label: "Tổng", level: asLevel(profile.overallLevel) },
    { skill: "writing", label: "Viết", level: asLevel(profile.writing) },
    { skill: "speaking", label: "Nói", level: asLevel(profile.speaking) },
    { skill: "reading", label: "Đọc", level: asLevel(profile.reading) },
    { skill: "listening", label: "Nghe", level: asLevel(profile.listening) },
  ];
}

export interface VocabStats {
  total: number;
  mastered: number; // đã ôn đúng >= 2 lần liên tiếp, coi như "thuộc"
  due: number;
}

export async function getVocabStats(): Promise<VocabStats> {
  const [total, mastered, due] = await Promise.all([
    prisma.vocabCard.count(),
    prisma.vocabCard.count({ where: { repetition: { gte: 2 } } }),
    prisma.vocabCard.count({ where: { dueDate: { lte: new Date() } } }),
  ]);
  return { total, mastered, due };
}

export interface TodayProgress {
  done: number;
  goal: number;
}

// "Hoạt động hôm nay" = số Attempt (Viết/Nói/Đọc/Nghe/Test đầu vào) tạo hôm nay +
// số thẻ từ vựng được ôn ít nhất 1 lần hôm nay (xấp xỉ qua updatedAt — không đếm
// trùng nếu ôn 1 thẻ 2 lần, đủ tốt cho app cá nhân, khỏi cần thêm bảng event-log).
export async function getTodayProgress(dailyGoal: number): Promise<TodayProgress> {
  const today = startOfDay(new Date());
  const [attemptsToday, vocabReviewedToday] = await Promise.all([
    prisma.attempt.count({ where: { createdAt: { gte: today } } }),
    prisma.vocabCard.count({ where: { updatedAt: { gte: today } } }),
  ]);
  return { done: attemptsToday + vocabReviewedToday, goal: dailyGoal };
}

export interface DifficultWord {
  id: number;
  word: string;
  meaning: string;
  example: string | null;
  level: string;
  repetition: number;
  easeFactor: number;
}

// Ngưỡng easeFactor coi là "khó": mặc định SM-2 khởi tạo 2.5, mỗi lần bấm
// "Khó"/"Chưa nhớ" sẽ kéo hệ số này xuống — dưới 2.3 nghĩa là đã từng vấp ít
// nhất 1 lần. repetition = 0 bắt thêm các từ mới/chưa từng ôn đúng lần nào.
const DIFFICULT_EASE_THRESHOLD = 2.3;

// Từ khó (dễ quên, easeFactor thấp) hoặc chưa từng ôn đúng lần nào (repetition = 0).
// Sắp theo easeFactor tăng dần — khó nhất lên đầu.
export async function getDifficultWords(limit = 100): Promise<DifficultWord[]> {
  return prisma.vocabCard.findMany({
    where: {
      OR: [{ easeFactor: { lt: DIFFICULT_EASE_THRESHOLD } }, { repetition: 0 }],
    },
    orderBy: [{ easeFactor: "asc" }, { repetition: "asc" }],
    take: limit,
    select: {
      id: true,
      word: true,
      meaning: true,
      example: true,
      level: true,
      repetition: true,
      easeFactor: true,
    },
  });
}

export interface AttemptPoint {
  date: string; // yyyy-MM-dd, dùng làm trục X
  skill: string;
  cefr: string;
  score: number;
}

// Tổng số lượt luyện tập (mọi kỹ năng, mọi thời điểm) — dùng cho cột mốc thành tích.
export async function getAttemptCount(): Promise<number> {
  return prisma.attempt.count();
}

// Lấy các lượt luyện gần đây để vẽ xu hướng theo thời gian (mỗi kỹ năng 1 đường).
export async function getAttemptTrend(limit = 100): Promise<AttemptPoint[]> {
  const attempts = await prisma.attempt.findMany({
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { skill: true, cefr: true, score: true, createdAt: true },
  });
  return attempts.map((a) => ({
    date: localDateKey(a.createdAt), // giờ LOCAL — khớp với streak (recordStudyActivity) và danh sách gần đây
    skill: a.skill,
    cefr: a.cefr,
    score: a.score,
  }));
}

export interface RecentAttempt {
  id: number;
  skill: string;
  cefr: string;
  score: number;
  createdAt: string;
  evidence: string; // trích 1 dòng bằng chứng thật (rationale/lỗi/số câu đúng) từ detail JSON
}

// Rút 1 dòng bằng chứng NGƯỜI ĐỌC ĐƯỢC từ Attempt.detail — mỗi skill lưu JSON khác
// hình dạng nên phải xử lý riêng. Đây là lý do tồn tại của danh sách này: không lặp
// lại con số đã có ở biểu đồ, mà cho xem LÝ DO đằng sau con số đó.
function summarizeEvidence(skill: string, detailRaw: string | null): string {
  if (!detailRaw) return "Không có chi tiết.";
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(detailRaw);
  } catch {
    return "Không đọc được chi tiết.";
  }

  if (skill === "reading" || skill === "listening") {
    const correct = d.correct;
    const total = d.total;
    return typeof correct === "number" && typeof total === "number"
      ? `${correct}/${total} câu đúng`
      : "Không có chi tiết.";
  }

  if (skill === "writing" || skill === "speaking") {
    const errors = Array.isArray(d.errors) ? d.errors.length : 0;
    const note = typeof d.taskAchievement === "string" ? d.taskAchievement : "";
    const prefix = errors > 0 ? `${errors} lỗi được chỉ ra. ` : "Không có lỗi. ";
    return (prefix + note).trim() || "Không có chi tiết.";
  }

  if (skill === "placement") {
    return typeof d.rationale === "string" ? d.rationale : "Không có chi tiết.";
  }

  return "Không có chi tiết.";
}

// Danh sách bằng chứng thô gần nhất — để người dùng tự soát lại, không chỉ tin số liệu tổng hợp.
export async function getRecentAttempts(limit = 10): Promise<RecentAttempt[]> {
  const attempts = await prisma.attempt.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, skill: true, cefr: true, score: true, createdAt: true, detail: true },
  });
  return attempts.map((a) => ({
    id: a.id,
    skill: a.skill,
    cefr: a.cefr,
    score: a.score,
    createdAt: a.createdAt.toISOString(),
    evidence: summarizeEvidence(a.skill, a.detail),
  }));
}

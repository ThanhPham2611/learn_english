import { prisma } from "@/lib/db";
import { CefrLevel } from "@/lib/cefr";
import { startOfDay } from "@/lib/date";

// Hồ sơ 1 người → luôn là dòng id = 1. Tạo mặc định nếu chưa có.
export async function getProfile() {
  return prisma.profile.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, overallLevel: "A2" },
  });
}

// Cập nhật trình độ sau khi làm bài test đầu vào.
export async function applyPlacement(levels: {
  overall: CefrLevel;
  writing: CefrLevel;
}) {
  return prisma.profile.upsert({
    where: { id: 1 },
    update: {
      overallLevel: levels.overall,
      writing: levels.writing,
      placementDone: true,
    },
    create: {
      id: 1,
      overallLevel: levels.overall,
      writing: levels.writing,
      placementDone: true,
    },
  });
}

// Cập nhật trình độ Viết sau mỗi bài luyện (không đổi overallLevel — đó là chỉ số
// tổng, chỉ cập nhật lại khi làm test đầu vào hoặc ở Dashboard tổng hợp sau này).
export async function applyWritingLevel(level: CefrLevel) {
  return prisma.profile.upsert({
    where: { id: 1 },
    update: { writing: level },
    create: { id: 1, overallLevel: "A2", writing: level },
  });
}

export async function applySpeakingLevel(level: CefrLevel) {
  return prisma.profile.upsert({
    where: { id: 1 },
    update: { speaking: level },
    create: { id: 1, overallLevel: "A2", speaking: level },
  });
}

export async function applyListeningLevel(level: CefrLevel) {
  return prisma.profile.upsert({
    where: { id: 1 },
    update: { listening: level },
    create: { id: 1, overallLevel: "A2", listening: level },
  });
}

export async function applyReadingLevel(level: CefrLevel) {
  return prisma.profile.upsert({
    where: { id: 1 },
    update: { reading: level },
    create: { id: 1, overallLevel: "A2", reading: level },
  });
}

// Cập nhật mục tiêu số hoạt động luyện tập muốn hoàn thành mỗi ngày.
export async function setDailyGoal(dailyGoal: number) {
  return prisma.profile.upsert({
    where: { id: 1 },
    update: { dailyGoal },
    create: { id: 1, overallLevel: "A2", dailyGoal },
  });
}

// Cập nhật streak (số ngày học liên tục). Gọi 1 lần sau mỗi lượt luyện tập
// thành công (bất kỳ kỹ năng nào) — không gọi trong getProfile() để tránh
// tăng streak chỉ vì mở trang xem, phải THẬT SỰ làm bài mới tính.
export async function recordStudyActivity(now: Date = new Date()) {
  const profile = await getProfile();
  const today = startOfDay(now);

  let streak = profile.streak;
  if (!profile.lastStudyDate) {
    streak = 1;
  } else {
    const last = startOfDay(profile.lastStudyDate);
    const diffDays = Math.round((today.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) {
      streak = profile.streak; // đã học hôm nay rồi -> giữ nguyên
    } else if (diffDays === 1) {
      streak = profile.streak + 1; // học liên tục sang ngày mới
    } else {
      streak = 1; // bỏ cách ngày -> tính lại từ đầu
    }
  }

  return prisma.profile.update({
    where: { id: 1 },
    data: { streak, lastStudyDate: now },
  });
}

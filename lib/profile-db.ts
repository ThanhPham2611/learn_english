import { prisma } from "@/lib/db";
import { CefrLevel } from "@/lib/cefr";
import { startOfDay } from "@/lib/date";

// Hồ sơ 1 dòng / user. Tạo mặc định nếu chưa có.
export async function getProfile(userId: string) {
  return prisma.profile.upsert({
    where: { userId },
    update: {},
    create: { userId, overallLevel: "A2" },
  });
}

// Cập nhật trình độ sau khi làm bài test đầu vào.
export async function applyPlacement(
  userId: string,
  levels: {
    overall: CefrLevel;
    writing: CefrLevel;
  }
) {
  return prisma.profile.upsert({
    where: { userId },
    update: {
      overallLevel: levels.overall,
      writing: levels.writing,
      placementDone: true,
    },
    create: {
      userId,
      overallLevel: levels.overall,
      writing: levels.writing,
      placementDone: true,
    },
  });
}

// Cập nhật trình độ Viết sau mỗi bài luyện (không đổi overallLevel — đó là chỉ số
// tổng, chỉ cập nhật lại khi làm test đầu vào hoặc ở Dashboard tổng hợp sau này).
export async function applyWritingLevel(userId: string, level: CefrLevel) {
  return prisma.profile.upsert({
    where: { userId },
    update: { writing: level },
    create: { userId, overallLevel: "A2", writing: level },
  });
}

export async function applySpeakingLevel(userId: string, level: CefrLevel) {
  return prisma.profile.upsert({
    where: { userId },
    update: { speaking: level },
    create: { userId, overallLevel: "A2", speaking: level },
  });
}

export async function applyListeningLevel(userId: string, level: CefrLevel) {
  return prisma.profile.upsert({
    where: { userId },
    update: { listening: level },
    create: { userId, overallLevel: "A2", listening: level },
  });
}

export async function applyReadingLevel(userId: string, level: CefrLevel) {
  return prisma.profile.upsert({
    where: { userId },
    update: { reading: level },
    create: { userId, overallLevel: "A2", reading: level },
  });
}

// Cập nhật mục tiêu số hoạt động luyện tập muốn hoàn thành mỗi ngày.
export async function setDailyGoal(userId: string, dailyGoal: number) {
  return prisma.profile.upsert({
    where: { userId },
    update: { dailyGoal },
    create: { userId, overallLevel: "A2", dailyGoal },
  });
}

// Cập nhật streak (số ngày học liên tục). Gọi 1 lần sau mỗi lượt luyện tập
// thành công (bất kỳ kỹ năng nào) — không gọi trong getProfile() để tránh
// tăng streak chỉ vì mở trang xem, phải THẬT SỰ làm bài mới tính.
export async function recordStudyActivity(userId: string, now: Date = new Date()) {
  const profile = await getProfile(userId);
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
    where: { userId },
    data: { streak, lastStudyDate: now },
  });
}

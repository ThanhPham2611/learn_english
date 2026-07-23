import { CefrLevel } from "@/lib/cefr";

// Đề luyện Nói, xếp theo trình độ — chủ đề công sở, khớp mục tiêu "đi làm".
// minWords là ngưỡng tham khảo (không chặt như Viết, vì nói tự nhiên ngắn hơn).

export interface SpeakingPrompt {
  id: number;
  level: CefrLevel;
  title: string;
  instruction: string;
  minWords: number;
}

export const SPEAKING_PROMPTS: SpeakingPrompt[] = [
  { id: 1, level: "A1", title: "Giới thiệu bản thân", instruction: "Introduce yourself: your name, where you're from, and your job.", minWords: 15 },
  { id: 2, level: "A2", title: "Một ngày làm việc", instruction: "Talk about what you usually do at work every day.", minWords: 25 },
  { id: 3, level: "A2", title: "Sở thích của bạn", instruction: "Talk about a hobby you enjoy and why you like it.", minWords: 25 },
  { id: 4, level: "B1", title: "Một khó khăn trong công việc", instruction: "Talk about a challenge you faced at work and how you solved it.", minWords: 40 },
  { id: 5, level: "B1", title: "Kế hoạch tương lai", instruction: "Talk about your plans for your career in the next few years.", minWords: 40 },
  { id: 6, level: "B2", title: "Ưu nhược điểm làm việc nhóm", instruction: "Talk about the advantages and disadvantages of working in a team.", minWords: 55 },
  { id: 7, level: "B2", title: "Thuyết trình ý tưởng", instruction: "Pitch an idea to improve something at your workplace, as if presenting to your team.", minWords: 55 },
  { id: 8, level: "C1", title: "Phản hồi ý kiến trái chiều", instruction: "Explain how you would handle disagreeing with a colleague's idea in a meeting, while staying professional.", minWords: 70 },
];

export function promptsForLevel(level: CefrLevel): SpeakingPrompt[] {
  const list = SPEAKING_PROMPTS.filter((p) => p.level === level);
  return list.length > 0 ? list : SPEAKING_PROMPTS.filter((p) => p.level === "A2");
}

export function randomPromptForLevel(level: CefrLevel): SpeakingPrompt {
  const list = promptsForLevel(level);
  return list[Math.floor(Math.random() * list.length)];
}

export function findPrompt(id: number): SpeakingPrompt | undefined {
  return SPEAKING_PROMPTS.find((p) => p.id === id);
}

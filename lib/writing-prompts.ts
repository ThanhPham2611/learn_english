import { CefrLevel } from "@/lib/cefr";

// Ngân hàng đề viết, xếp theo trình độ (đề càng cao càng đòi hỏi lập luận/diễn đạt phức tạp).
// Chủ đề thiên về công sở — khớp mục tiêu "đi làm" của người học.

export interface WritingPrompt {
  id: number;
  level: CefrLevel;
  title: string;
  instruction: string;
  minWords: number;
}

export const WRITING_PROMPTS: WritingPrompt[] = [
  { id: 1, level: "A1", title: "Giới thiệu bản thân", instruction: "Write 3-4 sentences to introduce yourself: your name, job, and one hobby.", minWords: 20 },
  { id: 2, level: "A2", title: "Một ngày làm việc", instruction: "Describe your typical work day, from morning to evening.", minWords: 40 },
  { id: 3, level: "A2", title: "Email xin nghỉ phép", instruction: "Write a short email to your manager asking for one day off next week.", minWords: 40 },
  { id: 4, level: "B1", title: "Một dự án bạn tự hào", instruction: "Describe a project or task at work you are proud of, and explain why.", minWords: 60 },
  { id: 5, level: "B1", title: "Email phản hồi khách hàng", instruction: "Write an email replying to a customer who is unhappy with a late delivery. Apologize and explain the next steps.", minWords: 60 },
  { id: 6, level: "B2", title: "Đề xuất ý tưởng cải tiến", instruction: "Write a short proposal to your team suggesting one improvement to how your team works, with reasons.", minWords: 90 },
  { id: 7, level: "B2", title: "So sánh làm việc từ xa và tại văn phòng", instruction: "Compare the advantages and disadvantages of working remotely versus working in an office.", minWords: 90 },
  { id: 8, level: "C1", title: "Phản hồi trong buổi đánh giá hiệu suất", instruction: "Write how you would respond in a performance review when your manager gives you constructive criticism you partly disagree with.", minWords: 120 },
  { id: 9, level: "C1", title: "Thuyết phục lãnh đạo phê duyệt ngân sách", instruction: "Write a persuasive message to leadership requesting budget approval for a new tool your team needs, addressing likely objections.", minWords: 120 },
];

export function promptsForLevel(level: CefrLevel): WritingPrompt[] {
  const list = WRITING_PROMPTS.filter((p) => p.level === level);
  return list.length > 0 ? list : WRITING_PROMPTS.filter((p) => p.level === "A2");
}

export function randomPromptForLevel(level: CefrLevel): WritingPrompt {
  const list = promptsForLevel(level);
  return list[Math.floor(Math.random() * list.length)];
}

export function findPrompt(id: number): WritingPrompt | undefined {
  return WRITING_PROMPTS.find((p) => p.id === id);
}

import { CefrLevel } from "@/lib/cefr";

// Ngân hàng bài đọc: đúng cấp CEFR, chủ đề công sở. Mỗi bài có vài từ mới (vocab)
// được tự động thêm vào bộ ôn tập SRS sau khi đọc xong.

export interface ReadingVocab {
  word: string;
  meaning: string; // nghĩa tiếng Việt ngắn gọn
  example: string; // câu ví dụ (trích trong bài hoặc câu mới)
}

export interface ReadingQuestion {
  id: number;
  prompt: string;
  options: string[];
  answer: number;
}

export interface ReadingPassage {
  id: number;
  level: CefrLevel;
  title: string;
  text: string;
  vocab: ReadingVocab[];
  questions: ReadingQuestion[];
}

export const READING_PASSAGES: ReadingPassage[] = [
  {
    id: 1,
    level: "A1",
    title: "My Office",
    text: "My office is small but comfortable. I sit next to the window. Every morning, I check my email and talk to my colleagues. We have lunch together at noon. My manager is friendly and helpful.",
    vocab: [
      { word: "comfortable", meaning: "thoải mái", example: "My office is small but comfortable." },
      { word: "colleague", meaning: "đồng nghiệp", example: "I talk to my colleagues every morning." },
      { word: "helpful", meaning: "hay giúp đỡ", example: "My manager is friendly and helpful." },
    ],
    questions: [
      { id: 1, prompt: "Where does the writer sit?", options: ["Near the door", "Next to the window", "In the kitchen", "Outside"], answer: 1 },
      { id: 2, prompt: "When do they have lunch?", options: ["Morning", "Noon", "Evening", "Night"], answer: 1 },
      { id: 3, prompt: "How is the manager described?", options: ["Strict", "Busy", "Friendly and helpful", "Absent"], answer: 2 },
    ],
  },
  {
    id: 2,
    level: "A2",
    title: "Working from Home",
    text: "Many people now work from home instead of going to an office. It saves time because there is no need to travel. However, it can be difficult to focus with family around. Some employees miss talking to their colleagues in person. Companies now offer flexible schedules to help.",
    vocab: [
      { word: "instead of", meaning: "thay vì", example: "Many people work from home instead of going to an office." },
      { word: "focus", meaning: "tập trung", example: "It can be difficult to focus with family around." },
      { word: "flexible", meaning: "linh hoạt", example: "Companies now offer flexible schedules." },
    ],
    questions: [
      { id: 1, prompt: "Why does working from home save time?", options: ["No need to travel", "Shorter meetings", "Less email", "Better internet"], answer: 0 },
      { id: 2, prompt: "What is difficult about working from home?", options: ["Using computers", "Focusing with family around", "Finding a job", "Learning new skills"], answer: 1 },
      { id: 3, prompt: "What do companies offer to help?", options: ["Free lunch", "More holidays", "Flexible schedules", "Higher salary"], answer: 2 },
    ],
  },
  {
    id: 3,
    level: "B1",
    title: "Giving Feedback at Work",
    text: "Giving useful feedback is an important skill in any workplace. Good feedback is specific and focuses on behavior, not personality. For example, instead of saying \"you're careless,\" a manager might say \"the report had three errors in the numbers.\" This approach helps employees understand exactly what to improve without feeling attacked. Timing also matters — feedback given soon after an event is more effective than feedback given weeks later.",
    vocab: [
      { word: "specific", meaning: "cụ thể", example: "Good feedback is specific and focuses on behavior." },
      { word: "approach", meaning: "cách tiếp cận", example: "This approach helps employees understand what to improve." },
      { word: "effective", meaning: "hiệu quả", example: "Feedback given soon after an event is more effective." },
    ],
    questions: [
      { id: 1, prompt: "What should good feedback focus on?", options: ["Personality", "Behavior", "Salary", "Appearance"], answer: 1 },
      { id: 2, prompt: "Why is the example about the report used?", options: ["To praise the employee", "To show specific feedback", "To criticize personality", "To explain a rule"], answer: 1 },
      { id: 3, prompt: "According to the text, when is feedback most effective?", options: ["Weeks later", "Soon after the event", "At the end of the year", "Never"], answer: 1 },
    ],
  },
  {
    id: 4,
    level: "B2",
    title: "The Rise of Asynchronous Work",
    text: "As teams become more distributed across time zones, many companies are shifting toward asynchronous communication — exchanging information without requiring everyone to be online at the same time. Proponents argue this approach reduces unnecessary meetings and allows employees to do focused work without constant interruptions. Critics, however, point out that async communication can slow down urgent decisions and make it harder to build team rapport. The most effective organizations tend to combine both approaches, reserving real-time meetings for complex discussions while defaulting to async updates for routine matters.",
    vocab: [
      { word: "distributed", meaning: "phân tán (về địa lý)", example: "Teams become more distributed across time zones." },
      { word: "proponent", meaning: "người ủng hộ", example: "Proponents argue this approach reduces unnecessary meetings." },
      { word: "rapport", meaning: "sự gắn kết, mối quan hệ tốt", example: "Async communication can make it harder to build team rapport." },
    ],
    questions: [
      { id: 1, prompt: "What do proponents of async communication argue?", options: ["It increases meetings", "It reduces unnecessary meetings", "It requires everyone online", "It slows down all work"], answer: 1 },
      { id: 2, prompt: "What is a criticism of async communication?", options: ["It's too expensive", "It can slow urgent decisions", "It requires more staff", "It's illegal in some places"], answer: 1 },
      { id: 3, prompt: "What do the most effective organizations do?", options: ["Use only async", "Use only real-time meetings", "Combine both approaches", "Avoid all communication"], answer: 2 },
    ],
  },
];

export function passagesForLevel(level: CefrLevel): ReadingPassage[] {
  const list = READING_PASSAGES.filter((p) => p.level === level);
  return list.length > 0 ? list : READING_PASSAGES.filter((p) => p.level === "A2");
}

export function randomPassageForLevel(level: CefrLevel): ReadingPassage {
  const list = passagesForLevel(level);
  return list[Math.floor(Math.random() * list.length)];
}

export function findPassage(id: number): ReadingPassage | undefined {
  return READING_PASSAGES.find((p) => p.id === id);
}

// Bỏ đáp án trước khi gửi cho client (vocab được gửi kèm vì cần hiển thị sau khi làm bài).
export function passageForClient(p: ReadingPassage) {
  return {
    id: p.id,
    level: p.level,
    title: p.title,
    text: p.text,
    vocab: p.vocab,
    questions: p.questions.map(({ id, prompt, options }) => ({ id, prompt, options })),
  };
}

export function scoreReading(passage: ReadingPassage, answers: Record<number, number>): number {
  return passage.questions.reduce(
    (correct, q) => correct + (answers[q.id] === q.answer ? 1 : 0),
    0
  );
}

export interface ReadingQuestionResult {
  id: number;
  prompt: string;
  chosenText: string;
  correctText: string;
  isCorrect: boolean;
}

export function gradeReadingDetailed(
  passage: ReadingPassage,
  answers: Record<number, number>
): ReadingQuestionResult[] {
  return passage.questions.map((q) => {
    const chosenIdx = answers[q.id];
    return {
      id: q.id,
      prompt: q.prompt,
      chosenText: q.options[chosenIdx] ?? "(chưa chọn)",
      correctText: q.options[q.answer],
      isCorrect: chosenIdx === q.answer,
    };
  });
}

// Quy đổi số câu đúng/tổng sang cấp CEFR — deterministic, giống module Nghe.
export function readingScoreToLevel(correct: number, total: number, passageLevel: CefrLevel): CefrLevel {
  const ratio = total > 0 ? correct / total : 0;
  const levels: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = levels.indexOf(passageLevel);
  if (ratio >= 0.8) return levels[Math.min(idx + 1, levels.length - 1)];
  if (ratio >= 0.4) return passageLevel;
  return levels[Math.max(idx - 1, 0)];
}

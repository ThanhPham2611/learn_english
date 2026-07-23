import { CefrLevel } from "@/lib/cefr";

// Ngân hàng bài nghe: text được đọc bằng Web Speech API (TTS) phía client, đáp án
// câu hỏi giữ ở server — cùng cách làm với ngân hàng câu hỏi test đầu vào (lib/placement.ts).

export interface ListeningQuestion {
  id: number;
  prompt: string;
  options: string[];
  answer: number;
}

export interface ListeningPassage {
  id: number;
  level: CefrLevel;
  title: string;
  text: string; // nội dung đọc bằng TTS
  questions: ListeningQuestion[];
}

export const LISTENING_PASSAGES: ListeningPassage[] = [
  {
    id: 1,
    level: "A1",
    title: "A New Colleague",
    text: "Hi, my name is Anna. I am a new employee at this company. I work in the marketing team. My manager's name is Tom. I start work at nine o'clock every morning.",
    questions: [
      { id: 1, prompt: "What team does Anna work in?", options: ["Sales", "Marketing", "Finance", "IT"], answer: 1 },
      { id: 2, prompt: "What time does Anna start work?", options: ["Eight o'clock", "Nine o'clock", "Ten o'clock", "Seven o'clock"], answer: 1 },
      { id: 3, prompt: "Who is Anna's manager?", options: ["Anna", "Tom", "The company", "A new employee"], answer: 1 },
    ],
  },
  {
    id: 2,
    level: "A2",
    title: "Booking a Meeting Room",
    text: "Hello, I would like to book a meeting room for tomorrow afternoon. We need the room from two to three thirty. There will be five people in the meeting. Could you also prepare a projector for us?",
    questions: [
      { id: 1, prompt: "When do they need the room?", options: ["Tomorrow morning", "Tomorrow afternoon", "Today", "Next week"], answer: 1 },
      { id: 2, prompt: "How many people will be in the meeting?", options: ["Two", "Three", "Five", "Six"], answer: 2 },
      { id: 3, prompt: "What extra equipment do they need?", options: ["A whiteboard", "A microphone", "A projector", "A printer"], answer: 2 },
    ],
  },
  {
    id: 3,
    level: "B1",
    title: "A Delayed Shipment",
    text: "I'm calling about our order, number four five two one. It was supposed to arrive last Monday, but we still haven't received it. Could you check the status and let us know when it will actually arrive? This delay is starting to affect our production schedule.",
    questions: [
      { id: 1, prompt: "What is the caller asking about?", options: ["A refund", "A delayed shipment", "A new order", "A price change"], answer: 1 },
      { id: 2, prompt: "When was the order supposed to arrive?", options: ["Last Monday", "Next Monday", "Today", "Last Friday"], answer: 0 },
      { id: 3, prompt: "What problem does the delay cause?", options: ["It affects the budget", "It affects production schedule", "It affects hiring", "It affects marketing"], answer: 1 },
    ],
  },
  {
    id: 4,
    level: "B2",
    title: "Performance Review Feedback",
    text: "During your review this quarter, the team highlighted strong progress in project management, particularly your ability to keep stakeholders aligned under tight deadlines. However, there's an opportunity to delegate more effectively instead of taking on every task yourself. We'd like you to mentor one junior team member next quarter as a way to build that skill.",
    questions: [
      { id: 1, prompt: "What strength was highlighted?", options: ["Coding skills", "Project management", "Sales performance", "Punctuality"], answer: 1 },
      { id: 2, prompt: "What area needs improvement?", options: ["Delegating tasks", "Meeting deadlines", "Communication with clients", "Budget planning"], answer: 0 },
      { id: 3, prompt: "What is suggested for next quarter?", options: ["A promotion", "A new project", "Mentoring a junior colleague", "A training course"], answer: 2 },
    ],
  },
];

export function passagesForLevel(level: CefrLevel): ListeningPassage[] {
  const list = LISTENING_PASSAGES.filter((p) => p.level === level);
  return list.length > 0 ? list : LISTENING_PASSAGES.filter((p) => p.level === "A2");
}

export function randomPassageForLevel(level: CefrLevel): ListeningPassage {
  const list = passagesForLevel(level);
  return list[Math.floor(Math.random() * list.length)];
}

export function findPassage(id: number): ListeningPassage | undefined {
  return LISTENING_PASSAGES.find((p) => p.id === id);
}

// Bỏ đáp án trước khi gửi cho client (giữ nguyên text vì cần đọc TTS).
export function passageForClient(p: ListeningPassage) {
  return {
    id: p.id,
    level: p.level,
    title: p.title,
    text: p.text,
    questions: p.questions.map(({ id, prompt, options }) => ({ id, prompt, options })),
  };
}

export function scoreListening(passage: ListeningPassage, answers: Record<number, number>): number {
  return passage.questions.reduce(
    (correct, q) => correct + (answers[q.id] === q.answer ? 1 : 0),
    0
  );
}

export interface ListeningQuestionResult {
  id: number;
  prompt: string;
  chosenText: string;
  correctText: string;
  isCorrect: boolean;
}

export function gradeListeningDetailed(
  passage: ListeningPassage,
  answers: Record<number, number>
): ListeningQuestionResult[] {
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

// Quy đổi số câu đúng/tổng sang cấp CEFR — deterministic, không cần gọi AI
// (bài nghe hiểu vốn khách quan, bằng chứng là đúng/sai từng câu).
export function listeningScoreToLevel(correct: number, total: number, passageLevel: CefrLevel): CefrLevel {
  const ratio = total > 0 ? correct / total : 0;
  const levels: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = levels.indexOf(passageLevel);
  if (ratio >= 0.8) return levels[Math.min(idx + 1, levels.length - 1)]; // làm tốt -> có thể lên cấp
  if (ratio >= 0.4) return passageLevel; // đạt mức đề -> giữ cấp
  return levels[Math.max(idx - 1, 0)]; // kém -> hạ cấp
}

import { CefrLevel } from "@/lib/cefr";

// Ngân hàng câu hỏi test đầu vào (chỉ dùng phía server để không lộ đáp án ra client).
// Xếp theo độ khó tăng dần. Client lấy câu hỏi qua GET /api/placement (đã bỏ đáp án).

export interface PlacementQuestion {
  id: number;
  level: CefrLevel;
  prompt: string;
  options: string[];
  answer: number; // chỉ số đáp án đúng (server giữ)
}

export const WRITING_PROMPT =
  "Write 2-4 sentences about your job or what you do every day.";

export const PLACEMENT_QUESTIONS: PlacementQuestion[] = [
  { id: 1, level: "A1", prompt: "I ___ a student.", options: ["am", "is", "are", "be"], answer: 0 },
  { id: 2, level: "A1", prompt: "She ___ to school every day.", options: ["go", "goes", "going", "gone"], answer: 1 },
  { id: 3, level: "A2", prompt: "Yesterday I ___ to the market.", options: ["go", "going", "went", "gone"], answer: 2 },
  { id: 4, level: "A2", prompt: "There ___ some milk in the fridge.", options: ["are", "is", "be", "am"], answer: 1 },
  { id: 5, level: "A2", prompt: "I have lived here ___ 2010.", options: ["since", "for", "from", "at"], answer: 0 },
  { id: 6, level: "B1", prompt: "If it rains, we ___ at home.", options: ["stay", "will stay", "stayed", "would stay"], answer: 1 },
  { id: 7, level: "B1", prompt: "She's the person ___ helped me.", options: ["which", "who", "whom", "whose"], answer: 1 },
  { id: 8, level: "B1", prompt: "I'm not used ___ early.", options: ["to get up", "to getting up", "get up", "getting up"], answer: 1 },
  { id: 9, level: "B2", prompt: "By next year, I ___ here for a decade.", options: ["will work", "will have worked", "have worked", "worked"], answer: 1 },
  { id: 10, level: "B2", prompt: "Hardly ___ down when the phone rang.", options: ["I had sat", "had I sat", "I sat", "did I sat"], answer: 1 },
];

// Bỏ đáp án trước khi gửi cho client.
export function questionsForClient() {
  return PLACEMENT_QUESTIONS.map(({ id, prompt, options }) => ({ id, prompt, options }));
}

// Đếm số câu đúng từ mảng lựa chọn của người dùng (theo id).
export function scoreMcq(answers: Record<number, number>): number {
  return PLACEMENT_QUESTIONS.reduce(
    (correct, q) => correct + (answers[q.id] === q.answer ? 1 : 0),
    0
  );
}

// Bằng chứng chi tiết từng câu — chỉ gọi SAU khi đã nộp bài (an toàn để lộ đáp án).
export interface QuestionResult {
  id: number;
  prompt: string;
  chosenText: string;
  correctText: string;
  isCorrect: boolean;
}

export function gradeDetailed(answers: Record<number, number>): QuestionResult[] {
  return PLACEMENT_QUESTIONS.map((q) => {
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

// Quy đổi số câu đúng (trên tổng) sang cấp CEFR thô — làm mỏ neo cho Assessor.
export function mcqToLevel(correct: number): CefrLevel {
  if (correct <= 2) return "A1";
  if (correct <= 4) return "A2";
  if (correct <= 6) return "B1";
  if (correct <= 8) return "B2";
  return "C1";
}

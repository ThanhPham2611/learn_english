import { generateJson } from "@/lib/agents/assessor";

// AGENT "VOCAB CHECKER" — khác Assessor (chấm bài dài, nhiều tiêu chí): ở đây
// chỉ phân loại nhanh đúng/gần đúng/sai cho MỘT cặp từ-nghĩa, chạy rất thường
// xuyên (mỗi thẻ ôn, tới 20 lần/phiên) nên prompt phải cực ngắn.

export type VocabVerdict = "correct" | "close" | "wrong";

export interface VocabCheckResult {
  verdict: VocabVerdict;
  feedback: string;
}

const SYSTEM_INSTRUCTION =
  "You grade whether a Vietnamese learner correctly recalled the Vietnamese meaning of an " +
  "English word. Accept synonyms, rephrasing, and partial-but-essentially-correct answers as " +
  "close or correct — do not require exact wording. Output ONLY valid JSON.";

export async function checkVocabAnswer(params: {
  word: string;
  correctMeaning: string;
  userAnswer: string;
}): Promise<VocabCheckResult> {
  const { word, correctMeaning, userAnswer } = params;

  const parsed = await generateJson(
    SYSTEM_INSTRUCTION,
    `English word: "${word}"
Correct Vietnamese meaning: "${correctMeaning}"
Learner's typed answer: "${userAnswer}"

Classify the learner's answer:
- "correct": matches the meaning (wording can differ)
- "close": right general idea but missing nuance, too vague, or partially right
- "wrong": incorrect or unrelated

Return JSON with EXACTLY these keys:
{
  "verdict": one of ["correct","close","wrong"],
  "feedback": very short Vietnamese sentence (max ~15 words) explaining the verdict
}`
  );

  const verdict: VocabVerdict =
    parsed.verdict === "correct" || parsed.verdict === "close" || parsed.verdict === "wrong"
      ? parsed.verdict
      : "wrong"; // giá trị lạ từ AI -> coi như sai, tránh đánh lừa là đã nhớ đúng

  return {
    verdict,
    feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
  };
}

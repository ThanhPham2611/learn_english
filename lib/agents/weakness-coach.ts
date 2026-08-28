import { getGemini, GEMINI_MODEL_LITE } from "@/lib/gemini";
import { CefrLevel } from "@/lib/cefr";
import { MISTAKE_CATEGORY_LABEL, MistakeCategory } from "@/lib/mistake-categories";

// AGENT "WEAKNESS COACH" — sinh bài luyện nhắm đúng 1 loại lỗi hay mắc (xem
// lib/weakness.ts) cho tính năng "Điểm yếu" ở Dashboard. Bài luyện sinh MỚI mỗi
// lần, không lưu DB (giống sentence-coach) — đủ nhẹ vì chỉ chạy khi user chủ
// động bấm "Luyện ngay", không phải tự động.

export interface WeaknessDrillItem {
  sentence: string; // câu có lỗi cố ý đúng loại category
  hint: string; // gợi ý loại lỗi cần tìm, không lộ đáp án
}

export async function generateWeaknessDrill(
  category: MistakeCategory,
  examples: { original: string; correction: string }[],
  level: CefrLevel
): Promise<WeaknessDrillItem[]> {
  const label = MISTAKE_CATEGORY_LABEL[category] ?? category;
  const model = getGemini().getGenerativeModel({
    model: GEMINI_MODEL_LITE,
    systemInstruction:
      "You create short English practice sentences for a Vietnamese learner to fix. Each sentence " +
      "must contain EXACTLY ONE deliberate mistake of the given category, otherwise be natural and " +
      "correct. Base the sentences on everyday topics similar in style to the learner's own past " +
      "mistakes (given as examples) so practice feels relevant. Output ONLY valid JSON matching the " +
      "requested schema — no markdown, no commentary.",
    generationConfig: { responseMimeType: "application/json" },
  });

  const exampleText =
    examples.length > 0
      ? `The learner's own past mistakes of this type (for style reference only, do not reuse verbatim):\n${examples
          .map((e) => `- "${e.original}" -> "${e.correction}"`)
          .join("\n")}`
      : "";

  const prompt = `The learner's CEFR level is ${level}. Mistake category: "${category}" (${label}).

${exampleText}

Generate exactly 3 short English sentences (5-12 words each), each containing exactly one deliberate mistake of this category. The learner will try to fix each sentence.

Return JSON with EXACTLY this shape:
{
  "drills": [
    { "sentence": "<sentence with the deliberate mistake>", "hint": "<short Vietnamese hint about what kind of error to look for, without giving the fix away>" }
  ]
}`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    parsed = JSON.parse(match[0]);
  }

  const rows = Array.isArray(parsed.drills) ? parsed.drills : [];
  const drills: WeaknessDrillItem[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const sentence = typeof r.sentence === "string" ? r.sentence.trim() : "";
    const hint = typeof r.hint === "string" ? r.hint.trim() : "";
    if (!sentence) continue;
    drills.push({ sentence, hint });
  }
  return drills.slice(0, 3);
}

export interface WeaknessDrillCheckResult {
  correct: boolean;
  correction: string;
  explanation: string;
}

export async function checkWeaknessDrillAnswer(
  sentence: string,
  userAnswer: string
): Promise<WeaknessDrillCheckResult> {
  const model = getGemini().getGenerativeModel({
    model: GEMINI_MODEL_LITE,
    systemInstruction:
      "You check whether a Vietnamese English learner correctly fixed a sentence that had exactly " +
      "one deliberate mistake. Judge by meaning and grammatical correctness, not exact wording — " +
      "minor rephrasing that still fixes the mistake counts as correct. Output ONLY valid JSON " +
      "matching the requested schema — no markdown, no commentary.",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `Original sentence (has exactly one mistake): "${sentence}"
Learner's attempted correction: "${userAnswer}"

Return JSON with EXACTLY this shape:
{
  "correct": <true if the learner's version fixes the mistake correctly, false otherwise>,
  "correction": "<a fully correct version of the sentence>",
  "explanation": "<short Vietnamese explanation of the mistake and fix>"
}`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI trả về dữ liệu không hợp lệ, không thể chấm.");
    parsed = JSON.parse(match[0]);
  }

  return {
    correct: parsed.correct === true,
    correction: typeof parsed.correction === "string" ? parsed.correction.trim() : "",
    explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
  };
}

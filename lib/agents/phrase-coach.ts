import { getGemini, GEMINI_MODEL_LITE } from "@/lib/gemini";
import { CefrLevel } from "@/lib/cefr";

// AGENT "PHRASE COACH" — cho tính năng "Học cụm câu": sinh các cụm từ/thành ngữ
// (collocation) thông dụng theo trình độ người học, MỖI cụm kèm 1 từ để luyện
// điền-từ-còn-thiếu ngay khi vừa học (xem app/(app)/phrases). Dùng model rẻ
// (GEMINI_MODEL_LITE) vì đây là nội dung sinh hàng loạt, không phải hội thoại chính.

export interface PhraseSuggestion {
  phrase: string;
  meaning: string;
  example: string;
  blankWord: string;
}

export async function generatePhrases(
  level: CefrLevel,
  excludePhrases: string[],
  count = 5
): Promise<PhraseSuggestion[]> {
  const model = getGemini().getGenerativeModel({
    model: GEMINI_MODEL_LITE,
    systemInstruction:
      "You generate common, natural English phrases/collocations (multi-word chunks, e.g. " +
      "'make up your mind', 'as far as I know') appropriate for a Vietnamese learner at a given " +
      "CEFR level. Each phrase must include a Vietnamese meaning, a short example sentence using " +
      "the phrase naturally, and ONE word from the phrase (exact substring, unchanged casing) that " +
      "is the most useful word to test recall of — used to build a fill-in-the-blank exercise. " +
      "Output ONLY valid JSON matching the requested schema — no markdown, no commentary.",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `The learner's CEFR level is ${level}. Generate ${count} common English phrases/collocations suitable for this level.

${excludePhrases.length > 0 ? `Do NOT repeat any of these phrases the learner already has:\n${JSON.stringify(excludePhrases)}\n` : ""}
Return JSON with EXACTLY this shape:
{
  "phrases": [
    {
      "phrase": "<the full phrase, e.g. 'make up your mind'>",
      "meaning": "<short Vietnamese meaning>",
      "example": "<one natural example sentence using the phrase>",
      "blankWord": "<one word copied EXACTLY from \\"phrase\\" (same spelling/case) to blank out for practice>"
    }
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

  const rows = Array.isArray(parsed.phrases) ? parsed.phrases : [];
  const suggestions: PhraseSuggestion[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const phrase = typeof r.phrase === "string" ? r.phrase.trim() : "";
    const meaning = typeof r.meaning === "string" ? r.meaning.trim() : "";
    const example = typeof r.example === "string" ? r.example.trim() : "";
    const blankWord = typeof r.blankWord === "string" ? r.blankWord.trim() : "";
    if (!phrase || !meaning || !example || !blankWord) continue;
    // blankWord phải khớp nguyên 1 từ trong phrase (word-boundary) — model có thể
    // trả sai lệch (thêm dấu câu, đổi hoa/thường) nên loại bỏ item không hợp lệ
    // thay vì cố sửa, tránh quiz điền-từ bị lỗi không thể so khớp được.
    const boundary = new RegExp(`\\b${blankWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (!boundary.test(phrase)) continue;
    suggestions.push({ phrase, meaning, example, blankWord });
  }

  return suggestions;
}

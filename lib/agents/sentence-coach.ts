import { getGemini, GEMINI_MODEL_LITE } from "@/lib/gemini";
import { CefrLevel } from "@/lib/cefr";

// AGENT "SENTENCE COACH" — cho tính năng "Học theo câu": sau 1 phiên Chat, xem
// lại các câu NGƯỜI HỌC đã viết (không phải câu AI) và gợi ý câu diễn đạt tự
// nhiên/nâng cao hơn. Học theo CẢ CÂU, không tách thành từ vựng rời rạc — dùng
// model rẻ (GEMINI_MODEL_LITE) vì đây là phân tích phụ, không phải hội thoại chính.

export interface SentenceSuggestion {
  original: string;
  suggested: string;
  explanation: string;
  level: string;
}

const MAX_SUGGESTIONS = 5;

export async function analyzeSentencesForLearning(
  userSentences: string[],
  level: CefrLevel
): Promise<SentenceSuggestion[]> {
  if (userSentences.length === 0) return [];

  const model = getGemini().getGenerativeModel({
    model: GEMINI_MODEL_LITE,
    systemInstruction:
      "You are an English writing coach reviewing sentences a Vietnamese learner wrote during a " +
      "chat practice session. For each sentence, decide if it is already natural and correctly " +
      "phrased (skip it), or if it could be rephrased to sound more natural or at a more advanced " +
      "level (include it). Always suggest a REWRITE OF THE WHOLE SENTENCE, never an isolated word " +
      "or vocabulary list — learning happens through whole sentences/phrases in context. Only include " +
      `the most valuable sentences to learn from, at most ${MAX_SUGGESTIONS}. Output ONLY valid JSON ` +
      "matching the requested schema — no markdown, no commentary.",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `The learner's current CEFR level is ${level}. Here are the sentences they wrote, in order:

${JSON.stringify(userSentences)}

Return JSON with EXACTLY this shape:
{
  "suggestions": [
    {
      "original": "<the exact original sentence from the list>",
      "suggested": "<a full rewritten sentence, more natural or more advanced>",
      "explanation": "<short explanation in Vietnamese of why the suggested version is better>",
      "level": "<estimated CEFR level of the suggested sentence, e.g. B1>"
    }
  ]
}
Only include sentences worth improving. If none are worth improving, return {"suggestions": []}.`;

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

  const rows = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const suggestions: SentenceSuggestion[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const original = typeof r.original === "string" ? r.original.trim() : "";
    const suggested = typeof r.suggested === "string" ? r.suggested.trim() : "";
    const explanation = typeof r.explanation === "string" ? r.explanation.trim() : "";
    const lvl = typeof r.level === "string" ? r.level.trim() : level;
    if (!original || !suggested) continue;
    suggestions.push({ original, suggested, explanation, level: lvl });
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

import { getGemini, GEMINI_MODEL } from "@/lib/gemini";

// AGENT "TRANSLATOR" — dịch Anh-Việt cho module Chat: dịch nguyên câu trả lời
// của Tutor, và tra nghĩa 1 từ/cụm từ theo đúng ngữ cảnh câu chứa nó.

export async function translateMessage(text: string): Promise<string> {
  const model = getGemini().getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction:
      "You are a professional English-to-Vietnamese translator. Translate the given English " +
      "text into natural, fluent Vietnamese. Output ONLY the Vietnamese translation — no notes, " +
      "no quotation marks, no explanation.",
  });
  const result = await model.generateContent(
    `Translate this English text to Vietnamese:\n\n"""\n${text}\n"""`
  );
  return result.response.text().trim();
}

export interface TranslateBatchItem {
  index: number;
  word: string;
  contextSentence: string;
}

export interface TranslateBatchResult {
  index: number;
  meaning: string;
  pronunciation: string | null;
}

// Dịch nhiều từ/cụm trong 1 lượt gọi Gemini duy nhất — mỗi item vẫn chỉ dùng
// đúng câu ngữ cảnh của riêng nó để chọn nghĩa (không lẫn ngữ cảnh giữa các từ).
// `model` truyền vào từ ngoài để route quyết định dùng GEMINI_MODEL hay
// GEMINI_MODEL_LITE tuỳ theo độ khó của cả lô (xem lib/word-complexity.ts).
export async function translateWordsBatch(
  items: TranslateBatchItem[],
  model: string
): Promise<TranslateBatchResult[]> {
  const gemini = getGemini().getGenerativeModel({
    model,
    systemInstruction:
      "You translate English words or short phrases to Vietnamese, one at a time, each within " +
      "its own sentence context (the same word can mean different things in different contexts). " +
      "You are given a numbered list of items. For each item, use ONLY that item's own sentence " +
      "to pick the correct sense. Output ONLY valid JSON matching the requested schema — no " +
      "markdown, no commentary.",
    generationConfig: { responseMimeType: "application/json" },
  });

  const payload = items.map((it) => ({ index: it.index, word: it.word, sentence: it.contextSentence }));
  const prompt = `Translate each of these English words/phrases to Vietnamese, using ONLY the sentence
given for that specific item to pick the correct sense.

Items:
${JSON.stringify(payload)}

Return JSON with EXACTLY this shape:
{
  "results": [
    { "index": <same index as input>, "meaning": "short Vietnamese translation AS USED in that sentence (a few words, not a full dictionary entry)", "pronunciation": "IPA pronunciation of the English word/phrase, or null if unsure" }
  ]
}
Include exactly one result per input item, in any order, each with its matching "index".`;

  const result = await gemini.generateContent(prompt);
  const raw = result.response.text();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI trả về dữ liệu không hợp lệ, không thể dịch.");
    parsed = JSON.parse(match[0]);
  }

  return mapBatchResults(items, parsed.results);
}

// Tách riêng phần map kết quả thô của Gemini về đúng item đầu vào — hàm thuần,
// không gọi mạng — để unit-test được việc xử lý model trả sai thứ tự/thiếu/thừa
// dòng mà không cần gọi Gemini thật.
// Không tin tưởng thứ tự/số lượng model trả về — luôn map lại theo items đầu
// vào, item nào không khớp thì coi là lỗi riêng của item đó (không hỏng cả lô).
export function mapBatchResults(items: TranslateBatchItem[], rawResults: unknown): TranslateBatchResult[] {
  const rows = Array.isArray(rawResults) ? rawResults : [];
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const idx = Number((row as Record<string, unknown>).index);
    if (!Number.isFinite(idx)) continue;
    byIndex.set(idx, row as Record<string, unknown>);
  }

  return items.map((it) => {
    const row = byIndex.get(it.index);
    const meaning = row && typeof row.meaning === "string" ? row.meaning.trim() : "";
    const pronunciation = row && typeof row.pronunciation === "string" && row.pronunciation ? row.pronunciation : null;
    return { index: it.index, meaning, pronunciation };
  });
}

import { getGemini, GEMINI_MODEL } from "@/lib/gemini";
import { generateJson } from "@/lib/agents/assessor";

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

export async function translateWord(word: string, contextSentence: string): Promise<{ meaning: string }> {
  const parsed = await generateJson(
    "You translate a single English word or short phrase to Vietnamese, using the surrounding " +
      "sentence to pick the correct sense (the same word can mean different things in different " +
      "contexts). Output ONLY valid JSON.",
    `English word or phrase: "${word}"
Sentence it appears in: "${contextSentence}"

Return JSON with EXACTLY this key:
{
  "meaning": short Vietnamese translation of "${word}" AS USED in this specific sentence (a few words, not a full dictionary entry)
}`
  );
  return {
    meaning: typeof parsed.meaning === "string" && parsed.meaning ? parsed.meaning : "(không dịch được)",
  };
}

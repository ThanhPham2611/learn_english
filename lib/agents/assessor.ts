import { getGemini, GEMINI_MODEL } from "@/lib/gemini";
import { CefrLevel, CEFR_LEVELS, cefrToNumber } from "@/lib/cefr";
import { FILLER_WORDS } from "@/lib/fluency";

// AGENT "ASSESSOR" — người chấm, ĐỘC LẬP với Tutor.
// Nhiệm vụ: chấm output của người học theo thang CEFR và trả về JSON có cấu trúc
// (điểm + bằng chứng cụ thể) để lưu DB và vẽ biểu đồ. Không dạy, không trò chuyện.

function coerceLevel(v: unknown, fallback: CefrLevel): CefrLevel {
  return CEFR_LEVELS.includes(v as CefrLevel) ? (v as CefrLevel) : fallback;
}

function coerceStringArray(v: unknown, max: number): string[] {
  return Array.isArray(v) ? v.map(String).slice(0, max) : [];
}

// Gọi Gemini với schema JSON bắt buộc, rồi parse.
// QUAN TRỌNG: nếu không parse được JSON hợp lệ, hàm THROW thay vì âm thầm trả {}.
// Lý do: mọi nơi gọi hàm này đều nằm trong try/catch coi lỗi = "chưa chấm được"
// (assessorUsed=false, không lưu Attempt). Nếu ở đây nuốt lỗi và trả {}, kết quả
// toàn field mặc định sẽ bị hiểu nhầm là ĐÃ CHẤM THÀNH CÔNG và lưu vào hồ sơ học.
export async function generateJson(systemInstruction: string, prompt: string): Promise<Record<string, unknown>> {
  const model = getGemini().getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
    generationConfig: { responseMimeType: "application/json" },
  });

  const result = await model.generateContent(prompt);
  const raw = result.response.text();

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // rơi xuống throw bên dưới
      }
    }
    console.error("[assessor] không parse được JSON từ Gemini:", raw.slice(0, 200));
    throw new Error("AI trả về dữ liệu không hợp lệ, không thể chấm bài.");
  }
}

// ---------- Chấm bài test đầu vào (placement) ----------

export interface PlacementAssessment {
  overallLevel: CefrLevel;
  writingLevel: CefrLevel; // suy ra từ đoạn viết mẫu
  rationale: string; // giải thích ngắn (bằng chứng)
  strengths: string[];
  weaknesses: string[];
}

// Ước lượng CEFR từ: điểm trắc nghiệm (đã tính ở server) + đoạn viết mẫu.
// mcqLevel là cấp suy ra từ phần trắc nghiệm; dùng làm mỏ neo cho AI.
export async function assessPlacement(params: {
  mcqCorrect: number;
  mcqTotal: number;
  mcqLevel: CefrLevel;
  writingPrompt: string;
  writingSample: string;
}): Promise<PlacementAssessment> {
  const { mcqCorrect, mcqTotal, mcqLevel, writingPrompt, writingSample } = params;

  const parsed = await generateJson(
    "You are a strict but fair CEFR examiner. You assess an English learner's level " +
      "objectively based on evidence. You never inflate scores. Output ONLY valid JSON.",
    `Assess this learner's English CEFR level.

Grammar/vocab quiz: ${mcqCorrect}/${mcqTotal} correct (this maps to roughly ${mcqLevel}).

Writing prompt: "${writingPrompt}"
Learner's writing sample: """${writingSample || "(left blank)"}"""

Weigh the writing sample heavily for productive skill. Return JSON with EXACTLY these keys:
{
  "overallLevel": one of ["A1","A2","B1","B2","C1","C2"],
  "writingLevel": one of ["A1","A2","B1","B2","C1","C2"],
  "rationale": short English sentence citing concrete evidence (errors, range, complexity),
  "strengths": array of 1-3 short strings,
  "weaknesses": array of 1-3 short strings
}`
  );

  const overallLevel = coerceLevel(parsed.overallLevel, mcqLevel);
  return {
    overallLevel,
    writingLevel: coerceLevel(parsed.writingLevel, overallLevel),
    rationale:
      typeof parsed.rationale === "string"
        ? parsed.rationale
        : "Đánh giá dựa trên phần trắc nghiệm và đoạn viết.",
    strengths: coerceStringArray(parsed.strengths, 3),
    weaknesses: coerceStringArray(parsed.weaknesses, 3),
  };
}

// ---------- Chấm bài Viết (module Writing) ----------

export interface WritingError {
  original: string; // cụm từ/câu gốc có lỗi
  correction: string; // sửa lại đúng
  explanation: string; // giải thích ngắn gọn tại sao sai
}

export interface WritingAssessment {
  cefrLevel: CefrLevel;
  taskAchievement: string; // bài có trả lời đúng đề không, đủ ý không
  grammarVocab: string; // nhận xét ngữ pháp/từ vựng
  errors: WritingError[];
  strengths: string[];
  weaknesses: string[];
}

export async function assessWriting(params: {
  learnerLevel: CefrLevel;
  promptTitle: string;
  promptInstruction: string;
  essay: string;
}): Promise<WritingAssessment> {
  const { learnerLevel, promptTitle, promptInstruction, essay } = params;

  const parsed = await generateJson(
    "You are a strict but fair CEFR writing examiner grading workplace English. " +
      "You never inflate scores. You quote EXACT substrings from the learner's text for " +
      "each error so they can be located precisely. Output ONLY valid JSON.",
    `Grade this piece of writing against the CEFR scale.

Writing task: "${promptTitle}" — ${promptInstruction}
Learner's current level: ${learnerLevel}

Learner's essay:
"""
${essay}
"""

Return JSON with EXACTLY these keys:
{
  "cefrLevel": one of ["A1","A2","B1","B2","C1","C2"] (the level this essay actually demonstrates),
  "taskAchievement": short English sentence on whether the essay fulfills the task,
  "grammarVocab": short English sentence on grammar/vocabulary range and accuracy,
  "errors": array (max 6) of { "original": exact substring copied verbatim from the essay, "correction": corrected version, "explanation": short reason },
  "strengths": array of 1-3 short strings,
  "weaknesses": array of 1-3 short strings
}
If there are no errors, return an empty array for "errors".`
  );

  const errorsRaw = Array.isArray(parsed.errors) ? parsed.errors : [];
  const errors: WritingError[] = errorsRaw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({
      original: typeof e.original === "string" ? e.original : "",
      correction: typeof e.correction === "string" ? e.correction : "",
      explanation: typeof e.explanation === "string" ? e.explanation : "",
    }))
    // Chỉ giữ lỗi mà cụm gốc thực sự có trong bài (tránh AI bịa trích dẫn) để highlight chính xác.
    .filter((e) => e.original && essay.includes(e.original))
    .slice(0, 6);

  return {
    cefrLevel: coerceLevel(parsed.cefrLevel, learnerLevel),
    taskAchievement:
      typeof parsed.taskAchievement === "string" ? parsed.taskAchievement : "Chưa đánh giá được.",
    grammarVocab:
      typeof parsed.grammarVocab === "string" ? parsed.grammarVocab : "Chưa đánh giá được.",
    errors,
    strengths: coerceStringArray(parsed.strengths, 3),
    weaknesses: coerceStringArray(parsed.weaknesses, 3),
  };
}

// ---------- Chấm bài Nói (module Speaking) ----------
// Dùng lại đúng dạng lỗi (WritingError) — cùng cấu trúc original/correction/explanation
// nên tái dùng được component highlight trong bài của module Viết.

export interface SpeakingAssessment {
  cefrLevel: CefrLevel;
  taskAchievement: string;
  grammarVocab: string;
  errors: WritingError[];
  strengths: string[];
  weaknesses: string[];
}

export async function assessSpeaking(params: {
  learnerLevel: CefrLevel;
  promptTitle: string;
  promptInstruction: string;
  transcript: string;
  wpm: number | null;
  fillerCount: number;
}): Promise<SpeakingAssessment> {
  const { learnerLevel, promptTitle, promptInstruction, transcript, wpm, fillerCount } = params;

  const parsed = await generateJson(
    "You are a strict but fair CEFR speaking examiner grading workplace English. " +
      "The text you see is a speech-to-text transcript, so ignore missing punctuation/capitalization " +
      "and minor transcription artifacts — focus on grammar, vocabulary, and coherence. " +
      "You never inflate scores. You quote EXACT substrings from the transcript for each error " +
      "so they can be located precisely. Output ONLY valid JSON.",
    `Grade this spoken answer (from speech-to-text) against the CEFR scale.

Speaking task: "${promptTitle}" — ${promptInstruction}
Learner's current level: ${learnerLevel}
Measured fluency: ${wpm ?? "unknown"} words/minute, ${fillerCount} filler words (${FILLER_WORDS.join("/")}) counted separately — do not re-flag these as grammar errors.

Transcript:
"""
${transcript}
"""

Return JSON with EXACTLY these keys:
{
  "cefrLevel": one of ["A1","A2","B1","B2","C1","C2"] (the level this response actually demonstrates),
  "taskAchievement": short English sentence on whether the response addresses the task,
  "grammarVocab": short English sentence on grammar/vocabulary range and accuracy,
  "errors": array (max 6) of { "original": exact substring copied verbatim from the transcript, "correction": corrected version, "explanation": short reason },
  "strengths": array of 1-3 short strings,
  "weaknesses": array of 1-3 short strings
}
If there are no grammar errors, return an empty array for "errors".`
  );

  const errorsRaw = Array.isArray(parsed.errors) ? parsed.errors : [];
  const errors: WritingError[] = errorsRaw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({
      original: typeof e.original === "string" ? e.original : "",
      correction: typeof e.correction === "string" ? e.correction : "",
      explanation: typeof e.explanation === "string" ? e.explanation : "",
    }))
    .filter((e) => e.original && transcript.includes(e.original))
    .slice(0, 6);

  return {
    cefrLevel: coerceLevel(parsed.cefrLevel, learnerLevel),
    taskAchievement:
      typeof parsed.taskAchievement === "string" ? parsed.taskAchievement : "Chưa đánh giá được.",
    grammarVocab:
      typeof parsed.grammarVocab === "string" ? parsed.grammarVocab : "Chưa đánh giá được.",
    errors,
    strengths: coerceStringArray(parsed.strengths, 3),
    weaknesses: coerceStringArray(parsed.weaknesses, 3),
  };
}

// ---------- Chấm ngữ pháp tin nhắn Chat (tự động, chạy song song với Tutor) ----------
// Prompt ngắn hơn hẳn Viết/Nói vì tin nhắn chat chỉ 1-2 câu, không cần chấm CEFR
// tổng thể — chỉ cần bắt lỗi để highlight ngay trong bong bóng chat.

export async function assessChatMessage(params: {
  learnerLevel: CefrLevel;
  message: string;
}): Promise<{ errors: WritingError[] }> {
  const { learnerLevel, message } = params;

  const parsed = await generateJson(
    "You are a strict but fair CEFR English grammar checker reviewing a short chat message " +
      "from a Vietnamese learner practicing conversational English. You quote EXACT substrings " +
      "from the message for each error so they can be located precisely. Ignore trivial style " +
      "issues (missing capitalization, missing final punctuation) — only flag real grammar or " +
      "word-choice mistakes. Output ONLY valid JSON.",
    `Check this chat message for English grammar/word-choice errors.
Learner's level: ${learnerLevel} — do not flag natural simplifications typical at this level, only actual mistakes.

Message: "${message}"

Return JSON with EXACTLY this key:
{
  "errors": array (max 4) of { "original": exact substring copied verbatim from the message, "correction": corrected version, "explanation": very short reason (max ~12 words) }
}
If there are no errors, return an empty array.`
  );

  const errorsRaw = Array.isArray(parsed.errors) ? parsed.errors : [];
  const errors: WritingError[] = errorsRaw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({
      original: typeof e.original === "string" ? e.original : "",
      correction: typeof e.correction === "string" ? e.correction : "",
      explanation: typeof e.explanation === "string" ? e.explanation : "",
    }))
    .filter((e) => e.original && message.includes(e.original))
    .slice(0, 4);

  return { errors };
}

// Đổi cấp CEFR -> điểm số 1..6 để lưu DB / vẽ biểu đồ.
export function levelToScore(level: CefrLevel): number {
  return cefrToNumber(level);
}

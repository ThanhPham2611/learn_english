import { getGemini, GEMINI_MODEL, GEMINI_MODEL_LITE } from "@/lib/gemini";
import { CefrLevel, CEFR_DESCRIPTIONS } from "@/lib/cefr";

// AGENT "TUTOR" — người dạy/trò chuyện.
// Vai trò: hội thoại tự nhiên, khuyến khích, sửa lỗi nhẹ nhàng, giữ độ khó
// vừa với trình độ người học (nguyên tắc i+1: hơi cao hơn hiện tại một chút).
// KHÔNG chấm điểm — việc chấm là của agent Assessor (tách bạch để khách quan).

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

function tutorSystemPrompt(level: CefrLevel): string {
  return `You are a warm, patient English tutor for a Vietnamese adult learner whose goal is to become fluent for the workplace.

The learner's current CEFR level is ${level} (${CEFR_DESCRIPTIONS[level]}).

Rules:
- Reply in English. Keep vocabulary and grammar at roughly ${level} level, but push slightly above it (i+1) so they keep learning.
- Keep replies SHORT (2-4 sentences) and end most replies with one simple question to keep the conversation going.
- If the learner makes a mistake, gently model the correct version inside your reply (do not lecture). Example: if they say "I go store yesterday", you might reply "Nice — so you went to the store yesterday? What did you buy?".
- Be encouraging and natural, like a friendly colleague. Never switch to Vietnamese unless they are completely stuck and explicitly ask.
- Occasionally introduce one useful new word and briefly show its meaning in context.`;
}

// Biến thể dùng cho luyện NÓI kiểu "trò chuyện tự do" (khác Chat: đây là hội thoại
// bằng giọng nói, được đọc lại qua TTS, nên câu trả lời phải NGẮN hơn và tự nhiên
// khi nghe — không liệt kê, không dùng markdown). AI chủ động mở lời bằng câu hỏi
// đời thường (hôm nay thế nào, ăn gì, cuối tuần...) thay vì chủ đề công sở của Chat.
function casualSpeakingSystemPrompt(level: CefrLevel): string {
  return `You are a friendly English-speaking partner having a relaxed VOICE conversation with a Vietnamese adult learner. Your replies will be read aloud by text-to-speech, so keep them sounding natural when spoken.

The learner's current CEFR level is ${level} (${CEFR_DESCRIPTIONS[level]}).

Rules:
- If this is the very first message (empty history), open the conversation yourself with ONE short, casual everyday question — like how their day is going, what they ate, their weekend plans, or the weather. Do not wait for the learner to speak first.
- Reply in English only, at roughly ${level} level, pushed slightly above it (i+1).
- Keep replies VERY SHORT (1-2 sentences) and spoken-friendly — no lists, no markdown, no long explanations.
- Always react briefly to what the learner just said, then ask ONE natural follow-up question based on their answer to keep the small talk going — like a genuine casual conversation, not an interview.
- If the learner makes a mistake, gently model the correct version inside your reaction (do not lecture, do not stop to explain grammar).
- Stay on light everyday topics (daily life, food, weekend, hobbies, weather, family) — avoid formal workplace topics unless the learner brings them up.
- Never switch to Vietnamese unless they are completely stuck and explicitly ask.`;
}

// Trả về stream chữ (async generator) để UI hiển thị dần từng đoạn — trải nghiệm
// tốt hơn là chờ trả lời xong mới hiện (theo pattern AI UI: stream, đừng để màn trống).
export async function* streamTutorReply(
  level: CefrLevel,
  history: ChatTurn[],
  style: "chat" | "casual-speaking" = "chat"
): AsyncGenerator<string> {
  const model = getGemini().getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: style === "casual-speaking" ? casualSpeakingSystemPrompt(level) : tutorSystemPrompt(level),
  });

  // Gemini yêu cầu lịch sử bắt đầu bằng "user"; ta gửi toàn bộ history dạng contents.
  const contents = history.map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));

  // Chế độ "trò chuyện tự do": lượt đầu tiên chưa có history (AI phải tự mở lời) —
  // Gemini bắt buộc phải có ít nhất 1 content, nên gửi 1 chỉ dẫn ẩn thay cho lượt user.
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "(Start the conversation now.)" }] });
  }

  const result = await model.generateContentStream({ contents });
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

export interface AnswerSuggestion {
  suggestion: string;
  explanation: string;
}

// Gợi ý cách trả lời câu hỏi AI vừa hỏi trong lúc luyện Nói (Trò chuyện tự do) —
// bấm mới gọi (xem app/(app)/speaking/page.tsx), KHÔNG tự động, để không làm mất
// tính chủ động luyện tập. Stateless — chỉ cần câu hỏi + trình độ, model rẻ vì
// đây là gợi ý phụ, không phải hội thoại chính.
export async function suggestAnswer(question: string, level: CefrLevel): Promise<AnswerSuggestion> {
  const model = getGemini().getGenerativeModel({
    model: GEMINI_MODEL_LITE,
    systemInstruction:
      "You help a Vietnamese English learner practice speaking. Given a question their AI " +
      "conversation partner just asked, suggest ONE natural, complete sample spoken answer at the " +
      "learner's CEFR level, plus a short Vietnamese explanation of why it's a good answer (structure, " +
      "useful vocabulary). The learner will read this before answering out loud in their own words — " +
      "keep the suggestion short and spoken-friendly (1-2 sentences), not a lecture. Output ONLY valid " +
      "JSON matching the requested schema — no markdown, no commentary.",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `The learner's CEFR level is ${level}. The AI just asked them:
"""
${question}
"""

Return JSON with EXACTLY this shape:
{ "suggestion": "<a natural 1-2 sentence sample spoken answer>", "explanation": "<short Vietnamese explanation of why this is a good answer>" }`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI trả về dữ liệu không hợp lệ, không thể gợi ý.");
    parsed = JSON.parse(match[0]);
  }

  const suggestion = typeof parsed.suggestion === "string" ? parsed.suggestion.trim() : "";
  const explanation = typeof parsed.explanation === "string" ? parsed.explanation.trim() : "";
  if (!suggestion) throw new Error("AI trả về dữ liệu không hợp lệ, không thể gợi ý.");
  return { suggestion, explanation };
}

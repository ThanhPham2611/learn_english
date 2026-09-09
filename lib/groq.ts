/**
 * lib/groq.ts
 *
 * Client gọi Groq Speech-to-Text (Whisper) để transcribe audio kèm mốc thời
 * gian TỪNG TỪ (word-level timestamps).
 *
 * Vì sao Whisper chứ không phải Gemini: Gemini chỉ "đoán" mốc thời gian bằng
 * ngôn ngữ nên lệch dần về cuối file. Whisper sinh timestamp từ alignment thật
 * giữa sóng âm và chữ → cắt câu bám đúng từ. Có mốc từng từ rồi thì việc gom
 * thành câu là thuật toán thuần (xem lib/dictation-segmenter.ts).
 *
 * API của Groq tương thích OpenAI → dùng fetch + FormData trực tiếp, KHÔNG cần
 * thêm dependency nào vào package.json.
 */

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Whisper bắt chước phong cách của prompt. Đoạn mồi này chỉ nhằm giữ cho nó
 * chấm câu đều tay từ đầu tới cuối file — nội dung cố ý vô thưởng vô phạt.
 */
const PUNCTUATION_PRIMER =
  "Hello, how are you today? I'm doing well, thanks. That sounds good. Let's begin.";

// Model đọc từ .env để đổi mà không cần sửa code.
// whisper-large-v3 (WER 10.3%) chính xác hơn whisper-large-v3-turbo (12%) —
// audio ở đây tối đa 3 phút nên chênh lệch tốc độ/chi phí không đáng kể.
export const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3";

const apiKey = process.env.GROQ_API_KEY;

/** Một từ đơn lẻ kèm mốc thời gian thật trong file audio. */
export interface GroqWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Một "segment" theo cách chia của Whisper — KHÔNG dùng làm câu để luyện gõ
 * (Whisper chia theo cửa sổ 30s, không theo câu), chỉ dùng 2 chỉ số chất lượng
 * no_speech_prob / avg_logprob để phát hiện đoạn hallucination.
 */
export interface GroqSegment {
  start: number;
  end: number;
  text: string;
  no_speech_prob: number;
  avg_logprob: number;
}

export interface GroqTranscription {
  text: string;
  words: GroqWord[];
  segments: GroqSegment[];
}

/** Báo lỗi rõ ràng nếu quên điền key — đỡ mất thời gian dò. */
export function assertGroqKey(): string {
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error(
      "GROQ_API_KEY chưa được cấu hình. Mở file .env và điền key thật " +
        "(lấy miễn phí tại https://console.groq.com/keys)."
    );
  }
  return apiKey;
}

/**
 * Gửi buffer audio lên Groq, xin verbose_json kèm timestamp cấp TỪ và cấp
 * segment.
 *
 * `filename` phải có đuôi đúng định dạng (vd "audio.mp3") — Groq nhận diện
 * định dạng qua tên file chứ không chỉ qua Content-Type.
 */
export async function transcribeWithWords(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<GroqTranscription> {
  const key = assertGroqKey();

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), filename);
  form.append("model", GROQ_STT_MODEL);
  form.append("response_format", "verbose_json");
  // Cần cả "word" (để cắt câu) lẫn "segment" (để lấy no_speech_prob lọc rác).
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  form.append("language", "en");
  // temperature 0 → output ổn định, ít bịa hơn.
  form.append("temperature", "0");
  // Prompt MỒI PHONG CÁCH, không phải mồi nội dung. Whisper hay ngừng chấm câu
  // giữa chừng ở file dài (khi đó cả câu dài dính liền, không tách được) — mồi
  // vài câu có dấu chấm/hỏi đầy đủ giúp nó giữ nếp chấm câu tới cuối file.
  // Cố ý dùng câu trung tính, không mang thông tin về nội dung file, để không
  // đẩy Whisper vào việc bịa nội dung theo prompt.
  form.append("prompt", PUNCTUATION_PRIMER);

  let res: Response;
  try {
    res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } catch (err) {
    throw new Error(`GROQ_NETWORK: không kết nối được tới Groq (${String(err)})`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Prefix mã lỗi để route phía trên map sang thông báo tiếng Việt phù hợp.
    if (res.status === 401 || res.status === 403) {
      throw new Error(`GROQ_AUTH: API key không hợp lệ (${res.status}) ${body}`);
    }
    if (res.status === 429) {
      throw new Error(`GROQ_RATE_LIMIT: hết quota hoặc quá tải (429) ${body}`);
    }
    if (res.status === 413) {
      throw new Error(`GROQ_TOO_LARGE: file vượt giới hạn của Groq (413) ${body}`);
    }
    throw new Error(`GROQ_ERROR: ${res.status} ${body}`);
  }

  const data = (await res.json()) as Partial<GroqTranscription>;

  return {
    text: typeof data.text === "string" ? data.text.trim() : "",
    words: Array.isArray(data.words) ? data.words : [],
    segments: Array.isArray(data.segments) ? data.segments : [],
  };
}

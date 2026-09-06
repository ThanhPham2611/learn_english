/**
 * app/api/dictation/transcribe/route.ts
 *
 * POST multipart/form-data:
 *   - audio: File (audio/*)  max 25MB
 *   - duration: string (giây, float — user cung cấp từ HTMLMediaElement.duration)
 *
 * Luồng:
 * 1. Auth check
 * 2. Validate file type + duration ≤ 180s
 * 3. Hash file → lookup cache AudioTranscript
 * 4. Cache miss → gửi audio inline base64 lên Gemini, xin transcribe kèm
 *    mốc thời gian bắt đầu/kết thúc của TỪNG câu (JSON) — dùng để phát lại
 *    đúng đoạn audio gốc theo câu khi luyện tập, thay vì đọc lại bằng TTS.
 * 5. Lưu cache → trả về danh sách segment
 *
 * Dùng Gemini 2.5 Flash (model đã cấu hình trong GEMINI_MODEL) thay vì
 * OpenAI Whisper → không cần OPENAI_API_KEY, dùng lại GEMINI_API_KEY sẵn có.
 * Đánh đổi: Gemini không phải forced-aligner chuyên dụng nên mốc thời gian có
 * thể lệch chút ít, nhưng đủ dùng để luyện nghe và không tốn thêm chi phí/API key.
 */

import { NextRequest } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { hashAudioBuffer } from "@/lib/audio-hash";
import { DictationSegment } from "@/lib/dictation";
import { prisma } from "@/lib/db";
import { getGemini, GEMINI_MODEL } from "@/lib/gemini";

export const runtime = "nodejs";

// Giới hạn bảo vệ chi phí
const MAX_DURATION_SEC = 180; // 3 phút
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB (giữ buffer an toàn)

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "video/webm", // webm thường bị báo sai mime type khi record trực tiếp
]);

const TRANSCRIBE_PROMPT =
  "Transcribe the English speech in this audio file and split it into individual sentences. " +
  "For EACH sentence, give the exact start and end time (in seconds, decimal, 0 = start of file) " +
  "matching when that sentence is actually spoken in the audio. " +
  "Output ONLY valid JSON — no markdown code fences, no explanation — in exactly this shape: " +
  '[{"text": "sentence text", "start": 0.0, "end": 3.2}, ...] ' +
  "Rules: sentences must be in chronological order and cover all spoken content; " +
  "each array item is exactly one sentence (do not merge multiple sentences into one item); " +
  "do not add speaker labels or any commentary inside \"text\".";

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  // --- Parse form data ---
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "Không đọc được dữ liệu gửi lên" }, { status: 400 });
  }

  const audioFile = formData.get("audio");
  const durationRaw = formData.get("duration");

  if (!(audioFile instanceof File)) {
    return Response.json({ error: "Thiếu file audio" }, { status: 400 });
  }

  // Validate file type
  const mimeType = audioFile.type || "";
  if (!ALLOWED_AUDIO_TYPES.has(mimeType) && !mimeType.startsWith("audio/")) {
    return Response.json(
      { error: "Định dạng file không được hỗ trợ. Hãy dùng MP3, M4A, WAV, WebM hoặc OGG." },
      { status: 400 }
    );
  }

  // Validate file size
  if (audioFile.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: "File quá lớn (tối đa 20MB)." },
      { status: 400 }
    );
  }

  // Validate duration
  const durationSec = parseFloat(String(durationRaw ?? "0"));
  if (!isFinite(durationSec) || durationSec <= 0) {
    return Response.json(
      { error: "Không đọc được độ dài audio. Hãy thử lại." },
      { status: 400 }
    );
  }
  if (durationSec > MAX_DURATION_SEC) {
    return Response.json(
      {
        error: `Audio quá dài (${Math.ceil(durationSec / 60)} phút). Tối đa 3 phút mỗi lần để kiểm soát chi phí.`,
      },
      { status: 400 }
    );
  }

  // --- Hash file để tra cache ---
  const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
  const fileHash = hashAudioBuffer(audioBuffer);

  // --- Lookup cache ---
  const cached = await prisma.audioTranscript.findUnique({
    where: { userId_fileHash: { userId, fileHash } },
  });

  let segments: DictationSegment[];
  if (cached?.segmentsJson) {
    segments = JSON.parse(cached.segmentsJson);
  } else {
    // --- Gọi Gemini để transcribe + lấy timestamp từng câu ---
    try {
      const gemini = getGemini();
      const model = gemini.getGenerativeModel({ model: GEMINI_MODEL });

      // Encode audio thành base64 để gửi inline (phù hợp file nhỏ ≤ 20MB)
      const base64Audio = audioBuffer.toString("base64");
      const effectiveMime = normalizeMime(mimeType);

      const parts = [
        { inlineData: { mimeType: effectiveMime, data: base64Audio } },
        { text: TRANSCRIBE_PROMPT },
      ];

      // Gemini thỉnh thoảng trả JSON không hợp lệ (thừa text, thiếu dấu…) —
      // thử tối đa 2 lần trước khi báo lỗi cho user.
      let parsed: DictationSegment[] | null = null;
      let lastRawText = "";
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        const result = await model.generateContent(parts);
        lastRawText = result.response.text().trim();
        parsed = parseSegments(lastRawText, durationSec);
      }

      if (!parsed || parsed.length === 0) {
        console.error("[dictation/transcribe] Không parse được segments:", lastRawText);
        return Response.json(
          { error: "Không nhận ra giọng nói trong file. Hãy thử file khác." },
          { status: 422 }
        );
      }

      segments = parsed;
      const transcript = segments.map((s) => s.text).join(" ");

      // Lưu cache
      await prisma.audioTranscript.upsert({
        where: { userId_fileHash: { userId, fileHash } },
        create: { userId, fileHash, transcript, segmentsJson: JSON.stringify(segments), durationSec },
        update: { transcript, segmentsJson: JSON.stringify(segments), durationSec },
      });
    } catch (err) {
      console.error("[dictation/transcribe] Gemini error:", err);
      const message = err instanceof Error ? err.message : String(err);
      // Trả lỗi Gemini rõ ràng hơn nếu có thể
      if (message.includes("GEMINI_API_KEY") || message.includes("API key")) {
        return Response.json(
          { error: "Server chưa cấu hình GEMINI_API_KEY. Hãy kiểm tra .env.local." },
          { status: 500 }
        );
      }
      return Response.json(
        { error: "Lỗi khi xử lý audio. Hãy thử lại sau." },
        { status: 500 }
      );
    }
  }

  return Response.json({ segments });
}

/**
 * Parse + validate JSON segments từ output của Gemini.
 * Trả về null nếu output không phải JSON hợp lệ hoặc không còn segment nào
 * sau khi lọc dữ liệu hỏng (start/end vô lý, text rỗng…).
 */
function parseSegments(raw: string, durationSec: number): DictationSegment[] | null {
  // Gemini đôi khi bọc JSON trong ```json ... ``` dù đã dặn không làm vậy
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const segments: DictationSegment[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    const start = Number(obj.start);
    const end = Number(obj.end);
    if (!text) continue;
    if (!isFinite(start) || !isFinite(end) || start < 0 || end <= start) continue;
    segments.push({ text, start, end: Math.min(end, durationSec) });
  }

  segments.sort((a, b) => a.start - b.start);
  return segments.length > 0 ? segments : null;
}

/**
 * Gemini SDK chỉ chấp nhận một số mimeType audio nhất định.
 * Map những giá trị không chuẩn về giá trị Gemini hiểu được.
 */
function normalizeMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/wave": "audio/wav",
    "video/webm": "audio/webm",
  };
  return map[mime] ?? mime;
}

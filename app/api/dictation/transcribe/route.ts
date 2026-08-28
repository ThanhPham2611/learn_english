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
 * 4. Cache miss → gửi audio inline base64 lên Gemini để transcribe
 * 5. Lưu cache → chia chunks → trả về
 *
 * Dùng Gemini 2.5 Flash (model đã cấu hình trong GEMINI_MODEL) thay vì
 * OpenAI Whisper → không cần OPENAI_API_KEY, dùng lại GEMINI_API_KEY sẵn có.
 */

import { NextRequest } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { hashAudioBuffer } from "@/lib/audio-hash";
import { chunkTranscript } from "@/lib/dictation";
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

  let transcript: string;
  if (cached) {
    transcript = cached.transcript;
  } else {
    // --- Gọi Gemini để transcribe ---
    try {
      const gemini = getGemini();
      const model = gemini.getGenerativeModel({ model: GEMINI_MODEL });

      // Encode audio thành base64 để gửi inline (phù hợp file nhỏ ≤ 20MB)
      const base64Audio = audioBuffer.toString("base64");
      const effectiveMime = normalizeMime(mimeType);

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: effectiveMime,
            data: base64Audio,
          },
        },
        {
          text:
            "Transcribe the English speech in this audio file. " +
            "Output ONLY the transcribed text, exactly as spoken. " +
            "Do NOT add any explanations, timestamps, speaker labels, punctuation corrections, " +
            "or any other commentary. Just the raw spoken words.",
        },
      ]);

      transcript = result.response.text().trim();

      if (!transcript) {
        return Response.json(
          { error: "Không nhận ra giọng nói trong file. Hãy thử file khác." },
          { status: 422 }
        );
      }

      // Lưu cache
      await prisma.audioTranscript.create({
        data: { userId, fileHash, transcript, durationSec },
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

  const chunks = chunkTranscript(transcript);

  return Response.json({ chunks, transcript });
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

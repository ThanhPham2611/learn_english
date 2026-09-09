/**
 * app/api/dictation/transcribe/route.ts
 *
 * POST multipart/form-data:
 *   - audio: File (audio/*)  max 20MB
 *   - duration: string (giây, float — user cung cấp từ HTMLMediaElement.duration)
 *
 * Luồng:
 * 1. Auth check
 * 2. Validate file type + duration ≤ 180s
 * 3. Hash file → lookup cache AudioTranscript
 * 4. Cache miss → gửi audio lên Groq Whisper, xin transcript kèm mốc thời gian
 *    TỪNG TỪ, rồi tự gom từ → câu (lib/dictation-segmenter.ts)
 * 5. Lưu cache → trả về danh sách segment
 *
 * Dùng Groq Whisper (whisper-large-v3) thay vì Gemini: Gemini không phải
 * forced-aligner, nó chỉ "đoán" mốc thời gian bằng ngôn ngữ nên lệch dần về
 * cuối file và hay cắt giữa câu. Whisper trả timestamp cấp TỪ sinh từ alignment
 * thật với sóng âm → cắt câu bám đúng từ, không nuốt đầu/cuối câu.
 */

import { NextRequest } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { hashAudioBuffer } from "@/lib/audio-hash";
import { DictationSegment } from "@/lib/dictation";
import { buildSegments } from "@/lib/dictation-segmenter";
import { prisma } from "@/lib/db";
import { transcribeWithWords } from "@/lib/groq";

export const runtime = "nodejs";

// Giới hạn bảo vệ chi phí
const MAX_DURATION_SEC = 180; // 3 phút
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB (Groq free tier cho tối đa 25MB)

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
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
  let cached;
  try {
    cached = await prisma.audioTranscript.findUnique({
      where: { userId_fileHash: { userId, fileHash } },
    });
  } catch (err) {
    console.error("[dictation/transcribe] Lỗi truy vấn cache:", err);
    return Response.json(
      { error: "Lỗi kết nối cơ sở dữ liệu. Hãy thử lại sau." },
      { status: 500 }
    );
  }

  let segments: DictationSegment[];
  if (cached?.segmentsJson) {
    segments = JSON.parse(cached.segmentsJson);
  } else {
    // --- Gọi Groq Whisper để transcribe + lấy timestamp từng TỪ ---
    try {
      const result = await transcribeWithWords(
        audioBuffer,
        buildGroqFilename(audioFile.name, mimeType),
        normalizeMime(mimeType)
      );

      segments = buildSegments(result.words, result.segments, durationSec);

      if (segments.length === 0) {
        console.error(
          "[dictation/transcribe] Không dựng được segment nào. words=%d segments=%d",
          result.words.length,
          result.segments.length
        );
        return Response.json(
          { error: "Không nhận ra giọng nói trong file. Hãy thử file khác." },
          { status: 422 }
        );
      }

      const transcript = result.text || segments.map((s) => s.text).join(" ");

      // Lưu cache
      await prisma.audioTranscript.upsert({
        where: { userId_fileHash: { userId, fileHash } },
        create: { userId, fileHash, transcript, segmentsJson: JSON.stringify(segments), durationSec },
        update: { transcript, segmentsJson: JSON.stringify(segments), durationSec },
      });
    } catch (err) {
      console.error("[dictation/transcribe] Groq error:", err);
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes("GROQ_API_KEY")) {
        return Response.json(
          {
            error:
              "Server chưa cấu hình GROQ_API_KEY. Mở file .env và điền key " +
              "(lấy miễn phí tại https://console.groq.com/keys).",
          },
          { status: 500 }
        );
      }
      if (message.startsWith("GROQ_AUTH")) {
        return Response.json(
          { error: "GROQ_API_KEY không hợp lệ. Hãy kiểm tra lại key trong .env." },
          { status: 500 }
        );
      }
      if (message.startsWith("GROQ_RATE_LIMIT")) {
        return Response.json(
          { error: "Groq đang quá tải hoặc đã hết quota. Hãy thử lại sau ít phút." },
          { status: 429 }
        );
      }
      if (message.startsWith("GROQ_TOO_LARGE")) {
        return Response.json(
          { error: "File quá lớn với dịch vụ nhận dạng. Hãy dùng file nhỏ hơn." },
          { status: 400 }
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
 * Groq nhận diện định dạng audio qua ĐUÔI TÊN FILE chứ không chỉ qua
 * Content-Type. Tên file gốc có thể thiếu đuôi hoặc có đuôi lạ (vd bản ghi từ
 * MediaRecorder), nên luôn tự dựng lại tên với đuôi suy ra từ mimeType.
 */
function buildGroqFilename(originalName: string, mime: string): string {
  const extByMime: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
  };

  const ext =
    extByMime[mime] ??
    // Không đoán được từ mime → thử lấy đuôi của tên gốc, cuối cùng mặc định mp3.
    (originalName.match(/\.([a-z0-9]{2,4})$/i)?.[1].toLowerCase() || "mp3");

  return `audio.${ext}`;
}

/**
 * Map những mimeType không chuẩn về giá trị chuẩn trước khi gửi lên Groq.
 * Groq hỗ trợ: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm.
 */
function normalizeMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/wave": "audio/wav",
    "audio/x-wav": "audio/wav",
    "video/webm": "audio/webm",
  };
  return map[mime] ?? mime;
}

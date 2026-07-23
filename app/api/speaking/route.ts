import { NextRequest } from "next/server";
import { randomPromptForLevel, findPrompt } from "@/lib/speaking-prompts";
import { assessSpeaking, levelToScore } from "@/lib/agents/assessor";
import { getProfile, applySpeakingLevel, recordStudyActivity } from "@/lib/profile-db";
import { computeFluency } from "@/lib/fluency";
import { prisma } from "@/lib/db";
import { CEFR_LEVELS, CefrLevel } from "@/lib/cefr";

export const runtime = "nodejs";

// GET: trả 1 đề nói ngẫu nhiên khớp trình độ hiện tại (speaking level nếu có).
export async function GET() {
  try {
    const profile = await getProfile();
    const level = (profile.speaking ?? profile.overallLevel) as CefrLevel;
    const prompt = randomPromptForLevel(CEFR_LEVELS.includes(level) ? level : "A2");
    return Response.json({ prompt, level });
  } catch (err) {
    console.error("[speaking] lỗi khi lấy đề bài:", err);
    return Response.json({ error: "Không tải được đề bài" }, { status: 500 });
  }
}

// POST: nhận transcript (từ Web Speech API) + thời lượng nói -> tính chỉ số trôi
// chảy (deterministic) + Assessor chấm ngữ pháp/CEFR -> lưu Attempt + cập nhật hồ sơ.
//
// 2 hình thức gửi lên:
// - { promptId, transcript, durationSec }              — chế độ "Theo đề bài" (cũ)
// - { conversation: { topic, transcript }, durationSec } — chế độ "Trò chuyện tự do" (mới):
//   transcript là toàn bộ các lượt NÓI của người học nối lại, topic là câu hỏi mở đầu
//   của AI (dùng làm promptInstruction cho Assessor thay vì 1 đề tĩnh).
export async function POST(req: NextRequest) {
  // --- 1) Đọc & kiểm tra request ---
  let promptTitle: string;
  let promptInstruction: string;
  let transcript: string;
  let durationSec: number;
  let minRequired: number;
  let attemptDetailExtra: Record<string, unknown>;
  try {
    const body = (await req.json()) as {
      promptId?: number;
      conversation?: { topic?: string; transcript?: string };
      transcript?: string;
      durationSec?: number;
    };

    const rawDuration = typeof body.durationSec === "number" ? body.durationSec : 0;
    // Chặn trong khoảng hợp lý (1s..30 phút) — durationSec do client tự đo, không
    // tin tưởng tuyệt đối vì nó nuôi thẳng vào chỉ số wpm lưu làm bằng chứng.
    durationSec = rawDuration > 0 ? Math.min(rawDuration, 1800) : 0;

    if (body.conversation) {
      transcript = typeof body.conversation.transcript === "string" ? body.conversation.transcript.trim() : "";
      transcript = transcript.slice(0, 8000); // hội thoại nhiều lượt nên cho phép dài hơn 1 đề đơn
      const topic = typeof body.conversation.topic === "string" ? body.conversation.topic.trim() : "";
      promptTitle = "Trò chuyện tự do";
      promptInstruction = topic || "A casual, free-flowing spoken conversation about everyday life.";
      minRequired = 15; // không có minWords tham chiếu như đề tĩnh, đặt ngưỡng thấp cho hội thoại ngắn
      attemptDetailExtra = { mode: "conversation", conversationTopic: promptInstruction };
    } else {
      if (typeof body.promptId !== "number") {
        return Response.json({ error: "Thiếu đề bài" }, { status: 400 });
      }
      const prompt = findPrompt(body.promptId);
      if (!prompt) {
        return Response.json({ error: "Không tìm thấy đề bài" }, { status: 400 });
      }
      transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
      transcript = transcript.slice(0, 4000);
      promptTitle = prompt.title;
      promptInstruction = prompt.instruction;
      minRequired = Math.max(8, Math.round(prompt.minWords * 0.4));
      attemptDetailExtra = { mode: "prompt", promptId: body.promptId };
    }

    if (!transcript) {
      return Response.json(
        { error: "Chưa có nội dung nói (không nhận diện được giọng nói)" },
        { status: 400 }
      );
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  const metrics = computeFluency(transcript, durationSec);
  if (metrics.wordCount < minRequired) {
    return Response.json(
      {
        error: `Câu trả lời quá ngắn (${metrics.wordCount} từ, cần tối thiểu ~${minRequired} từ). Hãy nói dài hơn.`,
      },
      { status: 400 }
    );
  }

  // --- 2) Chấm + lưu DB ---
  try {
    const profile = await getProfile();
    const learnerLevel = (profile.speaking ?? profile.overallLevel) as CefrLevel;

    let assessment;
    try {
      assessment = await assessSpeaking({
        learnerLevel: CEFR_LEVELS.includes(learnerLevel) ? learnerLevel : "A2",
        promptTitle,
        promptInstruction,
        transcript,
        wpm: metrics.wpm,
        fillerCount: metrics.fillerCount,
      });
    } catch (err) {
      console.error("[speaking] assessor lỗi:", err);
      return Response.json(
        { error: "Không chấm được bài lúc này (lỗi AI). Hãy thử lại sau." },
        { status: 502 }
      );
    }

    await prisma.attempt.create({
      data: {
        skill: "speaking",
        cefr: assessment.cefrLevel,
        score: levelToScore(assessment.cefrLevel),
        detail: JSON.stringify({ transcript, ...metrics, ...assessment, ...attemptDetailExtra }),
      },
    });
    await applySpeakingLevel(assessment.cefrLevel);
    try {
      await recordStudyActivity();
    } catch (err) {
      // Không để lỗi cập nhật streak (phụ) làm hỏng thông báo thành công của kết quả chính (đã lưu).
      console.error("[streak] lỗi khi cập nhật (không nghiêm trọng):", err);
    }

    return Response.json({ transcript, assessorUsed: true, ...metrics, ...assessment });
  } catch (err) {
    console.error("[speaking] lỗi hệ thống khi chấm/lưu:", err);
    return Response.json(
      { error: "Có lỗi hệ thống khi chấm bài, kết quả chưa được lưu. Hãy thử lại." },
      { status: 500 }
    );
  }
}

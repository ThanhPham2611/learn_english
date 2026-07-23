import { NextRequest } from "next/server";
import { randomPromptForLevel, findPrompt } from "@/lib/writing-prompts";
import { assessWriting, levelToScore } from "@/lib/agents/assessor";
import { getProfile, applyWritingLevel, recordStudyActivity } from "@/lib/profile-db";
import { prisma } from "@/lib/db";
import { CEFR_LEVELS, CefrLevel } from "@/lib/cefr";

export const runtime = "nodejs";

// GET: trả 1 đề viết ngẫu nhiên khớp trình độ hiện tại của người học (writing level
// nếu đã có, không thì dùng overallLevel).
export async function GET() {
  try {
    const profile = await getProfile();
    const level = (profile.writing ?? profile.overallLevel) as CefrLevel;
    const prompt = randomPromptForLevel(CEFR_LEVELS.includes(level) ? level : "A2");
    return Response.json({ prompt, level });
  } catch (err) {
    console.error("[writing] lỗi khi lấy đề bài:", err);
    return Response.json({ error: "Không tải được đề bài" }, { status: 500 });
  }
}

// POST: nhận bài luận -> Assessor chấm rubric + lỗi inline -> lưu Attempt + cập nhật hồ sơ.
export async function POST(req: NextRequest) {
  // --- 1) Đọc & kiểm tra request ---
  let promptId: number;
  let essay: string;
  try {
    const body = (await req.json()) as { promptId?: number; essay?: string };
    if (typeof body.promptId !== "number") {
      return Response.json({ error: "Thiếu đề bài" }, { status: 400 });
    }
    essay = typeof body.essay === "string" ? body.essay.trim() : "";
    essay = essay.slice(0, 4000); // giới hạn độ dài, tránh tốn quota / prompt quá dài
    promptId = body.promptId;

    if (!essay) {
      return Response.json({ error: "Vui lòng viết bài trước khi nộp" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  const prompt = findPrompt(promptId);
  if (!prompt) {
    return Response.json({ error: "Không tìm thấy đề bài" }, { status: 400 });
  }

  // Ngưỡng chặn = 40% độ dài gợi ý của đề (tối thiểu 10 từ) — đủ chặn bài spam,
  // không quá khắt khe, và co giãn thật theo từng đề thay vì hằng số cố định.
  const wordCount = essay.split(/\s+/).filter(Boolean).length;
  const minRequired = Math.max(10, Math.round(prompt.minWords * 0.4));
  if (wordCount < minRequired) {
    return Response.json(
      { error: `Bài viết quá ngắn (${wordCount} từ, cần tối thiểu ~${minRequired} từ). Hãy viết đủ ý hơn.` },
      { status: 400 }
    );
  }

  // --- 2) Chấm + lưu DB ---
  try {
    const profile = await getProfile();
    const learnerLevel = (profile.writing ?? profile.overallLevel) as CefrLevel;

    let assessorUsed = true;
    let assessment;
    try {
      assessment = await assessWriting({
        learnerLevel: CEFR_LEVELS.includes(learnerLevel) ? learnerLevel : "A2",
        promptTitle: prompt.title,
        promptInstruction: prompt.instruction,
        essay,
      });
    } catch (err) {
      assessorUsed = false;
      console.error("[writing] assessor lỗi:", err);
      return Response.json(
        { error: "Không chấm được bài lúc này (lỗi AI). Hãy thử lại sau." },
        { status: 502 }
      );
    }

    await prisma.attempt.create({
      data: {
        skill: "writing",
        cefr: assessment.cefrLevel,
        score: levelToScore(assessment.cefrLevel),
        detail: JSON.stringify({ promptId, wordCount, essay, ...assessment }),
      },
    });
    await applyWritingLevel(assessment.cefrLevel);
    try {
      await recordStudyActivity();
    } catch (err) {
      // Không để lỗi cập nhật streak (phụ) làm hỏng thông báo thành công của kết quả chính (đã lưu).
      console.error("[streak] lỗi khi cập nhật (không nghiêm trọng):", err);
    }

    // Trả lại đúng bản essay đã được chấm (đã trim/cắt) để client highlight lỗi
    // đúng vị trí, không lệch so với bản gõ thô (có thể dài hơn nếu vượt 4000 ký tự).
    return Response.json({ wordCount, assessorUsed, essay, ...assessment });
  } catch (err) {
    console.error("[writing] lỗi hệ thống khi chấm/lưu:", err);
    return Response.json(
      { error: "Có lỗi hệ thống khi chấm bài, kết quả chưa được lưu. Hãy thử lại." },
      { status: 500 }
    );
  }
}

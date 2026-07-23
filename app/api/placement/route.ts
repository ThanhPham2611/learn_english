import { NextRequest } from "next/server";
import {
  questionsForClient,
  scoreMcq,
  mcqToLevel,
  gradeDetailed,
  PLACEMENT_QUESTIONS,
  WRITING_PROMPT,
} from "@/lib/placement";
import { assessPlacement, levelToScore } from "@/lib/agents/assessor";
import { applyPlacement, recordStudyActivity } from "@/lib/profile-db";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET: gửi câu hỏi (đã bỏ đáp án) + đề viết cho client hiển thị.
export async function GET() {
  return Response.json({
    questions: questionsForClient(),
    writingPrompt: WRITING_PROMPT,
  });
}

// POST: nhận bài làm -> chấm trắc nghiệm -> Assessor ước lượng CEFR -> lưu DB.
export async function POST(req: NextRequest) {
  // --- 1) Đọc & kiểm tra request (lỗi ở bước này -> 400, lỗi của người gửi) ---
  let answers: Record<number, number>;
  let writingSample: string;
  try {
    const body = (await req.json()) as {
      answers?: Record<string, number>;
      writingSample?: string;
    };

    if (typeof body.answers !== "object" || body.answers === null) {
      return Response.json({ error: "Thiếu câu trả lời trắc nghiệm" }, { status: 400 });
    }
    answers = {};
    for (const [k, v] of Object.entries(body.answers)) {
      if (typeof v === "number") answers[Number(k)] = v;
    }
    writingSample = typeof body.writingSample === "string" ? body.writingSample.trim() : "";
    // Giới hạn độ dài để tránh tốn quota / prompt quá dài.
    writingSample = writingSample.slice(0, 2000);

    if (!writingSample) {
      return Response.json({ error: "Vui lòng viết ít nhất 1 câu ở phần Viết" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  // --- 2) Chấm + lưu DB (lỗi ở bước này -> 500, lỗi của hệ thống) ---
  try {
    const mcqCorrect = scoreMcq(answers);
    const mcqTotal = PLACEMENT_QUESTIONS.length;
    const mcqLevel = mcqToLevel(mcqCorrect);
    const questionResults = gradeDetailed(answers);

    // Assessor (cần API key). Nếu lỗi/chưa có key -> lùi về kết quả trắc nghiệm.
    let assessment;
    let assessorUsed = true;
    try {
      assessment = await assessPlacement({
        mcqCorrect,
        mcqTotal,
        mcqLevel,
        writingPrompt: WRITING_PROMPT,
        writingSample,
      });
    } catch (err) {
      assessorUsed = false;
      console.error("[placement] assessor lỗi, lùi về kết quả trắc nghiệm:", err);
      assessment = {
        overallLevel: mcqLevel,
        writingLevel: mcqLevel,
        rationale: "Chỉ chấm phần trắc nghiệm — chưa đánh giá phần viết bằng AI.",
        strengths: [],
        weaknesses: [],
      };
    }

    // Lưu 1 Attempt (bằng chứng) + cập nhật hồ sơ.
    await prisma.attempt.create({
      data: {
        skill: "placement",
        cefr: assessment.overallLevel,
        score: levelToScore(assessment.overallLevel),
        detail: JSON.stringify({ mcqCorrect, mcqTotal, mcqLevel, questionResults, ...assessment }),
      },
    });
    await applyPlacement({
      overall: assessment.overallLevel,
      writing: assessment.writingLevel,
    });
    try {
      await recordStudyActivity();
    } catch (err) {
      // Không để lỗi cập nhật streak (phụ) làm hỏng thông báo thành công của kết quả chính (đã lưu).
      console.error("[streak] lỗi khi cập nhật (không nghiêm trọng):", err);
    }

    return Response.json({
      mcqCorrect,
      mcqTotal,
      assessorUsed,
      questionResults,
      ...assessment,
    });
  } catch (err) {
    console.error("[placement] lỗi hệ thống khi chấm/lưu:", err);
    return Response.json(
      { error: "Có lỗi hệ thống khi chấm bài, kết quả chưa được lưu. Hãy thử lại." },
      { status: 500 }
    );
  }
}

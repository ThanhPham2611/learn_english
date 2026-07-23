import { NextRequest } from "next/server";
import {
  randomPassageForLevel,
  findPassage,
  passageForClient,
  scoreListening,
  gradeListeningDetailed,
  listeningScoreToLevel,
} from "@/lib/listening-content";
import { applyListeningLevel, getProfile, recordStudyActivity } from "@/lib/profile-db";
import { prisma } from "@/lib/db";
import { CEFR_LEVELS, CefrLevel, cefrToNumber } from "@/lib/cefr";

export const runtime = "nodejs";

// GET: trả 1 bài nghe (kèm text để đọc bằng TTS phía client) + câu hỏi (đã bỏ đáp án).
export async function GET() {
  try {
    const profile = await getProfile();
    const level = (profile.listening ?? profile.overallLevel) as CefrLevel;
    const passage = randomPassageForLevel(CEFR_LEVELS.includes(level) ? level : "A2");
    return Response.json({ passage: passageForClient(passage), level });
  } catch (err) {
    console.error("[listening] lỗi khi lấy bài nghe:", err);
    return Response.json({ error: "Không tải được bài nghe" }, { status: 500 });
  }
}

// POST: chấm câu trả lời (deterministic — nghe hiểu là khách quan, không cần AI)
// -> lưu Attempt + cập nhật hồ sơ.
export async function POST(req: NextRequest) {
  let passageId: number;
  let answers: Record<number, number>;
  try {
    const body = (await req.json()) as { passageId?: number; answers?: Record<string, number> };
    if (typeof body.passageId !== "number") {
      return Response.json({ error: "Thiếu bài nghe" }, { status: 400 });
    }
    if (typeof body.answers !== "object" || body.answers === null) {
      return Response.json({ error: "Thiếu câu trả lời" }, { status: 400 });
    }
    passageId = body.passageId;
    answers = {};
    for (const [k, v] of Object.entries(body.answers)) {
      if (typeof v === "number") answers[Number(k)] = v;
    }
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  const passage = findPassage(passageId);
  if (!passage) {
    return Response.json({ error: "Không tìm thấy bài nghe" }, { status: 400 });
  }
  if (passage.questions.some((q) => !(q.id in answers))) {
    return Response.json({ error: "Vui lòng trả lời hết các câu hỏi" }, { status: 400 });
  }

  try {
    const correct = scoreListening(passage, answers);
    const total = passage.questions.length;
    const questionResults = gradeListeningDetailed(passage, answers);
    const cefrLevel = listeningScoreToLevel(correct, total, passage.level);

    await prisma.attempt.create({
      data: {
        skill: "listening",
        cefr: cefrLevel,
        score: cefrToNumber(cefrLevel), // giữ cùng thang 1..6 với các skill khác; số câu đúng nằm trong detail
        detail: JSON.stringify({ passageId, correct, total, questionResults }),
      },
    });
    await applyListeningLevel(cefrLevel);
    try {
      await recordStudyActivity();
    } catch (err) {
      // Không để lỗi cập nhật streak (phụ) làm hỏng thông báo thành công của kết quả chính (đã lưu).
      console.error("[streak] lỗi khi cập nhật (không nghiêm trọng):", err);
    }

    return Response.json({ correct, total, cefrLevel, questionResults });
  } catch (err) {
    console.error("[listening] lỗi hệ thống khi chấm/lưu:", err);
    return Response.json(
      { error: "Có lỗi hệ thống khi chấm bài, kết quả chưa được lưu. Hãy thử lại." },
      { status: 500 }
    );
  }
}

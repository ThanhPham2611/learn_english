import { NextRequest } from "next/server";
import {
  randomPassageForLevel,
  findPassage,
  passageForClient,
  scoreReading,
  gradeReadingDetailed,
  readingScoreToLevel,
} from "@/lib/reading-content";
import { getProfile, recordStudyActivity } from "@/lib/profile-db";
import { prisma } from "@/lib/db";
import { CEFR_LEVELS, CefrLevel, cefrToNumber } from "@/lib/cefr";

export const runtime = "nodejs";

// GET: trả 1 bài đọc khớp trình độ hiện tại + từ mới (vocab) + câu hỏi (đã bỏ đáp án).
export async function GET() {
  try {
    const profile = await getProfile();
    const level = (profile.reading ?? profile.overallLevel) as CefrLevel;
    const passage = randomPassageForLevel(CEFR_LEVELS.includes(level) ? level : "A2");
    return Response.json({ passage: passageForClient(passage), level });
  } catch (err) {
    console.error("[reading] lỗi khi lấy bài đọc:", err);
    return Response.json({ error: "Không tải được bài đọc" }, { status: 500 });
  }
}

// POST: chấm câu hỏi hiểu (deterministic) -> lưu Attempt -> thêm từ mới của bài
// vào bộ ôn tập SRS (bỏ qua từ đã có sẵn, không ghi đè tiến độ ôn đang có).
export async function POST(req: NextRequest) {
  let passageId: number;
  let answers: Record<number, number>;
  try {
    const body = (await req.json()) as { passageId?: number; answers?: Record<string, number> };
    if (typeof body.passageId !== "number") {
      return Response.json({ error: "Thiếu bài đọc" }, { status: 400 });
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
    return Response.json({ error: "Không tìm thấy bài đọc" }, { status: 400 });
  }
  if (passage.questions.some((q) => !(q.id in answers))) {
    return Response.json({ error: "Vui lòng trả lời hết các câu hỏi" }, { status: 400 });
  }

  try {
    const correct = scoreReading(passage, answers);
    const total = passage.questions.length;
    const questionResults = gradeReadingDetailed(passage, answers);
    const cefrLevel = readingScoreToLevel(correct, total, passage.level);

    // Gộp toàn bộ ghi DB (Attempt + Profile + thêm từ mới) trong 1 transaction:
    // hoặc lưu trọn vẹn, hoặc không lưu gì — tránh trường hợp Attempt đã lưu
    // thành công nhưng bước thêm từ lỗi lại báo "chưa được lưu" (sai sự thật).
    // Dùng upsert(update:{}) thay vì findUnique+create để tránh race điều kiện
    // (2 tab cùng đọc 1 bài) — từ đã có giữ nguyên tiến độ ôn, không bị ghi đè.
    const newVocabAdded = await prisma.$transaction(async (tx) => {
      await tx.attempt.create({
        data: {
          skill: "reading",
          cefr: cefrLevel,
          score: cefrToNumber(cefrLevel),
          detail: JSON.stringify({ passageId, correct, total, questionResults }),
        },
      });
      await tx.profile.upsert({
        where: { id: 1 },
        update: { reading: cefrLevel },
        create: { id: 1, overallLevel: "A2", reading: cefrLevel },
      });

      let added = 0;
      for (const v of passage.vocab) {
        const before = await tx.vocabCard.findUnique({ where: { word: v.word } });
        await tx.vocabCard.upsert({
          where: { word: v.word },
          update: {}, // giữ nguyên tiến độ ôn nếu từ đã tồn tại
          create: {
            word: v.word,
            meaning: v.meaning,
            example: v.example,
            level: passage.level,
            sourceSkill: "reading",
          },
        });
        if (!before) added++;
      }
      return added;
    });
    try {
      await recordStudyActivity();
    } catch (err) {
      // Không để lỗi cập nhật streak (phụ) làm hỏng thông báo thành công của kết quả chính (đã lưu).
      console.error("[streak] lỗi khi cập nhật (không nghiêm trọng):", err);
    }

    return Response.json({
      correct,
      total,
      cefrLevel,
      questionResults,
      vocab: passage.vocab,
      newVocabAdded,
    });
  } catch (err) {
    console.error("[reading] lỗi hệ thống khi chấm/lưu:", err);
    return Response.json(
      { error: "Có lỗi hệ thống khi chấm bài, kết quả chưa được lưu. Hãy thử lại." },
      { status: 500 }
    );
  }
}

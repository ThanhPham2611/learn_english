import { NextRequest } from "next/server";
import { GEMINI_MODEL, GEMINI_MODEL_LITE } from "@/lib/gemini";
import { translateWordsBatch, type TranslateBatchItem } from "@/lib/agents/translator";
import { classify } from "@/lib/word-complexity";
import { cacheKey, getCached, writeCache } from "@/lib/translation-cache";
import { getCurrentUserId } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_ITEMS = 20;

interface ResultRow {
  word: string;
  meaning: string;
  example: string;
  pronunciation: string | null;
  error: string | null;
}

// POST: tra nghĩa 1 lô từ/cụm (bôi đen trong chat) theo đúng ngữ cảnh câu chứa
// từng từ. Trước khi gọi Gemini: tra cache -> phân loại độ khó -> chỉ những từ
// thực sự cần mới gọi LLM (gộp thành tối đa 2 lượt gọi/request theo tier).
export async function POST(req: NextRequest) {
  if (!(await getCurrentUserId())) return Response.json({ error: "Chưa đăng nhập" }, { status: 401 });

  let rawItems: { word: string; contextSentence: string }[];
  try {
    const body = (await req.json()) as { items?: { word?: string; contextSentence?: string }[] };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return Response.json({ error: "Thiếu danh sách từ cần tra" }, { status: 400 });
    }
    rawItems = body.items.slice(0, MAX_ITEMS).map((it) => ({
      word: typeof it.word === "string" ? it.word.trim().slice(0, 60) : "",
      contextSentence: typeof it.contextSentence === "string" ? it.contextSentence.trim().slice(0, 1000) : "",
    }));
  } catch {
    return Response.json({ error: "Dữ liệu gửi lên không hợp lệ" }, { status: 400 });
  }

  // results[] khớp 1-1 với rawItems theo index — điền dần từ cache/dict/LLM.
  const results: (ResultRow | null)[] = rawItems.map(() => null);

  rawItems.forEach((it, i) => {
    if (!it.word) {
      results[i] = { word: it.word, meaning: "", example: it.contextSentence, pronunciation: null, error: "Thiếu từ cần tra" };
    }
  });

  const validIndices = rawItems.map((_, i) => i).filter((i) => rawItems[i].word && !results[i]);

  try {
    const cached = await getCached(validIndices.map((i) => rawItems[i]));
    const stillMissing: number[] = [];
    for (const i of validIndices) {
      const { word, hash } = cacheKey(rawItems[i].word, rawItems[i].contextSentence);
      const hit = cached.get(`${word}:${hash}`);
      if (hit) {
        results[i] = {
          word: rawItems[i].word,
          meaning: hit.meaning,
          example: hit.example ?? rawItems[i].contextSentence,
          pronunciation: hit.pronunciation,
          error: null,
        };
      } else {
        stillMissing.push(i);
      }
    }

    const simpleQueue: TranslateBatchItem[] = [];
    const ambiguousQueue: TranslateBatchItem[] = [];
    const toCache: { word: string; contextHash: string; meaning: string; example?: string | null; pronunciation?: string | null; source: "dict" | "llm" }[] = [];

    for (const i of stillMissing) {
      const item = rawItems[i];
      const { tier, dictEntry } = classify(item);
      if (tier === "dict" && dictEntry) {
        results[i] = {
          word: item.word,
          meaning: dictEntry.meaning,
          example: item.contextSentence,
          pronunciation: dictEntry.pronunciation ?? null,
          error: null,
        };
        const { word, hash } = cacheKey(item.word, item.contextSentence);
        toCache.push({ word, contextHash: hash, meaning: dictEntry.meaning, example: item.contextSentence, pronunciation: dictEntry.pronunciation ?? null, source: "dict" });
      } else if (tier === "llm-simple") {
        simpleQueue.push({ index: i, word: item.word, contextSentence: item.contextSentence });
      } else {
        ambiguousQueue.push({ index: i, word: item.word, contextSentence: item.contextSentence });
      }
    }

    const [simpleOutcome, ambiguousOutcome] = await Promise.all([
      runTier(simpleQueue, GEMINI_MODEL_LITE, "simple"),
      runTier(ambiguousQueue, GEMINI_MODEL, "ambiguous"),
    ]);

    for (const { index, meaning, pronunciation, failed } of [...simpleOutcome, ...ambiguousOutcome]) {
      const item = rawItems[index];
      if (failed || !meaning) {
        results[index] = {
          word: item.word,
          meaning: "",
          example: item.contextSentence,
          pronunciation: null,
          error: "Không tra được nghĩa lúc này, thử lại sau.",
        };
        continue;
      }
      results[index] = { word: item.word, meaning, example: item.contextSentence, pronunciation, error: null };
      const { word, hash } = cacheKey(item.word, item.contextSentence);
      toCache.push({ word, contextHash: hash, meaning, example: item.contextSentence, pronunciation, source: "llm" });
    }

    await writeCache(toCache);

    return Response.json({ results: results.map((r) => r as ResultRow) });
  } catch (err) {
    console.error("[tutor/translate-words] lỗi:", err);
    return Response.json({ error: "Không tra được nghĩa lúc này, thử lại sau." }, { status: 500 });
  }
}

async function runTier(
  items: TranslateBatchItem[],
  model: string,
  tierName: string
): Promise<{ index: number; meaning: string; pronunciation: string | null; failed: boolean }[]> {
  if (items.length === 0) return [];
  try {
    const rows = await translateWordsBatch(items, model);
    return rows.map((r) => ({ ...r, failed: false }));
  } catch (err) {
    console.error(`[tutor/translate-words] lỗi LLM tier=${tierName}:`, err);
    return items.map((it) => ({ index: it.index, meaning: "", pronunciation: null, failed: true }));
  }
}

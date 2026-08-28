import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { normalizeContext, normalizeWord } from "@/lib/text-normalize";

// Cache dịch từ/cụm theo ngữ cảnh (bảng TranslationCache, xem prisma/schema.prisma).
// Cache GLOBAL — không theo userId — nên đọc/ghi ở đây không cần biết ai đang hỏi.

export function contextHash(normalizedSentence: string): string {
  return createHash("sha256").update(normalizedSentence).digest("hex");
}

export function cacheKey(word: string, contextSentence: string): { word: string; hash: string } {
  return { word: normalizeWord(word), hash: contextHash(normalizeContext(contextSentence)) };
}

function mapKey(word: string, hash: string): string {
  return `${word}:${hash}`;
}

export interface CachedEntry {
  meaning: string;
  example: string | null;
  pronunciation: string | null;
  source: string;
}

export interface CacheWriteEntry {
  word: string; // đã chuẩn hoá
  contextHash: string;
  meaning: string;
  example?: string | null;
  pronunciation?: string | null;
  source: "dict" | "llm";
}

// Tra 1 lượt cho cả batch bằng 1 query duy nhất (không tra từng item).
export async function getCached(
  items: { word: string; contextSentence: string }[]
): Promise<Map<string, CachedEntry>> {
  const result = new Map<string, CachedEntry>();
  if (items.length === 0) return result;

  const keys = items.map((item) => cacheKey(item.word, item.contextSentence));
  const rows = await prisma.translationCache.findMany({
    where: { OR: keys.map(({ word, hash }) => ({ word, contextHash: hash })) },
  });

  for (const row of rows) {
    result.set(mapKey(row.word, row.contextHash), {
      meaning: row.meaning,
      example: row.example,
      pronunciation: row.pronunciation,
      source: row.source,
    });
  }
  return result;
}

// Ghi 1 lượt cho cả batch bằng 1 query duy nhất. skipDuplicates để tránh crash khi
// 2 request đụng nhau ghi cùng 1 khoá (race giữa nhiều user tra cùng lúc).
export async function writeCache(entries: CacheWriteEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await prisma.translationCache.createMany({
    data: entries.map((e) => ({
      word: e.word,
      contextHash: e.contextHash,
      meaning: e.meaning,
      example: e.example ?? null,
      pronunciation: e.pronunciation ?? null,
      source: e.source,
    })),
    skipDuplicates: true,
  });
}

export { normalizeContext, normalizeWord };

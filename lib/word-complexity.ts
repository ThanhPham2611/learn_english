import commonWords from "@/lib/data/common-words-en-vi.json";
import { normalizeWord } from "@/lib/text-normalize";

// Router phân loại độ khó của 1 lượt tra từ để quyết định có cần gọi LLM hay
// không. Chỉ import ở code server (route handler) — file JSON ~400 từ không
// được để lọt vào bundle client.
//
// Nguyên tắc: PHÂN VÂN THÌ ƯU TIÊN GỌI LLM — không đánh đổi độ chính xác theo
// ngữ cảnh để tiết kiệm 1 lượt gọi.

export type ComplexityTier = "dict" | "llm-simple" | "llm-ambiguous";

export interface DictEntry {
  word: string;
  meaning: string;
  pronunciation?: string;
  polysemous: boolean;
}

export interface ClassifyInput {
  word: string;
  contextSentence: string;
}

export interface ClassifyResult {
  tier: ComplexityTier;
  dictEntry?: DictEntry;
}

const DICT = new Map<string, DictEntry>((commonWords as DictEntry[]).map((e) => [e.word, e]));

export function classify(input: ClassifyInput): ClassifyResult {
  const word = normalizeWord(input.word);

  // Chọn nhiều từ (có khoảng trắng) = cụm/thành ngữ -> luôn cần LLM đọc cả câu.
  if (/\s/.test(word)) return { tier: "llm-ambiguous" };

  const entry = DICT.get(word);
  if (!entry) return { tier: "llm-simple" };

  if (entry.polysemous) return { tier: "llm-ambiguous" };

  return { tier: "dict", dictEntry: entry };
}

export function classifyBatch(items: ClassifyInput[]): ClassifyResult[] {
  return items.map(classify);
}

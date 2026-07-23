// Tính chỉ số trôi chảy khi nói TRỰC TIẾP từ transcript + thời lượng — đo được
// khách quan (words/phút, tỉ lệ từ đệm), không nhờ AI ước lượng để tránh sai số.

import { escapeRegex } from "@/lib/highlight";

// Không đưa "like" vào danh sách: từ này quá phổ biến với nghĩa thật (verb/giới từ:
// "I like my job") nên đếm bừa sẽ làm sai lệch chỉ số hơn là giúp ích.
export const FILLER_WORDS = ["um", "uh", "uhh", "umm", "er", "erm", "you know"];

export interface FluencyMetrics {
  wordCount: number;
  durationSec: number;
  wpm: number | null; // null nếu không có thời lượng hợp lệ
  fillerCount: number;
  fillerRatio: number; // 0..1
}

export function computeFluency(transcript: string, durationSec: number): FluencyMetrics {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const lower = transcript.toLowerCase();
  let fillerCount = 0;
  for (const filler of FILLER_WORDS) {
    const pattern = escapeRegex(filler).replace(/\s+/g, "\\s+");
    const matches = lower.match(new RegExp(`\\b${pattern}\\b`, "g"));
    if (matches) fillerCount += matches.length;
  }

  const wpm = durationSec > 0 ? Math.round(wordCount / (durationSec / 60)) : null;
  const fillerRatio = wordCount > 0 ? fillerCount / wordCount : 0;

  return { wordCount, durationSec, wpm, fillerCount, fillerRatio };
}

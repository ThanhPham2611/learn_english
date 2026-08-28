/**
 * lib/dictation.ts
 *
 * Pure utility functions cho tính năng Nghe-Viết (Dictation).
 * KHÔNG phụ thuộc server, chạy được ở cả client và server.
 * KHÔNG gọi API — tất cả là thuật toán, không tốn phí.
 */

// ---------------------------------------------------------------------------
// 1. Chia transcript thành các đoạn theo câu hoàn chỉnh
// ---------------------------------------------------------------------------

/**
 * Chia transcript thành mảng các đoạn, mỗi đoạn là 1 hoặc nhiều câu HOÀN CHỈNH.
 *
 * Nguyên tắc:
 * - Tách theo dấu kết câu: `.` `?` `!` (giữ dấu ở cuối câu)
 * - Ghép các câu liền nhau lại nếu tổng chưa quá `maxWords` (mặc định 20)
 * - Câu đơn lẻ dài hơn `maxWords` vẫn được giữ nguyên 1 chunk (không cắt giữa câu)
 * - Câu quá ngắn (< `minWords`, mặc định 4 từ) tự động ghép với câu tiếp theo
 *
 * Kết quả: mỗi chunk luôn kết thúc ở ranh giới câu, không cắt ngang giữa câu.
 */
export function chunkTranscript(
  transcript: string,
  maxWords = 12,
  minWords = 3
): string[] {
  if (!transcript.trim()) return [];

  // Tách câu — giữ dấu kết câu gắn với câu đó
  // Regex: tách tại `.` `?` `!` theo sau là khoảng trắng/hết chuỗi
  const sentences = transcript
    .trim()
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return [transcript.trim()];

  const chunks: string[] = [];
  let currentSentences: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const wordCount = sentence.split(/\s+/).filter(Boolean).length;

    const wouldExceed = currentWordCount + wordCount > maxWords;
    const currentTooShort = currentWordCount < minWords;

    if (currentSentences.length === 0) {
      // Chunk trống → luôn thêm câu này vào
      currentSentences.push(sentence);
      currentWordCount += wordCount;
    } else if (!wouldExceed || currentTooShort) {
      // Vẫn còn chỗ, hoặc chunk hiện tại quá ngắn → ghép thêm
      currentSentences.push(sentence);
      currentWordCount += wordCount;
    } else {
      // Chunk đầy → đóng chunk hiện tại, bắt đầu chunk mới
      chunks.push(currentSentences.join(" "));
      currentSentences = [sentence];
      currentWordCount = wordCount;
    }
  }

  // Đoạn cuối còn lại
  if (currentSentences.length > 0) {
    chunks.push(currentSentences.join(" "));
  }

  return chunks.filter(Boolean);
}

// ---------------------------------------------------------------------------
// 2. Edit distance (Levenshtein) + backtrace ở cấp ký tự
// ---------------------------------------------------------------------------

export interface CharDiffResult {
  /** Chuỗi kết quả hiển thị — theo độ dài từ đúng.
   *  Ký tự đúng: giữ nguyên. Ký tự sai/thiếu: '*'. */
  display: string;
  /** true nếu user gõ hoàn toàn đúng (case-insensitive) */
  isCorrect: boolean;
}

/**
 * So sánh 2 từ theo từng ký tự bằng edit distance + backtrace.
 * Luôn lowercase trước khi so sánh.
 *
 * Ví dụ:
 *   diffWord("hello", "helo")  → { display: "hel*o", isCorrect: false }
 *   diffWord("world", "world") → { display: "world", isCorrect: true }
 */
export function diffWord(correct: string, typed: string): CharDiffResult {
  const a = correct.toLowerCase();
  const b = typed.toLowerCase();

  if (a === b) return { display: a, isCorrect: true };

  const n = a.length;
  const m = b.length;

  // Build DP table — dp[i][j] = edit distance của a[0..i-1] và b[0..j-1]
  const dp: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]; // match, không tốn chi phí
      } else {
        dp[i][j] =
          1 +
          Math.min(
            dp[i - 1][j - 1], // substitute
            dp[i - 1][j], // delete (thiếu ký tự so với bản đúng)
            dp[i][j - 1] // insert (thừa ký tự so với bản đúng)
          );
      }
    }
  }

  // Backtrace — xây chuỗi kết quả theo độ dài bản đúng
  const result: string[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      // ký tự khớp → giữ nguyên
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      // substitute: đổi ký tự → đánh dấu *
      result.unshift("*");
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      // delete: ký tự này có trong bản đúng nhưng user bỏ qua → *
      result.unshift("*");
      i--;
    } else {
      // insert: user gõ thừa ký tự → bỏ qua (không thuộc bản đúng)
      j--;
    }
  }

  return { display: result.join(""), isCorrect: false };
}

// ---------------------------------------------------------------------------
// 3. Word-level alignment + char diff cho cả đoạn
// ---------------------------------------------------------------------------

/**
 * Bỏ dấu câu ở đầu/cuối từ — chỉ giữ lại chữ cái, chữ số và dấu nháy đơn
 * (apostrophe trong "don't", "it's"…). So sánh chữ thôi, không tính dấu câu.
 */
function stripPunct(w: string): string {
  return w.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, "");
}

export interface WordResult {
  /** Từ đúng trong transcript gốc (đã bỏ dấu câu) */
  correct: string;
  /** Từ user gõ (hoặc "" nếu thiếu) */
  typed: string;
  /** Chuỗi hiển thị — ký tự đúng giữ, sai → '*' */
  display: string;
  isCorrect: boolean;
}

/**
 * So sánh 2 đoạn văn bản: chia thành từng từ, align bằng edit distance ở cấp
 * từ, rồi gọi diffWord cho từng cặp từ khớp nhau.
 * Dấu câu bị bỏ qua hoàn toàn khi so sánh.
 *
 * Trả về mảng WordResult — 1 phần tử cho mỗi từ trong transcript gốc.
 */
export function diffChunk(correctChunk: string, typedChunk: string): WordResult[] {
  // Strip dấu câu khỏi từng từ trước khi so sánh
  const correctWords = correctChunk.trim().split(/\s+/).filter(Boolean).map(stripPunct).filter(Boolean);
  const typedWords   = typedChunk.trim().split(/\s+/).filter(Boolean).map(stripPunct).filter(Boolean);

  if (correctWords.length === 0) return [];

  // Word-level edit distance alignment
  const aligned = alignWords(correctWords, typedWords);

  return aligned.map(([cw, tw]) => {
    const { display, isCorrect } = diffWord(cw, tw);
    return { correct: cw, typed: tw, display, isCorrect };
  });
}

/**
 * Align 2 mảng từ bằng edit distance ở cấp từ.
 * Trả về mảng cặp [từ_đúng, từ_user_gõ] — luôn có đủ từ phía đúng.
 * Nếu user thiếu từ → cặp [từ_đúng, ""].
 * Nếu user thừa từ → gộp vào từ gần nhất (hoặc bỏ qua).
 */
function alignWords(correct: string[], typed: string[]): [string, string][] {
  const n = correct.length;
  const m = typed.length;

  // dp[i][j] = số từ sai khi so sánh correct[0..i-1] với typed[0..j-1]
  // Chi phí: match=0, substitute=1, delete(bỏ ký tự đúng)=1, insert(thừa)=1
  const dp: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const isSame = correct[i - 1].toLowerCase() === typed[j - 1].toLowerCase();
      dp[i][j] = isSame
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrace
  const pairs: [string, string][] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && correct[i - 1].toLowerCase() === typed[j - 1].toLowerCase()) {
      pairs.unshift([correct[i - 1], typed[j - 1]]);
      i--;
      j--;
    } else if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] + 1
    ) {
      // substitute
      pairs.unshift([correct[i - 1], typed[j - 1]]);
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      // user thiếu từ này
      pairs.unshift([correct[i - 1], ""]);
      i--;
    } else {
      // user thừa từ → bỏ qua (không thuộc bản đúng)
      j--;
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// 4. Tính điểm accuracy cho 1 lượt luyện
// ---------------------------------------------------------------------------

export interface DictationScore {
  totalWords: number;
  correctWords: number;
  accuracyPct: number; // 0-100
}

export function calcScore(results: WordResult[][]): DictationScore {
  let total = 0;
  let correct = 0;
  for (const chunk of results) {
    for (const w of chunk) {
      total++;
      if (w.isCorrect) correct++;
    }
  }
  return {
    totalWords: total,
    correctWords: correct,
    accuracyPct: total === 0 ? 0 : Math.round((correct / total) * 100),
  };
}

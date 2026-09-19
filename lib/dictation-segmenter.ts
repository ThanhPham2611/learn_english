/**
 * lib/dictation-segmenter.ts
 *
 * Gom danh sách TỪ (kèm mốc thời gian thật do Whisper trả về) thành các CÂU để
 * luyện nghe-viết.
 *
 * Pure function, KHÔNG gọi API, KHÔNG phụ thuộc server — chạy được ở cả client
 * và server, và test được bằng cách gọi trực tiếp.
 *
 * Vì sao phải tự gom: Whisper chia "segment" theo cửa sổ giải mã ~30s chứ không
 * theo câu, nên một segment của Whisper có thể chứa 4 câu hoặc nửa câu. Nhưng
 * mốc thời gian cấp TỪ thì chính xác, nên ta bỏ cách chia của Whisper và tự gom
 * từ → câu theo dấu câu + khoảng lặng.
 */

import type { DictationSegment } from "./dictation";
import type { GroqSegment, GroqWord } from "./groq";

// --- Ngưỡng chia câu ---------------------------------------------------------

/** Khoảng lặng giữa 2 từ đủ dài để coi như đã hết câu. */
const MAX_GAP_SEC = 0.75;
/** Câu ít từ hơn mức này → gộp vào câu kề. */
const MIN_WORDS = 3;
/** Câu nhiều từ hơn mức này → tách tiếp cho dễ gõ. */
const MAX_WORDS = 16;
/** Câu dài hơn mức này (giây) → tách tiếp. */
const MAX_SEG_SEC = 12;
/**
 * Câu quá dài chỉ được tách ở chỗ CÓ NGẮT HƠI THẬT. Tách ở khoảng hở ~0 nghĩa là
 * cắt giữa cụm từ đang nói liền — vừa khó gõ, vừa tạo ra đúng cái biên hở ≈ 0
 * gây lố sang câu sau. Thà để một câu dài còn hơn cắt vào giữa hơi.
 */
const MIN_SPLIT_GAP_SEC = 0.2;
/**
 * Không gộp câu ngắn qua khoảng lặng dài hơn mức này. Buộc bằng MAX_GAP_SEC:
 * khoảng lặng đã đủ mạnh để ÉP TÁCH câu thì không có lý gì lát sau lại gộp
 * ngược về. (Trước đây là 1.2s > MAX_GAP_SEC nên tự mâu thuẫn: tách ra ở 0.8s
 * rồi gộp lại cũng ở 0.8s.)
 */
const MERGE_GAP_SEC = MAX_GAP_SEC;

// --- Cứu vãn khi Whisper quên chấm câu ---------------------------------------
// Whisper thỉnh thoảng ngừng sinh dấu câu giữa chừng (thường ở nửa sau file dài).
// Khi đó vẫn còn 1 tín hiệu: nó GIỮ chữ hoa đầu câu. Dùng chữ hoa + một khoảng
// lặng nhỏ làm bằng chứng phụ để tách câu.

/** Khoảng lặng tối thiểu trước 1 từ viết hoa để coi đó là câu mới. */
const CAPITAL_GAP_SEC = 0.24;
/** Từ luôn viết hoa trong tiếng Anh → cần khoảng lặng rõ hơn mới dám tách. */
const AMBIGUOUS_CAPITAL_GAP_SEC = 0.45;
const ALWAYS_CAPITAL = new Set(["i", "i'm", "i've", "i'll", "i'd"]);
// --- Biên phát lại -----------------------------------------------------------
// Whisper báo mốc BẮT ĐẦU của từ TRỄ hơn thực tế ~0.1-0.2s (đặc tính của DTW
// alignment trên cross-attention). Nên biên phải lệch VỀ TRƯỚC onset, không
// được lấy điểm giữa khoảng hở: khi Whisper báo hở = 0 thì điểm giữa rơi thẳng
// vào onset → câu trước phát chồm sang, để lộ từ đầu của câu sau.

/** Luôn dừng trước onset của câu kế tiếp ít nhất chừng này. */
const END_GUARD_SEC = 0.15;
/** Luôn vào sớm trước onset của chính câu này chừng này (bù onset trễ). */
const START_LEAD_SEC = 0.15;
/** Ngân thêm đuôi câu khi khoảng lặng phía sau đủ rộng. */
const END_TAIL_PAD_SEC = 0.1;

// --- Lọc hallucination -------------------------------------------------------

/** Đoạn im lặng/nhạc nền thường bị Whisper "bịa" ra chữ với 2 chỉ số này. */
const NO_SPEECH_THRESHOLD = 0.6;
const AVG_LOGPROB_THRESHOLD = -0.8;

/** Viết tắt kết thúc bằng dấu chấm nhưng KHÔNG phải hết câu. */
const ABBREVIATIONS = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "st.",
  "vs.",
  "e.g.",
  "i.e.",
  "etc.",
  "jr.",
  "sr.",
  "no.",
]);

/** Nhóm từ đang được gom thành 1 câu. */
type WordGroup = GroqWord[];

/**
 * Điểm vào chính: từ words + segments thô của Whisper → danh sách câu kèm
 * mốc thời gian đã chốt biên.
 */
export function buildSegments(
  words: GroqWord[],
  whisperSegments: GroqSegment[],
  durationSec: number
): DictationSegment[] {
  const clean = dropHallucinatedWords(words, whisperSegments);
  if (clean.length === 0) return [];

  let groups = splitIntoSentences(clean);
  groups = groups.flatMap((g) => splitLongGroup(g));
  groups = mergeShortGroups(groups);

  return finalizeBoundaries(groups, durationSec);
}

// --- Bước 1: lọc hallucination ----------------------------------------------

/**
 * Loại các từ nằm trong những segment mà Whisper vừa "chắc là không có tiếng
 * nói" (no_speech_prob cao) vừa "không tự tin vào chữ mình vừa ghi"
 * (avg_logprob thấp). Đây là bộ lọc chính diệt các segment rác kiểu "you".
 */
function dropHallucinatedWords(words: GroqWord[], segments: GroqSegment[]): GroqWord[] {
  const badRanges = segments
    .filter(
      (s) =>
        Number(s.no_speech_prob) > NO_SPEECH_THRESHOLD &&
        Number(s.avg_logprob) < AVG_LOGPROB_THRESHOLD
    )
    .map((s) => [s.start, s.end] as const);

  const valid = words.filter(
    (w) =>
      w &&
      typeof w.word === "string" &&
      w.word.trim() !== "" &&
      isFinite(w.start) &&
      isFinite(w.end) &&
      w.end >= w.start
  );

  if (badRanges.length === 0) return valid;

  // Từ được coi là nằm trong đoạn xấu nếu tâm của nó rơi vào khoảng đó.
  return valid.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return !badRanges.some(([from, to]) => mid >= from && mid <= to);
  });
}

// --- Bước 2: chia câu --------------------------------------------------------

function splitIntoSentences(words: GroqWord[]): WordGroup[] {
  const groups: WordGroup[] = [];
  let current: WordGroup = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current.push(word);

    const next = words[i + 1];
    if (!next) break;

    const gap = next.start - word.end;
    if (endsSentence(word.word) || gap > MAX_GAP_SEC || startsNewSentence(next.word, gap)) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function endsSentence(raw: string): boolean {
  const token = raw.trim().toLowerCase();
  if (!/[.?!]["')\]]?$/.test(token)) return false;
  // "Mr." / "e.g." không phải hết câu.
  if (ABBREVIATIONS.has(token)) return false;
  // Chữ cái đơn + dấu chấm (viết tắt tên: "J.") cũng không phải hết câu.
  if (/^[a-z]\.$/.test(token)) return false;
  return true;
}

/**
 * Lưới an toàn cho trường hợp Whisper quên chấm câu: một từ VIẾT HOA đứng sau
 * một khoảng lặng nhỏ gần như chắc chắn là đầu câu mới.
 *
 * Rủi ro dương tính giả là danh từ riêng giữa câu ("I met John yesterday") —
 * nên vẫn đòi có khoảng lặng, và đòi khoảng lặng rõ hơn với những từ LUÔN viết
 * hoa trong tiếng Anh (I, I'm...) vì chữ hoa của chúng không mang thông tin gì.
 */
function startsNewSentence(nextRaw: string, gap: number): boolean {
  const token = nextRaw.trim();
  if (!/^[A-Z]/.test(token)) return false;

  const bare = token.toLowerCase().replace(/[^a-z']/g, "");
  const threshold = ALWAYS_CAPITAL.has(bare) ? AMBIGUOUS_CAPITAL_GAP_SEC : CAPITAL_GAP_SEC;
  return gap > threshold;
}

// --- Bước 3: tách câu quá dài ------------------------------------------------

/**
 * Tách đệ quy tại khoảng trống giữa 2 từ LỚN NHẤT nằm ở vùng giữa câu (bỏ qua
 * 25% đầu và cuối) để không tách ra những mẩu vụn 1-2 từ.
 *
 * Nhưng chỉ tách khi chỗ đó có NGẮT HƠI THẬT (≥ MIN_SPLIT_GAP_SEC). Câu dài nói
 * một hơi không có chỗ nào để tách tử tế: ép tách sẽ cắt vào giữa cụm từ. Với
 * audio đã tự chia câu sẵn thì đây còn là thứ giữ đúng ánh xạ 1 câu = 1 đoạn.
 */
function splitLongGroup(group: WordGroup): WordGroup[] {
  const durationOf = (g: WordGroup) => g[g.length - 1].end - g[0].start;
  if (group.length <= MAX_WORDS && durationOf(group) <= MAX_SEG_SEC) return [group];
  if (group.length < MIN_WORDS * 2) return [group];

  const from = Math.max(1, Math.floor(group.length * 0.25));
  const to = Math.min(group.length - 1, Math.ceil(group.length * 0.75));

  let bestIndex = -1;
  let bestGap = -1;
  for (let i = from; i < to; i++) {
    const gap = group[i].start - group[i - 1].end;
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }

  if (bestIndex <= 0 || bestGap < MIN_SPLIT_GAP_SEC) return [group];

  return [
    ...splitLongGroup(group.slice(0, bestIndex)),
    ...splitLongGroup(group.slice(bestIndex)),
  ];
}

// --- Bước 4: gộp câu quá ngắn ------------------------------------------------

/**
 * Câu dưới MIN_WORDS từ được gộp vào câu liền kề GẦN HƠN về thời gian, miễn là
 * khoảng cách < MERGE_GAP_SEC (không gộp xuyên qua khoảng lặng dài — nghe sẽ
 * rất kỳ). Mẩu ngắn không gộp được mà nội dung nằm trong denylist thì bỏ hẳn:
 * đây là lưới lọc thứ hai cho segment rác kiểu "you".
 */
function mergeShortGroups(groups: WordGroup[]): WordGroup[] {
  const result: WordGroup[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];

    if (group.length >= MIN_WORDS) {
      result.push(group);
      continue;
    }

    const prev = result[result.length - 1];
    const next = groups[i + 1];
    const gapPrev = prev ? group[0].start - prev[prev.length - 1].end : Infinity;
    const gapNext = next ? next[0].start - group[group.length - 1].end : Infinity;

    if (gapPrev <= gapNext && gapPrev < MERGE_GAP_SEC && prev) {
      prev.push(...group);
      continue;
    }
    if (gapNext < MERGE_GAP_SEC && next) {
      // Gộp vào câu sau: nhét vào đầu nhóm kế tiếp, để vòng lặp xử lý tiếp.
      groups[i + 1] = [...group, ...next];
      continue;
    }

    // Đứng một mình, cách xa hai bên → GIỮ. Trước đây chỗ này còn đối chiếu một
    // denylist ("thank you", "you", "bye"…) và BỎ HẲN nếu trùng. Đã gỡ: nó xoá
    // câu mà không báo gì, nên một câu ngắn CÓ THẬT ("Thank you.") sẽ biến mất
    // khỏi bài và user không tài nào biết. Với bài chính tả, mất câu thật tệ hơn
    // nhiều so với thừa một câu rác — câu rác thì bấm "Bỏ qua" là xong.
    // Lưới lọc chính (no_speech_prob + avg_logprob) vẫn còn ở dropHallucinatedWords().
    result.push(group);
  }

  return result;
}

// --- Bước 5: chốt biên -------------------------------------------------------

/**
 * Chốt biên phát lại — BẤT ĐỐI XỨNG một cách có chủ đích.
 *
 * Đây là bài luyện nghe-viết, nên hai loại lỗi biên KHÔNG ngang nhau:
 *  - Phát lố sang từ đầu của câu SAU = lộ đáp án → lỗi nặng.
 *  - Cắt cụt đuôi câu = mất âm tiết cuối (chỗ mang -ly/-ed/-s, thứ bài chính
 *    tả CHẤM ĐIỂM) → gõ kiểu gì cũng sai.
 *
 * BẤT BIẾN CỨNG: cửa sổ phát luôn CHỨA ĐỦ từ của chính câu mình. Pad và guard
 * chỉ được ăn vào KHOẢNG HỞ, không bao giờ cắn vào một từ. Lý do: script chấm
 * điểm (segments[i].text) là cố định, nên thứ user NGHE phải khớp đúng thứ
 * script NÓI — thiếu một âm tiết là hỏng hợp đồng đó.
 *
 * Hệ quả khi khoảng hở < END_GUARD_SEC: dừng ở đúng cuối từ mình, chấp nhận
 * lố qua onset THẬT của câu sau chừng vài chục ms. Vài chục ms đó chỉ là tiếng
 * bật đầu của một phụ âm — không đủ nhận ra là từ gì, nên không lộ đáp án.
 */
function finalizeBoundaries(groups: WordGroup[], durationSec: number): DictationSegment[] {
  // durationSec do client báo lên (best-effort, với MP3 VBR có thể là số ước
  // lượng) — không để nó cắt mất đuôi câu. Lấy max trên MỌI nhóm chứ không chỉ
  // nhóm cuối: mốc của Whisper không phải lúc nào cũng tăng đều, và bất biến
  // "chứa đủ từ" phải đúng vô điều kiện.
  const maxWordEnd = groups.reduce((m, g) => Math.max(m, g[g.length - 1].end), 0);
  const limit = Math.max(durationSec, maxWordEnd);
  const clamp = (v: number) => Math.max(0, Math.min(v, limit));

  return groups.map((group, i) => {
    const firstStart = group[0].start;
    const lastEnd = group[group.length - 1].end;
    const next = groups[i + 1];

    // --- START: luôn vào sớm hơn onset để bù việc Whisper báo onset trễ ---
    // KHÔNG chặn theo đuôi câu trước: chặn như vậy chỉ kích hoạt đúng lúc mốc
    // Whisper chồng lấn, và khi đó nó cắt mất phụ âm đầu của chính câu này —
    // nghe lố lại đuôi câu ĐÃ GÕ RỒI thì vô hại, vào trễ thì mất hẳn thông tin.
    let start = firstStart - START_LEAD_SEC;

    // --- END: né onset câu sau, nhưng chỉ bằng phần KHOẢNG HỞ ---
    // max(lastEnd, ...) là cái chốt: khi hở hẹp (hoặc khi mốc Whisper tự mâu
    // thuẫn, onset câu sau báo SỚM hơn cuối từ của câu này), guard bị bỏ qua
    // thay vì cắn vào từ cuối của mình.
    let end = lastEnd + END_TAIL_PAD_SEC;
    if (next) {
      end = Math.max(lastEnd, Math.min(end, next[0].start - END_GUARD_SEC));
    }

    start = clamp(start);
    end = clamp(end);
    // Suy biến duy nhất còn lại: câu chỉ gồm từ dài 0s ở đúng mốc 0 → cửa sổ
    // rỗng, không phát được gì. Giữ lấy một khoảng nghe được.
    if (end <= start) end = clamp(start + 0.2);

    return { text: groupText(group), start, end };
  });
}

/** Ghép các token của Whisper lại thành câu (token đã kèm sẵn khoảng trắng đầu). */
function groupText(group: WordGroup): string {
  return group
    .map((w) => w.word.trim())
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

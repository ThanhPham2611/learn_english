/**
 * lib/dictation-segmenter.check.mjs
 *
 * Chạy:  node lib/dictation-segmenter.check.mjs
 * Node ≥22.18 tự bỏ type của file .ts — không cần cài thêm gì.
 *
 * Bất biến được canh: cửa sổ phát của một câu phải CHỨA ĐỦ từ của chính câu đó
 * (không bao giờ cắt vào từ), và không bao giờ chạm tới onset câu sau. Bug thật
 * đã gặp: mốc từ của Whisper tự mâu thuẫn → biên cuối bị kéo lùi 0.65s → nghe
 * "Betty found a love-", mất "-ly dress".
 */
import assert from "node:assert/strict";
import { buildSegments } from "./dictation-segmenter.ts";

const w = (word, start, end) => ({ word, start, end });

/** Ghép từ → câu, phải khớp groupText() trong segmenter (không export). */
const join = (ws) =>
  ws.map((x) => x.word.trim()).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();

/**
 * Chạy buildSegments và canh BẤT BIẾN PHỔ QUÁT trên mọi câu:
 *  1. chứa đủ từ của chính mình  → start <= từ đầu, end >= từ cuối;
 *  2. không lấn câu sau          → end <= max(cuối từ mình, onset câu sau).
 * (2) chính là thứ chặn ai đó "đơn giản hoá" thành end = lastEnd + PAD.
 */
function check(label, words, durationSec) {
  const segs = buildSegments(words, [], durationSec);
  let i = 0;
  const groups = segs.map((seg) => {
    let k = i + 1;
    while (k <= words.length && join(words.slice(i, k)) !== seg.text) k++;
    assert.ok(k <= words.length, `${label}: không dò được từ gốc của "${seg.text}"`);
    const g = words.slice(i, k);
    i = k;
    assert.ok(seg.start <= g[0].start + 1e-9, `${label}: cụt đầu "${seg.text}"`);
    assert.ok(seg.end >= g[g.length - 1].end - 1e-9, `${label}: cụt đuôi "${seg.text}"`);
    return g;
  });
  segs.forEach((seg, j) => {
    const nxt = groups[j + 1];
    if (!nxt) return;
    const ceiling = Math.max(groups[j][groups[j].length - 1].end, nxt[0].start);
    assert.ok(seg.end <= ceiling + 1e-9, `${label}: lấn câu sau — end=${seg.end}`);
  });
  return segs;
}

// 1. Ca hồi quy: Whisper báo onset "She" (11.80) SỚM HƠN cuối "dress." (12.40).
const contradictory = check(
  "mốc mâu thuẫn",
  [
    w("Betty", 10.0, 10.4), w("found", 10.45, 10.8), w("a", 10.85, 10.95),
    w("lovely", 11.0, 11.6), w("dress.", 11.7, 12.4),
    w("She", 11.8, 12.9), w("wore", 12.95, 13.2), w("it", 13.25, 13.4),
    w("yesterday.", 13.45, 14.2),
  ],
  20
);

assert.equal(contradictory.length, 2);
assert.equal(contradictory[0].text, "Betty found a lovely dress.");
assert.ok(contradictory[0].end >= 12.4, `cụt đuôi: end=${contradictory[0].end} < 12.4`);
assert.ok(contradictory[0].start <= 10.0, `cụt đầu: start=${contradictory[0].start}`);
assert.ok(contradictory[1].start <= 11.8, `cụt đầu câu 2: start=${contradictory[1].start}`);

// 2. Khoảng lặng bình thường: KHÔNG được lấn sang onset câu sau (giữ chủ ý bất
//    đối xứng — lấn = lộ đáp án).
const normal = check(
  "hở rộng",
  [
    w("Betty", 10.0, 10.4), w("found", 10.45, 10.8), w("a", 10.85, 10.95),
    w("dress.", 11.0, 11.5),
    w("She", 12.5, 12.7), w("wore", 12.75, 13.0), w("it", 13.05, 13.3),
    w("yesterday.", 13.35, 14.0),
  ],
  20
);

assert.equal(normal.length, 2);
assert.ok(normal[0].end >= 11.5, `cụt đuôi khi hở rộng: ${normal[0].end}`);
assert.ok(normal[0].end <= 12.5 - 0.15 + 1e-9, `lấn sang onset câu sau: ${normal[0].end}`);
assert.ok(normal[1].start < 12.5, "phải vào sớm trước onset để bù onset trễ");

// 3. Câu sau sát nút (hở 0.1s): guard bị bỏ qua để không cắn vào từ cuối, nhưng
//    vẫn phải dừng TRƯỚC onset câu sau (chặn `end = lastEnd + PAD` = đúng 11.6).
const tight = check(
  "hở sát nút",
  [
    w("Betty", 10.0, 10.4), w("found", 10.45, 10.8), w("a", 10.85, 10.95),
    w("dress.", 11.0, 11.5),
    w("She", 11.6, 11.9), w("wore", 11.95, 12.2), w("it", 12.25, 12.5),
    w("yesterday.", 12.55, 13.2),
  ],
  20
);

assert.equal(tight.length, 2);
assert.ok(tight[0].end >= 11.5, `cắt vào từ cuối: ${tight[0].end}`);
assert.ok(tight[0].end < 11.6, `chạm/lấn onset câu sau: ${tight[0].end}`);

// 4. durationSec client báo thiếu không được cắt mất đuôi câu cuối.
const shortDuration = check(
  "duration báo thiếu",
  [
    w("Betty", 10.0, 10.4), w("found", 10.45, 10.8), w("a", 10.85, 10.95),
    w("dress.", 11.0, 11.5),
  ],
  11.2
);
assert.ok(shortDuration[0].end >= 11.5, `duration client cắt mất đuôi: ${shortDuration[0].end}`);

// 5. AUDIO ĐÃ TỰ CHIA CÂU SẴN: mỗi câu một lượt đọc, chừa khoảng lặng ~1.5s.
//    Đây là ca quan trọng nhất — phải giữ đúng ánh xạ 1 câu = 1 đoạn, kể cả khi
//    câu rất ngắn ("Thank you." — trước đây bị denylist XOÁ HẲN) và khi câu dài
//    hơn MAX_WORDS nhưng nói liền một hơi (trước đây bị chẻ đôi giữa cụm từ).
const prepared = check(
  "audio chia sẵn",
  [
    // câu 1 — ngắn, 3 từ
    w("Good", 0.5, 0.8), w("morning", 0.85, 1.3), w("everyone.", 1.35, 2.0),
    // câu 2 — 19 từ (> MAX_WORDS = 16), nói liền hơi, hở trong câu đều ≤ 0.05s
    w("The", 3.5, 3.6), w("committee", 3.65, 4.1), w("agreed", 4.15, 4.5),
    w("that", 4.55, 4.7), w("the", 4.75, 4.85), w("proposal", 4.9, 5.4),
    w("should", 5.45, 5.7), w("be", 5.75, 5.85), w("reviewed", 5.9, 6.3),
    w("again", 6.35, 6.7), w("before", 6.75, 7.1), w("the", 7.15, 7.25),
    w("end", 7.3, 7.5), w("of", 7.55, 7.65), w("the", 7.7, 7.8),
    w("financial", 7.85, 8.4), w("year", 8.45, 8.8), w("next", 8.85, 9.15),
    w("spring.", 9.2, 9.8),
    // câu 3 — 2 từ, đúng chuỗi nằm trong denylist cũ
    w("Thank", 11.3, 11.6), w("you.", 11.65, 12.1),
    // câu 4
    w("See", 13.6, 13.9), w("you", 13.95, 14.1), w("tomorrow.", 14.15, 14.8),
  ],
  20
);

assert.equal(prepared.length, 4, `phải giữ đúng 4 câu, đang ra ${prepared.length}`);
assert.equal(prepared[0].text, "Good morning everyone.");
assert.equal(
  prepared[1].text,
  "The committee agreed that the proposal should be reviewed again before the end of the financial year next spring.",
  "câu dài nói liền hơi không được chẻ đôi"
);
assert.equal(prepared[2].text, "Thank you.", "câu ngắn thật không được xoá/gộp");
assert.equal(prepared[3].text, "See you tomorrow.");
// Khoảng lặng rộng → không câu nào bị cắt cụt, cũng không câu nào lấn sang câu sau.
prepared.forEach((s, i) => {
  const nextStart = [3.5, 11.3, 13.6][i];
  if (nextStart) assert.ok(s.end < nextStart, `câu ${i + 1} lấn sang câu sau: ${s.end}`);
});

console.log("OK — 5 ca chốt biên + bất biến chứa-đủ-từ đều đạt");

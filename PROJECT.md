# English Learning — Tóm tắt dự án (đọc file này để nắm bối cảnh nhanh)

> File này dành cho việc bắt đầu lại 1 phiên làm việc mới. Đọc xong là đủ hiểu
> app làm gì, cấu trúc ra sao, và những quyết định/vướng mắc kỹ thuật đã gặp.

## App này là gì

Website học tiếng Anh **cá nhân** (1 người dùng, không có đăng nhập/nhiều tài
khoản) cho người Việt học để đi làm, mục tiêu đạt fluent. Điểm khác biệt cốt
lõi: **mọi trình độ hiển thị đều có bằng chứng cụ thể** (lỗi gì, đúng/sai câu
nào) — không phải một con số suông.

- 5 kỹ năng: Chat, Viết, Nói, Đọc, Nghe — đều **đã hoàn thành** (`lib/modules.ts`
  toàn bộ `ready: true`).
- Bài test đầu vào (`/placement`) xác định CEFR khởi điểm.
- Ôn từ vựng theo SRS (`/vocab`) — từ tự động gom từ bài Đọc và từ tra trong Chat.
- Dashboard tiến độ (`/dashboard`) — biểu đồ + streak + bằng chứng gần đây.

## Tech stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Prisma 6.19.3** (KHÔNG lên v7 — v7 đổi cách khai báo datasource, phức tạp
  không cần thiết cho app cá nhân) + **SQLite** (`prisma/dev.db`)
- **Gemini** (`@google/generative-ai`) — model mặc định `gemini-2.5-flash`
  (xem mục "Vướng mắc đã gặp" bên dưới, đừng đổi lại `gemini-2.0-flash`)
- **Recharts 3.10** cho Dashboard (bản v3, khác API/behaviour so với v2 phổ
  biến trên mạng — xem mục vướng mắc)
- **Web Speech API** của trình duyệt (native, không cần SDK) cho Nói (STT) và
  Nghe (TTS) — chỉ chạy tốt trên Chrome/Edge

Chạy: `npm install` → điền `GEMINI_API_KEY` vào `.env.local` → `npm run dev`.

## Kiến trúc AI: nhiều agent, mỗi agent 1 việc

Tất cả nằm trong `lib/agents/`, dùng chung `generateJson()` (định nghĩa trong
`lib/agents/assessor.ts`) — gọi Gemini với `responseMimeType: application/json`,
parse an toàn, **throw lỗi thật nếu JSON hỏng** (không âm thầm trả `{}`, để nơi
gọi coi là thất bại chứ không lưu kết quả rác vào hồ sơ).

| Agent | File | Việc |
|---|---|---|
| **Tutor** | `lib/agents/tutor.ts` | Trò chuyện Chat, sinh phản hồi streaming |
| **Assessor** | `lib/agents/assessor.ts` | Chấm CEFR độc lập cho Placement/Viết/Nói — **độc lập với Tutor** để khách quan |
| **Translator** | `lib/agents/translator.ts` | Dịch cả câu / tra 1 từ theo đúng ngữ cảnh câu (dùng trong Chat) |
| **Vocab checker** | `lib/agents/vocab-checker.ts` | Chấm nhanh đúng/gần đúng/sai khi ôn từ (prompt cực ngắn vì chạy rất nhiều lần/phiên) |

Nghe & Đọc chấm **deterministic** (đếm số câu đúng), không cần gọi AI — tiết
kiệm quota, và bản chất câu hỏi trắc nghiệm vốn khách quan sẵn.

## Bản đồ trang & API

| Trang | API | Mô tả |
|---|---|---|
| `/` | — | Trang chủ: trình độ hiện tại, 5 thẻ kỹ năng, nhắc ôn từ nếu có từ đến hạn |
| `/placement` | `api/placement` | Test đầu vào: MCQ + đoạn viết → Assessor chấm |
| `/chat` | `api/tutor`, `api/tutor/grammar-check`, `api/tutor/translate-message`, `api/tutor/translate-word`, `api/vocab/add` | Chat streaming; chấm ngữ pháp nền (không chặn UI); dịch câu/từ theo yêu cầu; thêm từ vào bộ ôn ngay từ Chat |
| `/writing` | `api/writing` | Đề theo trình độ → Assessor chấm + highlight lỗi ngay trong bài |
| `/speaking` | `api/speaking` | Ghi âm (STT) → chỉ số trôi chảy tính tay (wpm, từ đệm) + Assessor chấm ngữ pháp |
| `/reading` | `api/reading` | Bài đọc → MCQ chấm cứng → từ mới tự thêm vào `VocabCard` (transaction, xem dưới) |
| `/listening` | `api/listening` | Bài nghe (TTS đọc) → MCQ chấm cứng |
| `/vocab` | `api/vocab/due`, `api/vocab/check`, `api/vocab/review` | Ôn theo SRS: gõ nghĩa (active recall) → Vocab checker chấm đúng/gần đúng/sai → tự chọn mức nhớ → SM-2 tính lịch ôn tiếp |
| `/dashboard` | (đọc thẳng DB qua `lib/dashboard.ts`) | Biểu đồ xu hướng, trình độ từng kỹ năng, streak, bằng chứng gần đây |

**Lưu ý luồng `/vocab`**: đã đổi từ "lật thẻ xem nghĩa" (recognition) sang **gõ
nghĩa trước** (active recall) — API `due` không gửi `meaning`/`example` nữa,
chỉ lộ ra sau khi POST `api/vocab/check`. Đây là thay đổi sư phạm cố ý (active
recall hiệu quả hơn recognition), không phải bug.

## Database (`prisma/schema.prisma`)

- **`Profile`** (luôn 1 dòng, `id=1`): `overallLevel` + trình độ từng kỹ năng
  (`writing/speaking/reading/listening`), `streak`, `lastStudyDate`.
- **`Attempt`**: mỗi lần luyện tập/test = 1 dòng. `score` LUÔN ở thang 1-6
  (dùng `cefrToNumber()`) cho MỌI skill kể cả Nghe/Đọc — để Dashboard cộng gộp
  được. `detail` (JSON) chứa bằng chứng thật (rationale/lỗi/số câu đúng) — đây
  là nguồn cho mục "Bằng chứng gần đây" ở Dashboard, khác hình dạng theo từng
  skill (xem `summarizeEvidence()` trong `lib/dashboard.ts`).
- **`VocabCard`**: thẻ ôn SRS. `word` là `@unique` toàn cục (an toàn vì app 1
  người dùng). Cập nhật qua `upsert(update:{})` chứ không phải `findUnique`+
  `create` — SQLite qua Prisma **không hỗ trợ `skipDuplicates`**, đã tự vấp
  phải và sửa.

`recordStudyActivity()` (`lib/profile-db.ts`) tính streak — gọi **non-blocking**
(bọc try/catch riêng) sau mỗi lượt luyện thành công ở cả 5 route, để lỗi cập
nhật streak không làm sai thông báo "đã lưu thành công".

## Design system

- Màu: teal (`--primary`) + cam (`--accent`), có biến `--primary-text`/
  `--accent-text` riêng cho CHỮ trên nền sáng (bản gốc primary/accent chỉ đạt
  contrast ~3.6-3.7:1, KHÔNG đủ chuẩn AA cho text thường — luôn dùng biến
  `-text` khi tô màu chữ, không dùng `text-primary`/`text-accent` trực tiếp).
- Font: **Fraunces** (heading, qua `font-heading`) + **IBM Plex Sans** (body).
- 4 màu đánh giá trí nhớ ở `/vocab` cố ý dùng 4 *hue* khác hẳn nhau (đỏ/cam/
  teal/xanh dương) — từng bị bug chỉ khác độ đậm nhạt, dễ bấm nhầm gây sai lịch
  ôn nhiều ngày sau mới phát hiện.
- Pattern dùng lại nhiều nơi: `lib/highlight.ts` (`buildSegments`, `findIndex`)
  — highlight cụm lỗi AI trả về ngay trong văn bản gốc, chịu được sai khác nhỏ
  (dấu ngoặc kép cong/thẳng, khoảng trắng).

## Vướng mắc kỹ thuật đã gặp (đọc trước khi đổi lại)

1. **Gemini model**: `gemini-2.0-flash` bị `limit: 0` (không có free tier) với
   nhiều API key mới → đã đổi mặc định sang `gemini-2.5-flash` trong
   `lib/gemini.ts`. Đừng đổi lại trừ khi đã verify quota thật.
2. **Prisma 7**: đã thử, phải bỏ vì bắt buộc đổi cách khai báo `datasource`
   (driver adapter) — không đáng công cho app cá nhân. Đang ghim ở **Prisma 6**.
3. **`skipDuplicates` không chạy trên SQLite** qua Prisma — dùng `upsert` thay.
4. **Recharts 3.10 (không phải v2)**: `Bar` với `isAnimationActive` mặc định
   `true` có thể bị "kẹt khung hình đầu" (không vẽ gì) trong môi trường
   test/headless — đã tắt animation (`isAnimationActive={false}`) cho `Bar`.
   `Line` thì KHÔNG cần tắt (hoạt động bình thường); nếu debug DOM biểu đồ,
   nhớ rằng mỗi icon trong `<Legend>` cũng tạo ra 1 `.recharts-wrapper` riêng
   (14×14px) — lọc theo `width > 100` khi cần chọn đúng SVG chart chính.
5. **Streak/ngày tháng**: mọi chỗ gộp theo "ngày" (streak, biểu đồ xu hướng,
   danh sách gần đây) phải dùng **giờ local** nhất quán qua `lib/date.ts`
   (`startOfDay`, `localDateKey`) — từng bị lệch UTC-vs-local ở dashboard.
6. **`Attempt.score`**: LUÔN quy về thang 1-6 qua `cefrToNumber()`, kể cả với
   Nghe/Đọc (đừng lưu số câu đúng thô vào field này) — Dashboard cộng gộp mọi
   skill trên cùng 1 thang.

## Cách làm việc đã dùng trong dự án (để tái dùng khi cần)

- Có 2 agent review trong `.claude/agents/`: **code-reviewer** và
  **ui-ux-designer** (dùng qua tool `Agent`, `subagent_type` tương ứng) — mỗi
  milestone đều chạy 2 review này song song sau khi code xong, áp fix, rồi
  verify lại trên browser thật (không chỉ tin `tsc --noEmit`).
- Có 2 skill design: `frontend-design` và `ui-ux-pro-max` (dùng để chọn bảng
  màu/font ban đầu, ít dùng lại về sau).
- Luôn test bằng dữ liệu thật qua `curl` + Prisma script trực tiếp (không chỉ
  đọc code) trước khi báo hoàn thành, và verify UI qua Browser pane
  (`mcp__Claude_Browser__*`) — nhiều bug (SQLite skipDuplicates, Recharts v3
  animation, model quota) chỉ lộ ra khi chạy thật.

## Trạng thái

Đủ 6 milestone đã hoàn thành (M0 khởi tạo → M6 Dashboard). App chạy được đầy
đủ end-to-end. Các hướng có thể làm tiếp nếu muốn: viết test tự động, deploy
lên Vercel (cần đổi SQLite sang Postgres nếu deploy thật vì SQLite không hợp
serverless), thêm nội dung bài Đọc/Nghe (hiện đang là ngân hàng tĩnh trong
`lib/reading-content.ts` / `lib/listening-content.ts`, có thể sinh động bằng AI).

# English Learning — Website học tiếng Anh cá nhân

Học 5 kỹ năng (Chat, Viết, Nói, Đọc, Nghe) với AI, chấm theo thang CEFR để theo dõi tiến độ thật.

Stack: Next.js 14 + TypeScript + Tailwind + Gemini (free tier).

## Cách chạy

1. **Cài thư viện** (chỉ lần đầu):
   ```bash
   npm install
   ```

2. **Điền API key Gemini** (miễn phí):
   - Lấy key tại: https://aistudio.google.com/app/apikey
   - Mở file `.env.local`, thay `your_key_here` bằng key thật:
     ```
     GEMINI_API_KEY=AIza...
     GEMINI_MODEL=gemini-2.0-flash
     ```

3. **Chạy**:
   ```bash
   npm run dev
   ```
   Mở http://localhost:3000 (dùng Chrome/Edge để sau này Nói/Nghe chạy tốt).

   Lưu ý model: nếu gặp lỗi 429 "limit: 0" với `gemini-2.0-flash`, đổi
   `GEMINI_MODEL` trong `.env.local` sang `gemini-2.5-flash` (một số key mới
   không có free tier cho 2.0-flash).

## Tình trạng theo milestone

- [x] **M0** — Khởi tạo dự án, git, design system (teal + Fraunces/IBM Plex Sans)
- [x] **M1** — Khung app + Chat với AI (streaming, chọn trình độ, gợi ý mở đầu)
- [x] **M2** — Database (Prisma/SQLite) + bài test đầu vào (placement) + agent Assessor
- [x] **M3** — Module Viết: đề theo trình độ, chấm CEFR + lỗi highlight ngay trong bài
- [x] **M4** — Module Nói (STT + chỉ số trôi chảy) + Nghe (TTS + câu hỏi hiểu)
- [x] **M5** — Module Đọc (highlight từ mới) + Ôn từ vựng SRS (SM-2, phím tắt)
- [x] **M6** — Dashboard tiến độ (biểu đồ xu hướng, trình độ từng kỹ năng, streak, bằng chứng)

Cả 6 milestone đã hoàn thành — website đủ 5 kỹ năng + hệ thống theo dõi tiến độ.

## Cấu trúc chính

- `app/` — các trang: `chat`, `writing`, `speaking`, `reading`, `listening`, `placement`,
  `vocab` (ôn từ), `dashboard` (tiến độ) + `api/` (gọi Gemini/chấm bài phía server)
- `lib/agents/tutor.ts` — agent Gia sư (dạy/trò chuyện)
- `lib/agents/assessor.ts` — agent chấm điểm độc lập (CEFR + lỗi cụ thể)
- `lib/gemini.ts` — kết nối Gemini, đọc key từ `.env.local`
- `lib/cefr.ts` — thang trình độ CEFR
- `lib/srs.ts` — thuật toán ôn tập ngắt quãng SM-2
- `lib/dashboard.ts` — tổng hợp dữ liệu cho trang Tiến độ
- `prisma/schema.prisma` — DB: `Profile`, `Attempt` (bằng chứng), `VocabCard` (thẻ từ)

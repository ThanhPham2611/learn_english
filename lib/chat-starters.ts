// Gợi ý câu mở đầu hiển thị khi Chat chưa có tin nhắn nào — tách riêng khỏi
// app/(app)/chat/page.tsx để route phân tích "Học theo câu" (server) cũng dùng
// được để loại các câu mẫu này ra khỏi input gửi Gemini (không phải câu người
// học tự viết nên không có giá trị học).
export const STARTERS = [
  "Hi! Can we talk about my weekend?",
  "Let's practice ordering food at a restaurant.",
  "Ask me questions about my job.",
  "Teach me 3 useful words for work emails.",
];

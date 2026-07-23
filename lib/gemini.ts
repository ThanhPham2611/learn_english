import { GoogleGenerativeAI } from "@google/generative-ai";

// Khởi tạo client Gemini một lần, dùng lại cho mọi request.
// API key CHỈ đọc phía server (không có NEXT_PUBLIC_ nên không lộ ra trình duyệt).

const apiKey = process.env.GEMINI_API_KEY;

// Tên model đọc từ .env.local để đổi model mà không cần sửa code.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Báo lỗi rõ ràng nếu quên điền key — đỡ mất thời gian dò.
export function assertApiKey(): string {
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error(
      "Chưa cấu hình GEMINI_API_KEY. Mở file .env.local và điền key thật " +
        "(lấy miễn phí tại https://aistudio.google.com/app/apikey)."
    );
  }
  return apiKey;
}

let client: GoogleGenerativeAI | null = null;

export function getGemini(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(assertApiKey());
  }
  return client;
}

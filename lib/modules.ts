// Khai báo 5 kỹ năng ở một nơi để Nav và trang chủ dùng chung.
// "ready" = đã làm xong; các module chưa tới milestone sẽ hiện nhãn "Sắp có".

export interface ModuleInfo {
  slug: string;
  title: string;
  desc: string;
  ready: boolean;
}

export const MODULES: ModuleInfo[] = [
  { slug: "chat", title: "Chat với AI", desc: "Trò chuyện tự do, sửa lỗi nhẹ nhàng.", ready: true },
  { slug: "writing", title: "Viết", desc: "Viết theo đề, được chấm CEFR + sửa lỗi.", ready: true },
  { slug: "speaking", title: "Nói", desc: "Nói vào mic, chấm độ trôi chảy.", ready: true },
  { slug: "reading", title: "Đọc", desc: "Bài đọc đúng cấp + câu hỏi hiểu.", ready: true },
  { slug: "listening", title: "Nghe", desc: "Nghe hội thoại + câu hỏi.", ready: true },
];

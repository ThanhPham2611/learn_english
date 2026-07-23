// Helper ngày tháng dùng chung — TẤT CẢ chỗ gộp dữ liệu theo "ngày" (streak, biểu
// đồ xu hướng, danh sách gần đây) phải dùng cùng 1 chuẩn giờ LOCAL của máy chạy
// app. Trộn lẫn UTC và local sẽ làm streak và biểu đồ hiển thị lệch nhau, đặc biệt
// rõ ở múi giờ Việt Nam (UTC+7) khi học buổi tối muộn.

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Khóa ngày dạng yyyy-MM-dd theo giờ LOCAL (khác với d.toISOString().slice(0,10) là UTC).
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

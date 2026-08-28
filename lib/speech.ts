// Đọc to 1 đoạn tiếng Anh qua Web Speech API — dùng chung cho phần Nói và
// trang ôn cụm câu (bấm "Nghe" để nghe lại cách phát âm).

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

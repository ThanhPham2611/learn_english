"use client";

/**
 * app/(app)/dictation/page.tsx
 *
 * Tính năng Nghe-Viết: upload audio → transcribe → nghe từng đoạn → gõ lại → chấm lỗi ký tự.
 *
 * 3 phase:
 *   "upload"    — chọn file + nút bắt đầu
 *   "practice"  — nghe + gõ từng đoạn
 *   "result"    — tổng kết + lưu kết quả
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { diffChunk, calcScore, WordResult } from "@/lib/dictation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Phase = "upload" | "processing" | "practice" | "result";

interface ChunkPracticeState {
  typedText: string;
  submitted: boolean;
  wordResults: WordResult[] | null;
  /** Kết quả tốt nhất qua các lần thử (dùng để tính điểm cuối) */
  bestWordResults: WordResult[] | null;
  /** Số lần đã kiểm tra */
  attempts: number;
}

interface SaveResult {
  cefrLevel: string;
  correct: number;
  total: number;
}

// ---------------------------------------------------------------------------
// TTS helper (Web Speech API) — dùng để đọc text của từng đoạn
// ---------------------------------------------------------------------------
function speakText(text: string, onEnd?: () => void): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
  return true;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Hiển thị từng từ với diff — từ đúng xanh, sai đỏ (với ký tự * màu đỏ) */
function WordDiffDisplay({ results }: { results: WordResult[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {results.map((w, i) => {
        if (w.isCorrect) {
          return (
            <span key={i} className="rounded px-1 py-0.5 font-mono text-sm text-primary-text bg-primary/10">
              {w.display}
            </span>
          );
        }
        // Hiển thị ký tự đúng và * với màu khác nhau
        const chars = w.display.split("").map((ch, ci) => (
          <span key={ci} className={ch === "*" ? "text-accent-text font-bold" : ""}>
            {ch}
          </span>
        ));
        return (
          <span key={i} className="rounded px-1 py-0.5 font-mono text-sm bg-accent/10 border border-accent/30">
            {chars}
          </span>
        );
      })}
    </div>
  );
}

/** Progress bar đơn giản */
function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((current / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted shrink-0">
        {current}/{total}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DictationPage() {
  const [phase, setPhase] = useState<Phase>("upload");

  // Upload phase
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const hiddenAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);

  // Practice phase
  const [chunks, setChunks] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [practiceStates, setPracticeStates] = useState<ChunkPracticeState[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [practiceError, setPracticeError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Result phase
  const [allWordResults, setAllWordResults] = useState<WordResult[][]>([]);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Cleanup object URL khi unmount
  useEffect(() => {
    return () => {
      if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    };
  }, [audioObjectUrl]);

  // Focus textarea khi sang đoạn mới
  useEffect(() => {
    if (phase === "practice") {
      textareaRef.current?.focus();
    }
  }, [phase, currentIndex]);

  // ---------------------------------------------------------------------------
  // Upload phase handlers
  // ---------------------------------------------------------------------------
  function handleFileChange(file: File | null) {
    setUploadError("");
    setAudioFile(null);
    setAudioDuration(0);
    if (audioObjectUrl) {
      URL.revokeObjectURL(audioObjectUrl);
      setAudioObjectUrl(null);
    }
    if (!file) return;

    // Validate type
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/webm")) {
      setUploadError("Chỉ chấp nhận file audio (MP3, M4A, WAV, WebM, OGG).");
      return;
    }

    // Validate size
    if (file.size > 25 * 1024 * 1024) {
      setUploadError("File quá lớn (tối đa 25MB).");
      return;
    }

    // Dùng audio element ẩn để lấy duration
    const url = URL.createObjectURL(file);
    setAudioObjectUrl(url);

    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const dur = audio.duration;
      if (!isFinite(dur) || dur <= 0) {
        setUploadError("Không đọc được độ dài audio. Hãy thử file khác.");
        URL.revokeObjectURL(url);
        setAudioObjectUrl(null);
        return;
      }
      if (dur > 180) {
        setUploadError(`Audio quá dài (${Math.ceil(dur / 60)} phút). Tối đa 3 phút mỗi lần.`);
        URL.revokeObjectURL(url);
        setAudioObjectUrl(null);
        return;
      }
      setAudioDuration(dur);
      setAudioFile(file);
    };
    audio.onerror = () => {
      setUploadError("Không đọc được file audio. Hãy thử định dạng khác.");
      URL.revokeObjectURL(url);
      setAudioObjectUrl(null);
    };
    audio.src = url;
    hiddenAudioRef.current = audio;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0] ?? null;
    handleFileChange(file);
  }

  async function handleStartPractice() {
    if (!audioFile || audioDuration <= 0) return;
    setUploadError("");
    setPhase("processing");

    try {
      const form = new FormData();
      form.append("audio", audioFile);
      form.append("duration", String(audioDuration));

      const res = await fetch("/api/dictation/transcribe", {
        method: "POST",
        body: form,
      });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error ?? "Không xử lý được audio. Hãy thử lại.");
        setPhase("upload");
        return;
      }

      const chunkList: string[] = data.chunks ?? [];
      if (chunkList.length === 0) {
        setUploadError("Không nhận ra nội dung tiếng Anh trong file.");
        setPhase("upload");
        return;
      }

      setChunks(chunkList);
      setCurrentIndex(0);
      setPracticeStates(
        chunkList.map(() => ({
          typedText: "",
          submitted: false,
          wordResults: null,
          bestWordResults: null,
          attempts: 0,
        }))
      );
      setPhase("practice");
    } catch {
      setUploadError("Lỗi kết nối. Hãy thử lại.");
      setPhase("upload");
    }
  }

  // ---------------------------------------------------------------------------
  // Practice phase handlers
  // ---------------------------------------------------------------------------
  function handleSpeak() {
    if (isSpeaking || !chunks[currentIndex]) return;
    setIsSpeaking(true);
    const ok = speakText(chunks[currentIndex], () => setIsSpeaking(false));
    if (!ok) {
      setIsSpeaking(false);
      setPracticeError("Trình duyệt không hỗ trợ phát âm thanh. Hãy dùng Chrome hoặc Edge.");
    }
  }

  function handleCheckChunk() {
    const current = practiceStates[currentIndex];
    if (!current.typedText.trim()) return;

    const results = diffChunk(chunks[currentIndex], current.typedText);
    const allCorrect = results.every((w) => w.isCorrect);

    // Giữ lại kết quả tốt nhất (nhiều từ đúng hơn) qua các lần thử
    const prevBest = current.bestWordResults;
    const prevCorrectCount = prevBest ? prevBest.filter((w) => w.isCorrect).length : -1;
    const newCorrectCount = results.filter((w) => w.isCorrect).length;
    const newBest = newCorrectCount >= prevCorrectCount ? results : prevBest;

    setPracticeStates((prev) =>
      prev.map((s, i) =>
        i === currentIndex
          ? {
              ...s,
              submitted: true,
              wordResults: results,
              bestWordResults: newBest,
              attempts: s.attempts + 1,
            }
          : s
      )
    );

    // Nếu đúng hết → tự động mở khoá "Đoạn tiếp" (không cần retry)
    if (allCorrect) return;
  }

  /** Thử lại đoạn hiện tại — giữ nguyên text, chỉ unlock textarea để sửa tiếp */
  function handleRetry() {
    setPracticeStates((prev) =>
      prev.map((s, i) =>
        i === currentIndex
          ? { ...s, submitted: false, wordResults: s.wordResults }
          : s
      )
    );
    // Focus lại textarea, đặt cursor về cuối
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }, 0);
  }

  function handleNextChunk() {
    if (currentIndex < chunks.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      finishPractice();
    }
  }

  function finishPractice() {
    // Dùng bestWordResults (kết quả tốt nhất qua các lần thử), không phải lần cuối
    const allResults = practiceStates.map((s, i) => {
      const best = s.bestWordResults ?? s.wordResults;
      if (best) return best;
      return diffChunk(chunks[i], ""); // chưa làm → tính sai hết
    });
    setAllWordResults(allResults);
    setPhase("result");
    saveResultToDB(allResults);
  }

  // ---------------------------------------------------------------------------
  // Result phase
  // ---------------------------------------------------------------------------
  async function saveResultToDB(results: WordResult[][]) {
    setSaving(true);
    setSaveError("");
    const score = calcScore(results);
    try {
      const res = await fetch("/api/dictation/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(score),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "Không lưu được kết quả.");
      } else {
        setSaveResult(data);
      }
    } catch {
      setSaveError("Lỗi kết nối — kết quả chưa được lưu.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setPhase("upload");
    setAudioFile(null);
    setAudioDuration(0);
    setUploadError("");
    setPracticeError("");
    setChunks([]);
    setCurrentIndex(0);
    setPracticeStates([]);
    setAllWordResults([]);
    setSaveResult(null);
    setSaveError("");
    if (audioObjectUrl) {
      URL.revokeObjectURL(audioObjectUrl);
      setAudioObjectUrl(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render: Upload phase
  // ---------------------------------------------------------------------------
  if (phase === "upload" || phase === "processing") {
    const processing = phase === "processing";
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Nghe-Viết</h1>
          <p className="mt-1 text-sm text-muted">
            Upload file audio tiếng Anh (tối đa 3 phút), nghe và gõ lại từng đoạn — lỗi ký tự sẽ được chỉ ra chính xác.
          </p>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => !processing && fileInputRef.current?.click()}
          className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors duration-200 ${
            audioFile
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary hover:bg-primary/5"
          } ${processing ? "pointer-events-none opacity-60" : ""}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/webm"
            className="sr-only"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            disabled={processing}
          />

          {audioFile ? (
            <>
              <span className="text-3xl">🎵</span>
              <p className="font-medium text-sm">{audioFile.name}</p>
              <p className="text-xs text-muted">
                {Math.round(audioDuration)}s • {(audioFile.size / 1024 / 1024).toFixed(1)}MB
              </p>
              <p className="text-xs text-primary-text">Bấm để đổi file</p>
            </>
          ) : (
            <>
              <span className="text-3xl text-muted">🎧</span>
              <p className="font-medium text-sm">
                Kéo thả hoặc bấm để chọn file audio
              </p>
              <p className="text-xs text-muted">
                MP3, M4A, WAV, WebM, OGG • tối đa 3 phút / 25MB
              </p>
            </>
          )}
        </div>

        {uploadError && (
          <p className="rounded-lg bg-accent/10 p-3 text-sm text-accent-text">{uploadError}</p>
        )}

        {/* Preview audio nếu có */}
        {audioObjectUrl && audioFile && !processing && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio
            ref={audioRef}
            src={audioObjectUrl}
            controls
            className="w-full rounded-lg"
          />
        )}

        <button
          onClick={handleStartPractice}
          disabled={!audioFile || processing || audioDuration <= 0}
          className="cursor-pointer rounded-xl bg-primary px-5 py-3 font-medium text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Đang xử lý audio…
            </span>
          ) : (
            "Bắt đầu luyện →"
          )}
        </button>

        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted mb-2">Cách hoạt động</p>
          <ol className="flex flex-col gap-1.5 text-xs text-muted list-decimal list-inside">
            <li>Upload file audio tiếng Anh (podcast, bài giảng, hội thoại…)</li>
            <li>Hệ thống tự chuyển âm thanh thành văn bản (AI transcribe)</li>
            <li>Văn bản được chia thành từng câu hoàn chỉnh</li>
            <li>Nghe từng câu rồi gõ lại — gõ sai có thể thử lại nhiều lần đến khi đúng</li>
          </ol>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Practice phase
  // ---------------------------------------------------------------------------
  if (phase === "practice") {
    const state = practiceStates[currentIndex];
    const isLast = currentIndex === chunks.length - 1;
    const allCorrect = state.wordResults?.every((w) => w.isCorrect) ?? false;
    const canCheck = !state.submitted && state.typedText.trim().length > 0;
    const canNext = state.submitted; // có thể next bất kể đúng hay sai

    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Nghe-Viết</h1>
          <button
            onClick={handleReset}
            className="text-xs text-muted hover:text-text transition-colors"
          >
            ✕ Thoát
          </button>
        </div>

        {/* Progress */}
        <ProgressBar current={currentIndex + 1} total={chunks.length} />

        {/* Audio player card */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted mb-3">
            Câu {currentIndex + 1}/{chunks.length} — Nghe rồi gõ lại bên dưới
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSpeak}
              disabled={isSpeaking}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 font-medium text-sm text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSpeaking ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-pulse rounded-full bg-white" />
                  Đang phát…
                </>
              ) : (
                <>🔊 Nghe câu này</>
              )}
            </button>
          </div>

          {practiceError && (
            <p className="mt-2 text-xs text-accent-text">{practiceError}</p>
          )}

          {/* Kết quả diff sau khi submit */}
          {state.submitted && state.wordResults && (
            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted font-medium">
                  Kết quả lần {state.attempts}:
                </p>
                {allCorrect ? (
                  <span className="text-xs font-medium text-primary-text">✓ Hoàn toàn đúng!</span>
                ) : (
                  <span className="text-xs text-accent-text font-medium">
                    {state.wordResults.filter((w) => w.isCorrect).length}/
                    {state.wordResults.length} từ đúng
                  </span>
                )}
              </div>
              <WordDiffDisplay results={state.wordResults} />
              <p className="mt-2 text-xs text-muted">
                Chú thích:{" "}
                <span className="text-primary-text font-medium">xanh = đúng</span>
                {" · "}
                <span className="text-accent-text font-medium">* = ký tự sai/thiếu</span>
              </p>
              {/* Bản gốc — chỉ hiện sau lần thứ 2 trở đi để khuyến khích nghe trước */}
              {state.attempts >= 2 && (
                <div className="mt-3 rounded-lg bg-bg p-3">
                  <p className="text-xs text-muted mb-1">Bản gốc:</p>
                  <p className="text-sm font-mono">{chunks[currentIndex]}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">
            Gõ lại những gì bạn nghe được:
          </label>
          <textarea
            ref={textareaRef}
            value={state.typedText}
            onChange={(e) =>
              setPracticeStates((prev) =>
                prev.map((s, i) =>
                  i === currentIndex && !s.submitted
                    ? { ...s, typedText: e.target.value }
                    : s
                )
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canCheck) handleCheckChunk();
                else if (state.submitted && !allCorrect) handleRetry();
                else if (canNext) handleNextChunk();
              }
            }}
            disabled={state.submitted}
            placeholder="Gõ câu bạn nghe được ở đây…"
            rows={3}
            className="w-full rounded-xl border border-border bg-bg p-3 text-sm font-mono resize-none outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:bg-surface"
          />

          <div className="flex gap-3">
            {!state.submitted ? (
              /* Chưa kiểm tra → nút Kiểm tra */
              <button
                onClick={handleCheckChunk}
                disabled={!canCheck}
                className="flex-1 cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-sm text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                Kiểm tra
              </button>
            ) : allCorrect ? (
              /* Đúng hết → chỉ hiện Đoạn tiếp */
              <button
                onClick={handleNextChunk}
                className="flex-1 cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-sm text-white transition-colors duration-200 hover:bg-primary-dark"
              >
                {isLast ? "Xem kết quả →" : "Câu tiếp →"}
              </button>
            ) : (
              /* Còn sai → Thử lại + Bỏ qua */
              <>
                <button
                  onClick={handleRetry}
                  className="flex-1 cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-sm text-white transition-colors duration-200 hover:bg-primary-dark"
                >
                  Thử lại
                </button>
                <button
                  onClick={handleNextChunk}
                  className="cursor-pointer rounded-xl border border-border px-4 py-2.5 text-sm transition-colors hover:border-primary"
                >
                  {isLast ? "Kết quả →" : "Bỏ qua →"}
                </button>
              </>
            )}
            <button
              onClick={handleSpeak}
              disabled={isSpeaking}
              aria-label="Nghe lại"
              className="rounded-xl border border-border px-4 py-2.5 text-sm transition-colors hover:border-primary disabled:opacity-50"
            >
              🔊
            </button>
          </div>

          <p className="text-xs text-muted">
            {!state.submitted
              ? <>Nhấn <kbd className="rounded bg-border px-1">Enter</kbd> để kiểm tra. Không cần gõ đúng hoa thường.</>
              : allCorrect
                ? <>Tuyệt vời! Nhấn <kbd className="rounded bg-border px-1">Enter</kbd> để sang câu tiếp.</>
                : <>Nhấn <kbd className="rounded bg-border px-1">Enter</kbd> để thử lại, hoặc &quot;Bỏ qua&quot; để sang câu tiếp.</>
            }
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Result phase
  // ---------------------------------------------------------------------------
  const score = calcScore(allWordResults);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <h1 className="text-2xl font-semibold">Kết quả luyện Nghe-Viết</h1>

      {/* Score card */}
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        {saveResult ? (
          <>
            <p className="text-sm text-muted">Trình độ ước lượng</p>
            <h2 className="font-heading my-1 text-5xl font-semibold text-primary">
              {saveResult.cefrLevel}
            </h2>
          </>
        ) : (
          <p className="text-sm text-muted">Đang lưu kết quả…</p>
        )}
        <div className="mt-3 flex justify-center gap-6">
          <div>
            <p className="text-2xl font-semibold text-primary-text">{score.accuracyPct}%</p>
            <p className="text-xs text-muted">Độ chính xác</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{score.correctWords}</p>
            <p className="text-xs text-muted">Từ đúng</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-muted">{score.totalWords}</p>
            <p className="text-xs text-muted">Tổng từ</p>
          </div>
        </div>
        {saving && (
          <p className="mt-3 text-xs text-muted">Đang lưu…</p>
        )}
        {saveError && (
          <p className="mt-3 text-xs text-accent-text">{saveError}</p>
        )}
      </div>

      {/* Chi tiết từng đoạn */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Chi tiết từng đoạn</p>
        {allWordResults.map((results, idx) => {
          const chunkCorrect = results.filter((w) => w.isCorrect).length;
          const chunkTotal = results.length;
          const allRight = chunkCorrect === chunkTotal;
          return (
            <div
              key={idx}
              className={`rounded-xl border p-4 ${
                allRight ? "border-border" : "border-accent/40 bg-accent/5"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted">Đoạn {idx + 1}</p>
                <span
                  className={`text-xs font-medium ${
                    allRight ? "text-primary-text" : "text-accent-text"
                  }`}
                >
                  {chunkCorrect}/{chunkTotal} từ đúng
                </span>
              </div>
              <WordDiffDisplay results={results} />
              {!allRight && (
                <p className="mt-2 text-xs font-mono text-muted bg-bg rounded px-2 py-1">
                  {chunks[idx]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleReset}
          className="cursor-pointer rounded-xl bg-primary px-5 py-2.5 font-medium text-sm text-white transition-colors duration-200 hover:bg-primary-dark"
        >
          Luyện bài khác
        </button>
        <Link
          href="/"
          className="cursor-pointer rounded-xl border border-border px-5 py-2.5 text-sm transition-colors duration-200 hover:border-primary"
        >
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}

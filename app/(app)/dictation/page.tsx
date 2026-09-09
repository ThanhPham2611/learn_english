"use client";

/**
 * app/(app)/dictation/page.tsx
 *
 * Tính năng Nghe-Viết: upload audio → transcribe (kèm mốc thời gian từng câu)
 * → nghe ĐÚNG đoạn audio gốc của từng câu → gõ lại → chấm lỗi ký tự.
 *
 * 3 phase:
 *   "upload"    — chọn file + nút bắt đầu
 *   "practice"  — nghe + gõ từng đoạn
 *   "result"    — tổng kết + lưu kết quả
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { diffChunk, calcScore, DictationSegment, WordResult } from "@/lib/dictation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Phase = "upload" | "processing" | "practice" | "result";

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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

/** Danh sách câu dạng số — bấm để nhảy tới câu bất kỳ (không lộ nội dung câu) */
function SegmentPills({
  segments,
  states,
  currentIndex,
  onJump,
}: {
  segments: DictationSegment[];
  states: ChunkPracticeState[];
  currentIndex: number;
  onJump: (idx: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {segments.map((_, idx) => {
        const s = states[idx];
        const isCurrent = idx === currentIndex;
        const correct = s.submitted && (s.wordResults?.every((w) => w.isCorrect) ?? false);
        const wrong = s.submitted && !correct;
        return (
          <button
            key={idx}
            onClick={() => onJump(idx)}
            aria-label={`Câu ${idx + 1}`}
            className={`h-7 w-7 shrink-0 cursor-pointer rounded-full text-xs font-medium transition-colors ${
              isCurrent
                ? "bg-primary text-white"
                : correct
                  ? "bg-primary/15 text-primary-text hover:bg-primary/25"
                  : wrong
                    ? "bg-accent/15 text-accent-text hover:bg-accent/25"
                    : "border border-border text-muted hover:border-primary"
            }`}
          >
            {idx + 1}
          </button>
        );
      })}
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
  const audioElRef = useRef<HTMLAudioElement>(null);
  const hiddenAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);

  // Practice phase
  const [segments, setSegments] = useState<DictationSegment[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [practiceStates, setPracticeStates] = useState<ChunkPracticeState[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [practiceError, setPracticeError] = useState("");
  const segmentEndRef = useRef(0);
  // Huỷ listener "seeked" + timeout fallback đang chờ (nếu có) khi user bấm
  // phát 1 câu khác trước khi seek trước đó xong, hoặc khi thoát/unmount.
  const seekCleanupRef = useRef<(() => void) | null>(null);
  // Huỷ vòng canh mốc kết thúc câu (requestAnimationFrame) đang chạy — xem
  // watchSegmentEnd().
  const endWatchRef = useRef<(() => void) | null>(null);
  // Tăng mỗi lần playSegment được gọi. Promise của audio.play() không huỷ được,
  // nên dùng token này để lượt phát cũ tự nhận ra mình đã bị thay thế.
  const playTokenRef = useRef(0);
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

  // Huỷ chờ-seek + vòng canh mốc kết thúc còn treo (nếu có) khi component unmount
  useEffect(() => {
    return () => {
      seekCleanupRef.current?.();
      endWatchRef.current?.();
    };
  }, []);

  // Thẻ <audio> nằm ở vị trí cố định trong cây render nên không bị unmount khi
  // đổi phase — nhưng vẫn đồng bộ lại isPlaying theo trạng thái THẬT của element
  // mỗi lần đổi phase, để state không bao giờ lệch và khoá mất nút phát.
  useEffect(() => {
    setIsPlaying(!(audioElRef.current?.paused ?? true));
  }, [phase]);

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
    // Dừng preview nếu user vẫn đang nghe thử — không để audio chạy tiếp dưới nền
    // suốt lúc transcribe.
    audioElRef.current?.pause();
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

      const segmentList: DictationSegment[] = data.segments ?? [];
      if (segmentList.length === 0) {
        setUploadError("Không nhận ra nội dung tiếng Anh trong file.");
        setPhase("upload");
        return;
      }

      setSegments(segmentList);
      setCurrentIndex(0);
      setPracticeStates(
        segmentList.map(() => ({
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
  // Practice phase handlers — phát ĐÚNG đoạn audio gốc theo mốc start/end
  // ---------------------------------------------------------------------------
  function playSegment(index: number) {
    const audio = audioElRef.current;
    const segment = segments[index];
    if (!audio || !segment) return;
    setPracticeError("");

    // Huỷ lần chờ-seek + vòng canh mốc kết thúc trước đó, nếu user bấm chuyển
    // câu liên tục
    seekCleanupRef.current?.();
    endWatchRef.current?.();
    const token = ++playTokenRef.current;
    // Pause trước khi seek — tránh audio phát tiếp vài chục ms từ vị trí cũ
    // trong lúc seek đang xử lý bất đồng bộ (gây tiếng méo/lạ ở đầu câu mới)
    audio.pause();

    segmentEndRef.current = segment.end;
    audio.playbackRate = playbackRate;

    // Đợi browser seek xong (sự kiện "seeked") rồi mới play, để không phát
    // nhầm từ vị trí cũ. Có timeout fallback phòng trường hợp "seeked" không
    // bắn (vd seek tới đúng currentTime hiện tại) — dù đường nào kích hoạt
    // trước, cleanup() đều huỷ luôn đường còn lại để không bị play() "ma"
    // trễ 400ms sau khi user đã chuyển sang câu khác.
    const cleanup = () => {
      audio.removeEventListener("seeked", doPlay);
      clearTimeout(timeoutId);
      seekCleanupRef.current = null;
    };
    const doPlay = () => {
      cleanup();
      audio
        .play()
        .then(() => {
          // Lượt phát này đã bị lượt sau thay thế trong lúc play() còn treo →
          // bỏ qua, nếu không sẽ canh câu mới bằng mốc end của câu cũ.
          if (playTokenRef.current !== token) return;
          watchSegmentEnd(audio, segment.end);
        })
        .catch(() => {
          if (playTokenRef.current !== token) return;
          setPracticeError("Không phát được audio. Hãy thử lại.");
        });
    };
    audio.addEventListener("seeked", doPlay, { once: true });
    const timeoutId = window.setTimeout(doPlay, 400);
    seekCleanupRef.current = cleanup;

    audio.currentTime = segment.start;
  }

  /**
   * Canh mốc kết thúc câu bằng requestAnimationFrame (~60 lần/giây, sai số
   * ~16ms).
   *
   * KHÔNG dùng sự kiện "timeupdate" làm cơ chế chính: trình duyệt chỉ bắn nó
   * ~4 lần/giây (đo thật: ~266ms/lần), nên audio luôn chạy quá mốc `end` tới
   * cả phần tư giây trước khi pause() kịp chạy — đủ để nghe lọt nguyên từ đầu
   * của câu kế tiếp, tức là lộ đáp án. Ở tốc độ phát nhanh còn tệ hơn (đo ở
   * 1.5x: vọt 188-357ms).
   *
   * KHÔNG dùng setTimeout hẹn đúng thời lượng còn lại: nếu user hạ tốc độ phát
   * giữa chừng thì hẹn giờ sẽ bắn sớm và cắt cụt câu. Đọc currentTime thật qua
   * rAF thì tự đúng ở mọi tốc độ.
   */
  function watchSegmentEnd(audio: HTMLAudioElement, end: number) {
    endWatchRef.current?.();

    let rafId = 0;
    const cancel = () => {
      cancelAnimationFrame(rafId);
      endWatchRef.current = null;
    };
    const tick = () => {
      if (audio.paused) return cancel(); // user tự bấm pause
      if (audio.currentTime >= end - 0.005) {
        cancel();
        audio.pause();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    endWatchRef.current = cancel;
  }

  /**
   * Lưới an toàn cho trường hợp user chuyển sang tab khác: khi tab bị ẩn,
   * trình duyệt ngưng chạy requestAnimationFrame nên watchSegmentEnd đứng
   * hình, còn "timeupdate" là sự kiện media thì vẫn bắn đều.
   */
  function handleTimeUpdate() {
    const audio = audioElRef.current;
    if (!audio) return;
    if (audio.currentTime >= segmentEndRef.current - 0.02) {
      audio.pause();
    }
  }

  function handleSetRate(rate: number) {
    setPlaybackRate(rate);
    if (audioElRef.current) audioElRef.current.playbackRate = rate;
  }

  function handleCheckChunk() {
    const current = practiceStates[currentIndex];
    if (!current.typedText.trim()) return;

    const results = diffChunk(segments[currentIndex].text, current.typedText);
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

  /** Nhảy tới câu bất kỳ (từ danh sách số) — tự phát luôn đoạn audio của câu đó */
  function handleJumpTo(idx: number) {
    setCurrentIndex(idx);
    playSegment(idx);
  }

  function handleNextChunk() {
    if (currentIndex < segments.length - 1) {
      const next = currentIndex + 1;
      setCurrentIndex(next);
      playSegment(next);
    } else {
      finishPractice();
    }
  }

  function finishPractice() {
    // Dùng bestWordResults (kết quả tốt nhất qua các lần thử), không phải lần cuối
    const allResults = practiceStates.map((s, i) => {
      const best = s.bestWordResults ?? s.wordResults;
      if (best) return best;
      return diffChunk(segments[i].text, ""); // chưa làm → tính sai hết
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
    seekCleanupRef.current?.();
    endWatchRef.current?.();
    // Vô hiệu hoá lượt play() nào còn treo, để nó không canh nhầm sau khi reset.
    playTokenRef.current++;
    audioElRef.current?.pause();
    setIsPlaying(false);
    setPhase("upload");
    setAudioFile(null);
    setAudioDuration(0);
    setUploadError("");
    setPracticeError("");
    setSegments([]);
    setCurrentIndex(0);
    setPracticeStates([]);
    setAllWordResults([]);
    setSaveResult(null);
    setSaveError("");
    setPlaybackRate(1);
    if (audioObjectUrl) {
      URL.revokeObjectURL(audioObjectUrl);
      setAudioObjectUrl(null);
    }
  }

  // Audio element dùng chung cho cả preview (upload phase) và phát đoạn (practice
  // phase) — chỉ 1 instance để giữ được currentTime/seek liền mạch giữa các phase.
  //
  // QUAN TRỌNG: nó phải luôn là CON ĐẦU TIÊN của thẻ bọc ngoài ở MỌI phase, để
  // React tái sử dụng đúng node DOM thay vì unmount/mount lại. Nếu nó bị unmount
  // trong lúc đang phát (trước đây xảy ra khi bấm "Bắt đầu luyện" giữa lúc nghe
  // thử), trình duyệt pause node đã tách khỏi DOM và sự kiện "pause" không bao giờ
  // tới listener của React → isPlaying kẹt ở true.
  const audioElement = audioObjectUrl && (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio
      ref={audioElRef}
      src={audioObjectUrl}
      controls={phase === "upload" || phase === "processing"}
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      onEnded={() => setIsPlaying(false)}
      onTimeUpdate={phase === "practice" ? handleTimeUpdate : undefined}
      onError={() => phase === "practice" && setPracticeError("Không phát được audio. Hãy thử lại.")}
      className={phase === "upload" || phase === "processing" ? "w-full rounded-lg" : "hidden"}
    />
  );

  // ---------------------------------------------------------------------------
  // Render: Upload phase
  // ---------------------------------------------------------------------------
  if (phase === "upload" || phase === "processing") {
    const processing = phase === "processing";
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        {audioFile && audioElement}

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
            <li>Hệ thống tự chuyển âm thanh thành văn bản kèm mốc thời gian từng câu (AI transcribe)</li>
            <li>Nghe đúng đoạn audio gốc của từng câu rồi gõ lại — có thể chỉnh tốc độ phát</li>
            <li>Gõ sai có thể nghe lại và thử lại nhiều lần đến khi đúng</li>
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
    const isLast = currentIndex === segments.length - 1;
    const allCorrect = state.wordResults?.every((w) => w.isCorrect) ?? false;
    const canCheck = !state.submitted && state.typedText.trim().length > 0;

    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        {audioFile && audioElement}

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
        <ProgressBar current={currentIndex + 1} total={segments.length} />

        {/* Danh sách câu — bấm để nhảy tới câu bất kỳ */}
        <SegmentPills
          segments={segments}
          states={practiceStates}
          currentIndex={currentIndex}
          onJump={handleJumpTo}
        />

        {/* Audio player card */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted mb-3">
            Câu {currentIndex + 1}/{segments.length} — Nghe rồi gõ lại bên dưới
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => playSegment(currentIndex)}
              className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 font-medium text-sm text-white transition-colors duration-200 hover:bg-primary-dark"
            >
              {isPlaying ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-pulse rounded-full bg-white" />
                  Đang phát… (bấm để nghe lại)
                </>
              ) : (
                <>▶ Nghe câu này</>
              )}
            </button>
          </div>

          {/* Tốc độ phát */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted mr-1">Tốc độ:</span>
            {RATE_OPTIONS.map((r) => (
              <button
                key={r}
                onClick={() => handleSetRate(r)}
                className={`cursor-pointer rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                  playbackRate === r
                    ? "bg-primary text-white"
                    : "border border-border text-muted hover:border-primary"
                }`}
              >
                {r}x
              </button>
            ))}
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
                  <p className="text-sm font-mono">{segments[currentIndex].text}</p>
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
                else if (state.submitted) handleNextChunk();
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
              onClick={() => playSegment(currentIndex)}
              aria-label="Nghe lại"
              className="cursor-pointer rounded-xl border border-border px-4 py-2.5 text-sm transition-colors hover:border-primary"
            >
              🔁
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
      {audioFile && audioElement}

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
                  {segments[idx].text}
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

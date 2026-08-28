/**
 * lib/audio-hash.ts
 *
 * SHA-256 hash của buffer audio — dùng làm cache key cho AudioTranscript.
 * Server-only (dùng Node.js crypto).
 */
import { createHash } from "crypto";

/**
 * Trả về hex SHA-256 của buffer.
 * Collision probability với quy mô cá nhân: cực kỳ thấp, chấp nhận được.
 */
export function hashAudioBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

"use client";

// Hồ sơ người học (tạm lưu ở localStorage cho M1).
// M2 sẽ chuyển sang database (Prisma/SQLite) sau khi có bài test đầu vào.

import { CefrLevel, CEFR_LEVELS } from "@/lib/cefr";

const KEY = "cefrLevel";

export function getLevel(): CefrLevel {
  if (typeof window === "undefined") return "A2";
  const v = window.localStorage.getItem(KEY);
  return CEFR_LEVELS.includes(v as CefrLevel) ? (v as CefrLevel) : "A2";
}

export function setLevel(level: CefrLevel): void {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, level);
}

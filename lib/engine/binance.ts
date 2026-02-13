import type { TF } from "./types";

export function intervalToTF(interval: string): TF | null {
  const t = interval.toLowerCase();
  if (t === "1d") return "D1";
  if (t === "4h") return "H4";
  if (t === "1h") return "H1";
  if (t === "30m") return "M30";
  if (t === "15m") return "M15";
  if (t === "5m") return "M5";
  return null; // 3m, 2h 등은 엔진 스펙 TF가 아니라서 일단 무시
}

export function tfDurationMs(tf: TF): number {
  switch (tf) {
    case "D1":
      return 24 * 60 * 60 * 1000;
    case "H4":
      return 4 * 60 * 60 * 1000;
    case "H1":
      return 60 * 60 * 1000;
    case "M30":
      return 30 * 60 * 1000;
    case "M15":
      return 15 * 60 * 1000;
    case "M5":
      return 5 * 60 * 1000;
  }
}


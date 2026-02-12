// lib/engine/math.ts
import type { Zone, Price } from "./types";

export function makeZone(bottom: Price, top: Price): Zone {
  const b = Math.min(bottom, top);
  const t = Math.max(bottom, top);
  return { bottom: b, top: t, height: t - b };
}

export function overlapLen(a: Zone, b: Zone): number {
  return Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
}

// overlapRatio = overlapLen / min(heightA, heightB)
export function overlapRatio(a: Zone, b: Zone): number {
  const ol = overlapLen(a, b);
  const denom = Math.min(a.height, b.height);
  if (denom <= 0) return 0;
  return ol / denom;
}

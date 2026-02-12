export function toIsoUtc(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.replace(/\.\d{3}Z$/, "Z");
}

export function utcSecToMs(sec: number): number {
  return Math.trunc(sec * 1000);
}

export function msToUtcSec(ms: number): number {
  return Math.trunc(ms / 1000);
}
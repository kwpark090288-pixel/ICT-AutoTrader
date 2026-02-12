export type NormTickResult = {
  tick: number;
  eps: number;
  bottomTick: number;
  topTick: number;
  bottomNorm: number;
  topNorm: number;
};

export function normalizeByTick(bottom: number, top: number, tick: number): NormTickResult {
  if (!Number.isFinite(tick) || tick <= 0) throw new Error(`invalid tick: ${tick}`);
  const eps = tick * 1e-6;

  const bottomTick = Math.floor((bottom + eps) / tick);
  const topTick = Math.ceil((top - eps) / tick);

  const bottomNorm = bottomTick * tick;
  const topNorm = topTick * tick;

  return { tick, eps, bottomTick, topTick, bottomNorm, topNorm };
}

export function decimalsFromTick(tick: number): number {
  if (!Number.isFinite(tick) || tick <= 0) return 0;
  let d = 0;
  let x = tick;
  while (d < 10 && Math.abs(x - Math.round(x)) > 1e-12) {
    x *= 10;
    d += 1;
  }
  return d;
}

export function formatPriceByTick(price: number, tick: number): string {
  const d = decimalsFromTick(tick);
  return Number.isFinite(price) ? price.toFixed(d) : String(price);
}


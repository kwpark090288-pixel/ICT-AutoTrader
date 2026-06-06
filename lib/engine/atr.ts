import type { AtrSnapshot, Bar, TF } from "./types";

export const ATR_PERIOD = 14;

function assertSameTfAscending(bars: readonly Bar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("ATR bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("ATR bars must be strictly ascending by closeTime");
    }
  }
}

export function computeTrueRange(
  currentBar: Bar,
  prevClose?: number
): number {
  const highLow = currentBar.high - currentBar.low;
  const prevCloseNumber = Number(prevClose);

  if (!Number.isFinite(prevCloseNumber)) {
    return highLow;
  }

  const highPrevClose = Math.abs(currentBar.high - prevCloseNumber);
  const lowPrevClose = Math.abs(currentBar.low - prevCloseNumber);

  return Math.max(highLow, highPrevClose, lowPrevClose);
}

export function buildAtrSnapshots(
  bars: readonly Bar[],
  period: number = ATR_PERIOD
): AtrSnapshot[] {
  if (bars.length < period) {
    return [];
  }

  assertSameTfAscending(bars);

  const out: AtrSnapshot[] = [];
  const trValues: number[] = [];

  let atr: number | null = null;

  for (let i = 0; i < bars.length; i += 1) {
    const currentBar = bars[i];
    const prevClose = i > 0 ? bars[i - 1].close : undefined;
    const tr = computeTrueRange(currentBar, prevClose);

    if (i < period - 1) {
      trValues.push(tr);
      continue;
    }

    if (i === period - 1) {
      trValues.push(tr);
      atr = trValues.reduce((sum, value) => sum + value, 0) / period;

      out.push({
        tf: currentBar.tf as TF,
        time: currentBar.closeTime,
        atr14: atr,
      });

      continue;
    }

    atr = (((atr as number) * (period - 1)) + tr) / period;

    out.push({
      tf: currentBar.tf as TF,
      time: currentBar.closeTime,
      atr14: atr,
    });
  }

  return out;
}

export function getAtrSnapshotAtCloseTime(
  bars: readonly Bar[],
  closeTime: number,
  period: number = ATR_PERIOD
): AtrSnapshot | null {
  const snapshots = buildAtrSnapshots(bars, period);
  return snapshots.find((snapshot) => snapshot.time === closeTime) ?? null;
}

export function getAtrValueAtCloseTime(
  bars: readonly Bar[],
  closeTime: number,
  period: number = ATR_PERIOD
): number | null {
  const snapshot = getAtrSnapshotAtCloseTime(bars, closeTime, period);
  return snapshot ? snapshot.atr14 : null;
}

import { FVG_ATR_PERIOD } from "./constants";
import type { AtrSnapshot, FvgBar, FvgTf } from "./types";

function assertSameTfAscending(bars: readonly FvgBar[]) {
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
  currentBar: FvgBar,
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

export function buildAtr14Snapshots(
  bars: readonly FvgBar[]
): AtrSnapshot[] {
  if (bars.length < FVG_ATR_PERIOD) {
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

    if (i < FVG_ATR_PERIOD - 1) {
      trValues.push(tr);
      continue;
    }

    if (i === FVG_ATR_PERIOD - 1) {
      trValues.push(tr);
      atr = trValues.reduce((sum, value) => sum + value, 0) / FVG_ATR_PERIOD;

      out.push({
        tf: currentBar.tf as FvgTf,
        time: currentBar.closeTime,
        atr14: atr,
      });

      continue;
    }

    atr = (((atr as number) * (FVG_ATR_PERIOD - 1)) + tr) / FVG_ATR_PERIOD;

    out.push({
      tf: currentBar.tf as FvgTf,
      time: currentBar.closeTime,
      atr14: atr,
    });
  }

  return out;
}

export function getAtrSnapshotAtConfTime(
  bars: readonly FvgBar[],
  confTime: number
): AtrSnapshot | null {
  const snapshots = buildAtr14Snapshots(bars);
  return snapshots.find((snapshot) => snapshot.time === confTime) ?? null;
}

export function getAtrValueAtConfTime(
  bars: readonly FvgBar[],
  confTime: number
): number | null {
  const snapshot = getAtrSnapshotAtConfTime(bars, confTime);
  return snapshot ? snapshot.atr14 : null;
}

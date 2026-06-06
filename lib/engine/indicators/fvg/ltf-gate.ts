import { getAtrValueAtConfTime } from "./atr";
import { FVG_REACTION_TFS, LTF_GATE_ATR } from "./constants";
import type {
  D1PoiFvg,
  Dir,
  FvgBar,
  H4CoreFvg,
  LtfGateEvalResult,
  SetupFvg,
} from "./types";

export type LtfGatePoi = D1PoiFvg | H4CoreFvg | SetupFvg;
export type LtfReactionTf = "M15" | "M5";

function assertSameTfAscending(bars: readonly FvgBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("LTF gate bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("LTF gate bars must be strictly ascending by closeTime");
    }
  }
}

export function isLtfReactionTf(tf: string): tf is LtfReactionTf {
  return (FVG_REACTION_TFS as readonly string[]).includes(tf);
}

export function isEligibleLtfGatePoi(poi: LtfGatePoi): boolean {
  if (poi.type === "D1_POI_FVG") {
    return poi.state === "ACTIVE";
  }

  if (poi.type === "H4_CORE_FVG") {
    return poi.state === "A_ACTIVE";
  }

  return poi.state === "ACTIVE";
}

export function getLtfGateBoundary(poi: LtfGatePoi): number {
  return poi.dir === "BULL" ? poi.zone.bottom : poi.zone.top;
}

export function getLtfGatePriceExtreme(bar: FvgBar, dir: Dir): number {
  return dir === "BULL" ? bar.low : bar.high;
}

export function computeLtfGateDist(
  priceExtreme: number,
  boundary: number
): number {
  return Math.abs(priceExtreme - boundary);
}

type EvaluateLtfGateOnBarArgs = {
  bar: FvgBar;
  poi: LtfGatePoi;
  atrAtLtf: number;
};

export function evaluateLtfGateOnBar(
  args: EvaluateLtfGateOnBarArgs
): LtfGateEvalResult | null {
  const { bar, poi, atrAtLtf } = args;

  if (!isLtfReactionTf(bar.tf)) return null;
  if (!isEligibleLtfGatePoi(poi)) return null;
  if (!Number.isFinite(atrAtLtf) || atrAtLtf <= 0) return null;

  const boundary = getLtfGateBoundary(poi);
  const priceExtreme = getLtfGatePriceExtreme(bar, poi.dir);
  const dist = computeLtfGateDist(priceExtreme, boundary);

  return {
    poiId: poi.id,
    poiType: poi.type,
    tf: bar.tf,
    dir: poi.dir,
    barCloseTime: bar.closeTime,
    boundary,
    priceExtreme,
    dist,
    atrAtLtf,
    passGate: dist <= atrAtLtf * LTF_GATE_ATR,
  };
}

export function evaluateLtfGateFromTfBars(
  tfBars: readonly FvgBar[],
  poi: LtfGatePoi
): LtfGateEvalResult | null {
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const atrAtLtf = getAtrValueAtConfTime(tfBars, currentBar.closeTime);

  if (!Number.isFinite(atrAtLtf)) {
    return null;
  }

  return evaluateLtfGateOnBar({
    bar: currentBar,
    poi,
    atrAtLtf: atrAtLtf as number,
  });
}

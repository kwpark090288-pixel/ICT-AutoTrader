import {
  D1_MIXED_STRONG_DISP_BODY_MAX_ATR,
  D1_MIXED_STRONG_DISP_BODY_SUM_ATR,
  MIN_ZONE_HEIGHT_ATR,
} from "./constants";
import { getCandleBodySize } from "./displacement";
import type {
  D1MixedStrongDisplacementEvalResult,
  D1PoiInvalidationFlags,
  D1PoiRegistrationEvalResult,
  DetectedWickFvg,
  Dir,
  DisplacementEvalResult,
  FvgBar,
  StructureBreakType,
  StructureState,
} from "./types";

export function evaluateD1MixedStrongDisplacementFromRecentBars(
  recentBars: readonly FvgBar[],
  atrAtConf: number
): D1MixedStrongDisplacementEvalResult | null {
  if (recentBars.length < 3) return null;
  if (!Number.isFinite(atrAtConf) || atrAtConf <= 0) return null;

  const [left, middle, right] = recentBars.slice(recentBars.length - 3);

  if (left.tf !== "D1" || middle.tf !== "D1" || right.tf !== "D1") {
    return null;
  }

  if (!(left.closeTime < middle.closeTime && middle.closeTime < right.closeTime)) {
    return null;
  }

  const bodies = [
    getCandleBodySize(left),
    getCandleBodySize(middle),
    getCandleBodySize(right),
  ];

  const bodyMax = Math.max(...bodies);
  const bodySum = bodies.reduce((sum, value) => sum + value, 0);

  const passByMax = bodyMax > atrAtConf * D1_MIXED_STRONG_DISP_BODY_MAX_ATR;
  const passBySum = bodySum > atrAtConf * D1_MIXED_STRONG_DISP_BODY_SUM_ATR;

  return {
    confTime: right.closeTime,
    atrAtConf,
    bodyMax,
    bodySum,
    passByMax,
    passBySum,
    passMixedStrongDisp: passByMax || passBySum,
  };
}

type EvaluateD1PoiFvgRegistrationArgs = {
  detectedFvg: DetectedWickFvg | null;
  structureAtConf: StructureState;
  displacementEval: DisplacementEvalResult | null;
  mixedStrongDisplacementEval?: D1MixedStrongDisplacementEvalResult | null;
};

export function evaluateD1PoiFvgRegistration(
  args: EvaluateD1PoiFvgRegistrationArgs
): D1PoiRegistrationEvalResult {
  const {
    detectedFvg,
    structureAtConf,
    displacementEval,
    mixedStrongDisplacementEval,
  } = args;

  const passZoneHeight = Boolean(
    detectedFvg &&
      detectedFvg.tf === "D1" &&
      detectedFvg.zone.height >= detectedFvg.atrAtConf * MIN_ZONE_HEIGHT_ATR
  );

  const passDisplacement = Boolean(displacementEval?.passDisplacement);
  const passMixedStrongDisp = Boolean(
    mixedStrongDisplacementEval?.passMixedStrongDisp
  );

  let passStructureRule = false;

  if (structureAtConf === "UP") {
    passStructureRule = detectedFvg?.dir === "BULL";
  } else if (structureAtConf === "DOWN") {
    passStructureRule = detectedFvg?.dir === "BEAR";
  } else {
    passStructureRule = passMixedStrongDisp;
  }

  return {
    canRegister: passZoneHeight && passDisplacement && passStructureRule,
    passZoneHeight,
    passDisplacement,
    structureAtConf,
    passStructureRule,
    passMixedStrongDisp,
  };
}

type EvaluateD1PoiFvgInvalidationFlagsArgs = {
  boxDir: Dir;
  fullFillHit?: boolean;
  structureBreakType?: StructureBreakType | null;
  nextStructureState?: StructureState;
  prunedByLimit?: boolean;
};

export function evaluateD1PoiFvgInvalidationFlags(
  args: EvaluateD1PoiFvgInvalidationFlagsArgs
): D1PoiInvalidationFlags {
  const {
    boxDir,
    fullFillHit,
    structureBreakType,
    nextStructureState,
    prunedByLimit,
  } = args;

  const oppositeChochInvalidated =
    boxDir === "BULL"
      ? structureBreakType === "CHOCH" && nextStructureState === "DOWN"
      : structureBreakType === "CHOCH" && nextStructureState === "UP";

  return {
    fullFillInvalidated: Boolean(fullFillHit),
    oppositeChochInvalidated,
    pruneInvalidated: Boolean(prunedByLimit),
    touchInvalidated: false,
  };
}

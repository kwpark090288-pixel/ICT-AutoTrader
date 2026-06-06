import type { Pivot } from "../engine/types";
import type {
  RouterCollabStrength,
  RouterOpenIntent,
  RouterOpenIntentPoiTier,
  RouterSendOpenPayload,
  RouterTf,
} from "../router/types";
import {
  EQ_BAND_ATR,
  ENTRY_Q_IDEAL_ATR,
  ENTRY_Q_VALID_ATR,
  RR_BASE_IDEAL,
  RR_BASE_LATE,
  RR_BASE_VALID,
  RR_MAX_D1_POI,
  RR_MAX_D1_POI_STRONG,
  RR_MAX_DEFAULT,
  RR_MAX_H4_CORE,
  RR_MIN,
  STOP_BUFFER_ATR,
  STOP_BUFFER_MIN_TICKS,
  TIMEOUT_D1_POI_MIN,
  TIMEOUT_H1_SETUP_MIN,
  TIMEOUT_H4_CORE_MIN,
  TIMEOUT_M30_SETUP_MIN,
  TIMEOUT_OTHER_MIN,
  TRADE_TICK_EPSILON_FACTOR,
} from "./constants";
import type {
  TradeEntryQuality,
  TradeInvalidationRef,
  TradeOpenEvalResult,
  TradePlan,
  TradePlanDraft,
  TradeSuppressReason,
  TradeTpMode,
} from "./types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasRequiredPolicySnapshotFields(
  intent?: RouterOpenIntent | null
): boolean {
  const policySnapshot = intent?.policySnapshot;

  if (!policySnapshot || typeof policySnapshot !== "object") {
    return false;
  }

  return (
    (policySnapshot.decision === "ALLOW" ||
      policySnapshot.decision === "BLOCK") &&
    (policySnapshot.regimeState === "NORMAL" ||
      policySnapshot.regimeState === "CAUTION" ||
      policySnapshot.regimeState === "TRANSITION" ||
      policySnapshot.regimeState === "HALT")
  );
}

export function hasRequiredOpenIntentFields(
  intent?: RouterOpenIntent | null
): boolean {
  if (!intent || typeof intent !== "object") {
    return false;
  }

  return (
    isNonEmptyString(intent.symbol) &&
    (intent.dir === "LONG" || intent.dir === "SHORT") &&
    (intent.eventType === "REACTION" ||
      intent.eventType === "ENTRY_WINDOW_OPEN") &&
    isNonEmptyString(intent.openTime) &&
    isNonEmptyString(intent.source) &&
    isNonEmptyString(intent.poiTier) &&
    isNonEmptyString(intent.poiId) &&
    Number.isFinite(intent.entryBoundaryPrice) &&
    Number.isFinite(intent.hardInvalidationPrice) &&
    Array.isArray(intent.tags) &&
    hasRequiredPolicySnapshotFields(intent)
  );
}

function hasRequiredOpenIntentCoreFields(
  intent?: RouterOpenIntent | null
): boolean {
  if (!intent || typeof intent !== "object") {
    return false;
  }

  return (
    isNonEmptyString(intent.symbol) &&
    (intent.dir === "LONG" || intent.dir === "SHORT") &&
    (intent.eventType === "REACTION" ||
      intent.eventType === "ENTRY_WINDOW_OPEN") &&
    isNonEmptyString(intent.openTime) &&
    isNonEmptyString(intent.source) &&
    isNonEmptyString(intent.poiTier) &&
    isNonEmptyString(intent.poiId) &&
    Number.isFinite(intent.entryBoundaryPrice) &&
    Number.isFinite(intent.hardInvalidationPrice) &&
    Array.isArray(intent.tags)
  );
}

export function evaluateOpenIntentPolicyGuard(
  intent?: RouterOpenIntent | null
): TradeSuppressReason | null {
  if (!intent || !hasRequiredPolicySnapshotFields(intent)) {
    return "POLICY_MISSING";
  }

  if (
    intent.policySnapshot.decision === "BLOCK" ||
    intent.policySnapshot.regimeState === "HALT"
  ) {
    return "HALT_OR_BLOCK";
  }

  return null;
}

function isWeakOrMissingCollabStrength(
  collabStrength?: RouterCollabStrength
): boolean {
  return (
    collabStrength === undefined ||
    collabStrength === "NONE" ||
    collabStrength === "WEAK"
  );
}

function isLateLowConvPoiTier(
  poiTier: RouterOpenIntentPoiTier
): boolean {
  return (
    poiTier === "H1_SETUP" ||
    poiTier === "M30_SETUP" ||
    poiTier === "OTHER"
  );
}

type ShouldSuppressLateLowConvArgs = {
  intent: RouterOpenIntent;
  entryQuality: TradeEntryQuality;
};

export function shouldSuppressLateLowConv(
  args: ShouldSuppressLateLowConvArgs
): boolean {
  const { intent, entryQuality } = args;

  if (entryQuality !== "LATE") {
    return false;
  }

  if (
    intent.poiTier === "D1_POI" ||
    intent.poiTier === "H4_CORE" ||
    intent.collabStrength === "OK" ||
    intent.collabStrength === "STRONG"
  ) {
    return false;
  }

  return (
    isLateLowConvPoiTier(intent.poiTier) &&
    isWeakOrMissingCollabStrength(intent.collabStrength)
  );
}

function toTickPrice(ticks: number, tickSize: number): number {
  return Number((ticks * tickSize).toFixed(12));
}

export function roundToTick(
  value: number,
  tickSize: number
): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) {
    return null;
  }

  const ticks = Math.round((value as number) / tickSize);
  return toTickPrice(ticks, tickSize);
}

export function floorToTick(
  value: number,
  tickSize: number
): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) {
    return null;
  }

  const ticks = Math.floor(((value as number) / tickSize) + TRADE_TICK_EPSILON_FACTOR);
  return toTickPrice(ticks, tickSize);
}

export function ceilToTick(
  value: number,
  tickSize: number
): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) {
    return null;
  }

  const ticks = Math.ceil(((value as number) / tickSize) - TRADE_TICK_EPSILON_FACTOR);
  return toTickPrice(ticks, tickSize);
}

export function computeEntryRefPrice(
  signalBarClose: number,
  tickSize: number
): number | null {
  return roundToTick(signalBarClose, tickSize);
}

export function computeStopBuffer(
  tickSize: number,
  atrM5_14_atOpen: number
): number | null {
  if (
    !Number.isFinite(tickSize) ||
    tickSize <= 0 ||
    !Number.isFinite(atrM5_14_atOpen) ||
    atrM5_14_atOpen <= 0
  ) {
    return null;
  }

  const raw = Math.max(
    STOP_BUFFER_MIN_TICKS * tickSize,
    (atrM5_14_atOpen as number) * STOP_BUFFER_ATR
  );

  return roundToTick(raw, tickSize);
}

export function computeStopPrice(
  dir: RouterOpenIntent["dir"],
  entryRefPrice: number,
  hardInvalidationPrice: number,
  stopBuffer: number,
  tickSize: number
): number | null {
  if (
    (dir !== "LONG" && dir !== "SHORT") ||
    !Number.isFinite(entryRefPrice) ||
    !Number.isFinite(hardInvalidationPrice) ||
    !Number.isFinite(stopBuffer) ||
    !Number.isFinite(tickSize) ||
    tickSize <= 0
  ) {
    return null;
  }

  if (dir === "LONG") {
    const stopRaw = (hardInvalidationPrice as number) - (stopBuffer as number);
    const stop = floorToTick(stopRaw, tickSize);
    const safety = roundToTick((entryRefPrice as number) - tickSize, tickSize);

    if (!Number.isFinite(stop) || !Number.isFinite(safety)) {
      return null;
    }

    return (stop as number) <= (safety as number)
      ? (stop as number)
      : (safety as number);
  }

  const stopRaw = (hardInvalidationPrice as number) + (stopBuffer as number);
  const stop = ceilToTick(stopRaw, tickSize);
  const safety = roundToTick((entryRefPrice as number) + tickSize, tickSize);

  if (!Number.isFinite(stop) || !Number.isFinite(safety)) {
    return null;
  }

  return (stop as number) >= (safety as number)
    ? (stop as number)
    : (safety as number);
}

export function computeEntryQuality(
  entryRefPrice: number,
  entryBoundaryPrice: number,
  atrM5_14_atOpen: number
): TradeEntryQuality | null {
  if (
    !Number.isFinite(entryRefPrice) ||
    !Number.isFinite(entryBoundaryPrice) ||
    !Number.isFinite(atrM5_14_atOpen) ||
    atrM5_14_atOpen <= 0
  ) {
    return null;
  }

  const dist = Math.abs((entryRefPrice as number) - (entryBoundaryPrice as number));

  if (dist <= (atrM5_14_atOpen as number) * ENTRY_Q_IDEAL_ATR) {
    return "IDEAL";
  }

  if (dist <= (atrM5_14_atOpen as number) * ENTRY_Q_VALID_ATR) {
    return "VALID";
  }

  return "LATE";
}

export function getRrMaxUsed(
  poiTier: RouterOpenIntent["poiTier"],
  collabStrength?: RouterCollabStrength
): number {
  if (poiTier === "D1_POI" && collabStrength === "STRONG") {
    return RR_MAX_D1_POI_STRONG;
  }

  if (poiTier === "D1_POI") {
    return RR_MAX_D1_POI;
  }

  if (poiTier === "H4_CORE") {
    return RR_MAX_H4_CORE;
  }

  return RR_MAX_DEFAULT;
}

export function getRrBase(
  entryQuality: TradeEntryQuality
): number {
  if (entryQuality === "IDEAL") {
    return RR_BASE_IDEAL;
  }

  if (entryQuality === "VALID") {
    return RR_BASE_VALID;
  }

  return RR_BASE_LATE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeTpRr(
  dir: RouterOpenIntent["dir"],
  entryRefPrice: number,
  stopPrice: number,
  rrBase: number,
  rrMaxUsed: number,
  tickSize: number
): number | null {
  if (
    (dir !== "LONG" && dir !== "SHORT") ||
    !Number.isFinite(entryRefPrice) ||
    !Number.isFinite(stopPrice) ||
    !Number.isFinite(rrBase) ||
    !Number.isFinite(rrMaxUsed) ||
    !Number.isFinite(tickSize) ||
    tickSize <= 0
  ) {
    return null;
  }

  const s = Math.abs((entryRefPrice as number) - (stopPrice as number));
  if (s <= 0) {
    return null;
  }

  const rrChosen = clamp(rrBase as number, RR_MIN, rrMaxUsed as number);
  const tpRaw =
    dir === "LONG"
      ? (entryRefPrice as number) + rrChosen * s
      : (entryRefPrice as number) - rrChosen * s;

  return dir === "LONG"
    ? ceilToTick(tpRaw, tickSize)
    : floorToTick(tpRaw, tickSize);
}

export function getTpLiqTf(
  poiTier: RouterOpenIntent["poiTier"]
): RouterTf {
  if (
    poiTier === "D1_POI" ||
    poiTier === "H4_CORE" ||
    poiTier === "H1_SETUP"
  ) {
    return "H1";
  }

  if (poiTier === "M30_SETUP") {
    return "M30";
  }

  return "H1";
}

export function getTimeoutMinutes(
  poiTier: RouterOpenIntent["poiTier"]
): number {
  if (poiTier === "D1_POI") {
    return TIMEOUT_D1_POI_MIN;
  }

  if (poiTier === "H4_CORE") {
    return TIMEOUT_H4_CORE_MIN;
  }

  if (poiTier === "H1_SETUP") {
    return TIMEOUT_H1_SETUP_MIN;
  }

  if (poiTier === "M30_SETUP") {
    return TIMEOUT_M30_SETUP_MIN;
  }

  return TIMEOUT_OTHER_MIN;
}

function parseIsoUtcMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeTimeoutDueTime(
  openTime: string,
  timeoutMinutes: number
): string | null {
  const openTimeMs = parseIsoUtcMs(openTime);

  if (!Number.isFinite(openTimeMs) || !Number.isFinite(timeoutMinutes)) {
    return null;
  }

  return new Date(
    (openTimeMs as number) + (timeoutMinutes as number) * 60 * 1000
  ).toISOString();
}

function pickNearestDirectionalLevel(
  dir: RouterOpenIntent["dir"],
  entryRefPrice: number,
  levels: readonly number[]
): number | null {
  const filtered = levels.filter((level) =>
    dir === "LONG" ? level > entryRefPrice : level < entryRefPrice
  );

  if (!filtered.length) {
    return null;
  }

  const sorted = [...filtered].sort((a, b) =>
    dir === "LONG" ? a - b : b - a
  );

  return sorted[0];
}

function buildEqLevels(
  dir: RouterOpenIntent["dir"],
  pivots: readonly Pivot[],
  eqBand: number
): number[] {
  const out: number[] = [];

  for (let i = 1; i < pivots.length; i += 1) {
    const prev = pivots[i - 1];
    const curr = pivots[i];

    if (Math.abs(curr.pivotPrice - prev.pivotPrice) > eqBand) {
      continue;
    }

    out.push(
      dir === "LONG"
        ? Math.max(prev.pivotPrice, curr.pivotPrice)
        : Math.min(prev.pivotPrice, curr.pivotPrice)
    );
  }

  return out;
}

type FindTpLiqCandidateArgs = {
  dir: RouterOpenIntent["dir"];
  openTime: string;
  entryRefPrice: number;
  atrLiq_14_atOpen: number;
  tpLiqTf: RouterTf;
  confirmedPivots: readonly Pivot[];
};

export function findTpLiqCandidate(
  args: FindTpLiqCandidateArgs
): number | null {
  const {
    dir,
    openTime,
    entryRefPrice,
    atrLiq_14_atOpen,
    tpLiqTf,
    confirmedPivots,
  } = args;

  if (
    (dir !== "LONG" && dir !== "SHORT") ||
    !Number.isFinite(entryRefPrice) ||
    !Number.isFinite(atrLiq_14_atOpen) ||
    atrLiq_14_atOpen <= 0
  ) {
    return null;
  }

  const openTimeMs = parseIsoUtcMs(openTime);
  if (!Number.isFinite(openTimeMs)) {
    return null;
  }

  const pivotType = dir === "LONG" ? "HIGH" : "LOW";
  const eligible = confirmedPivots
    .filter(
      (pivot) =>
        pivot.tf === tpLiqTf &&
        pivot.pivotType === pivotType &&
        pivot.isConfirmed === true &&
        pivot.confirmedAt < (openTimeMs as number)
    )
    .sort((a, b) => a.confirmedAt - b.confirmedAt);

  const eqBand = (atrLiq_14_atOpen as number) * EQ_BAND_ATR;
  const eqCandidate = pickNearestDirectionalLevel(
    dir,
    entryRefPrice as number,
    buildEqLevels(dir, eligible, eqBand)
  );

  if (Number.isFinite(eqCandidate)) {
    return eqCandidate as number;
  }

  return pickNearestDirectionalLevel(
    dir,
    entryRefPrice as number,
    eligible.map((pivot) => pivot.pivotPrice)
  );
}

type ComputeTpPriceArgs = {
  dir: RouterOpenIntent["dir"];
  entryRefPrice: number;
  stopPrice: number;
  rrBase: number;
  rrMaxUsed: number;
  tickSize: number;
  openTime: string;
  atrLiq_14_atOpen: number;
  tpLiqTf: RouterTf;
  confirmedPivots: readonly Pivot[];
};

export function computeTpPrice(
  args: ComputeTpPriceArgs
): { tpPrice: number; tpMode: TradeTpMode } | null {
  const {
    dir,
    entryRefPrice,
    stopPrice,
    rrBase,
    rrMaxUsed,
    tickSize,
    openTime,
    atrLiq_14_atOpen,
    tpLiqTf,
    confirmedPivots,
  } = args;

  const s = Math.abs(entryRefPrice - stopPrice);
  if (!Number.isFinite(s) || s <= 0) {
    return null;
  }

  const tpRr = computeTpRr(
    dir,
    entryRefPrice,
    stopPrice,
    rrBase,
    rrMaxUsed,
    tickSize
  );
  if (!Number.isFinite(tpRr)) {
    return null;
  }

  const tpLiq = findTpLiqCandidate({
    dir,
    openTime,
    entryRefPrice,
    atrLiq_14_atOpen,
    tpLiqTf,
    confirmedPivots,
  });

  if (Number.isFinite(tpLiq)) {
    const rrLiq = Math.abs((tpLiq as number) - entryRefPrice) / s;

    if (rrLiq >= RR_MIN && rrLiq <= rrMaxUsed) {
      const tpPrice =
        dir === "LONG"
          ? ceilToTick(tpLiq as number, tickSize)
          : floorToTick(tpLiq as number, tickSize);

      if (!Number.isFinite(tpPrice)) {
        return null;
      }

      return {
        tpPrice: tpPrice as number,
        tpMode: "LIQ",
      };
    }
  }

  return {
    tpPrice: tpRr as number,
    tpMode: "RR",
  };
}

type TradePlanDraftIntent = Pick<
  RouterOpenIntent,
  | "dir"
  | "openTime"
  | "poiTier"
  | "entryBoundaryPrice"
  | "hardInvalidationPrice"
  | "collabStrength"
>;

function hasRequiredTradePlanDraftIntentFields(
  intent?: TradePlanDraftIntent | null
): boolean {
  if (!intent || typeof intent !== "object") {
    return false;
  }

  return (
    (intent.dir === "LONG" || intent.dir === "SHORT") &&
    isNonEmptyString(intent.openTime) &&
    isNonEmptyString(intent.poiTier) &&
    Number.isFinite(intent.entryBoundaryPrice) &&
    Number.isFinite(intent.hardInvalidationPrice)
  );
}

type BuildTradePlanDraftArgs = {
  intent: TradePlanDraftIntent;
  signalBarClose: number;
  tickSize: number;
  atrM5_14_atOpen: number;
  atrLiq_14_atOpen: number;
  confirmedTpPivots: readonly Pivot[];
};

export function buildTradePlanDraft(
  args: BuildTradePlanDraftArgs
): TradePlanDraft | null {
  const {
    intent,
    signalBarClose,
    tickSize,
    atrM5_14_atOpen,
    atrLiq_14_atOpen,
    confirmedTpPivots,
  } = args;

  if (
    !hasRequiredTradePlanDraftIntentFields(intent) ||
    !Number.isFinite(signalBarClose) ||
    !Number.isFinite(tickSize) ||
    tickSize <= 0 ||
    !Number.isFinite(atrM5_14_atOpen) ||
    !Number.isFinite(atrLiq_14_atOpen)
  ) {
    return null;
  }

  const entryRefPrice = computeEntryRefPrice(signalBarClose, tickSize);
  const stopBuffer = computeStopBuffer(tickSize, atrM5_14_atOpen);

  if (!Number.isFinite(entryRefPrice) || !Number.isFinite(stopBuffer)) {
    return null;
  }

  const stopPrice = computeStopPrice(
    intent.dir,
    entryRefPrice as number,
    intent.hardInvalidationPrice,
    stopBuffer as number,
    tickSize
  );

  if (!Number.isFinite(stopPrice)) {
    return null;
  }

  const entryQuality = computeEntryQuality(
    entryRefPrice as number,
    intent.entryBoundaryPrice,
    atrM5_14_atOpen
  );

  if (!entryQuality) {
    return null;
  }

  const rrMaxUsed = getRrMaxUsed(intent.poiTier, intent.collabStrength);
  const rrBase = getRrBase(entryQuality);
  const rrChosen = clamp(rrBase, RR_MIN, rrMaxUsed);
  const tpLiqTf = getTpLiqTf(intent.poiTier);
  const tpEval = computeTpPrice({
    dir: intent.dir,
    entryRefPrice: entryRefPrice as number,
    stopPrice: stopPrice as number,
    rrBase,
    rrMaxUsed,
    tickSize,
    openTime: intent.openTime,
    atrLiq_14_atOpen,
    tpLiqTf,
    confirmedPivots: confirmedTpPivots,
  });
  const timeoutMinutes = getTimeoutMinutes(intent.poiTier);
  const timeoutDueTime = computeTimeoutDueTime(
    intent.openTime,
    timeoutMinutes
  );

  if (!tpEval || !isNonEmptyString(timeoutDueTime)) {
    return null;
  }

  return {
    entryRefPrice: entryRefPrice as number,
    stopPrice: stopPrice as number,
    tpPrice: tpEval.tpPrice,
    tpMode: tpEval.tpMode,
    rrBase,
    rrChosen,
    rrMaxUsed,
    atrM5_14_atOpen,
    stopBuffer: stopBuffer as number,
    entryQuality,
    timeoutMinutes,
    timeoutDueTime,
    tpLiqTf,
    atrLiq_14_atOpen,
  };
}

type BuildTradePlanArgs = {
  payload: RouterSendOpenPayload;
  draft: TradePlanDraft;
};

function buildTradePlanInvalidationRef(
  intent: RouterOpenIntent
): TradeInvalidationRef | null {
  if (!isNonEmptyString(intent.poiId)) {
    return null;
  }

  if (intent.source === "FVG") {
    return {
      source: "FVG",
      refId: intent.poiId,
    };
  }

  if (intent.source === "OB") {
    return {
      source: "OB",
      refId: intent.poiId,
    };
  }

  if (intent.source === "CHANNEL") {
    return {
      source: "CHANNEL_POI",
      refId: intent.poiId,
    };
  }

  if (intent.source === "TRENDLINE") {
    return {
      source: "TRENDLINE",
      refId: intent.poiId,
    };
  }

  return null;
}

export function buildTradePlan(
  args: BuildTradePlanArgs
): TradePlan | null {
  const { payload, draft } = args;

  if (
    !payload ||
    payload.type !== "SEND_OPEN" ||
    !hasRequiredOpenIntentFields(payload.intent) ||
    !draft
  ) {
    return null;
  }

  const invalidationRef = buildTradePlanInvalidationRef(payload.intent);
  if (!invalidationRef) {
    return null;
  }

  return {
    planId: payload.planId,
    planKey: payload.planKey,

    symbol: payload.intent.symbol,
    dir: payload.intent.dir,
    source: payload.intent.source,
    poiTier: payload.intent.poiTier,
    poiId: payload.intent.poiId,
    invalidationRef,
    eventType: payload.intent.eventType,
    tf: payload.intent.tf,

    openTime: payload.intent.openTime,

    entryRefPrice: draft.entryRefPrice,
    entryBoundaryPrice: payload.intent.entryBoundaryPrice,
    hardInvalidationPrice: payload.intent.hardInvalidationPrice,
    stopPrice: draft.stopPrice,
    tpPrice: draft.tpPrice,
    tpMode: draft.tpMode,

    rrBase: draft.rrBase,
    rrChosen: draft.rrChosen,
    rrMaxUsed: draft.rrMaxUsed,

    atrM5_14_atOpen: draft.atrM5_14_atOpen,
    stopBuffer: draft.stopBuffer,
    entryQuality: draft.entryQuality,

    timeoutMinutes: draft.timeoutMinutes,
    timeoutDueTime: draft.timeoutDueTime,

    tpLiqTf: draft.tpLiqTf,
    atrLiq_14_atOpen: draft.atrLiq_14_atOpen,

    status: "OPEN",

    mfeR: 0,
    maeR: 0,

    score: payload.intent.score,
    collabStrength: payload.intent.collabStrength,
    entryFillPrice: payload.intent.entryFillPrice,
    riskPctAtOpen: payload.intent.riskPctAtOpen,
    poiClusterKey: payload.intent.poiClusterKey,
    edgeSigFine: payload.intent.edgeSigFine,
    edgeSigMid: payload.intent.edgeSigMid,
    edgeSigCoarse: payload.intent.edgeSigCoarse,
    tags: [...payload.intent.tags],
    policySnapshot: { ...payload.intent.policySnapshot },
  };
}

type EvaluateTradeOpenArgs = {
  payload: RouterSendOpenPayload;
  signalBarClose: number;
  tickSize: number;
  atrM5_14_atOpen: number;
  atrLiq_14_atOpen: number;
  confirmedTpPivots: readonly Pivot[];
};

export function evaluateTradeOpen(
  args: EvaluateTradeOpenArgs
): TradeOpenEvalResult | null {
  const {
    payload,
    signalBarClose,
    tickSize,
    atrM5_14_atOpen,
    atrLiq_14_atOpen,
    confirmedTpPivots,
  } = args;

  if (!payload || payload.type !== "SEND_OPEN") {
    return {
      decision: "SUPPRESS",
      reason: "INVALID_INPUT",
    };
  }

  const intent = payload.intent;

  if (!hasRequiredOpenIntentCoreFields(intent)) {
    return {
      decision: "SUPPRESS",
      reason: "INVALID_INPUT",
    };
  }

  const policyGuardReason = evaluateOpenIntentPolicyGuard(intent);
  if (policyGuardReason) {
    return {
      decision: "SUPPRESS",
      reason: policyGuardReason,
    };
  }

  const draft = buildTradePlanDraft({
    intent,
    signalBarClose,
    tickSize,
    atrM5_14_atOpen,
    atrLiq_14_atOpen,
    confirmedTpPivots,
  });

  if (!draft) {
    return {
      decision: "SUPPRESS",
      reason: "INVALID_INPUT",
    };
  }

  if (shouldSuppressLateLowConv({ intent, entryQuality: draft.entryQuality })) {
    return {
      decision: "SUPPRESS",
      reason: "LATE_LOW_CONV",
    };
  }

  const plan = buildTradePlan({
    payload,
    draft,
  });

  if (!plan) {
    return {
      decision: "SUPPRESS",
      reason: "INVALID_INPUT",
    };
  }

  return {
    decision: "OPEN",
    reason: null,
    plan,
  };
}

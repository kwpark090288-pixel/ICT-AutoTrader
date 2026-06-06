import type {
  TradePlan,
  TradeSuppressReason,
  TradeStrengthCode,
  TradeTimeoutSign,
  TradeWeaknessCode,
} from "./types";

const STRENGTH_PRIORITY: readonly TradeStrengthCode[] = [
  "S_COLLAB_STRONG",
  "S_ENTRY_IDEAL",
  "S_TP_MODE_LIQ",
  "S_POI_TIER_HIGH",
  "S_POLICY_OK",
  "S_SCORE_HIGH",
] as const;

const WEAKNESS_PRIORITY: readonly TradeWeaknessCode[] = [
  "W_RR_LOW",
  "W_GAVE_BACK_PROFIT",
  "W_ENTRY_LATE",
  "W_POLICY_CAUTION",
  "W_TP_MODE_RR",
  "W_SC_LOW",
  "W_BOTH_HIT",
] as const;

function joinTopCodes(codes: readonly string[]): string {
  return codes.length > 0 ? codes.join(", ") : "-";
}

function formatList(codes: readonly string[] | undefined): string {
  return codes && codes.length > 0 ? codes.join("|") : "-";
}

function formatFixed2(value: number | null | undefined): string {
  return Number.isFinite(value) ? (value as number).toFixed(2) : "na";
}

function formatString(value: string | null | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : "na";
}

function formatBoolean(value: boolean | null | undefined): string {
  return typeof value === "boolean" ? String(value) : "na";
}

function formatNumber(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(value) : "na";
}

function formatScore(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(value) : "na";
}

function formatCollab(value: string | null | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : "na";
}

export function formatTradePlanOpenEvent(plan: TradePlan): string {
  return [
    "[PLAN][OPEN]",
    `time=${formatString(plan.openTime)}`,
    `planId=${formatString(plan.planId)}`,
    `symbol=${formatString(plan.symbol)}`,
    `dir=${formatString(plan.dir)}`,
    `source=${formatString(plan.source)}`,
    `poiTier=${formatString(plan.poiTier)}`,
    `poiId=${formatString(plan.poiId)}`,
    `eventType=${formatString(plan.eventType)}`,
    `entryRef=${formatNumber(plan.entryRefPrice)}`,
    `boundary=${formatNumber(plan.entryBoundaryPrice)}`,
    `invalid=${formatNumber(plan.hardInvalidationPrice)}`,
    `stop=${formatNumber(plan.stopPrice)}`,
    `tp=${formatNumber(plan.tpPrice)}`,
    `tpMode=${formatString(plan.tpMode)}`,
    `rrBase=${formatNumber(plan.rrBase)}`,
    `rr=${formatNumber(plan.rrChosen)}`,
    `rrMax=${formatNumber(plan.rrMaxUsed)}`,
    `entryQ=${formatString(plan.entryQuality)}`,
    `timeoutMin=${formatNumber(plan.timeoutMinutes)}`,
    `tags=${formatList(plan.tags)}`,
    `score=${formatScore(plan.score)}`,
    `collab=${formatCollab(plan.collabStrength)}`,
    `regime=${formatString(plan.policySnapshot?.regimeState)}`,
    `sc=${formatNumber(plan.policySnapshot?.sc)}`,
    `c_bps=${formatNumber(plan.policySnapshot?.c_bps)}`,
  ].join(" ");
}

export function formatTradePlanSuppressEvent(args: {
  openTime: string;
  reason: TradeSuppressReason;
  symbol: string;
  dir: TradePlan["dir"];
  poiId: string;
}): string {
  return [
    "[PLAN][SUPPRESS]",
    `time=${formatString(args.openTime)}`,
    `reason=${formatString(args.reason)}`,
    `symbol=${formatString(args.symbol)}`,
    `dir=${formatString(args.dir)}`,
    `poiId=${formatString(args.poiId)}`,
  ].join(" ");
}

export function getTradeReplayRootMessage(
  outcome?: TradePlan["outcome"] | null
): string | null {
  if (outcome === "HARD_TP") {
    return "익절(TP) 체결";
  }

  if (outcome === "HARD_SL") {
    return "하드 스탑(SL) 체결";
  }

  if (outcome === "SOFT_INVALID") {
    return "종가 기준 무효화(아이디어 붕괴)";
  }

  if (outcome === "TIMEOUT") {
    return "타임아웃(기대 진행 부재)";
  }

  return null;
}

export function getTradeTimeoutSubMessage(
  timeoutSign?: TradeTimeoutSign | null
): string | null {
  if (timeoutSign === "PROFIT") {
    return "수익 구간에서 시간 종료";
  }

  if (timeoutSign === "LOSS") {
    return "손실 구간에서 반등 실패로 시간 종료";
  }

  if (timeoutSign === "FLAT") {
    return "방향성 부족으로 시간 종료";
  }

  return null;
}

export function pickTopStrengthCodes(
  plan: Pick<TradePlan, "strengthCodes">
): TradeStrengthCode[] {
  const existing = new Set(plan.strengthCodes ?? []);
  const selected: TradeStrengthCode[] = [];

  for (const code of STRENGTH_PRIORITY) {
    if (existing.has(code)) {
      selected.push(code);
    }

    if (selected.length >= 2) {
      break;
    }
  }

  return selected;
}

export function pickTopWeaknessCodes(
  plan: Pick<TradePlan, "weaknessCodes">
): TradeWeaknessCode[] {
  const existing = new Set(plan.weaknessCodes ?? []);
  const selected: TradeWeaknessCode[] = [];

  for (const code of WEAKNESS_PRIORITY) {
    if (existing.has(code)) {
      selected.push(code);
    }

    if (selected.length >= 2) {
      break;
    }
  }

  return selected;
}

export function buildTradeReplayNote(
  plan: Pick<
    TradePlan,
    "outcome" | "timeoutSign" | "strengthCodes" | "weaknessCodes"
  >
): string | null {
  const root = getTradeReplayRootMessage(plan.outcome);
  if (!root) {
    return null;
  }

  if (plan.outcome === "HARD_TP") {
    return `${root} | 잘한점: ${joinTopCodes(pickTopStrengthCodes(plan))}`;
  }

  if (plan.outcome === "HARD_SL" || plan.outcome === "SOFT_INVALID") {
    return `${root} | 보완: ${joinTopCodes(pickTopWeaknessCodes(plan))}`;
  }

  if (plan.outcome === "TIMEOUT") {
    const timeoutSub = getTradeTimeoutSubMessage(plan.timeoutSign);
    const parts = [root];

    if (timeoutSub) {
      parts.push(timeoutSub);
    }

    parts.push(`보완: ${joinTopCodes(pickTopWeaknessCodes(plan))}`);

    return parts.join(" | ");
  }

  return null;
}

export function formatTradePlanCloseEvent(plan: TradePlan): string {
  return [
    "[PLAN][CLOSE]",
    `time=${formatString(plan.closeTime)}`,
    `planId=${formatString(plan.planId)}`,
    `symbol=${formatString(plan.symbol)}`,
    `dir=${formatString(plan.dir)}`,
    `outcome=${formatString(plan.outcome)}`,
    `exit=${formatNumber(plan.exitPrice)}`,
    `bothHit=${formatBoolean(plan.bothHit)}`,
    `timeoutSign=${formatString(plan.timeoutSign)}`,
    `mfeR=${formatFixed2(plan.mfeR)}`,
    `maeR=${formatFixed2(plan.maeR)}`,
    `openTime=${formatString(plan.openTime)}`,
    `closeTime=${formatString(plan.closeTime)}`,
    `rGross=${formatFixed2(plan.rGross)}`,
    `rAfterCost=${formatFixed2(plan.rAfterCost)}`,
    `rFillGross=${formatFixed2(plan.rFillGross)}`,
    `rFillAfterCost=${formatFixed2(plan.rFillAfterCost)}`,
    `strengths=${formatList(plan.strengthCodes)}`,
    `weaknesses=${formatList(plan.weaknessCodes)}`,
  ].join(" ");
}

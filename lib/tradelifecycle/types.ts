import type { RouterSendOpenPayload, RouterTradeDir } from "../router/types";
import {
  TRADE_CLOSE_OUTCOMES,
  TRADE_ENTRY_QUALITIES,
  TRADE_PLAN_STATUSES,
  TRADE_SUPPRESS_REASONS,
  TRADE_STRENGTH_CODES,
  TRADE_TIMEOUT_SIGNS,
  TRADE_TP_MODES,
  TRADE_WEAKNESS_CODES,
} from "./constants";

export type TradePlanStatus = (typeof TRADE_PLAN_STATUSES)[number];
export type TradeCloseOutcome = (typeof TRADE_CLOSE_OUTCOMES)[number];
export type TradeTpMode = (typeof TRADE_TP_MODES)[number];
export type TradeEntryQuality = (typeof TRADE_ENTRY_QUALITIES)[number];
export type TradeSuppressReason = (typeof TRADE_SUPPRESS_REASONS)[number];
export type TradeTimeoutSign = (typeof TRADE_TIMEOUT_SIGNS)[number];
export type TradeStrengthCode = (typeof TRADE_STRENGTH_CODES)[number];
export type TradeWeaknessCode = (typeof TRADE_WEAKNESS_CODES)[number];
export type TradeInvalidationSource =
  | "FVG"
  | "OB"
  | "CHANNEL_POI"
  | "TRENDLINE";

export interface TradeInvalidationRef {
  source: TradeInvalidationSource;
  refId: string;
}

export interface TradeActivePlanRef {
  symbol: string;
  dir: RouterTradeDir;
  status: TradePlanStatus;
  zoneKey: string;
}

export interface TradeOpenSeed {
  planKey: string;
  planId: string;
  zoneKey: string;
  payload: RouterSendOpenPayload;
}

export interface TradeOpenSuppressionEvalResult {
  decision: "ALLOW" | "SUPPRESS";
  reason: TradeSuppressReason | null;
  planKey: string;
  planId: string;
  zoneKey: string;
}

export interface TradePlan {
  planId: string;
  planKey: string;

  symbol: string;
  dir: RouterTradeDir;
  source: RouterSendOpenPayload["intent"]["source"];
  poiTier: RouterSendOpenPayload["intent"]["poiTier"];
  poiId: string;
  invalidationRef: TradeInvalidationRef;
  eventType: RouterSendOpenPayload["intent"]["eventType"];
  tf: RouterSendOpenPayload["intent"]["tf"];

  openTime: string;

  entryRefPrice: number;
  entryBoundaryPrice: number;
  hardInvalidationPrice: number;
  stopPrice: number;
  tpPrice: number;
  tpMode: TradeTpMode;

  rrBase: number;
  rrChosen: number;
  rrMaxUsed: number;

  atrM5_14_atOpen: number;
  stopBuffer: number;
  entryQuality: TradeEntryQuality;

  timeoutMinutes: number;
  timeoutDueTime: string;

  tpLiqTf: string;
  atrLiq_14_atOpen: number;

  status: TradePlanStatus;

  mfeR: number;
  maeR: number;
  closeTime?: string;
  outcome?: TradeCloseOutcome;
  exitPrice?: number;
  bothHit?: boolean;
  timeoutSign?: TradeTimeoutSign;
  strengthCodes?: TradeStrengthCode[];
  weaknessCodes?: TradeWeaknessCode[];
  rGross?: number;
  rAfterCost?: number | null;
  rFillGross?: number | null;
  rFillAfterCost?: number | null;

  score?: number;
  collabStrength?: RouterSendOpenPayload["intent"]["collabStrength"];
  entryFillPrice?: number;
  riskPctAtOpen?: number;
  poiClusterKey?: string;
  edgeSigFine?: string;
  edgeSigMid?: string;
  edgeSigCoarse?: string;
  tags?: string[];
  policySnapshot?: RouterSendOpenPayload["intent"]["policySnapshot"];
}

export interface TradeOpenEvalResult {
  decision: "OPEN" | "SUPPRESS";
  reason: TradeSuppressReason | null;
  plan?: TradePlan;
}

export interface TradePlanDraft {
  entryRefPrice: number;
  stopPrice: number;
  tpPrice: number;
  tpMode: TradeTpMode;
  rrBase: number;
  rrChosen: number;
  rrMaxUsed: number;
  atrM5_14_atOpen: number;
  stopBuffer: number;
  entryQuality: TradeEntryQuality;
  timeoutMinutes: number;
  timeoutDueTime: string;
  tpLiqTf: string;
  atrLiq_14_atOpen: number;
}

export interface TradeHitEvalResult {
  slHit: boolean;
  tpHit: boolean;
  bothHit: boolean;
}

export interface TradeCloseEvalResult {
  shouldEvaluate: boolean;
  mfeR: number;
  maeR: number;
  outcome: TradeCloseOutcome | null;
  exitPrice: number | null;
  closeTime: string | null;
  bothHit: boolean;
}

import type { Bar } from "../../types";
import {
  LINE_STATES,
  TRENDLINE_BEST_MATCH_KINDS,
  TRENDLINE_INVALID_REASONS,
  TRENDLINE_LTF_MICRO_RETEST_TYPES,
  TRENDLINE_LTF_TRIGGER_TOKENS,
  TRENDLINE_MODEL_TFS,
  TRENDLINE_PIVOT_TYPES,
  TRENDLINE_POI_CANDIDATE_REASONS,
  TRENDLINE_REACTION_TFS,
  TRENDLINE_STRUCTURE_STATES,
  TRENDLINE_TFS,
  TRENDLINE_TYPES,
} from "./constants";

export type Timestamp = number;
export type Price = number;

export type TF = (typeof TRENDLINE_TFS)[number];
export type TrendlineModelTf = (typeof TRENDLINE_MODEL_TFS)[number];
export type TrendlineReactionTf = (typeof TRENDLINE_REACTION_TFS)[number];

export type TrendlineType = (typeof TRENDLINE_TYPES)[number];
export type LineState = (typeof LINE_STATES)[number];
export type InvalidReason = (typeof TRENDLINE_INVALID_REASONS)[number];
export type PivotType = (typeof TRENDLINE_PIVOT_TYPES)[number];
export type StructureState = (typeof TRENDLINE_STRUCTURE_STATES)[number];
export type BestMatchKind = (typeof TRENDLINE_BEST_MATCH_KINDS)[number];
export type PoiCandidateReason =
  (typeof TRENDLINE_POI_CANDIDATE_REASONS)[number];
export type TrendlineLtfMicroRetestType =
  (typeof TRENDLINE_LTF_MICRO_RETEST_TYPES)[number];
export type TrendlineLtfTriggerToken =
  (typeof TRENDLINE_LTF_TRIGGER_TOKENS)[number];

export type TrendlineBar = Bar;

export interface Pivot {
  tf: TF;
  pivotType: PivotType;
  pivotTime: Timestamp;
  pivotPrice: Price;
  confirmedAt: Timestamp;
  isConfirmed: boolean;
}

export interface AtrSnapshot {
  tf: TF;
  time: Timestamp;
  atr14: number;
}

export interface Zone {
  bottom: Price;
  top: Price;
  height: number;
}

export interface StructureSnapshot {
  tf: TrendlineModelTf;
  time: Timestamp;
  state: StructureState;
  lastHighs: Pivot[];
  lastLows: Pivot[];
}

export interface BestMatch {
  kind: BestMatchKind;
  id?: string;
  distAtr?: number;
  meta?: string;
}

export interface TrendlineCollabEvalResult {
  tags: string[];
  bestMatch: BestMatch;
}

export interface TrendlineTouchEvalResult {
  tf: TrendlineModelTf;
  currentCloseTime: Timestamp;
  linePrice: Price;
  touchMargin: number;
  touched: boolean;
}

export interface TrendlineBreakEvalResult {
  tf: TrendlineModelTf;
  currentCloseTime: Timestamp;
  requiredCloses: number;
  atrAtBar: number;
  atrMultiplier: number;
  breakCount: number;
  linePrice: Price;
  closeDeviation: number;
  breakCandidate: boolean;
  breakConfirmed: boolean;
}

export interface TrendlineStaleEvalResult {
  currentCloseTime: Timestamp;
  displayUntil: Timestamp;
  staleExpired: boolean;
}

export interface TrendlineLtfTriggerEvalResult {
  tf: TrendlineReactionTf;
  dir: "BULL" | "BEAR";
  currentCloseTime: Timestamp;
  choch: boolean;
  sweepRec: boolean;
  microRetestTypes: TrendlineLtfMicroRetestType[];
  triggers: TrendlineLtfTriggerToken[];
}

export interface TrendlineLtfGateEvalResult {
  tf: TrendlineReactionTf;
  dir: "BULL" | "BEAR";
  currentCloseTime: Timestamp;
  boundaryPrice: Price;
  wickExtreme: Price;
  dist: number;
  atrAtBar: number;
  gateAtrMultiplier: number;
  passGate: boolean;
}

export interface RoleFlipWatch {
  startedAt: Timestamp;
  typeBefore: TrendlineType;
  touchSeen: boolean;
  touchTime?: Timestamp;
  barsSinceTouch: number;
}

export interface Trendline {
  id: string;
  symbol: string;
  tf: TrendlineModelTf;
  type: TrendlineType;
  state: LineState;

  a1Time: Timestamp;
  a1Price: Price;
  a2Time: Timestamp;
  a2Price: Price;

  createdAt: Timestamp;
  lastUpdatedAt?: Timestamp;

  touchCount: number;
  lastTouchTime?: Timestamp;

  breakStreak: number;
  lastBreakTime?: Timestamp;

  roleFlipWatch?: RoleFlipWatch;
  roleFlipCount: number;

  endTime?: Timestamp;
  invalidReason?: InvalidReason;

  tags: string[];
  bestMatch: BestMatch;

  maxForwardBars: number;
  displayUntil?: Timestamp;
}

export interface DailyCapCounter {
  key: string;
  count: number;
}

export interface TrendlinePoiCandidateEventInput {
  tf: "H1" | "M30";
  id: string;
  time: Timestamp;
  reason: PoiCandidateReason;
  touchCount: number;
}

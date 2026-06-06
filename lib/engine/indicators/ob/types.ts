import type { Bar } from "../../types";
import {
  OB_BOX_TYPES,
  OB_COLLAB_KINDS,
  OB_D1_STATES,
  OB_DIRS,
  OB_H4_STATES,
  OB_INVALID_REASONS,
  OB_LTF_MICRO_RETEST_TYPES,
  OB_LTF_TRIGGER_TOKENS,
  OB_PARENT_POI_TYPES,
  OB_PIVOT_TYPES,
  OB_SETUP_STATES,
  OB_STRUCTURE_STATES,
  OB_SWEEP_TARGET_TYPES,
  OB_TFS,
} from "./constants";

export type Timestamp = number;
export type Price = number;

export type ObTf = (typeof OB_TFS)[number];
export type Dir = (typeof OB_DIRS)[number];
export type BoxType = (typeof OB_BOX_TYPES)[number];
export type ParentPoiType = (typeof OB_PARENT_POI_TYPES)[number];
export type PivotType = (typeof OB_PIVOT_TYPES)[number];
export type StructureState = (typeof OB_STRUCTURE_STATES)[number];

export type D1PoiObState = (typeof OB_D1_STATES)[number];
export type H4CoreObState = (typeof OB_H4_STATES)[number];
export type SetupObState = (typeof OB_SETUP_STATES)[number];
export type InvalidReason = (typeof OB_INVALID_REASONS)[number];
export type SweepTargetType = (typeof OB_SWEEP_TARGET_TYPES)[number];
export type ObCollabKind = (typeof OB_COLLAB_KINDS)[number];
export type ObLtfMicroRetestType =
  (typeof OB_LTF_MICRO_RETEST_TYPES)[number];
export type ObLtfTriggerToken = (typeof OB_LTF_TRIGGER_TOKENS)[number];

export type ObBar = Bar;

export interface Zone {
  bottom: Price;
  top: Price;
  height: number;
}

export interface ObTickNormalizedZone {
  bottomTick: number;
  topTick: number;
  bottomNorm: number;
  topNorm: number;
}

export interface AtrSnapshot {
  tf: ObTf;
  time: Timestamp;
  atr14: number;
}

export interface ObDisplacementEvalResult {
  triggerIndex: number;
  triggerTime: Timestamp;
  atrAtTrigger: number;
  bodyMax: number;
  bodySum: number;
  passByMax: boolean;
  passBySum: boolean;
  passDisplacement: boolean;
}

export interface ObSweepRecoveryTarget {
  targetType: SweepTargetType;
  linePrice: Price;
  usedEqPair: boolean;
}

export interface ObSweepRecoveryEvalResult {
  hasTarget: boolean;
  targetType: SweepTargetType | null;
  linePrice: Price | null;
  usedEqPair: boolean;
  sweepBarTime?: Timestamp;
  recoveryBarTime?: Timestamp;
  passSweepRecovery: boolean;
}

export type ObContextSource = "CHANNEL" | "TRENDLINE" | "NONE";

export interface ObContextDistanceEvalResult {
  source: ObContextSource;
  distance: number | null;
  atrAtTrigger: number;
  passContextDist: boolean;
  passContextTight: boolean;
}

export interface ObLtfGateEvalResult {
  poiId: string;
  poiType: "D1_POI_OB" | "H4_CORE_OB" | "SETUP_OB";
  tf: "M15" | "M5";
  dir: Dir;
  barCloseTime: Timestamp;
  boundary: Price;
  priceExtreme: Price;
  dist: number;
  atrAtLtf: number;
  passGate: boolean;
}

export interface ObLtfTriggerEvalResult {
  tf: "M15" | "M5";
  dir: Dir;
  barCloseTime: Timestamp;
  choch: boolean;
  sweepRec: boolean;
  microRetestTypes: ObLtfMicroRetestType[];
  tokens: ObLtfTriggerToken[];
}

export interface ObTouchPenetrationEvalResult {
  overlapLen: number;
  penetrationMin: number;
  passTouchPenetration: boolean;
}

export interface ObInvalidationFlags {
  fullFillInvalidated: boolean;
  oppositeChochInvalidated: boolean;
  touchInvalidated: boolean;
  pruneInvalidated: boolean;
}

export interface ObInvalidationDecision {
  invalidated: boolean;
  invalidReason: InvalidReason | null;
}

export interface D1PoiObCandidateConfirmEvalResult {
  isDueTime: boolean;
  passSweepRecovery: boolean;
  passConfirm: boolean;
}

export interface H4CoreObCandidateConfirmEvalResult {
  isDueTime: boolean;
  passSweepRecovery: boolean;
  passConfirm: boolean;
}

export interface ObZoneHeightFilterEvalResult {
  tf: "D1" | "H4" | "H1" | "M30";
  zoneHeight: number;
  atrAtTrigger: number;
  minAllowed: number;
  maxAllowed: number;
  passMin: boolean;
  passMax: boolean;
  passHeightFilter: boolean;
}

export interface Pivot {
  tf: ObTf;
  pivotType: PivotType;
  pivotTime: Timestamp;
  pivotPrice: Price;
  confirmedAt: Timestamp;
  isConfirmed: boolean;
}

export interface StructureSnapshot {
  tf: ObTf;
  time: Timestamp;
  state: StructureState;
  lastPivotHigh?: Pivot;
  lastPivotLow?: Pivot;
}

export interface DetectedObZoneCandidate {
  triggerIndex: number;
  obCandleIndex: number;
  triggerTime: Timestamp;
  obCandleTime: Timestamp;
  dir: Dir;
  zone: Zone;
}

export interface ObCollabBestMatch {
  kind: ObCollabKind;
  targetId: string;
  ratioOrDist: number;
  tag: string;
}

export interface ObFvgCollabEvalResult {
  tags: string[];
  bestCollab?: ObCollabBestMatch;
}

export interface ObBoxBase {
  id: string;
  symbol: string;
  type: BoxType;
  tf: ObTf;
  dir: Dir;
  zone: Zone;
  triggerTime: Timestamp;
  createdAt: Timestamp;
  state: string;
  maxForwardBars: number;
  displayUntil?: Timestamp;
  confirmDueTime?: Timestamp;
  atrAtTrigger: number;
  passHeightFilter: boolean;
  passDisplacement: boolean;
  passSweepRecovery: boolean;
  passContextDist: boolean;
  sweepTargetType?: SweepTargetType;
  sweepTargetPrice?: Price;
  sweepTime?: Timestamp;
  recoveryTime?: Timestamp;
  touchCount: number;
  lastTouchTime?: Timestamp;
  fullFillHit: boolean;
  fullFillTime?: Timestamp;
  endTime?: Timestamp;
  invalidReason?: InvalidReason;
  tags: string[];
  bestCollab?: ObCollabBestMatch;
  lastReaction15mAt?: Timestamp;
  lastEntry5mAt?: Timestamp;
}

export interface D1PoiOb extends ObBoxBase {
  type: "D1_POI_OB";
  tf: "D1";
  state: D1PoiObState;
}

export interface H4CoreOb extends ObBoxBase {
  type: "H4_CORE_OB";
  tf: "H4";
  state: H4CoreObState;
}

export interface SetupOb extends ObBoxBase {
  type: "SETUP_OB";
  tf: "H1" | "M30";
  state: SetupObState;
  parentPoiId: string;
  parentPoiType: ParentPoiType;
  insideOverlapLen: number;
  insideOverlapRatio: number;
  passInside: boolean;
  passDirectionAlign: boolean;
  h4StructureAtConf: StructureState;
  hasH4MixedRiskTag: boolean;
  localOppChochAfterTouchOnly: boolean;
}

export interface ReactionGate {
  key: string;
  symbol: string;
  poiId: string;
  dir: Dir;
  last15mReactionAt?: Timestamp;
  last5mEntryAt?: Timestamp;
  block5mUntil?: Timestamp;
  blockAllUntil?: Timestamp;
}

export type AnyObBox = D1PoiOb | H4CoreOb | SetupOb;

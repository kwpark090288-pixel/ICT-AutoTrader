import type { Bar } from "../../types";
import type { RouterRawPoi } from "../../../router/raw-event";
import {
  FVG_ACTIVE_INACTIVE_STATES,
  FVG_BOX_TYPES,
  FVG_DIRS,
  FVG_H4_CORE_STATES,
  FVG_INVALID_REASONS,
  FVG_MICRO_RETEST_TYPES,
  FVG_PARENT_POI_TYPES,
  FVG_PIVOT_TYPES,
  FVG_STACK_STATES,
  FVG_STRUCTURE_BREAK_TYPES,
  FVG_STRUCTURE_STATES,
  FVG_TFS,
  FVG_TRIGGER_TOKENS,
} from "./constants";

export type Timestamp = number;
export type Price = number;

export type FvgTf = (typeof FVG_TFS)[number];
export type Dir = (typeof FVG_DIRS)[number];
export type BoxType = (typeof FVG_BOX_TYPES)[number];
export type ParentPoiType = (typeof FVG_PARENT_POI_TYPES)[number];
export type PivotType = (typeof FVG_PIVOT_TYPES)[number];
export type StructureState = (typeof FVG_STRUCTURE_STATES)[number];
export type StructureBreakType = (typeof FVG_STRUCTURE_BREAK_TYPES)[number];

export type ActiveInactiveState = (typeof FVG_ACTIVE_INACTIVE_STATES)[number];
export type H4CoreState = (typeof FVG_H4_CORE_STATES)[number];
export type StackState = (typeof FVG_STACK_STATES)[number];
export type InvalidReason = (typeof FVG_INVALID_REASONS)[number];

export type MicroRetestType = (typeof FVG_MICRO_RETEST_TYPES)[number];
export type ReactionTriggerToken = (typeof FVG_TRIGGER_TOKENS)[number];

export type FvgBar = Bar;

export interface Zone {
  bottom: Price;
  top: Price;
  height: number;
}

export interface AtrSnapshot {
  tf: FvgTf;
  time: Timestamp;
  atr14: number;
}

export interface Pivot {
  tf: FvgTf;
  pivotType: PivotType;
  pivotTime: Timestamp;
  pivotPrice: Price;
  confirmedAt: Timestamp;
  isConfirmed: boolean;
}

export interface StructureSnapshot {
  tf: FvgTf;
  time: Timestamp;
  state: StructureState;
  lastPivotHigh?: Pivot;
  lastPivotLow?: Pivot;
}

export interface StructureEvalResult {
  structureReady: boolean;
  prevState: StructureState;
  nextState: StructureState;
  breakType: StructureBreakType | null;
}

export interface FvgBoxBase<TType extends BoxType, TState extends string> {
  id: string;
  symbol: string;
  type: TType;
  tf: FvgTf;
  dir: Dir;
  zone: Zone;
  confTime: Timestamp;
  createdAt: Timestamp;
  state: TState;
  maxForwardBars: number;
  displayUntil: Timestamp;
  endTime?: Timestamp;
  invalidReason?: InvalidReason;
  touchCount: number;
  lastTouchTime?: Timestamp;
  fullFillHit: boolean;
  fullFillTime?: Timestamp;
  lastReaction15mAt?: Timestamp;
  lastEntry5mAt?: Timestamp;
}

export interface D1PoiFvg
  extends FvgBoxBase<"D1_POI_FVG", ActiveInactiveState> {
  atrAtConf: number;
  structureAtConf: StructureState;
  passDisplacement: boolean;
  passMixedStrongDisp: boolean;
}

export interface H4CoreFvg extends FvgBoxBase<"H4_CORE_FVG", H4CoreState> {
  atrAtConf: number;
  confirmDueTime: Timestamp;
  passF1: boolean;
  passF2: boolean;
  passF3: boolean;
  passF4: boolean;
}

export interface SetupFvg
  extends FvgBoxBase<"SETUP_FVG", ActiveInactiveState> {
  atrAtConf: number;
  parentPoiId: string;
  parentPoiType: ParentPoiType;
  supportingParentIds?: string[];
  tags?: string[];
  insideOverlapLen: number;
  insideOverlapRatio: number;
  passInside: boolean;
  passDirectionAlign: boolean;
  h4StructureAtConf: StructureState;
  passH4StructureFilter: boolean;
  passDisplacement: boolean;
}

export interface StackZone extends FvgBoxBase<"STACK_ZONE", StackState> {
  aId: string;
  bId: string;
  aTf: FvgTf;
  bTf: FvgTf;
  overlapLen: number;
  overlapRatio: number;
  passStack: boolean;
}

export interface ReactionGate {
  key: string;
  last15mReactionAt?: Timestamp;
  last5mEntryAt?: Timestamp;
  block5mUntil?: Timestamp;
  blockAllUntil?: Timestamp;
}

export interface DetectedWickFvg {
  tf: FvgTf;
  dir: Dir;
  leftCloseTime: Timestamp;
  middleCloseTime: Timestamp;
  rightCloseTime: Timestamp;
  confTime: Timestamp;
  atrAtConf: number;
  zone: Zone;
}

export interface DisplacementEvalResult {
  confTime: Timestamp;
  atrAtConf: number;
  bodyMax: number;
  bodySum: number;
  passByMax: boolean;
  passBySum: boolean;
  passDisplacement: boolean;
}

export type SweepRecoveryTargetType =
  | "EQH"
  | "EQL"
  | "SWING_HIGH"
  | "SWING_LOW";

export interface SweepRecoveryTarget {
  targetType: SweepRecoveryTargetType;
  linePrice: Price;
  usedEqPair: boolean;
}

export interface SweepRecoveryEvalResult {
  hasTarget: boolean;
  targetType: SweepRecoveryTargetType | null;
  linePrice: Price | null;
  usedEqPair: boolean;
  sweepBarTime?: Timestamp;
  recoveryBarTime?: Timestamp;
  passSweepRecovery: boolean;
}

export type F4ContextSource = "NONE" | "PROVIDER" | "SNAPSHOT";

export type F4ProviderKind = "CHANNEL" | "TRENDLINE";

export interface F4ContextInput {
  symbol: string;
  dir: Dir;
  confTime: Timestamp;
  candidateId: string;
  candidateZone: {
    bottomRaw: number;
    topRaw: number;
    heightRaw: number;
  };
  atr4hAtConf: number;
  getPublishedSnapshot?: (
    tf: "H4" | "D1",
    atOrBefore: Timestamp
  ) => readonly RouterRawPoi[];
}

export interface F4ContextEvalResult {
  source: F4ContextSource;
  passF4: boolean;
  providerKind?: F4ProviderKind | null;
  providerId?: string | null;
  distanceAtr?: number | null;
}

export interface D1MixedStrongDisplacementEvalResult {
  confTime: Timestamp;
  atrAtConf: number;
  bodyMax: number;
  bodySum: number;
  passByMax: boolean;
  passBySum: boolean;
  passMixedStrongDisp: boolean;
}

export interface D1PoiRegistrationEvalResult {
  canRegister: boolean;
  passZoneHeight: boolean;
  passDisplacement: boolean;
  structureAtConf: StructureState;
  passStructureRule: boolean;
  passMixedStrongDisp: boolean;
}

export interface FvgInvalidationFlags {
  fullFillInvalidated: boolean;
  oppositeChochInvalidated: boolean;
  pruneInvalidated: boolean;
  touchInvalidated: boolean;
}

export interface FvgInvalidationDecision {
  invalidated: boolean;
  invalidReason: InvalidReason | null;
}

export interface TouchPenetrationEvalResult {
  overlapLen: number;
  penetrationMin: number;
  passTouchPenetration: boolean;
}

export interface TickNormalizedZone {
  bottomTick: number;
  topTick: number;
  bottomNorm: number;
  topNorm: number;
}

export interface LtfGateEvalResult {
  poiId: string;
  poiType: "D1_POI_FVG" | "H4_CORE_FVG" | "SETUP_FVG";
  tf: "M15" | "M5";
  dir: Dir;
  barCloseTime: Timestamp;
  boundary: Price;
  priceExtreme: Price;
  dist: number;
  atrAtLtf: number;
  passGate: boolean;
}

export interface LtfTriggerEvalResult {
  tf: "M15" | "M5";
  dir: Dir;
  barCloseTime: Timestamp;
  choch: boolean;
  sweepRec: boolean;
  microRetestTypes: MicroRetestType[];
  tokens: ReactionTriggerToken[];
}

export interface ReactionGateEvalResult {
  tf: "M15" | "M5";
  currentCloseTime: Timestamp;
  blockedAll: boolean;
  blockedBy5mCooldown: boolean;
  reactionBlocked: boolean;
  entryBlocked: boolean;
}

export interface D1PoiInvalidationFlags extends FvgInvalidationFlags {}

export interface H4CandidateConfirmEvalResult {
  isDueTime: boolean;
  passF1: boolean;
  secondaryPassCount: number;
  passConfirm: boolean;
}

export type AnyFvgBox = D1PoiFvg | H4CoreFvg | SetupFvg | StackZone;
export type AnyFvgState = ActiveInactiveState | H4CoreState | StackState;

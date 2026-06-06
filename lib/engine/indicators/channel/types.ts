import type { Bar } from "../../types";
import {
  CHANNEL_DIRECTIONS,
  CHANNEL_DIRS,
  CHANNEL_GATE_ONLY_TFS,
  CHANNEL_INVALID_REASONS,
  CHANNEL_MODES,
  CHANNEL_MODEL_TFS,
  CHANNEL_POI_STATES,
  CHANNEL_POI_TRIGGERS,
  CHANNEL_PIVOT_TYPES,
  CHANNEL_STATES,
  CHANNEL_TFS,
  CHANNEL_TYPES,
} from "./constants";

export type Timestamp = number;
export type Price = number;

export type ChannelTf = (typeof CHANNEL_TFS)[number];
export type ChannelModelTf = (typeof CHANNEL_MODEL_TFS)[number];
export type ChannelGateOnlyTf = (typeof CHANNEL_GATE_ONLY_TFS)[number];
export type Dir = (typeof CHANNEL_DIRS)[number];
export type ChannelDir = (typeof CHANNEL_DIRECTIONS)[number];
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type ChannelState = (typeof CHANNEL_STATES)[number];
export type ChannelMode = (typeof CHANNEL_MODES)[number];
export type ChannelInvalidReason = (typeof CHANNEL_INVALID_REASONS)[number];
export type ChannelPoiState = (typeof CHANNEL_POI_STATES)[number];
export type PoiTrigger = (typeof CHANNEL_POI_TRIGGERS)[number];
export type PivotType = (typeof CHANNEL_PIVOT_TYPES)[number];
export type StructureState = "UP" | "DOWN" | "MIXED";
export type StructureBreakType = "BOS" | "CHOCH";
export type ChannelPoiParentRelation = "INSIDE" | "NEAR";

export type ChannelBar = Bar;

export interface AtrSnapshot {
  tf: ChannelTf;
  time: Timestamp;
  atr14: number;
}

export interface Zone {
  bottom: Price;
  top: Price;
  height: number;
}

export interface Pivot {
  tf: ChannelTf;
  pivotType: PivotType;
  pivotTime: Timestamp;
  pivotPrice: Price;
  confirmedAt: Timestamp;
  isConfirmed: boolean;
}

export interface AnchorPoint {
  time: Timestamp;
  price: Price;
}

export interface Line2P {
  a: AnchorPoint;
  b: AnchorPoint;
  slope: number;
  intercept: number;
}

export interface ChannelGeometry {
  dir: ChannelDir;
  anchorLine: Line2P;
  offset: number;
  midOffset: number;
}

export interface ChannelBoundaryInvalidEvalResult {
  tf: ChannelModelTf;
  currentCloseTime: Timestamp;
  requiredConsecutiveCloses: number;
  atrAtBar: number;
  atrMultiplier: number;
  closeCount: number;
  boundaryPrice: Price;
  closeDeviation: number;
  pass: boolean;
}

export interface ChannelLifecycleInvalidationEvalResult {
  ttlExpired: boolean;
  parentPoiEnded: boolean;
  invalidated: boolean;
  invalidReason: ChannelInvalidReason | null;
}

export interface ChannelPoiDayCapEvalResult {
  tf: "H1" | "M30";
  dayKeyUtc: string;
  capKey: string;
  currentCount: number;
  limit: number;
  allowed: boolean;
}

export interface ChannelResidualOffsetEvalResult {
  tf: ChannelModelTf;
  percentile: number;
  positiveResidualCount: number;
  offset: number | null;
  enoughSamples: boolean;
}

export interface ChannelPoiGateEvalResult {
  tf: ChannelModelTf;
  dir: Dir;
  currentCloseTime: Timestamp;
  boundaryPrice: Price;
  wickExtreme: Price;
  dist: number;
  atrAtBar: number;
  gateAtrMultiplier: number;
  passGate: boolean;
}

export interface ChannelParentPoiContext {
  id: string;
  boundaryPrice: Price;
  zone: Zone;
}

export interface ChannelParentNearInsideEvalResult {
  near: boolean;
  inside: boolean;
  pass: boolean;
}

export interface ChannelDispTriggerEvalResult {
  tf: ChannelModelTf;
  currentCloseTime: Timestamp;
  atrAtBar: number;
  bodyMax: number;
  bodySum: number;
  passByMax: boolean;
  passBySum: boolean;
  passDisp: boolean;
}

export interface ChannelPoiTriggerEvalResult {
  tf: ChannelModelTf;
  dir: Dir;
  currentCloseTime: Timestamp;
  sweepRec: boolean;
  structure: boolean;
  disp: boolean;
  triggers: PoiTrigger[];
}

export interface ChannelModel {
  id: string;
  symbol: string;
  type: ChannelType;
  tf: ChannelModelTf;
  state: ChannelState;
  mode: ChannelMode;
  geometry?: ChannelGeometry;
  anchorStartTime?: Timestamp;
  anchorEndTime?: Timestamp;
  createdAt: Timestamp;
  lastUpdatedAt: Timestamp;
  maxForwardBars: number;
  displayUntil?: Timestamp;
  endTime?: Timestamp;
  invalidReason?: ChannelInvalidReason;
  ttlBars?: number;
  ttlStartTime?: Timestamp;
  referencedParentIds?: string[];
}

export interface ChannelPoi {
  id: string;
  symbol: string;
  tf: ChannelModelTf;
  dir: Dir;
  createdAt: Timestamp;
  boundaryPrice: Price;
  triggers: PoiTrigger[];
  state: ChannelPoiState;
  parentRelation?: ChannelPoiParentRelation;
  endTime?: Timestamp;
  invalidReason?: ChannelInvalidReason | "expired_forward";
  dayKeyUtc?: string;
}

// lib/engine/types.ts
export type TF = "D1" | "H4" | "H1" | "M30" | "M15" | "M5";
export type DIR = "BULL" | "BEAR";

export type Timestamp = number; // ms epoch
export type Price = number;

export type BoxType = "D1_POI_FVG" | "H4_CORE_FVG" | "SETUP_FVG" | "STACK_ZONE";

export type InvalidReason =
  | "full_fill"
  | "opposite_choch"
  | "touch_3"
  | "pruned_by_limit"
  | "failed_confirm";

export interface Zone {
  bottom: Price;   // lower
  top: Price;      // higher
  height: number;  // top - bottom
}

export interface Bar {
  tf: TF;
  openTime: Timestamp;
  closeTime: Timestamp;
  open: Price;
  high: Price;
  low: Price;
  close: Price;
  volume: number;
}

export interface AtrSnapshot {
  tf: TF;
  time: Timestamp; // 기준 closeTime(ms)
  atr14: number;
}

export type PivotType = "HIGH" | "LOW";
export type StructureState = "UP" | "DOWN" | "MIXED";

export interface Pivot {
  tf: TF;
  pivotType: PivotType;
  pivotTime: Timestamp;     // pivot 기준봉 closeTime
  pivotPrice: Price;
  confirmedAt: Timestamp;   // pivotTime 이후 +3봉 closeTime
  isConfirmed: boolean;     // confirmedAt <= nowCloseTime
}

export interface StructureSnapshot {
  tf: TF;
  time: Timestamp;          // 해당 TF closeTime
  state: StructureState;
  lastPivotHigh?: Pivot;
  lastPivotLow?: Pivot;
}


export const FVG_TFS = ["D1", "H4", "H1", "M30", "M15", "M5"] as const;
export const FVG_CONTEXT_TFS = ["D1", "H4"] as const;
export const FVG_SETUP_TFS = ["H1", "M30"] as const;
export const FVG_REACTION_TFS = ["M15", "M5"] as const;
export const FVG_DETECT_TFS = ["D1", "H4", "H1", "M30"] as const;

export const FVG_DIRS = ["BULL", "BEAR"] as const;

export const FVG_BOX_TYPES = [
  "D1_POI_FVG",
  "H4_CORE_FVG",
  "SETUP_FVG",
  "STACK_ZONE",
] as const;

export const FVG_PARENT_POI_TYPES = ["D1_POI_FVG", "H4_CORE_FVG"] as const;

export const FVG_PIVOT_TYPES = ["HIGH", "LOW"] as const;
export const FVG_STRUCTURE_STATES = ["UP", "DOWN", "MIXED"] as const;
export const FVG_STRUCTURE_BREAK_TYPES = ["BOS", "CHOCH"] as const;

export const FVG_ACTIVE_INACTIVE_STATES = ["ACTIVE", "INACTIVE"] as const;
export const FVG_H4_CORE_STATES = [
  "CANDIDATE",
  "A_ACTIVE",
  "INACTIVE",
  "DELETED",
] as const;
export const FVG_STACK_STATES = ["ACTIVE", "INACTIVE"] as const;

export const FVG_INVALID_REASONS = [
  "full_fill",
  "opposite_choch",
  "touch_3",
  "pruned_by_limit",
  "failed_confirm",
] as const;

export const FVG_MICRO_RETEST_TYPES = [
  "MR_FVG_BOUNDARY",
  "MR_MICRO_OB",
  "MR_MICRO_FVG",
] as const;

export const FVG_TRIGGER_TOKENS = [
  "SWEEP_REC",
  "CHOCH",
  "MR_FVG_BOUNDARY",
  "MR_MICRO_OB",
  "MR_MICRO_FVG",
] as const;

export const FVG_ATR_PERIOD = 14;
export const FVG_WICK_CANDLE_COUNT = 3;
export const FVG_PIVOT_LEN = 3;

export const MAX_FORWARD_BARS = 300;
export const MIN_ZONE_HEIGHT_ATR = 0.15;

export const PENETRATION_ATR = 0.10;
export const PENETRATION_ZONE = 0.25;

export const INSIDE_OVERLAP_RATIO = 0.20;
export const STACK_OVERLAP_RATIO = 0.30;
export const LTF_GATE_ATR = 0.20;
export const EQH_EQL_ATR_RATIO = 0.10;

export const DISPLACEMENT_BODY_MAX_ATR = 1.0;
export const DISPLACEMENT_BODY_SUM_ATR = 1.8;

export const D1_MIXED_STRONG_DISP_BODY_MAX_ATR = 1.5;
export const D1_MIXED_STRONG_DISP_BODY_SUM_ATR = 2.4;

export const H4_CONFIRM_DELAY_BARS = 3;
export const H4_F2_F3_RANGE_BARS = 3;

export const TICK_EPSILON_FACTOR = 1e-6;
export const STACK_RATIO_DISPLAY_DECIMALS = 2;

export const COOLDOWN_AFTER_15M_REACTION_MIN = 30;
export const COOLDOWN_AFTER_5M_ENTRY_MIN = 60;

export const MAX_ACTIVE_D1 = 3;
export const MAX_ACTIVE_H4_POOL = 10;
export const MAX_ACTIVE_H1_SETUP = 6;
export const MAX_ACTIVE_M30_SETUP = 6;

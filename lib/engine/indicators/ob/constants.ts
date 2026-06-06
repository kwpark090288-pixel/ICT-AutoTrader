export const OB_TFS = ["D1", "H4", "H1", "M30", "M15", "M5"] as const;
export const OB_POI_TFS = ["D1", "H4"] as const;
export const OB_SETUP_TFS = ["H1", "M30"] as const;
export const OB_REACTION_TFS = ["M15", "M5"] as const;
export const OB_DETECT_TFS = ["D1", "H4", "H1", "M30"] as const;

export const OB_DIRS = ["BULL", "BEAR"] as const;

export const OB_BOX_TYPES = [
  "D1_POI_OB",
  "H4_CORE_OB",
  "SETUP_OB",
  "OB_COLLAB_TAG",
] as const;

export const OB_PARENT_POI_TYPES = ["D1_POI_OB", "H4_CORE_OB"] as const;

export const OB_PIVOT_TYPES = ["HIGH", "LOW"] as const;
export const OB_STRUCTURE_STATES = ["UP", "DOWN", "MIXED"] as const;

export const OB_D1_STATES = [
  "CANDIDATE",
  "ACTIVE",
  "INACTIVE",
  "DELETED",
] as const;

export const OB_H4_STATES = [
  "CANDIDATE",
  "POI_ACTIVE",
  "INACTIVE",
  "DELETED",
] as const;

export const OB_SETUP_STATES = ["ACTIVE", "INACTIVE"] as const;

export const OB_INVALID_REASONS = [
  "full_fill",
  "opposite_choch",
  "touch_3",
  "pruned_by_limit",
  "failed_confirm",
] as const;

export const OB_SWEEP_TARGET_TYPES = [
  "EQH",
  "EQL",
  "SWING_HIGH",
  "SWING_LOW",
] as const;

export const OB_COLLAB_KINDS = ["OB∩FVG", "OB∩CONTEXT"] as const;

export const OB_LTF_TRIGGER_TOKENS = [
  "CHOCH",
  "MR_MICRO_FVG",
  "MR_MICRO_OB",
  "SWEEP_REC",
] as const;

export const OB_LTF_MICRO_RETEST_TYPES = [
  "MR_MICRO_FVG",
  "MR_MICRO_OB",
] as const;

export const LTF_MICRO_PIVOT_LEN = 2;
export const LTF_SWEEP_RECOVERY_MAX_BARS = 2;
export const MICRO_OB_LOOKBACK_BARS = 6;
export const MICRO_FVG_MIN_ZONE_HEIGHT_ATR = 0.15;

export const MAX_FORWARD_BARS = 300;

export const MIN_OB_HEIGHT_ATR = 0.10;
export const MAX_OB_HEIGHT_ATR_D1 = 2.0;
export const MAX_OB_HEIGHT_ATR_H4 = 1.5;
export const MAX_OB_HEIGHT_ATR_SETUP = 1.0;

export const DISP_BODY_MAX_ATR = 1.0;
export const DISP_BODY_SUM_ATR = 1.8;
export const DISP_RANGE_BARS = 3;

export const SWEEP_WINDOW_BARS = 8;
export const EQ_BAND_ATR = 0.10;

export const CONTEXT_DIST_ATR = 0.25;
export const CONTEXT_TIGHT_ATR = 0.10;

export const PENETRATION_ATR = 0.10;
export const PENETRATION_ZONE = 0.25;
export const MAX_TOUCH_VALID = 2;

export const INSIDE_OVERLAP_RATIO = 0.20;

export const LTF_GATE_ATR = 0.20;

export const COOLDOWN_AFTER_15M_REACTION_MIN = 30;
export const COOLDOWN_AFTER_5M_ENTRY_MIN = 60;

export const MAX_ACTIVE_D1_POI_OB = 3;
export const MAX_ACTIVE_H4_OB_POOL = 10;
export const MAX_ACTIVE_H1_SETUP_OB = 6;
export const MAX_ACTIVE_M30_SETUP_OB = 6;

export const TICK_EPSILON_FACTOR = 1e-6;
export const OB_RATIO_DISPLAY_DECIMALS = 2;

export const POLICY_SOURCES = [
  "FVG",
  "OB",
  "CHANNEL",
  "TRENDLINE",
] as const;

export const POLICY_EVENT_TYPES = [
  "REACTION",
  "ENTRY_WINDOW_OPEN",
] as const;

export const POLICY_DIRS = ["BULL", "BEAR"] as const;

export const POLICY_POI_TIERS = [
  "D1_POI",
  "H4_CORE",
  "SETUP",
  "OTHER",
] as const;

export const POLICY_DECISIONS = ["ALLOW", "BLOCK"] as const;

export const POLICY_RISK_MODES = [
  "NORMAL",
  "L1",
  "L2",
  "HALT",
] as const;

export const POLICY_REGIME_STATES = [
  "OK",
  "CAUTION",
  "TRANSITION",
  "HALT",
] as const;

export const POLICY_VOL_STATES = [
  "LOW",
  "NORMAL",
  "HIGH",
] as const;

export const POLICY_LIQUIDITY_STATES = [
  "NORMAL",
  "LOW",
] as const;

export const POLICY_REGIME_BUCKETS = [
  "OK",
  "TRANSITION",
  "CAUTION",
] as const;

export const POLICY_DATA_STATES = [
  "OK",
  "BACKFILLING",
  "GAP_DETECTED",
] as const;

export const POLICY_EVIDENCE_LEVELS = [
  "FINE",
  "MID",
  "COARSE",
  "NO_EVIDENCE",
] as const;

export const POLICY_USED_SIGNATURES = [
  "FINE",
  "MID",
  "COARSE",
  "NONE",
] as const;

export const POLICY_COLLAB_STRENGTHS = [
  "NONE",
  "WEAK",
  "STRONG",
] as const;

export const POLICY_REWARD_PROXIES = [
  "HIGH",
  "MID",
  "LOW",
] as const;

export const POLICY_BASE_TF = "M5" as const;

export const W_LONG_BARS = 2016;
export const W_SHORT_BARS = 288;

export const WINDOW_CONC_15M_MIN = 15;
export const WINDOW_PNL_ROLLING_HOURS = 24;

export const SC_BLOCK = 3.0;
export const SC_PENALTY_1 = 4.0;
export const SC_PENALTY_2 = 5.0;
export const SC_MARGINAL_PENALTY = -15;
export const SC_OK_PENALTY = -5;

export const FEE_BPS_ROUNDTRIP_DEFAULT = 8.0;
export const SLIPPAGE_BPS_FLOOR = 1.0;

export const SPREAD_HALT_BPS = 50;
export const SPREAD_CAUTION_BPS = 20;
export const VOL_Q_LOW = 0.2;
export const VOL_Q_HIGH = 0.8;
export const VOLSHIFT_RATIO_TH = 1.5;
export const VOLSHIFT_SHORT_Q = 0.95;
export const LIQUIDITY_Q_LOW = 0.2;
export const FAST_MOVE_BARCHANGE_ATR_RATIO = 0.3;

export const SPREAD_CAUTION_PENALTY = -5;
export const LIQUIDITY_LOW_PENALTY = -10;
export const REGIME_CAUTION_PENALTY = -10;
export const REGIME_TRANSITION_PENALTY = -20;

export const STOP_BUFFER_TICKS_MIN = 2;
export const STOP_BUFFER_ATR_LOW = 0.08;
export const STOP_BUFFER_ATR_NORMAL = 0.1;
export const STOP_BUFFER_ATR_HIGH = 0.15;

export const POI_CLUSTER_STEP_BPS = 10;

export const MAX_UNIQUE_CLUSTERS_15M_PER_DIR = 5;
export const CONC_OVERRIDE_PENALTY = -30;
export const CONC_DUPLICATE_PENALTY = -10;

export const EDGE_MIN_SAMPLES = 30;
export const LCB_Z = 1.28;

export const EDGE_NO_EVIDENCE_PENALTY = -5;
export const EDGE_COLDSTART_EXTRA_PENALTY = -10;
export const EDGE_LCB_NEG_PENALTY = -35;
export const EDGE_LCB_NEG_BLOCK_SC = 4.5;

export const KELLY_DEFAULT_ENABLED = false;
export const KELLY_ENABLE_MIN_SAMPLES = 100;
export const KELLY_HALF = 0.5;
export const KELLY_MAX_MULT = 1.0;

export const REWARDPROXY_HIGH_SC = 5.0;
export const REWARDPROXY_MID_SC = 4.0;

export const RISK_PCT_NORMAL = 0.01;
export const RISK_PCT_L1 = 0.006;
export const RISK_PCT_L2 = 0.003;
export const RISK_PCT_HALT = 0.0;

export const PORTFOLIO_CAP_NORMAL = 0.020;
export const PORTFOLIO_CAP_L1 = 0.012;
export const PORTFOLIO_CAP_L2 = 0.006;
export const PORTFOLIO_CAP_HALT = 0.000;

export const HALT_ENTER_PNL_24H = -2.0;
export const HALT_EXIT_PNL_24H = -1.8;

export const CONSEC_LOSS_L1 = 3;
export const CONSEC_LOSS_L2 = 5;

export const MIN_RECOVERY_R_L1 = 0.30;
export const MIN_RECOVERY_R_L2_SUM2WINS = 0.40;

export const RISK_L1_PENALTY = -15;
export const RISK_L2_PENALTY = -25;

export const RR_PENALTY_LT_1_0 = -15;
export const RR_PENALTY_LT_1_2 = -8;

export const REWARDPROXY_LOW_PENALTY = -10;
export const REWARDPROXY_MID_PENALTY = -5;
export const REWARDPROXY_HIGH_PENALTY = 0;


import {
  POLICY_COLLAB_STRENGTHS,
  POLICY_DATA_STATES,
  POLICY_DECISIONS,
  POLICY_DIRS,
  POLICY_EVIDENCE_LEVELS,
  POLICY_EVENT_TYPES,
  POLICY_LIQUIDITY_STATES,
  POLICY_POI_TIERS,
  POLICY_REGIME_BUCKETS,
  POLICY_REGIME_STATES,
  POLICY_REWARD_PROXIES,
  POLICY_RISK_MODES,
  POLICY_SOURCES,
  POLICY_USED_SIGNATURES,
  POLICY_VOL_STATES,
} from "./constants";

export type PolicySource = (typeof POLICY_SOURCES)[number];
export type PolicyEventType = (typeof POLICY_EVENT_TYPES)[number];
export type PolicyDir = (typeof POLICY_DIRS)[number];
export type PolicyPoiTier = (typeof POLICY_POI_TIERS)[number];
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];
export type PolicyRiskMode = (typeof POLICY_RISK_MODES)[number];
export type PolicyRegimeState = (typeof POLICY_REGIME_STATES)[number];
export type PolicyVolState = (typeof POLICY_VOL_STATES)[number];
export type PolicyLiquidityState = (typeof POLICY_LIQUIDITY_STATES)[number];
export type PolicyDataState = (typeof POLICY_DATA_STATES)[number];
export type PolicyRegimeBucket = (typeof POLICY_REGIME_BUCKETS)[number];
export type PolicyEvidenceLevel = (typeof POLICY_EVIDENCE_LEVELS)[number];
export type PolicyUsedSignature = (typeof POLICY_USED_SIGNATURES)[number];
export type PolicyCollabStrength = (typeof POLICY_COLLAB_STRENGTHS)[number];
export type PolicyRewardProxy = (typeof POLICY_REWARD_PROXIES)[number];
export type PolicyDataReason =
  | "OK"
  | "STALE_BBO"
  | "M5_NOT_READY"
  | "GAP_SYNCING"
  | "BOOTSTRAP_WARMING"
  | "UNKNOWN";

export interface SignalCandidate {
  candidateId?: string;
  tradeKey?: string;
  symbol: string;
  time: string;
  source: PolicySource;
  eventType: PolicyEventType;
  dir: PolicyDir;
  ltf?: "M5" | "M15";
  poiTier: PolicyPoiTier;
  poiId: string;

  entryBoundaryPrice: number;
  hardInvalidationPrice: number;
  lastPrice: number;
  midPrice: number;
  tickSize: number;

  ltAtr14: number;

  triggerCount?: 0 | 1 | 2 | 3;
  collabStrength?: PolicyCollabStrength;
  hasStack?: boolean;
  tags?: string[];
  triggers?: string[];
  triggersStr?: string;
  poiTags?: string[];
  rawEvent?: string;
  poiSnapshot?: unknown;
  barSnapshot?: {
    close: number;
    high: number;
    low: number;
  };

  expectedRR?: number | null;
  tpRefPrice?: number | null;
}

export interface MarketSnapshot {
  time: string;
  symbol: string;

  bid: number | null;
  ask: number | null;
  last: number;
  mid: number;

  atr14_price: number | null;
  atr14_bps: number | null;
  volume_m5: number | null;
  barChange_bps_m5: number | null;

  dataOk: boolean;
  dataReason?: PolicyDataReason;
  dataState?: PolicyDataState;
  dataGapBars?: number;
  dataGapFromTime?: string;
}

export interface AccountSnapshot {
  time: string;
  equity: number;
  riskMode: PolicyRiskMode;
  realizedPnl_24h_pct: number;
  consecutiveLosses: number;

  openRiskPct?: number;
  signalsSent_60m?: number;
  accountMode?: "ALERT_ONLY" | "LIVE_RISK";
  accountDataQuality?: "STATIC" | "LIVE";
}

export interface DerivedValues {
  spread_bps: number;
  fee_bps_roundtrip: number;
  slippage_bps_p95_est: number;
  slippage_multiplier: number;
  c_bps_roundtrip: number;

  entryRefPrice: number;
  s_raw_bps: number;
  stopBuffer_price: number;
  stopBuffer_bps: number;
  s_effective_bps: number;
  SC: number;

  fastMove: boolean;
  atrRatio: number;
  q95_short: number;

  regimeState: PolicyRegimeState;
  volState: PolicyVolState;
  liquidityState: PolicyLiquidityState;

  poiClusterKey: string;

  evidenceLevel: PolicyEvidenceLevel;
  usedSignature: PolicyUsedSignature;
  lcbR: number | null;

  reward_bps: number | null;
  expectedRR_used: number | null;
  rewardProxy: PolicyRewardProxy;

  isExceptional: boolean;
}

export interface PolicyResult {
  decision: PolicyDecision;
  policyScoreDeltaSum: number;
  policyTags: string[];
  reasons: string[];
  riskMode: PolicyRiskMode;
  suggestedRiskPct: number;
  derived: DerivedValues;
}

export interface RegimeGateEvalResult {
  decision: PolicyDecision;
  scoreDelta: number;
  tags: string[];
  reasons: string[];
  regimeState: PolicyRegimeState;
  volState: PolicyVolState;
  liquidityState: PolicyLiquidityState;
  atrRatio: number;
  q95Short: number;
}

export interface CostGateEvalResult {
  decision: PolicyDecision;
  sc: number;
  scoreDelta: number;
  tags: string[];
  reasons: string[];
}

export interface DataIntegrityGateEvalResult {
  decision: PolicyDecision;
  scoreDelta: number;
  tags: string[];
  reasons: string[];
  skipRemainingGates: boolean;
}

export interface RewardProxyAdjustEvalResult {
  scoreDelta: number;
  tags: string[];
  reasons: string[];
  expectedRRUsed: number | null;
  rewardProxy: PolicyRewardProxy;
}

export interface ConcentrationHistoryItem {
  time: string;
  symbol: string;
  dir: PolicyDir;
  poiClusterKey: string;
}

export interface ConcentrationGateEvalResult {
  decision: PolicyDecision;
  scoreDelta: number;
  tags: string[];
  reasons: string[];
  uniqueClusters15m: number;
  duplicate: boolean;
  isExceptional: boolean;
}

export interface EdgeSignatureStats {
  meanR: number;
  stdR: number;
  n: number;
}

export interface EdgeSignatureKeys {
  coarse: string;
  mid: string;
  fine: string;
  regimeBucket: PolicyRegimeBucket;
}

export interface EdgeEvidenceGateEvalResult {
  decision: PolicyDecision;
  scoreDelta: number;
  tags: string[];
  reasons: string[];
  evidenceLevel: PolicyEvidenceLevel;
  usedSignature: PolicyUsedSignature;
  lcbR: number | null;
  suggestedRiskMultiplier: number | null;
}

export interface RiskManagerEvalResult {
  decision: PolicyDecision;
  riskMode: PolicyRiskMode;
  scoreDelta: number;
  tags: string[];
  reasons: string[];
  suggestedRiskPct: number;
}

export interface PortfolioExposureGateEvalResult {
  decision: PolicyDecision;
  scoreDelta: number;
  tags: string[];
  reasons: string[];
  suggestedRiskPct: number;
  cap: number;
  skipped: boolean;
}



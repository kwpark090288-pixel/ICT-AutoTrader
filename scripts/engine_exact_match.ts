import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createCompositeEngine, runCompositeEngineBatch } from "../lib/engine/composite-engine";
import { formatTags, uniqueLexicographicTags } from "../lib/engine/tags";
import {
  countPruneOverflow,
  getPrunedIdsByOldest,
} from "../lib/engine/pruning";
import {
  appendBarForTf,
  createTfBarStore,
  getBarCountForTf,
  getBarsForTf,
  setBarsForTf,
} from "../lib/engine/bar-store";
import {
  appendMarketBar,
  clearMarketContext,
  detectConfirmedFractalPivotAtIndex as detectMarketConfirmedFractalPivotAtIndex,
  getMarketAtr14AtCloseTime,
  getMarketBarAtCloseTime,
  getMarketBars,
  listConfirmedFractalPivots,
  listConfirmedFractalPivotsBeforeCloseTime,
} from "../lib/engine/market-context";
import { setCachedTickSize } from "../lib/engine/ticksize";
import {
  clearBookTickerCache,
  upsertBookTicker,
} from "../lib/engine/book-ticker";
import {
  clearRuntimePoiStore,
  getRuntimePoiStore,
  listRuntimePois,
  resolveRuntimeInvalidationTime,
  replaceRuntimePois,
  replaceRuntimeChannelExecutionPois,
  replaceRuntimeChannelPois,
  replaceRuntimeObPois,
  replaceRuntimeTrendlinePois,
  syncRuntimeChannelExecutionInvalidationPois,
  syncRuntimeTrendlineInvalidationPois,
} from "../lib/engine/runtime-poi-store";
import { resetEngine } from "../lib/engine/runtime";
import { buildRouterRawSignalCandidatesForBar } from "../lib/router/runtime";
import {
  buildRuntimePolicyResultFromSeed,
  buildRuntimeRouterCandidate,
  getRuntimePreviousM5CloseTimeIso,
} from "../lib/router/runtime-open";
import {
  bufferOrReleaseRouterCandidateEvaluationItem,
  buildRouterCloseSyncKey,
  clearRouterCloseSyncBatches,
  listPendingRouterCandidateEvaluationItems,
  releaseRouterCandidateEvaluationBatchForM5,
} from "../lib/router/close-sync";
import * as FvgConstants from "../lib/engine/indicators/fvg/constants";
import {
  applyFvgBarClose,
  createEmptyFvgRuntimeState,
  detectConfirmedWickFvgFromRecentBars,
  detectConfirmedWickFvgWithAtrFromTfBars,
  isFvgDetectTf,
} from "../lib/engine/indicators/fvg/engine";
import {
  buildFvgLifecycleEvents,
  formatD1PoiFvgNewEvent,
  formatH4CoreFvgConfirmEvent,
  formatSetupFvgNewEvent,
  formatStackZoneEndEvent,
} from "../lib/engine/indicators/fvg/events";
import {
  buildAtr14Snapshots,
  getAtrSnapshotAtConfTime,
  getAtrValueAtConfTime,
} from "../lib/engine/indicators/fvg/atr";
import {
  detectConfirmedFractalPivotAtIndex,
  detectNewlyConfirmedFractalPivot,
  isPivotStructureTf,
} from "../lib/engine/indicators/fvg/pivots";
import { evaluateStructureAtClose } from "../lib/engine/indicators/fvg/structure";
import {
  evaluateDisplacementF1FromRecentBars,
  evaluateDisplacementF1FromTfBars,
  getCandleBodySize,
} from "../lib/engine/indicators/fvg/displacement";
import {
  evaluateSweepRecoveryFromTfBars,
  resolveSweepRecoveryTarget,
} from "../lib/engine/indicators/fvg/sweep-recovery";
import { evaluateF4Context } from "../lib/engine/indicators/fvg/context";
import {
  evaluateD1MixedStrongDisplacementFromRecentBars,
  evaluateD1PoiFvgInvalidationFlags,
  evaluateD1PoiFvgRegistration,
} from "../lib/engine/indicators/fvg/d1-poi";
import {
  createH4CoreFvgCandidate,
  getH4CoreConfirmDueTime,
  getH4CoreDisplayUntil,
} from "../lib/engine/indicators/fvg/h4-core";
import {
  evaluateH4CoreFvgPassF2,
  evaluateH4CoreFvgPassF3,
} from "../lib/engine/indicators/fvg/h4-secondary";
import {
  applyH4CoreFvgCandidateConfirm,
  countH4SecondaryPasses,
  evaluateH4CoreFvgCandidateConfirm,
} from "../lib/engine/indicators/fvg/h4-confirm";
import {
  evaluateFvgFullFillHit,
  evaluateH4CoreFvgInvalidationFlags,
  evaluateSetupFvgInvalidationFlags,
  resolveFvgInvalidationDecision,
  resolveFvgInvalidationReasonWithPriority,
} from "../lib/engine/indicators/fvg/invalidation";
import {
  applySetupFvgOppositeChochKillChain,
  listKilledH4CoreFvgsAtCloseTime,
  shouldKillSetupFvgByKilledH4,
} from "../lib/engine/indicators/fvg/kill-chain";
import {
  computeTouchOverlapLen,
  computeTouchPenetrationMin,
  evaluateTouchPenetrationFilter,
} from "../lib/engine/indicators/fvg/touch-filter";
import {
  computeInsideOverlapLen,
  computeInsideOverlapRatio,
  createSetupFvg,
  createSetupFvgFromParentPool,
  getSetupDisplayUntil,
  getSetupParentLayer,
  isEligibleSetupParentPoi,
  isSetupTf,
  listValidSetupParentMatches,
  selectCanonicalSetupParentMatch,
} from "../lib/engine/indicators/fvg/setup";
import {
  computeStackOverlapLen,
  computeStackOverlapRatio,
  createStackZoneFromPair,
  createStackZonesInPriorityOrder,
  getStackDisplayUntil,
  getStackTfForPair,
} from "../lib/engine/indicators/fvg/stack";
import {
  computeLtfGateDist,
  evaluateLtfGateFromTfBars,
  evaluateLtfGateOnBar,
  getLtfGateBoundary,
  getLtfGatePriceExtreme,
  isEligibleLtfGatePoi,
  isLtfReactionTf,
} from "../lib/engine/indicators/fvg/ltf-gate";
import {
  detectConfirmedMicroPivotAtIndex,
  evaluateLtfChochTrigger,
  evaluateLtfSweepRecTrigger,
  evaluateLtfTriggers,
  evaluateMicroRetestBoundaryTrigger,
  evaluateMicroRetestMicroFvgTrigger,
  evaluateMicroRetestMicroObTrigger,
  getLatestConfirmedMicroPivot,
  isLtfTriggerTf,
  resolveLtfSweepRecoveryTarget,
  sortUniqueLtfTriggerTokens,
} from "../lib/engine/indicators/fvg/ltf-triggers";
import {
  apply15mReactionToGate,
  apply5mEntryToGate,
  buildReactionGateKey,
  createReactionGate,
  evaluateReactionGate,
  getBlock5mUntilFrom15mReaction,
  getBlockAllUntilFrom5mEntry,
} from "../lib/engine/indicators/fvg/reaction-gate";
import {
  buildNormalizedFvgId,
  formatFvgZoneForOutput,
  formatRatio2,
  normalizeFvgZoneToTick,
} from "../lib/engine/indicators/fvg/normalize";
import {
  applyFvgPrune,
  buildFvgPruneIdSet,
  getFvgPruneBucket,
  getFvgPruneLimit,
} from "../lib/engine/indicators/fvg/prune";
import * as ObConstants from "../lib/engine/indicators/ob/constants";
import {
  buildObZoneFromCandle,
  detectObZoneCandidateFromTriggerIndex,
  findLastOppositeColorCandleIndex,
  isOppositeColorCandleForOb,
} from "../lib/engine/indicators/ob/zone";
import {
  computeObTouchOverlapLen,
  computeObTouchPenetrationMin,
  evaluateObTouchPenetrationFilter,
} from "../lib/engine/indicators/ob/touch-filter";
import {
  evaluateObZoneHeightFilter,
  getMaxObHeightAtrMultiplier,
  isObHeightFilterTf,
} from "../lib/engine/indicators/ob/height-filter";
import {
  evaluateObContextDistanceFilter,
  evaluateObDisplacementAtTrigger,
  evaluateObSweepRecoveryAtTrigger,
  getObCandleBodySize,
  resolveObSweepRecoveryTarget,
  selectPreferredObContextDistance,
} from "../lib/engine/indicators/ob/filters";
import {
  applyD1PoiObCandidateConfirm,
  createD1PoiObCandidate,
  evaluateD1PoiObCandidateConfirm,
  getD1PoiObConfirmDueTime,
  getD1PoiObDisplayUntil,
} from "../lib/engine/indicators/ob/d1-poi";
import {
  applyH4CoreObCandidateConfirm,
  createH4CoreObCandidate,
  evaluateH4CoreObCandidateConfirm,
  getH4CoreObConfirmDueTime,
  getH4CoreObDisplayUntil,
} from "../lib/engine/indicators/ob/h4-core";
import {
  computeObLtfGateDist,
  detectConfirmedObMicroPivotAtIndex,
  evaluateObLtfChochTrigger,
  evaluateObLtfGateFromTfBars,
  evaluateObLtfGateOnBar,
  evaluateObLtfSweepRecTrigger,
  evaluateObLtfTriggers,
  evaluateObMicroRetestMicroFvgTrigger,
  evaluateObMicroRetestMicroObTrigger,
  getLatestConfirmedObMicroPivot,
  getObLtfGateBoundary,
  getObLtfGatePriceExtreme,
  isEligibleObLtfPoi,
  isObLtfReactionTf,
  resolveObLtfSweepRecoveryTarget,
  sortUniqueObLtfTriggerTokens,
} from "../lib/engine/indicators/ob/ltf";
import {
  computeObInsideOverlapLen,
  computeObInsideOverlapRatio,
  createSetupOb,
  getObSetupDisplayUntil,
  isEligibleObSetupParent,
  isObSetupTf,
  selectObSetupParent,
} from "../lib/engine/indicators/ob/setup";
import {
  evaluateD1PoiObInvalidationFlags,
  evaluateObFullFillHit,
  evaluateH4CoreObInvalidationFlags,
  evaluateSetupObInvalidationFlags,
  resolveObInvalidationDecision,
  resolveObInvalidationReasonWithPriority,
} from "../lib/engine/indicators/ob/invalidation";
import {
  evaluateObContextCollabAgainstRuntimePois,
  evaluateObContextSelectionAtTime,
  mergeObCollabState,
} from "../lib/engine/indicators/ob/context";
import {
  computeObFvgOverlapLen,
  computeObFvgOverlapRatio,
  evaluateObFvgCollab,
  getObFvgCollabTag,
  isEligibleFvgForObCollab,
} from "../lib/engine/indicators/ob/collab";
import {
  buildObLifecycleEvents,
  formatD1PoiObCandidateNewEvent,
  formatD1PoiObConfirmEvent,
  formatH4CoreObCandidateNewEvent,
  formatH4CoreObConfirmEvent,
  formatObInvalidEvent,
  formatObTouchEvent,
  formatSetupObNewEvent,
} from "../lib/engine/indicators/ob/events";
import {
  applySetupObH4OppositeChochKillChain,
  getObSetupInvalidatedDirFromH4OppositeChoch,
} from "../lib/engine/indicators/ob/kill-chain";
import {
  applyObPrune,
  buildObPruneIdSet,
  getObPruneBucket,
  getObPruneLimit,
} from "../lib/engine/indicators/ob/prune";
import {
  formatObFvgCollabEvent,
  getObFvgCollabDisplayTag,
  resolveObFvgCollabEvent,
  shouldEmitObFvgCollabEvent,
} from "../lib/engine/indicators/ob/collab-event";
import {
  applyObBarClose,
  createEmptyObRuntimeState,
} from "../lib/engine/indicators/ob/engine";
import {
  buildNormalizedObId,
  formatObRatio2,
  formatObZoneForOutput,
  getObCmpEpsilon,
  normalizeObZoneToTick,
} from "../lib/engine/indicators/ob/normalize";
import * as ChannelConstants from "../lib/engine/indicators/channel/constants";
import {
  buildAnchorLine2P,
  createChannelGeometry,
  createD1H4OperationalChannel,
  getD1H4ChannelType,
  getD1H4DisplayUntil,
  getD1H4FixedMode,
  getD1H4OffsetPercentile,
  isD1H4ChannelTf,
  linePriceAt,
} from "../lib/engine/indicators/channel/basic";
import {
  computeH1M30Mode,
  createH1M30OperationalChannel,
  getH1M30ChannelType,
  getH1M30DisplayUntil,
  getH1M30OffsetPercentile,
  getH1M30TtlBars,
  isH1M30ChannelTf,
} from "../lib/engine/indicators/channel/h1m30";
import {
  buildChannelModelFromResolvedAnchors,
  createEmptyChannelContextState,
  resolveCanonicalChannelAnchors,
  resolveChannelDirectionFromPairs,
  selectCanonicalDownAnchorPair,
  selectCanonicalUpAnchorPair,
  updateChannelContextState,
} from "../lib/engine/indicators/channel/anchors";
import {
  buildReferencedChannelParentIds,
  extractChannelParentBoundaryPrice,
  listActiveChannelParentCandidates,
  toChannelParentPoiContexts,
} from "../lib/engine/indicators/channel/parent";
import {
  formatChannelModeEvent,
  resolveChannelModeEvent,
  shouldEmitChannelModeEvent,
} from "../lib/engine/indicators/channel/mode-event";
import {
  applyChannelLifecycleInvalidation,
  buildChannelPoiCapKey,
  evaluateChannelParentPoiEnded,
  evaluateChannelPoiDayCap,
  evaluateChannelTtlExpiration,
  getChannelPoiDayKeyUtc,
  getChannelTtlBars,
  getChannelTtlExpiryTime,
  isChannelTtlTf,
  resolveChannelLifecycleInvalidation,
} from "../lib/engine/indicators/channel/lifecycle";
import {
  computeChannelPoiGateDist,
  evaluateChannelPoiGateFromTfBars,
  evaluateChannelPoiGateOnBar,
  getChannelPoiBoundaryPriceAt,
  getChannelPoiGateAtrMultiplier,
  getChannelPoiWickExtreme,
  isChannelPoiTf,
} from "../lib/engine/indicators/channel/poi-gate";
import {
  evaluateChannelDispTriggerAtBar,
  evaluateChannelDispTriggerFromTfBars,
  evaluateChannelPoiTriggers,
  evaluateChannelPoiTriggersFromTfBars,
  evaluateChannelStructureTrigger,
  evaluateChannelSweepRecTriggerNow,
  getChannelCandleBodySize,
} from "../lib/engine/indicators/channel/poi-triggers";
import {
  buildChannelBoundaryZoneProxy,
  countSatisfiedChannelPoiTriggers,
  createChannelPoi,
  evaluateChannelParentNearInside,
} from "../lib/engine/indicators/channel/poi";
import {
  formatChannelInvalidEvent,
  formatChannelNewEvent,
  formatChannelPoiEvent,
  formatChannelUpdateEvent,
  resolveChannelInvalidEvent,
  resolveChannelNewEvent,
  resolveChannelPoiEvent,
  resolveChannelUpdateEvent,
  shouldEmitChannelInvalidEvent,
  shouldEmitChannelNewEvent,
  shouldEmitChannelPoiEvent,
  shouldEmitChannelUpdateEvent,
} from "../lib/engine/indicators/channel/events";
import {
  applyChannelBarClose,
  createEmptyChannelRuntimeState,
} from "../lib/engine/indicators/channel/engine";
import * as TrendlineConstants from "../lib/engine/indicators/trendline/constants";
import {
  appendTrendlinePivotKeepingLast3,
  detectConfirmedTrendlinePivotAtIndex,
  detectNewlyConfirmedTrendlinePivot,
  isTrendlinePivotTf,
} from "../lib/engine/indicators/trendline/pivots";
import {
  buildTrendlineStructureSnapshot,
  evaluateTrendlineStructureState,
  isTrendlineStructureTf,
  takeLatestConfirmedTrendlinePivots,
} from "../lib/engine/indicators/trendline/structure";
import {
  checkTrendlineMinSwing,
  createTrendlineFromAnchors,
  detectTrendlineCandidates,
  getTrendlineDisplayUntil,
  getTrendlineLookbackBars,
  getTrendlineMaxForwardBars,
  getTrendlineMinSwingAtrMultiplier,
  isTrendlineDetectTf,
  selectAnchorsWithinLookback,
} from "../lib/engine/indicators/trendline/detect";
import {
  applyTrendlineLifecycleInvalidation,
  applyTrendlineTouchAndBreakStats,
  evaluateTrendlineBreakAtBar,
  evaluateTrendlineStaleExpiration,
  evaluateTrendlineTouchAtBar,
  getTrendlineBreakRule,
  getTrendlineLinePriceAt,
  isTrendlineLifecycleTf,
} from "../lib/engine/indicators/trendline/lifecycle";
import {
  applyTrendlineRoleFlip,
  evaluateTrendlineRoleFlipOppositeClose,
  getTrendlineRoleFlipOppositeType,
  shouldStartTrendlineRoleFlipWatch,
} from "../lib/engine/indicators/trendline/role-flip";
import {
  computeTrendlineChannelBoundaryDistance,
  computeTrendlineDistanceTicks,
  computeTrendlineDistanceToZone,
  evaluateTrendlineCollab,
  evaluateTrendlineCollabFromRuntimePois,
  getTrendlineChannelCollabTag,
  getTrendlinePoiCollabTag,
  isEligibleChannelForTrendlineCollab,
  isEligibleFvgForTrendlineCollab,
  isEligibleObForTrendlineCollab,
} from "../lib/engine/indicators/trendline/collab";
import { applyTrendlinePruneByType } from "../lib/engine/indicators/trendline/prune";
import {
  buildTrendlineDailyCapKey,
  buildTrendlinePoiCandidateEventInput,
  getTrendlinePoiCandidateReason,
} from "../lib/engine/indicators/trendline/poi";
import {
  evaluateTrendlineLtfGateFromTfBars,
  detectConfirmedTrendlineMicroPivotAtIndex,
  evaluateTrendlineLtfChochTrigger,
  evaluateTrendlineLtfTriggers,
  evaluateTrendlineLtfTriggersFromTfBars,
  evaluateTrendlineMicroFvgRetestTrigger,
  evaluateTrendlineMicroObRetestTrigger,
  evaluateTrendlineSweepRecTriggerNow,
  getLatestConfirmedTrendlineMicroPivot,
  isTrendlineReactionTf,
  sortUniqueTrendlineLtfTriggerTokens,
} from "../lib/engine/indicators/trendline/ltf";
import {
  buildTrendlinePoiCandidateEventKey,
  formatTrendlineInvalidEvent,
  formatTrendlineNewEvent,
  formatTrendlinePoiCandidateEvent,
  formatTrendlineRoleFlipEvent,
  formatTrendlineTouchEvent,
  resolveTrendlineInvalidEvent,
  resolveTrendlineNewEvent,
  resolveTrendlinePoiCandidateEvent,
  resolveTrendlineRoleFlipEvent,
  resolveTrendlineTouchEvent,
  shouldEmitTrendlineInvalidEvent,
  shouldEmitTrendlineNewEvent,
  shouldEmitTrendlinePoiCandidateEvent,
  shouldEmitTrendlineRoleFlipEvent,
  shouldEmitTrendlineTouchEvent,
} from "../lib/engine/indicators/trendline/events";
import {
  advanceSourceEmissionState,
  computeSourceEmissionStage,
} from "../lib/engine/source-emission";
import * as PolicyConstants from "../lib/policy/constants";
import type {
  AccountSnapshot,
  ConcentrationHistoryItem,
  DerivedValues,
  MarketSnapshot,
  PolicyResult,
  SignalCandidate,
} from "../lib/policy/types";
import {
  computeCostRoundtripBps,
  computeEntryRefPrice,
  computeExpectedRRUsed,
  computeFastMove,
  computePoiClusterKey,
  computeRewardBpsFromTpRefPrice,
  computeRewardProxy,
  computeSC,
  computeSEffectiveBps,
  computeSpreadBps,
  computeStopBufferBps,
  computeStopBufferPrice,
  computeSRawBps,
  computeSlippageMultiplier,
  estimateSlippageBpsP95,
  getStopBufferAtrFactor,
} from "../lib/policy/derived";
import {
  computeAtrRatio,
  computeLiquidityState,
  computeVolState,
  evaluateRegimeGate,
  meanOf,
  quantileNearestRank,
} from "../lib/policy/gates/regime";
import { evaluateCostGate } from "../lib/policy/gates/cost";
import {
  evaluateDataIntegrityGate,
  isConsistentPolicyDataState,
  isPolicyDataState,
} from "../lib/policy/gates/dataIntegrity";
import { evaluateRewardProxyAdjust } from "../lib/policy/gates/rewardProxy";
import {
  countUniquePoiClusters15m,
  evaluateConcentrationGate,
  hasDuplicatePoiCluster,
  isExceptionalSignal,
} from "../lib/policy/gates/concentration";
import {
  buildEdgeSignatureKeys,
  computeKellySuggestedRiskMultiplier,
  computeLcbR,
  evaluateEdgeEvidenceGate,
  getPolicyRegimeBucket,
} from "../lib/policy/gates/edge";
import {
  applyColdstartRiskClamp,
  evaluateRiskManager,
  getBaseRiskModeFromConsecutiveLosses,
  getSuggestedRiskPctByMode,
  reevaluateRiskMode,
  shouldEnterRiskHalt,
  shouldStayRiskHalt,
} from "../lib/policy/gates/risk";
import {
  evaluatePortfolioExposureGate,
  getPortfolioCapByRiskMode,
} from "../lib/policy/gates/portfolio";
import { evaluatePolicy } from "../lib/policy/policy";
import * as RouterConstants from "../lib/router/constants";
import type { RouterCandidate } from "../lib/router/types";
import {
  buildRouterOpenIntent,
  buildRouterPlanId,
  buildRouterPlanKey,
  buildRouterSendCloseId,
  buildRouterSendClosePayload,
  buildRouterSendOpenPayload,
  getRouterCloseSeverity,
  hasRequiredRouterOpenIntentFields,
  hasRequiredRouterSendClosePayloadFields,
  hasRequiredRouterSendOpenPayloadFields,
  toRouterOpenIntentPoiTier,
  toRouterPolicyState,
  toRouterTradeDir,
} from "../lib/router/contracts";
import {
  buildBest1SendOpenPayload,
  compareRouterBest1Candidates,
  computeRouterCandidateDist,
  getRouterPoiTierRank,
  selectBest1OpenCandidate,
} from "../lib/router/selection";
import {
  buildRouterRawCandidateId,
  buildRouterRawTradeKey,
  parseEventLine,
  parseTriggers,
  toRouterRawSignalCandidate,
} from "../lib/router/raw-event";
import type { RouterRawPoi } from "../lib/router/raw-event";
import {
  buildPolicySignalCandidateFromSeed,
  buildPolicySignalCandidateFromSeedViaDraft,
  compareRouterCycleCandidates,
  coalesceRouterCycleCandidates,
  computeRouterCollabStrength,
  computeRouterHasStack,
  computeRouterTriggerCount,
  filterRouterCycleSendOpenCandidates,
  groupRouterCycleCandidatesByTradeKey,
  hasActiveTradeKey,
  mapRouterPoiTier,
  selectStrongestRouterCycleCandidate,
} from "../lib/router/candidate";
import {
  buildTradeZoneKey,
  evaluateTradeOpenSuppression,
  hasDuplicateActiveZone,
  isContinuousM5Close,
} from "../lib/tradelifecycle/intake";
import {
  clearRuntimeTradeStore,
  listRuntimeActiveTradeKeyRefs,
  listRuntimeActiveTradePlanRefs,
  listRuntimeConcentrationHistory,
  listRuntimeOpenedTradePlans,
  registerRuntimeOpenedTrade,
} from "../lib/tradelifecycle/runtime-store";
import * as TradeLifecycleConstants from "../lib/tradelifecycle/constants";
import type {
  TradeActivePlanRef,
  TradePlan,
} from "../lib/tradelifecycle/types";
import {
  buildTradePlan,
  buildTradePlanDraft,
  computeEntryQuality,
  computeEntryRefPrice as computeTradeEntryRefPrice,
  computeStopBuffer,
  computeStopPrice,
  computeTimeoutDueTime,
  computeTpPrice,
  computeTpRr,
  evaluateTradeOpen,
  getRrMaxUsed,
  getTimeoutMinutes,
  hasRequiredOpenIntentFields,
} from "../lib/tradelifecycle/open";
import {
  applyTradeMonitorOnBar,
  computeTradeAdvR,
  computeTradeFavR,
  evaluateTradeHardTpSlHit,
  evaluateTradeSoftInvalid,
  evaluateTradeTimeoutHit,
  isTradeMonitorTf,
  resolveTradeCloseOutcome,
  resolveTradeExitPrice,
  roundToTick as roundTradeMonitorTick,
  shouldEvaluateTradeMonitorBar,
} from "../lib/tradelifecycle/monitor";
import {
  collectTradeStrengthCodes,
  collectTradeWeaknessCodes,
  computeTradeRAfterCost,
  computeTradeRFillAfterCost,
  computeTradeRFillGross,
  computeTradeRGross,
  computeTradeTimeoutSign,
  finalizeClosedTradeReview,
} from "../lib/tradelifecycle/review";
import {
  buildTradeReplayNote,
  formatTradePlanOpenEvent,
  formatTradePlanSuppressEvent,
  formatTradePlanCloseEvent,
  getTradeReplayRootMessage,
  getTradeTimeoutSubMessage,
  pickTopStrengthCodes,
  pickTopWeaknessCodes,
} from "../lib/tradelifecycle/closeOutput";
import {
  ALERT_EVENT_TYPE_FILTERS,
  ALERT_GROUP_MIN_COUNT,
  ALERT_GROUP_WINDOW_MIN,
  ALERT_SEVERITY_FILTERS,
  ALERT_SOUND_EVENT_TYPES,
  ALERT_NAV_BARS_AROUND,
  ALERT_OPEN_LINK_HIGHLIGHT_MS,
  ALERT_PLAN_LINES_HIGHLIGHT_MS,
  ALERT_POI_HIGHLIGHT_MS,
  ALERT_SEEN_TABS,
  DEFAULT_MUTE_DURATION_MIN,
  DEFAULT_ALERT_PROFILE_ID,
  DEFAULT_AUTO_TF_SWITCH_ENABLED,
  DEFAULT_SOUND_ALERT_HIGH_ENABLED,
} from "../lib/alerts/constants";
import {
  CHART_TIMEFRAMES,
  fromBinanceInterval,
  normalizeChartTimeframe,
  tfToSeconds,
  toBinanceInterval,
} from "../lib/chart/timeframes";
import {
  DEFAULT_TELEGRAM_REFERENCE_LEVERAGE,
  TELEGRAM_RETRY_DELAYS_MIN,
} from "../lib/telegram/constants";
import {
  computeDirectionalPriceMovePct,
  computeReferenceLeverageRoiPct,
  formatTelegramTradeCloseMessage,
  formatTelegramTradeOpenMessage,
} from "../lib/telegram/format";
import {
  buildTelegramCloseIdempotencyKey,
  buildTelegramCloseOutboxCreateInput,
  buildTelegramOpenIdempotencyKey,
  buildTelegramOpenOutboxCreateInput,
  computeTelegramNextAttemptAt,
  evaluateTelegramDispatchReadiness,
  loadTelegramDispatchConfig,
} from "../lib/telegram/outbox";
import type { AlertPanelSource } from "../lib/alerts/types";
import {
  appendSignalEvent,
  buildSignalGroupKey,
  buildSoundPlayedKey,
  buildMuteStateKey,
  buildMutedKeySet,
  clearMuteState,
  computeUnseenHighCountOther,
  getMuteState,
  getSeenState,
  getSoundPlayed,
  getSoundPreference,
  getReviewNote,
  getSignalSeverityRank,
  groupSignalEvents,
  hasSoundPlayed,
  isMuted,
  listOtherInboxEvents,
  listSignalEvents,
  listActiveMuteStates,
  listSignalEventsWithSeen,
  listSelectedSymbolEvents,
  markSoundPlayed,
  upsertSoundPreference,
  upsertMuteState,
  upsertSeenState,
  upsertReviewNote,
} from "../lib/alerts/store";
import {
  getAlertSeverity,
  shouldPlayHighOtherSymbolSound,
} from "../lib/alerts/sound";
import {
  buildAlertCardNavigationPlan,
  buildOpenLinkPlan,
  findLinkedOpenEvent,
} from "../lib/alerts/navigation";
import {
  buildSelectedFeedCard,
  buildSelectedFeedCloseCard,
  buildSelectedFeedOpenCard,
  getAlertTrafficLightState,
  hasReviewNoteBadge,
  pickCloseWeaknessPreview,
  resolveOpenLinkPlanId,
} from "../lib/alerts/cards";
import {
  applyOtherInboxFilters,
  applySelectedFeedFilters,
  getEventTypeBucket,
  matchesEventTypeFilter,
  matchesSeverityFilter,
} from "../lib/alerts/filters";
import {
  buildOtherInboxStatusView,
  buildSelectedFeedStatusView,
  buildWatchlistStatusLine,
  formatWatchlistStatusToken,
  isAlertBackendState,
} from "../lib/alerts/status";
import { GET as getSignalsRoute } from "../app/api/signals/route";
import {
  DELETE as deleteMuteRoute,
  GET as getMuteRoute,
  POST as postMuteRoute,
} from "../app/api/mute/route";
import {
  GET as getSoundRoute,
  POST as postSoundRoute,
} from "../app/api/sound/route";
import {
  GET as getSoundPlayedRoute,
  POST as postSoundPlayedRoute,
} from "../app/api/soundPlayed/route";
import {
  GET as getReviewNoteRoute,
  POST as postReviewNoteRoute,
} from "../app/api/reviewNote/route";
import {
  GET as getSeenRoute,
  POST as postSeenRoute,
} from "../app/api/seen/route";
import {
  evaluateChannelAnchorInvalidAtBar,
  evaluateChannelBreakAtBar,
  getChannelAnchorPriceAt,
  getChannelBreakBoundaryPriceAt,
  getChannelBreakRule,
  isChannelBreakTf,
} from "../lib/engine/indicators/channel/breaks";
import {
  collectPositiveResidualSamples,
  computeChannelResidualRaw,
  evaluateChannelOffsetFromResiduals,
  getChannelOffsetPercentile,
  isChannelResidualTf,
} from "../lib/engine/indicators/channel/offset";
import type { Bar, Pivot } from "../lib/engine/types";

function assertExactEventLog(
  actual: string[],
  expected: string[],
  label: string
) {
  assert.equal(
    actual.length,
    expected.length,
    `${label}: event count mismatch (expected=${expected.length}, actual=${actual.length})`
  );

  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(
      actual[i],
      expected[i],
      `${label}: mismatch at index=${i}\nexpected=${JSON.stringify(
        expected[i]
      )}\nactual=${JSON.stringify(actual[i])}`
    );
  }
}

async function withMockedNowIso<T>(
  nowIso: string,
  fn: () => Promise<T>
): Promise<T> {
  const RealDate = Date;

  class MockDate extends RealDate {
    constructor(value?: string | number | Date) {
      if (value === undefined) {
        super(nowIso);
      } else {
        super(value);
      }
    }

    static now(): number {
      return RealDate.parse(nowIso);
    }

    static parse(value: string): number {
      return RealDate.parse(value);
    }

    static UTC(
      year: number,
      monthIndex: number,
      date?: number,
      hours?: number,
      minutes?: number,
      seconds?: number,
      ms?: number
    ): number {
      return RealDate.UTC(
        year,
        monthIndex,
        date,
        hours,
        minutes,
        seconds,
        ms
      );
    }
  }

  globalThis.Date = MockDate as DateConstructor;

  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

function collectEventLog(bars: Bar[]): string[] {
  const engine = createCompositeEngine();
  const out: string[] = [];

  for (const bar of bars) {
    out.push(...engine.onBarClose(bar));
  }

  return out;
}

{
  clearRuntimePoiStore();

  const phaseLog: string[] = [];
  const bar: Bar = {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 1, 0, 59, 59),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 0,
  };

  replaceRuntimePois("BATCH", "FVG", [
    {
      id: "OLD",
      symbol: "BATCH",
      kind: "FVG",
      tf: "H1",
      dir: "BULL",
      zone: { bottom: 99, top: 100 },
      type: "SETUP_FVG",
      state: "ACTIVE",
    },
  ]);

  const engineA = {
    onBarClose: () => [],
    onBarClosePhaseA() {
      phaseLog.push("A.phaseA");
      return [];
    },
    onBarClosePhaseC() {
      phaseLog.push(`A.phaseC:${listRuntimePois("BATCH").map((poi) => poi.id).join(",")}`);
      return [];
    },
    publishRuntimeSnapshot() {
      phaseLog.push("A.publish");
      replaceRuntimePois("BATCH", "FVG", [
        {
          id: "A",
          symbol: "BATCH",
          kind: "FVG",
          tf: "H1",
          dir: "BULL",
          zone: { bottom: 100, top: 101 },
          type: "SETUP_FVG",
          state: "ACTIVE",
        },
      ]);
    },
  };

  const engineB = {
    onBarClose: () => [],
    onBarClosePhaseA() {
      phaseLog.push(`B.phaseA:${listRuntimePois("BATCH").map((poi) => poi.id).join(",")}`);
      return [];
    },
    onBarClosePhaseC() {
      phaseLog.push(`B.phaseC:${listRuntimePois("BATCH").map((poi) => poi.id).join(",")}`);
      return [];
    },
    publishRuntimeSnapshot() {
      phaseLog.push("B.publish");
    },
  };

  runCompositeEngineBatch([engineA, engineB], bar);

  assert.deepEqual(
    phaseLog,
    [
      "A.phaseA",
      "B.phaseA:OLD",
      "A.publish",
      "B.publish",
      "A.phaseC:A",
      "B.phaseC:A",
      "A.publish",
      "B.publish",
    ],
    "cross-source batch keeps phase-a on previous snapshot and phase-c on published snapshot"
  );
}

{
  clearRuntimePoiStore();

  const phaseLog: string[] = [];
  const bar: Bar = {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 1, 1, 0, 0),
    closeTime: Date.UTC(2026, 2, 1, 1, 59, 59),
    open: 101,
    high: 102,
    low: 100,
    close: 101.5,
    volume: 0,
  };

  const engineA = {
    onBarClose: () => [],
    onBarClosePhaseA() {
      return [];
    },
    onBarClosePhaseC() {
      phaseLog.push("A.phaseC");
      return [];
    },
    publishRuntimeSnapshot() {
      replaceRuntimePois("BATCH2", "FVG", [
        {
          id: "A",
          symbol: "BATCH2",
          kind: "FVG",
          tf: "H1",
          dir: "BULL",
          zone: { bottom: 100, top: 101 },
          type: "SETUP_FVG",
          state: "ACTIVE",
        },
      ]);
    },
  };

  let bPublished = false;
  const engineB = {
    onBarClose: () => [],
    onBarClosePhaseA() {
      return [];
    },
    onBarClosePhaseC() {
      phaseLog.push(`B.phaseC:${listRuntimePois("BATCH2").map((poi) => poi.id).join(",")}`);
      bPublished = true;
      return [];
    },
    publishRuntimeSnapshot() {
      if (!bPublished) {
        return;
      }

      replaceRuntimePois("BATCH2", "OB", [
        {
          id: "B",
          symbol: "BATCH2",
          kind: "OB",
          tf: "H1",
          dir: "BULL",
          zone: { bottom: 100, top: 101 },
          type: "SETUP_OB",
          state: "ACTIVE",
        },
      ]);
    },
  };

  const engineC = {
    onBarClose: () => [],
    onBarClosePhaseA() {
      return [];
    },
    onBarClosePhaseC() {
      phaseLog.push(`C.phaseC:${listRuntimePois("BATCH2").map((poi) => poi.id).join(",")}`);
      return [];
    },
    publishRuntimeSnapshot() {},
  };

  runCompositeEngineBatch([engineA, engineB, engineC], bar);

  assert.deepEqual(
    phaseLog,
    ["A.phaseC", "B.phaseC:A", "C.phaseC:A"],
    "phase-c writes stay invisible until all phase-c computations finish"
  );
}

const bars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 1, 23, 59, 59),
    open: 100,
    high: 105,
    low: 99,
    close: 104,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 2, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 3, 59, 59),
    open: 104,
    high: 106,
    low: 103,
    close: 105,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 2, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 4, 59, 59),
    open: 105,
    high: 107,
    low: 104,
    close: 106,
    volume: 0,
  },
  {
    tf: "M30",
    openTime: Date.UTC(2026, 2, 2, 5, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 5, 29, 59),
    open: 106,
    high: 106.5,
    low: 105.5,
    close: 106.2,
    volume: 0,
  },
  {
    tf: "M15",
    openTime: Date.UTC(2026, 2, 2, 5, 30, 0),
    closeTime: Date.UTC(2026, 2, 2, 5, 44, 59),
    open: 106.2,
    high: 106.4,
    low: 105.9,
    close: 106.1,
    volume: 0,
  },
  {
    tf: "M5",
    openTime: Date.UTC(2026, 2, 2, 5, 45, 0),
    closeTime: Date.UTC(2026, 2, 2, 5, 49, 59),
    open: 106.1,
    high: 106.3,
    low: 106.0,
    close: 106.25,
    volume: 0,
  },
];

const harnessExpected = ["[TEST][HARNESS] alpha", "[TEST][HARNESS] beta"];
const harnessActual = ["[TEST][HARNESS] alpha", "[TEST][HARNESS] beta"];
const tagInput = ["ZETA", "ALPHA", "BETA", "ALPHA"];
const tagExpected = ["ALPHA", "BETA", "ZETA"];
const pruneInput = [
  { id: "D", confTime: 3000 },
  { id: "C", confTime: 1000 },
  { id: "B", confTime: 1000 },
  { id: "A", confTime: 2000 },
];

const pruneExpected = ["B", "C"];

const storeM5Bar1: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 2, 2, 6, 0, 0),
  closeTime: Date.UTC(2026, 2, 2, 6, 4, 59),
  open: 10,
  high: 11,
  low: 9,
  close: 10.5,
  volume: 0,
};

const storeM5Bar2: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 2, 2, 6, 5, 0),
  closeTime: Date.UTC(2026, 2, 2, 6, 9, 59),
  open: 10.5,
  high: 11.5,
  low: 10.25,
  close: 11,
  volume: 0,
};

const storeM5Bar3: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 2, 2, 6, 10, 0),
  closeTime: Date.UTC(2026, 2, 2, 6, 14, 59),
  open: 11,
  high: 12,
  low: 10.8,
  close: 11.75,
  volume: 0,
};

const bullFvgBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 2, 7, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 7, 59, 59),
    open: 96,
    high: 100,
    low: 95,
    close: 97,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 2, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 8, 59, 59),
    open: 97,
    high: 99,
    low: 96,
    close: 98,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 2, 9, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 9, 59, 59),
    open: 103,
    high: 106,
    low: 102,
    close: 105,
    volume: 0,
  },
];

const bearFvgBars: Bar[] = [
  {
    tf: "M30",
    openTime: Date.UTC(2026, 2, 2, 10, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 10, 29, 59),
    open: 111,
    high: 112,
    low: 110,
    close: 111,
    volume: 0,
  },
  {
    tf: "M30",
    openTime: Date.UTC(2026, 2, 2, 10, 30, 0),
    closeTime: Date.UTC(2026, 2, 2, 10, 59, 59),
    open: 110,
    high: 111,
    low: 109,
    close: 109.5,
    volume: 0,
  },
  {
    tf: "M30",
    openTime: Date.UTC(2026, 2, 2, 11, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 11, 29, 59),
    open: 107,
    high: 108,
    low: 104,
    close: 105,
    volume: 0,
  },
];

const smallFvgBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 2, 12, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 15, 59, 59),
    open: 96,
    high: 100,
    low: 95,
    close: 98,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 2, 16, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 19, 59, 59),
    open: 98,
    high: 100.5,
    low: 97.5,
    close: 99,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 2, 20, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 23, 59, 59),
    open: 101,
    high: 103,
    low: 101,
    close: 102,
    volume: 0,
  },
];

const atrH1Bars: Bar[] = Array.from({ length: 15 }, (_, i) => {
  const openTime = Date.UTC(2026, 2, 3, i, 0, 0);
  const closeTime = Date.UTC(2026, 2, 3, i, 59, 59);

  if (i <= 11) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 95,
      volume: 0,
    };
  }

  if (i === 12) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 100,
      volume: 0,
    };
  }

  if (i === 13) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 100,
      high: 110,
      low: 100,
      close: 105,
      volume: 0,
    };
  }

  return {
    tf: "H1" as const,
    openTime,
    closeTime,
    open: 105,
    high: 112,
    low: 102,
    close: 107,
    volume: 0,
  };
});

const pivotHighD1Bars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 4, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 4, 23, 59, 59),
    open: 10,
    high: 11,
    low: 8,
    close: 9,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 5, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 5, 23, 59, 59),
    open: 11,
    high: 12,
    low: 8.5,
    close: 10,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 6, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 6, 23, 59, 59),
    open: 12,
    high: 13,
    low: 9,
    close: 11,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 7, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 7, 23, 59, 59),
    open: 13,
    high: 20,
    low: 10,
    close: 14,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 8, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 8, 23, 59, 59),
    open: 12,
    high: 14,
    low: 9.5,
    close: 11,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 9, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 9, 23, 59, 59),
    open: 11,
    high: 13,
    low: 9,
    close: 10,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 10, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 10, 23, 59, 59),
    open: 10,
    high: 12,
    low: 8.5,
    close: 9,
    volume: 0,
  },
];

const pivotLowH4Bars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 3, 59, 59),
    open: 20,
    high: 22,
    low: 10,
    close: 19,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 7, 59, 59),
    open: 19,
    high: 21,
    low: 9,
    close: 18,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 11, 59, 59),
    open: 18,
    high: 20,
    low: 8,
    close: 17,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 12, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 15, 59, 59),
    open: 17,
    high: 19,
    low: 2,
    close: 16,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 16, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 19, 59, 59),
    open: 18,
    high: 20,
    low: 7,
    close: 18,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 20, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 23, 59, 59),
    open: 19,
    high: 21,
    low: 8,
    close: 19,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 12, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 12, 3, 59, 59),
    open: 20,
    high: 22,
    low: 9,
    close: 20,
    volume: 0,
  },
];

const pivotHighH1Bars: Bar[] = pivotHighD1Bars.map((bar) => ({
  ...bar,
  tf: "H1" as const,
}));

const pivotLowD1Bars: Bar[] = pivotLowH4Bars.map((bar) => ({
  ...bar,
  tf: "D1" as const,
}));

const displacementMaxPassBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 13, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 13, 3, 59, 59),
    open: 10,
    high: 15,
    low: 9,
    close: 14,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 13, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 13, 7, 59, 59),
    open: 15,
    high: 27,
    low: 14,
    close: 26,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 13, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 13, 11, 59, 59),
    open: 26,
    high: 29,
    low: 25,
    close: 28,
    volume: 0,
  },
];

const displacementSumPassBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 14, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 14, 3, 59, 59),
    open: 10,
    high: 17,
    low: 9,
    close: 16,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 14, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 14, 7, 59, 59),
    open: 16,
    high: 17,
    low: 9,
    close: 10,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 14, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 14, 11, 59, 59),
    open: 10,
    high: 18,
    low: 9,
    close: 17,
    volume: 0,
  },
];

const displacementStrictFailBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 15, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 15, 3, 59, 59),
    open: 10,
    high: 21,
    low: 9,
    close: 20,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 15, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 15, 7, 59, 59),
    open: 20,
    high: 25,
    low: 19,
    close: 24,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 15, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 15, 11, 59, 59),
    open: 24,
    high: 25,
    low: 19,
    close: 20,
    volume: 0,
  },
];

const atrDisplacementH1Bars: Bar[] = Array.from({ length: 15 }, (_, i) => {
  const openTime = Date.UTC(2026, 2, 16, i, 0, 0);
  const closeTime = Date.UTC(2026, 2, 16, i, 59, 59);

  if (i <= 11) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 95,
      volume: 0,
    };
  }

  if (i === 12) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 94,
      high: 100,
      low: 90,
      close: 100,
      volume: 0,
    };
  }

  if (i === 13) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 100,
      high: 104,
      low: 94,
      close: 94,
      volume: 0,
    };
  }

  return {
    tf: "H1" as const,
    openTime,
    closeTime,
    open: 93,
    high: 103,
    low: 93,
    close: 100,
    volume: 0,
  };
});

function buildH4SweepBars(
  overrides: Record<number, Partial<Bar>>,
  count = 18
): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const openTime = Date.UTC(2026, 2, 18, i * 4, 0, 0);
    const closeTime = Date.UTC(2026, 2, 18, i * 4 + 3, 59, 59);

    const base: Bar = {
      tf: "H4",
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 95,
      volume: 0,
    };

    return {
      ...base,
      ...(overrides[i] ?? {}),
    };
  });
}

function buildLtfBars(
  tf: "M15" | "M5",
  count: number,
  overrides: Record<number, Partial<Bar>>
): Bar[] {
  const durationMs = tf === "M15" ? 15 * 60 * 1000 : 5 * 60 * 1000;
  const start = Date.UTC(2026, 3, 2, 0, 0, 0);

  return Array.from({ length: count }, (_, i) => {
    const openTime = start + i * durationMs;
    const closeTime = openTime + durationMs - 1000;

    const base: Bar = {
      tf,
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 95,
      volume: 0,
    };

    return {
      ...base,
      ...(overrides[i] ?? {}),
    };
  });
}
function buildChannelResidualBars(
  tf: "D1" | "H4" | "H1" | "M30",
  dir: "UP" | "DOWN",
  residuals: number[],
  start: number
): Bar[] {
  const durationMs =
    tf === "D1"
      ? 24 * 60 * 60 * 1000
      : tf === "H4"
        ? 4 * 60 * 60 * 1000
        : tf === "H1"
          ? 60 * 60 * 1000
          : 30 * 60 * 1000;

  return residuals.map((residual, i) => {
    const openTime = start + i * durationMs;
    const closeTime = openTime + durationMs - 1000;

    if (dir === "UP") {
      const low = 100 + residual;
      return {
        tf,
        openTime,
        closeTime,
        open: low + 0.5,
        high: low + 1,
        low,
        close: low + 0.5,
        volume: 0,
      };
    }

    const high = 100 - residual;
    return {
      tf,
      openTime,
      closeTime,
      open: high - 0.5,
      high,
      low: high - 1,
      close: high - 0.5,
      volume: 0,
    };
  });
}

function buildChannelPoiGateBars(
  tf: "D1" | "H4" | "H1" | "M30",
  base: { open: number; high: number; low: number; close: number },
  current: Partial<Bar>,
  start: number,
  count = 15
): Bar[] {
  const durationMs =
    tf === "D1"
      ? 24 * 60 * 60 * 1000
      : tf === "H4"
        ? 4 * 60 * 60 * 1000
        : tf === "H1"
          ? 60 * 60 * 1000
          : 30 * 60 * 1000;

  return Array.from({ length: count }, (_, i) => {
    const openTime = start + i * durationMs;
    const closeTime = openTime + durationMs - 1000;

    const bar: Bar = {
      tf,
      openTime,
      closeTime,
      open: base.open,
      high: base.high,
      low: base.low,
      close: base.close,
      volume: 0,
    };

    if (i === count - 1) {
      return {
        ...bar,
        ...current,
      };
    }

    return bar;
  });
}

function buildChannelBars(
  tf: "D1" | "H4" | "H1" | "M30",
  count: number,
  overrides: Record<number, Partial<Bar>>,
  start: number
): Bar[] {
  const durationMs =
    tf === "D1"
      ? 24 * 60 * 60 * 1000
      : tf === "H4"
        ? 4 * 60 * 60 * 1000
        : tf === "H1"
          ? 60 * 60 * 1000
          : 30 * 60 * 1000;

  return Array.from({ length: count }, (_, i) => {
    const openTime = start + i * durationMs;
    const closeTime = openTime + durationMs - 1000;

    const base: Bar = {
      tf,
      openTime,
      closeTime,
      open: 103,
      high: 108,
      low: 98,
      close: 103,
      volume: 0,
    };

    return {
      ...base,
      ...(overrides[i] ?? {}),
    };
  });
}

function canIntegratedLtfReaction(
  tfBars: Bar[],
  poi: any,
  gate: any
): boolean {
  const gateEval = evaluateLtfGateFromTfBars(tfBars, poi);
  const triggerEval = evaluateLtfTriggers(tfBars, poi);
  const currentBar = tfBars[tfBars.length - 1];

  const cooldownEval = evaluateReactionGate(
    gate,
    currentBar.tf as "M15" | "M5",
    currentBar.closeTime
  );

  return Boolean(
    gateEval?.passGate &&
      triggerEval &&
      triggerEval.tokens.length > 0 &&
      !cooldownEval.reactionBlocked
  );
}

function canIntegratedLtfEntry(
  tfBars: Bar[],
  poi: any,
  gate: any
): boolean {
  const currentBar = tfBars[tfBars.length - 1];

  if (currentBar.tf !== "M5") {
    return false;
  }

  const gateEval = evaluateLtfGateFromTfBars(tfBars, poi);
  const triggerEval = evaluateLtfTriggers(tfBars, poi);
  const cooldownEval = evaluateReactionGate(gate, "M5", currentBar.closeTime);

  return Boolean(
    gateEval?.passGate &&
      triggerEval &&
      triggerEval.tokens.length > 0 &&
      !cooldownEval.entryBlocked
  );
}

const sweepBullEqLowPair = [
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 2, 17, 3, 59, 59),
    pivotPrice: 90.5,
    confirmedAt: Date.UTC(2026, 2, 17, 15, 59, 59),
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
    pivotPrice: 90,
    confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
    isConfirmed: true,
  },
] as const;

const sweepBullWideLowPair = [
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 2, 17, 3, 59, 59),
    pivotPrice: 90,
    confirmedAt: Date.UTC(2026, 2, 17, 15, 59, 59),
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
    pivotPrice: 91.2,
    confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
    isConfirmed: true,
  },
] as const;

const sweepBearEqHighPair = [
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: Date.UTC(2026, 2, 17, 3, 59, 59),
    pivotPrice: 109.5,
    confirmedAt: Date.UTC(2026, 2, 17, 15, 59, 59),
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
    pivotPrice: 110,
    confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
    isConfirmed: true,
  },
] as const;

const sweepFallbackLowPivot = {
  tf: "H4" as const,
  pivotType: "LOW" as const,
  pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
  pivotPrice: 88,
  confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
  isConfirmed: true,
};

const sweepFallbackHighPivot = {
  tf: "H4" as const,
  pivotType: "HIGH" as const,
  pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
  pivotPrice: 112,
  confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
  isConfirmed: true,
};

const sweepBullBarsValid = buildH4SweepBars({
  16: { open: 94, high: 95, low: 89, close: 89 },
  17: { open: 89, high: 92, low: 88, close: 91 },
});

const sweepBullBarsLateSweep = buildH4SweepBars(
  {
    17: { open: 89, high: 92, low: 89, close: 89 },
    18: { open: 89, high: 92, low: 88, close: 91 },
  },
  19
);

const sweepBullBarsLateRecovery = buildH4SweepBars(
  {
    16: { open: 94, high: 95, low: 89, close: 89 },
    17: { open: 89, high: 90, low: 88, close: 90 },
    18: { open: 90, high: 92, low: 89, close: 91 },
  },
  19
);

const sweepBearBarsValid = buildH4SweepBars({
  16: { open: 109, high: 111, low: 105, close: 106 },
  17: { open: 106, high: 109, low: 104, close: 109 },
});

const f4ContextInput = {
  symbol: "BTCUSDT",
  dir: "BULL" as const,
  confTime: Date.UTC(2026, 2, 19, 3, 59, 59),
  candidateId: "BTCUSDT:H4_CORE_FVG:CONF",
  candidateZone: {
    bottomRaw: 100,
    topRaw: 101,
    heightRaw: 1,
  },
  atr4hAtConf: 4,
};
const reactionGateBaseTime = Date.UTC(2026, 3, 3, 0, 0, 0);

const policySampleSignalCandidate: SignalCandidate = {
  symbol: "BTCUSDT",
  time: "2026-06-01T00:00:00Z",
  source: "FVG",
  eventType: "ENTRY_WINDOW_OPEN",
  dir: "BULL",
  poiTier: "H4_CORE",
  poiId: "POI-1",
  entryBoundaryPrice: 100,
  hardInvalidationPrice: 95,
  lastPrice: 101,
  midPrice: 100.5,
  tickSize: 0.1,
  ltAtr14: 2.5,
  triggerCount: 2,
  collabStrength: "STRONG",
  hasStack: true,
  tags: ["A", "B"],
  expectedRR: 1.6,
  tpRefPrice: 108,
};

const policySampleMarketSnapshot: MarketSnapshot = {
  time: "2026-06-01T00:00:00Z",
  symbol: "BTCUSDT",
  bid: 100.4,
  ask: 100.6,
  last: 100.5,
  mid: 100.5,
  atr14_price: 2.2,
  atr14_bps: 218.9,
  volume_m5: 12345,
  barChange_bps_m5: 35,
  dataOk: true,
  dataState: "OK",
};

const policySampleAccountSnapshot: AccountSnapshot = {
  time: "2026-06-01T00:00:00Z",
  equity: 10000,
  riskMode: "NORMAL",
  realizedPnl_24h_pct: -0.4,
  consecutiveLosses: 1,
  openRiskPct: 0.008,
  signalsSent_60m: 3,
};

const policySampleDerived: DerivedValues = {
  spread_bps: 2,
  fee_bps_roundtrip: 8,
  slippage_bps_p95_est: 1.2,
  slippage_multiplier: 1,
  c_bps_roundtrip: 9.2,
  entryRefPrice: 100.5,
  s_raw_bps: 547.2636815920398,
  stopBuffer_price: 0.4,
  stopBuffer_bps: 39.800995024875625,
  s_effective_bps: 587.0646766169154,
  SC: 6.2,
  fastMove: false,
  atrRatio: 1.1,
  q95_short: 300,
  regimeState: "OK",
  volState: "NORMAL",
  liquidityState: "NORMAL",
  poiClusterKey: "BTCUSDT:BULL:100",
  evidenceLevel: "MID",
  usedSignature: "MID",
  lcbR: 0.24,
  reward_bps: 746.2686567164179,
  expectedRR_used: 1.27,
  rewardProxy: "MID",
  isExceptional: false,
};

const policySampleResult: PolicyResult = {
  decision: "ALLOW",
  policyScoreDeltaSum: -5,
  policyTags: ["EDGE_OK", "SC_GOOD"],
  reasons: [],
  riskMode: "NORMAL",
  suggestedRiskPct: 0.01,
  derived: policySampleDerived,
};

const regimeLongAtrHistory = [100, 200, 300, 400, 500];
const regimeShortAtrHistoryWeak = [100, 200, 300, 400, 600];
const regimeShortAtrHistoryStrong = [100, 200, 300, 400, 450];
const regimeLongVolumeHistory = [100, 200, 300, 400, 500];

const edgeFineInsufficientStats = {
  meanR: 0.8,
  stdR: 0.4,
  n: 10,
};

const edgeMidPositiveStats = {
  meanR: 0.4,
  stdR: 0.1,
  n: 35,
};

const edgeCoarsePositiveStats = {
  meanR: 0.3,
  stdR: 0.1,
  n: 40,
};

const edgeNegativeStats = {
  meanR: -0.1,
  stdR: 0.2,
  n: 30,
};

const edgeKellyStats = {
  meanR: 0.5,
  stdR: 0.25,
  n: 120,
};

const riskAccountBase: AccountSnapshot = {
  ...policySampleAccountSnapshot,
  riskMode: "NORMAL",
  realizedPnl_24h_pct: 0,
  consecutiveLosses: 0,
};

const concentrationSignalBase: SignalCandidate = {
  ...policySampleSignalCandidate,
  time: "2026-06-01T00:15:00Z",
  dir: "BULL",
  poiTier: "H4_CORE",
  eventType: "REACTION",
  triggerCount: 2,
  collabStrength: "WEAK",
  hasStack: false,
};

const concentrationExceptionalEntrySignal: SignalCandidate = {
  ...concentrationSignalBase,
  eventType: "ENTRY_WINDOW_OPEN",
  poiTier: "D1_POI",
  collabStrength: "WEAK",
  hasStack: false,
  entryBoundaryPrice: 100.5,
};

const concentrationExceptionalReactionSignal: SignalCandidate = {
  ...concentrationSignalBase,
  eventType: "REACTION",
  poiTier: "D1_POI",
  collabStrength: "STRONG",
  hasStack: false,
};

const concentrationHistorySameCluster: ConcentrationHistoryItem[] = [
  {
    time: "2026-06-01T00:01:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "1000",
  },
  {
    time: "2026-06-01T00:10:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "1000",
  },
];

const concentrationHistoryFiveUnique: ConcentrationHistoryItem[] = [
  {
    time: "2026-06-01T00:01:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "1000",
  },
  {
    time: "2026-06-01T00:02:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "1001",
  },
  {
    time: "2026-06-01T00:03:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "1002",
  },
  {
    time: "2026-06-01T00:04:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "1003",
  },
  {
    time: "2026-06-01T00:05:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "1004",
  },
];

const concentrationHistoryMixed: ConcentrationHistoryItem[] = [
  {
    time: "2026-06-01T00:01:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "1000",
  },
  {
    time: "2026-06-01T00:02:00Z",
    symbol: "ETHUSDT",
    dir: "BULL",
    poiClusterKey: "2000",
  },
  {
    time: "2026-06-01T00:03:00Z",
    symbol: "BTCUSDT",
    dir: "BEAR",
    poiClusterKey: "3000",
  },
  {
    time: "2026-05-31T23:40:00Z",
    symbol: "BTCUSDT",
    dir: "BULL",
    poiClusterKey: "4000",
  },
];

const channelAnchorA = {
  time: 1000,
  price: 100,
};

const channelAnchorB = {
  time: 1010,
  price: 110,
};
const channelFlatAnchorA = {
  time: 1000,
  price: 100,
};

const channelFlatAnchorB = {
  time: 2000,
  price: 100,
};

const channelBreakD1Up = createD1H4OperationalChannel({
  symbol: "BTCUSDT",
  tf: "D1",
  dir: "UP",
  a: channelFlatAnchorA,
  b: channelFlatAnchorB,
  offset: 10,
  createdAt: 3000,
})!;

const channelBreakH4Down = createD1H4OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H4",
  dir: "DOWN",
  a: channelFlatAnchorA,
  b: channelFlatAnchorB,
  offset: 10,
  createdAt: 4000,
})!;

const channelBreakH1Up = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelFlatAnchorA,
  b: channelFlatAnchorB,
  offset: 10,
  createdAt: 5000,
  activeParentPoiCount: 1,
})!;

const channelBreakM30Down = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "M30",
  dir: "DOWN",
  a: channelFlatAnchorA,
  b: channelFlatAnchorB,
  offset: 10,
  createdAt: 6000,
  activeParentPoiCount: 1,
})!;

const channelPoiD1Up = channelBreakD1Up;
const channelPoiH4Down = channelBreakH4Down;
const channelPoiH1Up = channelBreakH1Up;
const channelPoiM30Down = channelBreakM30Down;

const channelPoiGateD1Bars = buildChannelPoiGateBars(
  "D1",
  { open: 103, high: 108, low: 98, close: 103 },
  { high: 108.5, low: 98.5, close: 103 },
  Date.UTC(2026, 4, 28, 0, 0, 0)
);

const channelPoiGateH4Bars = buildChannelPoiGateBars(
  "H4",
  { open: 97, high: 102, low: 92, close: 97 },
  { high: 103, low: 93, close: 97 },
  Date.UTC(2026, 4, 29, 0, 0, 0)
);

const channelPoiGateH1Bars = buildChannelPoiGateBars(
  "H1",
  { open: 103, high: 108, low: 98, close: 103 },
  { high: 108, low: 98, close: 103 },
  Date.UTC(2026, 4, 30, 0, 0, 0)
);

const channelPoiGateM30Bars = buildChannelPoiGateBars(
  "M30",
  { open: 97, high: 102, low: 92, close: 97 },
  { high: 104, low: 94, close: 97 },
  Date.UTC(2026, 4, 30, 12, 0, 0)
);

const channelParentNear = {
  id: "PARENT-NEAR",
  boundaryPrice: 99.5,
  zone: {
    bottom: 99,
    top: 101,
    height: 2,
  },
};

const channelParentInside = {
  id: "PARENT-INSIDE",
  boundaryPrice: 120,
  zone: {
    bottom: 99.5,
    top: 100.5,
    height: 1,
  },
};

const channelParentFar = {
  id: "PARENT-FAR",
  boundaryPrice: 120,
  zone: {
    bottom: 110,
    top: 112,
    height: 2,
  },
};

const channelPoiGateEvalD1Pass = {
  tf: "D1" as const,
  dir: "BULL" as const,
  currentCloseTime: channelPoiGateD1Bars[14].closeTime,
  boundaryPrice: 100,
  wickExtreme: 98.5,
  dist: 1.5,
  atrAtBar: 10,
  gateAtrMultiplier: 0.15,
  passGate: true,
};

const channelPoiGateEvalH4Pass = {
  tf: "H4" as const,
  dir: "BEAR" as const,
  currentCloseTime: channelPoiGateH4Bars[14].closeTime,
  boundaryPrice: 100,
  wickExtreme: 103,
  dist: 3,
  atrAtBar: 25,
  gateAtrMultiplier: 0.12,
  passGate: true,
};

const channelPoiGateEvalH1Pass = {
  tf: "H1" as const,
  dir: "BULL" as const,
  currentCloseTime: channelPoiGateH1Bars[14].closeTime,
  boundaryPrice: 100,
  wickExtreme: 98,
  dist: 2,
  atrAtBar: 25,
  gateAtrMultiplier: 0.08,
  passGate: true,
};

const channelPoiGateEvalM30Pass = {
  tf: "M30" as const,
  dir: "BEAR" as const,
  currentCloseTime: channelPoiGateM30Bars[14].closeTime,
  boundaryPrice: 100,
  wickExtreme: 101,
  dist: 1,
  atrAtBar: 25,
  gateAtrMultiplier: 0.06,
  passGate: true,
};

const channelPoiTriggerEval2of3 = {
  tf: "D1" as const,
  dir: "BULL" as const,
  currentCloseTime: channelPoiGateD1Bars[14].closeTime,
  sweepRec: true,
  structure: true,
  disp: false,
  triggers: ["sweepRec", "structure"] as const,
};

const channelPoiTriggerEval1of3H4 = {
  tf: "H4" as const,
  dir: "BEAR" as const,
  currentCloseTime: channelPoiGateH4Bars[14].closeTime,
  sweepRec: true,
  structure: false,
  disp: false,
  triggers: ["sweepRec"] as const,
};

const channelPoiTriggerEval3of3H1 = {
  tf: "H1" as const,
  dir: "BULL" as const,
  currentCloseTime: channelPoiGateH1Bars[14].closeTime,
  sweepRec: true,
  structure: true,
  disp: true,
  triggers: ["sweepRec", "structure", "disp"] as const,
};

const channelPoiTriggerEval3of3M30 = {
  tf: "M30" as const,
  dir: "BEAR" as const,
  currentCloseTime: channelPoiGateM30Bars[14].closeTime,
  sweepRec: true,
  structure: true,
  disp: true,
  triggers: ["sweepRec", "structure", "disp"] as const,
};

const channelPoiH1Enabled = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 5,
  createdAt: 4000,
  activeParentPoiCount: 1,
})!;

const channelPoiH1ContextOnly = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 5,
  createdAt: 4000,
  activeParentPoiCount: 0,
})!;

const channelPoiM30Enabled = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "M30",
  dir: "DOWN",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 4,
  createdAt: 5000,
  activeParentPoiCount: 1,
})!;

const channelTriggerDispMaxBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 1, 3, 59, 59),
    open: 100,
    high: 106,
    low: 99,
    close: 104,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 1, 4, 0, 0),
    closeTime: Date.UTC(2026, 5, 1, 7, 59, 59),
    open: 104,
    high: 116,
    low: 103,
    close: 115,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 1, 8, 0, 0),
    closeTime: Date.UTC(2026, 5, 1, 11, 59, 59),
    open: 115,
    high: 118,
    low: 114,
    close: 117,
    volume: 0,
  },
];

const channelTriggerDispSumBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 2, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 2, 0, 59, 59),
    open: 100,
    high: 109,
    low: 99,
    close: 108,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 2, 1, 0, 0),
    closeTime: Date.UTC(2026, 5, 2, 1, 59, 59),
    open: 108,
    high: 117,
    low: 107,
    close: 116,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 2, 2, 0, 0),
    closeTime: Date.UTC(2026, 5, 2, 2, 59, 59),
    open: 116,
    high: 125,
    low: 115,
    close: 123,
    volume: 0,
  },
];

const channelTriggerDispStrictFailBars: Bar[] = [
  {
    tf: "M30",
    openTime: Date.UTC(2026, 5, 3, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 3, 0, 29, 59),
    open: 100,
    high: 111,
    low: 99,
    close: 110,
    volume: 0,
  },
  {
    tf: "M30",
    openTime: Date.UTC(2026, 5, 3, 0, 30, 0),
    closeTime: Date.UTC(2026, 5, 3, 0, 59, 59),
    open: 110,
    high: 115,
    low: 109,
    close: 114,
    volume: 0,
  },
  {
    tf: "M30",
    openTime: Date.UTC(2026, 5, 3, 1, 0, 0),
    closeTime: Date.UTC(2026, 5, 3, 1, 29, 59),
    open: 114,
    high: 115,
    low: 109,
    close: 110,
    volume: 0,
  },
];

const channelSweepRecUpBars = buildChannelBars(
  "H1",
  3,
  {
    1: { open: 107, high: 109, low: 99, close: 99 },
    2: { open: 96, high: 108, low: 100, close: 103 },
  },
  Date.UTC(2026, 5, 4, 0, 0, 0)
);

const channelSweepRecDownBars = buildChannelBars(
  "M30",
  3,
  {
    1: { open: 94, high: 101, low: 90, close: 101 },
    2: { open: 101, high: 102, low: 95, close: 99 },
  },
  Date.UTC(2026, 5, 5, 0, 0, 0)
);

const channelSweepRecCarryBars = buildChannelBars(
  "H1",
  4,
  {
    1: { open: 107, high: 109, low: 99, close: 99 },
    2: { open: 96, high: 108, low: 100, close: 103 },
    3: { open: 103, high: 108, low: 100, close: 103 },
  },
  Date.UTC(2026, 5, 6, 0, 0, 0)
);

const channelPoiTriggerWrapperBars = buildChannelBars(
  "H1",
  15,
  {
    12: { open: 100, high: 108, low: 98, close: 104 },
    13: { open: 107, high: 109, low: 99, close: 99 },
    14: { open: 96, high: 108, low: 98, close: 103 },
  },
  Date.UTC(2026, 5, 7, 0, 0, 0)
);

const d1BreakBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 4, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 1, 23, 59, 59),
    open: 109,
    high: 113,
    low: 108,
    close: 112,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 4, 2, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 2, 23, 59, 59),
    open: 112,
    high: 115,
    low: 111,
    close: 112,
    volume: 0,
  },
];

const h4BreakBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 4, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 1, 3, 59, 59),
    open: 91,
    high: 92,
    low: 88,
    close: 89.5,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 4, 1, 4, 0, 0),
    closeTime: Date.UTC(2026, 4, 1, 7, 59, 59),
    open: 89.5,
    high: 90,
    low: 87,
    close: 88,
    volume: 0,
  },
];

const h1BreakBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 4, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 1, 0, 59, 59),
    open: 109,
    high: 114,
    low: 108,
    close: 113,
    volume: 0,
  },
];

const m30BreakBars: Bar[] = [
  {
    tf: "M30",
    openTime: Date.UTC(2026, 4, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 1, 0, 29, 59),
    open: 91,
    high: 92,
    low: 86,
    close: 86.5,
    volume: 0,
  },
];

const d1AnchorInvalidBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 4, 3, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 3, 23, 59, 59),
    open: 101,
    high: 102,
    low: 97,
    close: 99,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 4, 4, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 4, 23, 59, 59),
    open: 99,
    high: 100,
    low: 97,
    close: 98,
    volume: 0,
  },
];

const h4AnchorInvalidBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 4, 3, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 3, 3, 59, 59),
    open: 100,
    high: 103,
    low: 99,
    close: 101,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 4, 3, 4, 0, 0),
    closeTime: Date.UTC(2026, 4, 3, 7, 59, 59),
    open: 101,
    high: 104,
    low: 100,
    close: 102,
    volume: 0,
  },
];

const d1BreakNotEnoughBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 4, 5, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 5, 23, 59, 59),
    open: 108,
    high: 110,
    low: 107,
    close: 109,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 4, 6, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 6, 23, 59, 59),
    open: 109,
    high: 113,
    low: 108,
    close: 112,
    volume: 0,
  },
];

const h1BreakLowDeviationBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 4, 7, 0, 0, 0),
    closeTime: Date.UTC(2026, 4, 7, 0, 59, 59),
    open: 109,
    high: 113,
    low: 108,
    close: 112.9,
    volume: 0,
  },
];

const channelD1CreatedAt = 2000;
const channelH4CreatedAt = 3000;
const channelH1CreatedAt = 4000;
const channelM30CreatedAt = 5000;
const channelModeEventTime = Date.UTC(2026, 4, 25, 12, 34, 56);

const trendlineHighPivotBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 10, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 10, 3, 59, 59),
    open: 96,
    high: 100,
    low: 94,
    close: 97,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 10, 4, 0, 0),
    closeTime: Date.UTC(2026, 5, 10, 7, 59, 59),
    open: 98,
    high: 102,
    low: 95,
    close: 99,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 10, 8, 0, 0),
    closeTime: Date.UTC(2026, 5, 10, 11, 59, 59),
    open: 100,
    high: 104,
    low: 96,
    close: 101,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 10, 12, 0, 0),
    closeTime: Date.UTC(2026, 5, 10, 15, 59, 59),
    open: 105,
    high: 110,
    low: 100,
    close: 106,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 10, 16, 0, 0),
    closeTime: Date.UTC(2026, 5, 10, 19, 59, 59),
    open: 103,
    high: 105,
    low: 99,
    close: 102,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 10, 20, 0, 0),
    closeTime: Date.UTC(2026, 5, 10, 23, 59, 59),
    open: 101,
    high: 103,
    low: 98,
    close: 100,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 11, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 11, 3, 59, 59),
    open: 100,
    high: 101,
    low: 97,
    close: 99,
    volume: 0,
  },
];

const trendlineLowPivotBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 11, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 11, 0, 59, 59),
    open: 104,
    high: 106,
    low: 100,
    close: 103,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 11, 1, 0, 0),
    closeTime: Date.UTC(2026, 5, 11, 1, 59, 59),
    open: 103,
    high: 105,
    low: 98,
    close: 102,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 11, 2, 0, 0),
    closeTime: Date.UTC(2026, 5, 11, 2, 59, 59),
    open: 102,
    high: 104,
    low: 96,
    close: 101,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 11, 3, 0, 0),
    closeTime: Date.UTC(2026, 5, 11, 3, 59, 59),
    open: 96,
    high: 100,
    low: 90,
    close: 95,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 11, 4, 0, 0),
    closeTime: Date.UTC(2026, 5, 11, 4, 59, 59),
    open: 98,
    high: 102,
    low: 95,
    close: 99,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 11, 5, 0, 0),
    closeTime: Date.UTC(2026, 5, 11, 5, 59, 59),
    open: 100,
    high: 103,
    low: 97,
    close: 101,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 11, 6, 0, 0),
    closeTime: Date.UTC(2026, 5, 11, 6, 59, 59),
    open: 101,
    high: 104,
    low: 99,
    close: 102,
    volume: 0,
  },
];

const trendlinePivotBaseHistory = [
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: 100,
    pivotPrice: 110,
    confirmedAt: 200,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: 300,
    pivotPrice: 120,
    confirmedAt: 400,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: 500,
    pivotPrice: 130,
    confirmedAt: 600,
    isConfirmed: true,
  },
];

const trendlinePivotNewHigh = {
  tf: "H4" as const,
  pivotType: "HIGH" as const,
  pivotTime: 700,
  pivotPrice: 140,
  confirmedAt: 800,
  isConfirmed: true,
};

const trendlinePivotDuplicateHigh = {
  tf: "H4" as const,
  pivotType: "HIGH" as const,
  pivotTime: 500,
  pivotPrice: 130,
  confirmedAt: 600,
  isConfirmed: true,
};

const trendlineDetectD1HighsUp = [
  {
    tf: "D1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 100,
    pivotPrice: 110,
    confirmedAt: 200,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 300,
    pivotPrice: 120,
    confirmedAt: 400,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 500,
    pivotPrice: 130,
    confirmedAt: 600,
    isConfirmed: true,
  },
];

const trendlineDetectD1LowsUp = [
  {
    tf: "D1" as const,
    pivotType: "LOW" as const,
    pivotTime: 120,
    pivotPrice: 90,
    confirmedAt: 220,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "LOW" as const,
    pivotTime: 320,
    pivotPrice: 95,
    confirmedAt: 420,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "LOW" as const,
    pivotTime: 520,
    pivotPrice: 100,
    confirmedAt: 620,
    isConfirmed: true,
  },
];

const trendlineDetectH1Highs = [
  {
    tf: "H1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 100,
    pivotPrice: 110,
    confirmedAt: 200,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 300,
    pivotPrice: 120,
    confirmedAt: 400,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 500,
    pivotPrice: 130,
    confirmedAt: 600,
    isConfirmed: true,
  },
];

const trendlineDetectH1Lows = [
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 120,
    pivotPrice: 90,
    confirmedAt: 220,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 320,
    pivotPrice: 95,
    confirmedAt: 420,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 520,
    pivotPrice: 100,
    confirmedAt: 620,
    isConfirmed: true,
  },
];

const trendlineFallbackLowPivots = [
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 100,
    pivotPrice: 95,
    confirmedAt: 200,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 300,
    pivotPrice: 101,
    confirmedAt: 400,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 500,
    pivotPrice: 101.5,
    confirmedAt: 600,
    isConfirmed: true,
  },
];

const trendlineOutOfLookbackLows = [
  {
    tf: "D1" as const,
    pivotType: "LOW" as const,
    pivotTime: 0,
    pivotPrice: 90,
    confirmedAt: 0,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "LOW" as const,
    pivotTime: 86400000,
    pivotPrice: 100,
    confirmedAt: 86400000,
    isConfirmed: true,
  },
];

const trendlineMixedSwingLowA = {
  tf: "H1" as const,
  pivotType: "LOW" as const,
  pivotTime: 100,
  pivotPrice: 100,
  confirmedAt: 200,
  isConfirmed: true,
};

const trendlineMixedSwingLowB = {
  tf: "H1" as const,
  pivotType: "LOW" as const,
  pivotTime: 300,
  pivotPrice: 103.5,
  confirmedAt: 400,
  isConfirmed: true,
};

const trendlineFlatSupportD1 = {
  id: "TL-D1-SUP",
  symbol: "BTCUSDT",
  tf: "D1" as const,
  type: "TL_SUPPORT" as const,
  state: "ACTIVE" as const,
  a1Time: 1000,
  a1Price: 100,
  a2Time: 2000,
  a2Price: 100,
  createdAt: 2000,
  touchCount: 0,
  breakStreak: 0,
  roleFlipCount: 0,
  tags: [],
  bestMatch: { kind: "NONE" as const },
  maxForwardBars: 300,
  displayUntil: 2000 + 300 * 24 * 60 * 60 * 1000,
};

const trendlineFlatSupportH4 = {
  ...trendlineFlatSupportD1,
  id: "TL-H4-SUP",
  tf: "H4" as const,
  maxForwardBars: 250,
  displayUntil: 2000 + 250 * 4 * 60 * 60 * 1000,
};

const trendlineFlatResistH1 = {
  ...trendlineFlatSupportD1,
  id: "TL-H1-RES",
  tf: "H1" as const,
  type: "TL_RESIST" as const,
  maxForwardBars: 150,
  displayUntil: 2000 + 150 * 60 * 60 * 1000,
};

const trendlineSupportTouchBar: Bar = {
  tf: "H4",
  openTime: Date.UTC(2026, 5, 12, 0, 0, 0),
  closeTime: Date.UTC(2026, 5, 12, 3, 59, 59),
  open: 103,
  high: 104,
  low: 101.5,
  close: 103,
  volume: 0,
};

const trendlineResistTouchBar: Bar = {
  tf: "H1",
  openTime: Date.UTC(2026, 5, 12, 4, 0, 0),
  closeTime: Date.UTC(2026, 5, 12, 4, 59, 59),
  open: 97,
  high: 98.5,
  low: 96,
  close: 97.5,
  volume: 0,
};

const trendlineD1BreakBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 5, 13, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 13, 23, 59, 59),
    open: 100,
    high: 101,
    low: 97,
    close: 97.9,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 5, 14, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 14, 23, 59, 59),
    open: 98,
    high: 99,
    low: 97,
    close: 97.5,
    volume: 0,
  },
];

const trendlineH1BreakBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 15, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 15, 0, 59, 59),
    open: 101,
    high: 103,
    low: 100,
    close: 102.6,
    volume: 0,
  },
];

const trendlineMixedD1BreakBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 5, 16, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 16, 23, 59, 59),
    open: 100,
    high: 101,
    low: 97,
    close: 97.9,
    volume: 0,
  },
];

const trendlineExactThresholdBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 5, 17, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 17, 23, 59, 59),
    open: 100,
    high: 101,
    low: 98,
    close: 98,
    volume: 0,
  },
];

const trendlineRoleFlipSupportLine = {
  ...trendlineFlatSupportH4,
  roleFlipWatch: undefined,
  roleFlipCount: 0,
  tags: [],
};

const trendlineRoleFlipResistLine = {
  ...trendlineFlatResistH1,
  roleFlipWatch: undefined,
  roleFlipCount: 0,
  tags: [],
};

const trendlineRoleFlipBreakCandidateH4 = {
  tf: "H4" as const,
  currentCloseTime: Date.UTC(2026, 5, 18, 3, 59, 59),
  requiredCloses: 2,
  atrAtBar: 10,
  atrMultiplier: 0.2,
  breakCount: 1,
  linePrice: 100,
  closeDeviation: 3,
  breakCandidate: true,
  breakConfirmed: false,
};

const trendlineRoleFlipBreakCandidateH1 = {
  tf: "H1" as const,
  currentCloseTime: Date.UTC(2026, 5, 19, 0, 59, 59),
  requiredCloses: 1,
  atrAtBar: 10,
  atrMultiplier: 0.25,
  breakCount: 1,
  linePrice: 100,
  closeDeviation: 3,
  breakCandidate: true,
  breakConfirmed: false,
};

const trendlineRoleFlipTouchH4 = {
  tf: "H4" as const,
  currentCloseTime: Date.UTC(2026, 5, 18, 7, 59, 59),
  linePrice: 100,
  touchMargin: 1.5,
  touched: true,
};

const trendlineRoleFlipTouchH1 = {
  tf: "H1" as const,
  currentCloseTime: Date.UTC(2026, 5, 19, 1, 59, 59),
  linePrice: 100,
  touchMargin: 1.5,
  touched: true,
};

const trendlineRoleFlipBarSupportTouch: Bar = {
  tf: "H4",
  openTime: Date.UTC(2026, 5, 18, 4, 0, 0),
  closeTime: Date.UTC(2026, 5, 18, 7, 59, 59),
  open: 102,
  high: 103,
  low: 101,
  close: 101.5,
  volume: 0,
};

const trendlineRoleFlipBarSupportConfirm: Bar = {
  tf: "H4",
  openTime: Date.UTC(2026, 5, 18, 8, 0, 0),
  closeTime: Date.UTC(2026, 5, 18, 11, 59, 59),
  open: 100,
  high: 101,
  low: 97,
  close: 99,
  volume: 0,
};

const trendlineRoleFlipBarResistTouch: Bar = {
  tf: "H1",
  openTime: Date.UTC(2026, 5, 19, 1, 0, 0),
  closeTime: Date.UTC(2026, 5, 19, 1, 59, 59),
  open: 98,
  high: 99,
  low: 97,
  close: 98.5,
  volume: 0,
};

const trendlineRoleFlipBarResistConfirm: Bar = {
  tf: "H1",
  openTime: Date.UTC(2026, 5, 19, 2, 0, 0),
  closeTime: Date.UTC(2026, 5, 19, 2, 59, 59),
  open: 100,
  high: 103,
  low: 99,
  close: 101,
  volume: 0,
};

const trendlineRoleFlipExpiredWatchLine = {
  ...trendlineRoleFlipSupportLine,
  roleFlipWatch: {
    startedAt: Date.UTC(2026, 5, 20, 0, 0, 0),
    typeBefore: "TL_SUPPORT" as const,
    touchSeen: true,
    touchTime: Date.UTC(2026, 5, 20, 3, 59, 59),
    barsSinceTouch: 2,
  },
};

const trendlineRoleFlipExpiredBar: Bar = {
  tf: "H4",
  openTime: Date.UTC(2026, 5, 20, 4, 0, 0),
  closeTime: Date.UTC(2026, 5, 20, 7, 59, 59),
  open: 101,
  high: 102,
  low: 100,
  close: 100.5,
  volume: 0,
};

const trendlineRoleFlipTaggedLine = {
  ...trendlineRoleFlipSupportLine,
  tags: ["TL_ROLE_FLIP"],
  roleFlipWatch: {
    startedAt: Date.UTC(2026, 5, 21, 0, 0, 0),
    typeBefore: "TL_SUPPORT" as const,
    touchSeen: true,
    touchTime: Date.UTC(2026, 5, 21, 3, 59, 59),
    barsSinceTouch: 0,
  },
};

const trendlineRoleFlipInactiveLine = {
  ...trendlineRoleFlipSupportLine,
  state: "INACTIVE" as const,
};

const trendlineStructureHighsUp = [
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: 100,
    pivotPrice: 110,
    confirmedAt: 200,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: 300,
    pivotPrice: 120,
    confirmedAt: 400,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: 500,
    pivotPrice: 130,
    confirmedAt: 600,
    isConfirmed: true,
  },
];

const trendlineStructureLowsUp = [
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 120,
    pivotPrice: 90,
    confirmedAt: 220,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 320,
    pivotPrice: 95,
    confirmedAt: 420,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 520,
    pivotPrice: 100,
    confirmedAt: 620,
    isConfirmed: true,
  },
];

const trendlineStructureHighsDown = [
  {
    tf: "D1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 100,
    pivotPrice: 130,
    confirmedAt: 200,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 300,
    pivotPrice: 120,
    confirmedAt: 400,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 500,
    pivotPrice: 110,
    confirmedAt: 600,
    isConfirmed: true,
  },
];

const trendlineStructureLowsDown = [
  {
    tf: "D1" as const,
    pivotType: "LOW" as const,
    pivotTime: 120,
    pivotPrice: 100,
    confirmedAt: 220,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "LOW" as const,
    pivotTime: 320,
    pivotPrice: 95,
    confirmedAt: 420,
    isConfirmed: true,
  },
  {
    tf: "D1" as const,
    pivotType: "LOW" as const,
    pivotTime: 520,
    pivotPrice: 90,
    confirmedAt: 620,
    isConfirmed: true,
  },
];

const trendlineStructureLowsMixed = [
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 120,
    pivotPrice: 90,
    confirmedAt: 220,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 320,
    pivotPrice: 88,
    confirmedAt: 420,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 520,
    pivotPrice: 89,
    confirmedAt: 620,
    isConfirmed: true,
  },
];

const trendlineHighsWithExtra = [
  ...trendlineStructureHighsUp,
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: 700,
    pivotPrice: 140,
    confirmedAt: 800,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: 900,
    pivotPrice: 150,
    confirmedAt: 1000,
    isConfirmed: false,
  },
];
const channelEventTime = Date.UTC(2026, 4, 31, 12, 34, 56);
const channelResidualUpMixedBars = buildChannelResidualBars(
  "H1",
  "UP",
  [1, -1, 3, 0, 5, 6],
  Date.UTC(2026, 4, 8, 0, 0, 0)
);

const channelResidualD1Bars = buildChannelResidualBars(
  "D1",
  "UP",
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  Date.UTC(2026, 4, 9, 0, 0, 0)
);

const channelResidualH4Bars = buildChannelResidualBars(
  "H4",
  "UP",
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  Date.UTC(2026, 4, 20, 0, 0, 0)
);

const channelResidualH1Bars = buildChannelResidualBars(
  "H1",
  "UP",
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  Date.UTC(2026, 4, 21, 0, 0, 0)
);

const channelResidualM30Bars = buildChannelResidualBars(
  "M30",
  "UP",
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  Date.UTC(2026, 4, 22, 0, 0, 0)
);

const channelResidualH1LongLookbackBars = buildChannelResidualBars(
  "H1",
  "UP",
  [
    100, 100, 100, 100, 100,
    ...Array.from({ length: 300 }, () => 1),
  ],
  Date.UTC(2026, 4, 23, 0, 0, 0)
);

const d1StrongDispMaxBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 20, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 20, 23, 59, 59),
    open: 100,
    high: 106,
    low: 99,
    close: 104,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 21, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 21, 23, 59, 59),
    open: 104,
    high: 121,
    low: 103,
    close: 120,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 22, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 22, 23, 59, 59),
    open: 120,
    high: 124,
    low: 119,
    close: 123,
    volume: 0,
  },
];

const d1StrongDispSumBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 23, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 23, 23, 59, 59),
    open: 100,
    high: 109,
    low: 99,
    close: 108,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 24, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 24, 23, 59, 59),
    open: 108,
    high: 117,
    low: 107,
    close: 116,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 25, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 25, 23, 59, 59),
    open: 116,
    high: 126,
    low: 115,
    close: 125,
    volume: 0,
  },
];

const d1BullDetectedFvg = {
  tf: "D1" as const,
  dir: "BULL" as const,
  leftCloseTime: Date.UTC(2026, 2, 26, 23, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 27, 23, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  confTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 100,
    top: 102,
    height: 2,
  },
};

const d1BearDetectedFvg = {
  tf: "D1" as const,
  dir: "BEAR" as const,
  leftCloseTime: Date.UTC(2026, 2, 26, 23, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 27, 23, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  confTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 98,
    top: 100,
    height: 2,
  },
};

const d1SmallDetectedFvg = {
  tf: "D1" as const,
  dir: "BULL" as const,
  leftCloseTime: Date.UTC(2026, 2, 26, 23, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 27, 23, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  confTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 100,
    top: 101,
    height: 1,
  },
};

const H4_BAR_DURATION_MS = 4 * 60 * 60 * 1000;

const h4DetectedFvg = {
  tf: "H4" as const,
  dir: "BULL" as const,
  leftCloseTime: Date.UTC(2026, 2, 29, 3, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 29, 7, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 29, 11, 59, 59),
  confTime: Date.UTC(2026, 2, 29, 11, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 100,
    top: 102,
    height: 2,
  },
};

const h4DisplacementPassEval = {
  confTime: h4DetectedFvg.confTime,
  atrAtConf: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const h4DisplacementMismatchedEval = {
  confTime: h4DetectedFvg.confTime - H4_BAR_DURATION_MS,
  atrAtConf: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const h4CandidatePassF1 = createH4CoreFvgCandidate({
  id: "H4-C-1",
  symbol: "BTCUSDT",
  detectedFvg: h4DetectedFvg,
  displacementEval: h4DisplacementPassEval,
})!;

const h4CandidateFailF1 = createH4CoreFvgCandidate({
  id: "H4-C-2",
  symbol: "BTCUSDT",
  detectedFvg: h4DetectedFvg,
  displacementEval: h4DisplacementMismatchedEval,
})!;

const h4SecondaryBullBreaks = [
  {
    tf: "H4" as const,
    closeTime: h4DetectedFvg.confTime - 2 * H4_BAR_DURATION_MS,
    nextState: "UP" as const,
    breakType: "BOS" as const,
  },
  {
    tf: "H4" as const,
    closeTime: h4DetectedFvg.confTime + H4_BAR_DURATION_MS,
    nextState: "UP" as const,
    breakType: "CHOCH" as const,
  },
] as const;

const h4SecondaryBullBarsRetrospective = buildH4SweepBars({
  15: { open: 94, high: 95, low: 89, close: 89 },
  16: { open: 89, high: 92, low: 88, close: 91 },
});

const h4SecondaryBullBarsForward = buildH4SweepBars({
  15: { open: 94, high: 95, low: 91, close: 94 },
  16: { open: 94, high: 95, low: 89, close: 89 },
  17: { open: 89, high: 92, low: 88, close: 91 },
});

const h4SecondaryRetrospectiveConfTime =
  h4SecondaryBullBarsRetrospective[16].closeTime;
const h4SecondaryForwardConfTime = h4SecondaryBullBarsForward[16].closeTime;

const d1ActiveParentPoi = {
  id: "D1-P-1",
  symbol: "BTCUSDT",
  type: "D1_POI_FVG" as const,
  tf: "D1" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 100,
    top: 110,
    height: 10,
  },
  confTime: Date.UTC(2026, 2, 29, 23, 59, 59),
  createdAt: Date.UTC(2026, 2, 29, 23, 59, 59),
  state: "ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil:
    Date.UTC(2026, 2, 29, 23, 59, 59) + 300 * 24 * 60 * 60 * 1000,
  touchCount: 0,
  fullFillHit: false,
  atrAtConf: 10,
  structureAtConf: "UP" as const,
  passDisplacement: true,
  passMixedStrongDisp: false,
};

const h4ActiveParentPoi = {
  id: "H4-P-1",
  symbol: "BTCUSDT",
  type: "H4_CORE_FVG" as const,
  tf: "H4" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 100,
    top: 112,
    height: 12,
  },
  confTime: Date.UTC(2026, 2, 30, 7, 59, 59),
  createdAt: Date.UTC(2026, 2, 30, 7, 59, 59),
  state: "A_ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil:
    Date.UTC(2026, 2, 30, 7, 59, 59) + 300 * H4_BAR_DURATION_MS,
  touchCount: 0,
  fullFillHit: false,
  atrAtConf: 10,
  confirmDueTime: Date.UTC(2026, 2, 30, 7, 59, 59) + 3 * H4_BAR_DURATION_MS,
  passF1: true,
  passF2: true,
  passF3: false,
  passF4: false,
};

const h4CandidateParentPoi = {
  ...h4ActiveParentPoi,
  state: "CANDIDATE" as const,
};

const setupDetectedH1 = {
  tf: "H1" as const,
  dir: "BULL" as const,
  leftCloseTime: Date.UTC(2026, 2, 30, 9, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 30, 10, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 30, 11, 59, 59),
  confTime: Date.UTC(2026, 2, 30, 11, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 108,
    top: 118,
    height: 10,
  },
};

const setupDetectedM30 = {
  tf: "M30" as const,
  dir: "BULL" as const,
  leftCloseTime: Date.UTC(2026, 2, 30, 10, 29, 59),
  middleCloseTime: Date.UTC(2026, 2, 30, 10, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 30, 11, 29, 59),
  confTime: Date.UTC(2026, 2, 30, 11, 29, 59),
  atrAtConf: 10,
  zone: {
    bottom: 110,
    top: 118,
    height: 8,
  },
};

const setupDetectedH1InsideFail = {
  ...setupDetectedH1,
  zone: {
    bottom: 111,
    top: 118,
    height: 7,
  },
};

const setupDetectedH1Bear = {
  ...setupDetectedH1,
  dir: "BEAR" as const,
};

const setupDetectedH4 = {
  ...setupDetectedH1,
  tf: "H4" as const,
};

const setupH1DisplacementPass = {
  confTime: setupDetectedH1.confTime,
  atrAtConf: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const setupH1DisplacementMismatch = {
  confTime: setupDetectedH1.confTime - 60 * 60 * 1000,
  atrAtConf: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const setupM30DisplacementPass = {
  confTime: setupDetectedM30.confTime,
  atrAtConf: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const activeSetupFromD1Parent = createSetupFvg({
  id: "SETUP-KILL-D1",
  symbol: "BTCUSDT",
  parentPoi: d1ActiveParentPoi,
  detectedFvg: setupDetectedH1,
  displacementEval: setupH1DisplacementPass,
  h4StructureAtConf: "UP",
})!;

const activeSetupFromH4Parent = createSetupFvg({
  id: "SETUP-KILL-H4",
  symbol: "BTCUSDT",
  parentPoi: h4ActiveParentPoi,
  detectedFvg: setupDetectedM30,
  displacementEval: setupM30DisplacementPass,
  h4StructureAtConf: "UP",
})!;

const killedH4AtSetupClose = {
  ...h4ActiveParentPoi,
  state: "INACTIVE" as const,
  invalidReason: "opposite_choch" as const,
  endTime: setupDetectedM30.confTime,
};

const stackCurrentCloseTime = Date.UTC(2026, 2, 31, 11, 59, 59);

const stackD1Source = {
  ...d1ActiveParentPoi,
  id: "STACK-D1-1",
  confTime: Date.UTC(2026, 2, 31, 3, 59, 59),
  createdAt: Date.UTC(2026, 2, 31, 3, 59, 59),
  zone: {
    bottom: 100,
    top: 110,
    height: 10,
  },
};

const stackH4Source1 = {
  ...h4ActiveParentPoi,
  id: "STACK-H4-1",
  confTime: Date.UTC(2026, 2, 31, 7, 59, 59),
  createdAt: Date.UTC(2026, 2, 31, 7, 59, 59),
  zone: {
    bottom: 103,
    top: 107,
    height: 4,
  },
};

const stackH4Source2 = {
  ...h4ActiveParentPoi,
  id: "STACK-H4-2",
  confTime: Date.UTC(2026, 2, 31, 7, 59, 59),
  createdAt: Date.UTC(2026, 2, 31, 7, 59, 59),
  zone: {
    bottom: 104,
    top: 108,
    height: 4,
  },
};

const stackH4CandidateSource = {
  ...stackH4Source1,
  state: "CANDIDATE" as const,
};

const stackH4BearSource = {
  ...stackH4Source2,
  id: "STACK-H4-BEAR",
  dir: "BEAR" as const,
};

const stackSetupSource1 = {
  id: "STACK-SETUP-1",
  symbol: "BTCUSDT",
  type: "SETUP_FVG" as const,
  tf: "M30" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 104.5,
    top: 106.5,
    height: 2,
  },
  confTime: Date.UTC(2026, 2, 31, 8, 29, 59),
  createdAt: Date.UTC(2026, 2, 31, 8, 29, 59),
  state: "ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil: Date.UTC(2026, 2, 31, 8, 29, 59) + 300 * 30 * 60 * 1000,
  touchCount: 0,
  fullFillHit: false,
  atrAtConf: 10,
  parentPoiId: "H4-P-1",
  parentPoiType: "H4_CORE_FVG" as const,
  insideOverlapLen: 2,
  insideOverlapRatio: 1,
  passInside: true,
  passDirectionAlign: true,
  h4StructureAtConf: "UP" as const,
  passH4StructureFilter: true,
  passDisplacement: true,
};

const stackSetupSource2 = {
  ...stackSetupSource1,
  id: "STACK-SETUP-2",
  zone: {
    bottom: 105,
    top: 107,
    height: 2,
  },
};

const stackSetupLowOverlap = {
  ...stackSetupSource1,
  id: "STACK-SETUP-LOW",
  zone: {
    bottom: 107.5,
    top: 109.5,
    height: 2,
  },
};

const pruneNow = Date.UTC(2026, 3, 4, 0, 0, 0);

const pruneD1Old = {
  ...d1ActiveParentPoi,
  id: "PRUNE-D1-OLD",
  confTime: Date.UTC(2026, 3, 1, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 1, 23, 59, 59),
};

const pruneD1Mid = {
  ...d1ActiveParentPoi,
  id: "PRUNE-D1-MID",
  confTime: Date.UTC(2026, 3, 2, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 2, 23, 59, 59),
};

const pruneD1New = {
  ...d1ActiveParentPoi,
  id: "PRUNE-D1-NEW",
  confTime: Date.UTC(2026, 3, 3, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 3, 23, 59, 59),
};

const pruneD1Newest = {
  ...d1ActiveParentPoi,
  id: "PRUNE-D1-NEWEST",
  confTime: Date.UTC(2026, 3, 4, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 4, 23, 59, 59),
};

const pruneH4CandidateOld = {
  ...h4CandidateParentPoi,
  id: "PRUNE-H4-CAND-OLD",
  confTime: Date.UTC(2026, 3, 1, 7, 59, 59),
  createdAt: Date.UTC(2026, 3, 1, 7, 59, 59),
};

const pruneH4AActiveNew = {
  ...h4ActiveParentPoi,
  id: "PRUNE-H4-AACT-NEW",
  confTime: Date.UTC(2026, 3, 2, 7, 59, 59),
  createdAt: Date.UTC(2026, 3, 2, 7, 59, 59),
};

const pruneSetupH1Old = {
  ...stackSetupSource1,
  id: "PRUNE-SETUP-H1-OLD",
  tf: "H1" as const,
  confTime: Date.UTC(2026, 3, 1, 0, 59, 59),
  createdAt: Date.UTC(2026, 3, 1, 0, 59, 59),
};

const pruneSetupH1New = {
  ...stackSetupSource1,
  id: "PRUNE-SETUP-H1-NEW",
  tf: "H1" as const,
  confTime: Date.UTC(2026, 3, 2, 0, 59, 59),
  createdAt: Date.UTC(2026, 3, 2, 0, 59, 59),
};

const pruneSetupM30Old = {
  ...stackSetupSource1,
  id: "PRUNE-SETUP-M30-OLD",
  tf: "M30" as const,
  confTime: Date.UTC(2026, 3, 1, 0, 29, 59),
  createdAt: Date.UTC(2026, 3, 1, 0, 29, 59),
};

const pruneSetupM30New = {
  ...stackSetupSource1,
  id: "PRUNE-SETUP-M30-NEW",
  tf: "M30" as const,
  confTime: Date.UTC(2026, 3, 2, 0, 29, 59),
  createdAt: Date.UTC(2026, 3, 2, 0, 29, 59),
};

const pruneInactiveH4 = {
  ...h4ActiveParentPoi,
  id: "PRUNE-H4-INACTIVE",
  state: "INACTIVE" as const,
};

const pruneStackUntouched = {
  id: "PRUNE-STACK-1",
  symbol: "BTCUSDT",
  type: "STACK_ZONE" as const,
  tf: "H4" as const,
  dir: "BULL" as const,
  zone: { bottom: 100, top: 105, height: 5 },
  confTime: Date.UTC(2026, 3, 1, 7, 59, 59),
  createdAt: Date.UTC(2026, 3, 1, 7, 59, 59),
  state: "ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil: Date.UTC(2026, 3, 1, 7, 59, 59) + 300 * H4_BAR_DURATION_MS,
  touchCount: 0,
  fullFillHit: false,
  aId: "A",
  bId: "B",
  aTf: "D1" as const,
  bTf: "H4" as const,
  overlapLen: 5,
  overlapRatio: 0.5,
  passStack: true,
};

const ltfGateBearParentPoi = {
  ...d1ActiveParentPoi,
  id: "LTF-D1-BEAR",
  dir: "BEAR" as const,
  zone: {
    bottom: 90,
    top: 110,
    height: 20,
  },
};

const ltfGateCurrentBarBull: Bar = {
  tf: "M15",
  openTime: Date.UTC(2026, 3, 1, 0, 0, 0),
  closeTime: Date.UTC(2026, 3, 1, 0, 14, 59),
  open: 103,
  high: 108,
  low: 98,
  close: 103,
  volume: 0,
};

const ltfGateCurrentBarBear: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 3, 1, 0, 15, 0),
  closeTime: Date.UTC(2026, 3, 1, 0, 19, 59),
  open: 107,
  high: 113,
  low: 103,
  close: 107,
  volume: 0,
};

const ltfGateM15Bars: Bar[] = Array.from({ length: 15 }, (_, i) => ({
  tf: "M15" as const,
  openTime: Date.UTC(2026, 3, 1, 0, i * 15, 0),
  closeTime: Date.UTC(2026, 3, 1, 0, i * 15 + 14, 59),
  open: 103,
  high: 108,
  low: 98,
  close: 103,
  volume: 0,
}));

const ltfBullPoiForAggregate = {
  ...d1ActiveParentPoi,
  id: "LTF-AGG-POI",
  zone: {
    bottom: 50,
    top: 60,
    height: 10,
  },
};

const ltfBullChochBars = buildLtfBars("M15", 19, {
  14: { high: 101 },
  15: { high: 102, close: 97 },
  16: { high: 101 },
  17: { high: 100 },
  18: { open: 99, high: 104, low: 94, close: 103 },
});

const ltfBearChochBars = buildLtfBars("M5", 19, {
  14: { low: 89 },
  15: { low: 88, close: 94 },
  16: { low: 89 },
  17: { low: 90 },
  18: { open: 89, high: 96, low: 86, close: 87 },
});

const ltfBullSweepEqBars = buildLtfBars("M15", 20, {
  9: { low: 93 },
  10: { low: 92.5 },
  11: { low: 90.5, high: 99 },
  12: { low: 93 },
  13: { low: 92, high: 100 },
  14: { low: 91, high: 101 },
  15: { low: 90, high: 100, close: 96 },
  16: { low: 91, high: 102, close: 97 },
  17: { low: 91.2, high: 101, close: 98 },
  18: { open: 97, high: 100, low: 89, close: 99 },
  19: { open: 99, high: 104, low: 94, close: 103 },
});

const ltfBullSweepFallbackBars = buildLtfBars("M15", 20, {
  9: { low: 94 },
  10: { low: 93 },
  11: { low: 91.5, high: 99 },
  12: { low: 93 },
  13: { low: 92, high: 100 },
  14: { low: 91, high: 101 },
  15: { low: 90, high: 100, close: 96 },
  16: { low: 91, high: 102, close: 97 },
  17: { low: 91.2, high: 101, close: 98 },
  18: { open: 97, high: 100, low: 89, close: 99 },
  19: { open: 99, high: 104, low: 94, close: 103 },
});

const ltfBoundaryMrBars = buildLtfBars("M15", 15, {
  13: { open: 100, high: 101, low: 99.5, close: 99.8 },
  14: { open: 99.8, high: 102, low: 100, close: 101 },
});

const ltfBullMicroObBars = buildLtfBars("M15", 20, {
  11: { high: 99 },
  12: { high: 100 },
  13: { high: 101, open: 96, close: 97 },
  14: { high: 100 },
  15: { open: 100, high: 100, low: 98.5, close: 99 },
  16: { open: 99, high: 104, low: 99, close: 103 },
  17: { open: 99, high: 100, low: 98.8, close: 99 },
  18: { open: 100, high: 100.4, low: 99.4, close: 99.5 },
  19: { open: 99.5, high: 101.2, low: 99.5, close: 101 },
});

const ltfBullMicroFvgBars = buildLtfBars("M15", 20, {
  14: { open: 95, high: 100, low: 90, close: 95 },
  15: { open: 95, high: 99, low: 94, close: 96 },
  16: { open: 103, high: 104, low: 102, close: 103 },
  17: { open: 98, high: 100, low: 96, close: 98 },
  18: { open: 99, high: 101, low: 100, close: 99.5 },
  19: { open: 99.5, high: 101.5, low: 100.2, close: 101 },
});

const ltfBullReactionPoi = {
  ...d1ActiveParentPoi,
  id: "LTF-REACTION-POI",
  zone: {
    bottom: 94,
    top: 104,
    height: 10,
  },
};

const ltfBullEntryPoi = {
  ...d1ActiveParentPoi,
  id: "LTF-ENTRY-POI",
  zone: {
    bottom: 99,
    top: 109,
    height: 10,
  },
};

const ltfBullM5EntryBars = buildLtfBars("M5", 19, {
  14: { high: 101 },
  15: { high: 102, close: 97 },
  16: { high: 101 },
  17: { high: 100 },
  18: { open: 99, high: 104, low: 99, close: 103 },
});

const ltfBullUnconfirmedHighBars = buildLtfBars("M15", 5, {
  0: { high: 95, low: 90, close: 94 },
  1: { high: 96, low: 91, close: 95 },
  2: { high: 97, low: 92, close: 96 },
  3: { high: 110, low: 93, close: 100 },
  4: { high: 111, low: 99, close: 112 },
});

const ltfBullUnconfirmedEqLowBars = buildLtfBars("M15", 6, {
  0: { low: 95, close: 95 },
  1: { low: 94, close: 95 },
  2: { low: 90, close: 94 },
  3: { low: 94, close: 95 },
  4: { low: 90.05, close: 94 },
  5: { low: 95, close: 96 },
});

assertExactEventLog(harnessActual, harnessExpected, "harness self-check");

assertExactEventLog(
  uniqueLexicographicTags(tagInput),
  tagExpected,
  "tag unique+sort"
);

assert.equal(
  formatTags(tagInput),
  "ALPHA|BETA|ZETA",
  "tag format"
);

assert.equal(
  countPruneOverflow(4, 2),
  2,
  "prune overflow count"
);

assertExactEventLog(
  getPrunedIdsByOldest(pruneInput, 2),
  pruneExpected,
  "prune oldest ids"
);

assertExactEventLog(
  getPrunedIdsByOldest(pruneInput, 4),
  [],
  "prune none when within limit"
);

const tfStore = createTfBarStore();

appendBarForTf(tfStore, storeM5Bar1, 2);
appendBarForTf(tfStore, storeM5Bar2, 2);
appendBarForTf(tfStore, storeM5Bar3, 2);

assert.equal(
  getBarCountForTf(tfStore, "M5"),
  2,
  "bar store append keeps lookback size"
);

assert.deepEqual(
  getBarsForTf(tfStore, "M5").map((bar) => bar.closeTime),
  [storeM5Bar2.closeTime, storeM5Bar3.closeTime],
  "bar store append keeps newest bars"
);

setBarsForTf(tfStore, "D1", [bars[0], bars[0]], 1);

assert.equal(
  getBarCountForTf(tfStore, "D1"),
  1,
  "bar store set trims to lookback"
);

assert.equal(
  getBarCountForTf(tfStore, "H4"),
  0,
  "bar store keeps tf separated"
);

assertExactEventLog(
  [...FvgConstants.FVG_TFS],
  ["D1", "H4", "H1", "M30", "M15", "M5"],
  "fvg tf set"
);

assertExactEventLog(
  [...FvgConstants.FVG_BOX_TYPES],
  ["D1_POI_FVG", "H4_CORE_FVG", "SETUP_FVG", "STACK_ZONE"],
  "fvg box types"
);

assert.deepEqual(
  {
    activeInactive: [...FvgConstants.FVG_ACTIVE_INACTIVE_STATES],
    h4: [...FvgConstants.FVG_H4_CORE_STATES],
    stack: [...FvgConstants.FVG_STACK_STATES],
  },
  {
    activeInactive: ["ACTIVE", "INACTIVE"],
    h4: ["CANDIDATE", "A_ACTIVE", "INACTIVE", "DELETED"],
    stack: ["ACTIVE", "INACTIVE"],
  },
  "fvg states"
);

assertExactEventLog(
  [...FvgConstants.FVG_INVALID_REASONS],
  [
    "full_fill",
    "opposite_choch",
    "touch_3",
    "pruned_by_limit",
    "failed_confirm",
  ],
  "fvg invalid reasons"
);

assert.deepEqual(
  [...FvgConstants.FVG_TRIGGER_TOKENS],
  [
    "SWEEP_REC",
    "CHOCH",
    "MR_FVG_BOUNDARY",
    "MR_MICRO_OB",
    "MR_MICRO_FVG",
  ],
  "fvg trigger tokens"
);

assert.deepEqual(
  {
    MAX_FORWARD_BARS: FvgConstants.MAX_FORWARD_BARS,
    MIN_ZONE_HEIGHT_ATR: FvgConstants.MIN_ZONE_HEIGHT_ATR,
    PENETRATION_ATR: FvgConstants.PENETRATION_ATR,
    PENETRATION_ZONE: FvgConstants.PENETRATION_ZONE,
    INSIDE_OVERLAP_RATIO: FvgConstants.INSIDE_OVERLAP_RATIO,
    STACK_OVERLAP_RATIO: FvgConstants.STACK_OVERLAP_RATIO,
    LTF_GATE_ATR: FvgConstants.LTF_GATE_ATR,
    FVG_PIVOT_LEN: FvgConstants.FVG_PIVOT_LEN,
    DISPLACEMENT_BODY_MAX_ATR: FvgConstants.DISPLACEMENT_BODY_MAX_ATR,
    DISPLACEMENT_BODY_SUM_ATR: FvgConstants.DISPLACEMENT_BODY_SUM_ATR,
    D1_MIXED_STRONG_DISP_BODY_MAX_ATR:
      FvgConstants.D1_MIXED_STRONG_DISP_BODY_MAX_ATR,
    D1_MIXED_STRONG_DISP_BODY_SUM_ATR:
      FvgConstants.D1_MIXED_STRONG_DISP_BODY_SUM_ATR,
    H4_CONFIRM_DELAY_BARS: FvgConstants.H4_CONFIRM_DELAY_BARS,
    COOLDOWN_AFTER_15M_REACTION_MIN:
      FvgConstants.COOLDOWN_AFTER_15M_REACTION_MIN,
    COOLDOWN_AFTER_5M_ENTRY_MIN: FvgConstants.COOLDOWN_AFTER_5M_ENTRY_MIN,
    MAX_ACTIVE_D1: FvgConstants.MAX_ACTIVE_D1,
    MAX_ACTIVE_H4_POOL: FvgConstants.MAX_ACTIVE_H4_POOL,
    MAX_ACTIVE_H1_SETUP: FvgConstants.MAX_ACTIVE_H1_SETUP,
    MAX_ACTIVE_M30_SETUP: FvgConstants.MAX_ACTIVE_M30_SETUP,
  },
  {
    MAX_FORWARD_BARS: 300,
    MIN_ZONE_HEIGHT_ATR: 0.15,
    PENETRATION_ATR: 0.1,
    PENETRATION_ZONE: 0.25,
    INSIDE_OVERLAP_RATIO: 0.2,
    STACK_OVERLAP_RATIO: 0.3,
    LTF_GATE_ATR: 0.2,
    FVG_PIVOT_LEN: 3,
    DISPLACEMENT_BODY_MAX_ATR: 1.0,
    DISPLACEMENT_BODY_SUM_ATR: 1.8,
    D1_MIXED_STRONG_DISP_BODY_MAX_ATR: 1.5,
    D1_MIXED_STRONG_DISP_BODY_SUM_ATR: 2.4,
    H4_CONFIRM_DELAY_BARS: 3,
    COOLDOWN_AFTER_15M_REACTION_MIN: 30,
    COOLDOWN_AFTER_5M_ENTRY_MIN: 60,
    MAX_ACTIVE_D1: 3,
    MAX_ACTIVE_H4_POOL: 10,
    MAX_ACTIVE_H1_SETUP: 6,
    MAX_ACTIVE_M30_SETUP: 6,
  },
  "fvg numeric constants"
);

assert.equal(
  isFvgDetectTf("D1"),
  true,
  "fvg detect tf includes D1"
);

assert.equal(
  isFvgDetectTf("M15"),
  false,
  "fvg detect tf excludes M15"
);

assert.deepEqual(
  detectConfirmedWickFvgFromRecentBars(bullFvgBars, 10),
  {
    tf: "H1",
    dir: "BULL",
    leftCloseTime: bullFvgBars[0].closeTime,
    middleCloseTime: bullFvgBars[1].closeTime,
    rightCloseTime: bullFvgBars[2].closeTime,
    confTime: bullFvgBars[2].closeTime,
    atrAtConf: 10,
    zone: {
      bottom: 100,
      top: 102,
      height: 2,
    },
  },
  "fvg bull wick triplet detect"
);

assert.deepEqual(
  detectConfirmedWickFvgFromRecentBars(bearFvgBars, 10),
  {
    tf: "M30",
    dir: "BEAR",
    leftCloseTime: bearFvgBars[0].closeTime,
    middleCloseTime: bearFvgBars[1].closeTime,
    rightCloseTime: bearFvgBars[2].closeTime,
    confTime: bearFvgBars[2].closeTime,
    atrAtConf: 10,
    zone: {
      bottom: 108,
      top: 110,
      height: 2,
    },
  },
  "fvg bear wick triplet detect"
);

assert.equal(
  detectConfirmedWickFvgFromRecentBars(smallFvgBars, 10),
  null,
  "fvg reject too small zone"
);

assert.equal(
  detectConfirmedWickFvgFromRecentBars(bullFvgBars.slice(0, 2), 10),
  null,
  "fvg needs 3 confirmed bars"
);

const atrSnapshots = buildAtr14Snapshots(atrH1Bars);

assert.equal(
  atrSnapshots.length,
  2,
  "fvg atr snapshots count"
);

assert.deepEqual(
  getAtrSnapshotAtConfTime(atrH1Bars, atrH1Bars[14].closeTime),
  {
    tf: "H1",
    time: atrH1Bars[14].closeTime,
    atr14: 10,
  },
  "fvg atr snapshot at conf time"
);

assert.equal(
  getAtrValueAtConfTime(atrH1Bars.slice(0, 13), atrH1Bars[12].closeTime),
  null,
  "fvg atr requires 14 bars"
);

assert.equal(
  getAtrValueAtConfTime(atrH1Bars, atrH1Bars[14].closeTime),
  10,
  "fvg atr sampled from conf close"
);

assert.deepEqual(
  detectConfirmedWickFvgWithAtrFromTfBars(atrH1Bars),
  {
    tf: "H1",
    dir: "BULL",
    leftCloseTime: atrH1Bars[12].closeTime,
    middleCloseTime: atrH1Bars[13].closeTime,
    rightCloseTime: atrH1Bars[14].closeTime,
    confTime: atrH1Bars[14].closeTime,
    atrAtConf: 10,
    zone: {
      bottom: 100,
      top: 102,
      height: 2,
    },
  },
  "fvg detect uses atr at conf time"
);

assert.equal(
  isPivotStructureTf("D1"),
  true,
  "fvg pivot tf includes D1"
);

assert.equal(
  isPivotStructureTf("H1"),
  false,
  "fvg pivot tf excludes H1"
);

assert.deepEqual(
  detectConfirmedFractalPivotAtIndex(pivotHighD1Bars, "HIGH", 3),
  {
    tf: "D1",
    pivotType: "HIGH",
    pivotTime: pivotHighD1Bars[3].closeTime,
    pivotPrice: 20,
    confirmedAt: pivotHighD1Bars[6].closeTime,
    isConfirmed: true,
  },
  "fvg pivot high confirmed at p+3 close"
);

assert.deepEqual(
  detectConfirmedFractalPivotAtIndex(pivotLowH4Bars, "LOW", 3),
  {
    tf: "H4",
    pivotType: "LOW",
    pivotTime: pivotLowH4Bars[3].closeTime,
    pivotPrice: 2,
    confirmedAt: pivotLowH4Bars[6].closeTime,
    isConfirmed: true,
  },
  "fvg pivot low confirmed at p+3 close"
);

assert.equal(
  detectConfirmedFractalPivotAtIndex(pivotHighD1Bars.slice(0, 6), "HIGH", 3),
  null,
  "fvg pivot rejects unconfirmed before p+3 close"
);

assert.equal(
  detectConfirmedFractalPivotAtIndex(pivotHighH1Bars, "HIGH", 3),
  null,
  "fvg pivot forbidden outside D1 H4"
);

assert.deepEqual(
  detectNewlyConfirmedFractalPivot(pivotHighD1Bars, "HIGH"),
  {
    tf: "D1",
    pivotType: "HIGH",
    pivotTime: pivotHighD1Bars[3].closeTime,
    pivotPrice: 20,
    confirmedAt: pivotHighD1Bars[6].closeTime,
    isConfirmed: true,
  },
  "fvg pivot latest newly confirmed"
);

const structurePivotHighD1 =
  detectConfirmedFractalPivotAtIndex(pivotHighD1Bars, "HIGH", 3)!;

const structurePivotLowD1 =
  detectConfirmedFractalPivotAtIndex(pivotLowD1Bars, "LOW", 3)!;

assertExactEventLog(
  [...FvgConstants.FVG_STRUCTURE_BREAK_TYPES],
  ["BOS", "CHOCH"],
  "fvg structure break types"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "UP",
    close: 15,
    lastConfirmedPivotHigh: structurePivotHighD1,
  }),
  {
    structureReady: false,
    prevState: "UP",
    nextState: "MIXED",
    breakType: null,
  },
  "fvg structure not ready missing low pivot"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "DOWN",
    close: 5,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: false,
    prevState: "DOWN",
    nextState: "MIXED",
    breakType: null,
  },
  "fvg structure not ready missing high pivot"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "MIXED",
    close: 21,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "MIXED",
    nextState: "UP",
    breakType: "BOS",
  },
  "fvg structure mixed to up via bos"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "MIXED",
    close: 1,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "MIXED",
    nextState: "DOWN",
    breakType: "BOS",
  },
  "fvg structure mixed to down via bos"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "MIXED",
    close: 10,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "MIXED",
    nextState: "MIXED",
    breakType: null,
  },
  "fvg structure mixed no break stays mixed"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "UP",
    close: 21,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "UP",
    nextState: "UP",
    breakType: "BOS",
  },
  "fvg structure up bos keeps up"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "UP",
    close: 1,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "UP",
    nextState: "DOWN",
    breakType: "CHOCH",
  },
  "fvg structure up choch to down"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "UP",
    close: 20,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "UP",
    nextState: "UP",
    breakType: null,
  },
  "fvg structure equality at pivot high is not break"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "DOWN",
    close: 1,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "DOWN",
    nextState: "DOWN",
    breakType: "BOS",
  },
  "fvg structure down bos keeps down"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "DOWN",
    close: 21,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "DOWN",
    nextState: "UP",
    breakType: "CHOCH",
  },
  "fvg structure down choch to up"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "DOWN",
    close: 2,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "DOWN",
    nextState: "DOWN",
    breakType: null,
  },
  "fvg structure equality at pivot low is not break"
);

assert.equal(
  getCandleBodySize({
    tf: "H4",
    openTime: Date.UTC(2026, 2, 17, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 17, 3, 59, 59),
    open: 120,
    high: 121,
    low: 109,
    close: 110,
    volume: 0,
  }),
  10,
  "fvg displacement body is abs close-open"
);

assert.deepEqual(
  evaluateDisplacementF1FromRecentBars(displacementMaxPassBars, 10),
  {
    confTime: displacementMaxPassBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 11,
    bodySum: 17,
    passByMax: true,
    passBySum: false,
    passDisplacement: true,
  },
  "fvg displacement passes by max body"
);

assert.deepEqual(
  evaluateDisplacementF1FromRecentBars(displacementSumPassBars, 10),
  {
    confTime: displacementSumPassBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 7,
    bodySum: 19,
    passByMax: false,
    passBySum: true,
    passDisplacement: true,
  },
  "fvg displacement passes by body sum"
);

assert.deepEqual(
  evaluateDisplacementF1FromRecentBars(displacementStrictFailBars, 10),
  {
    confTime: displacementStrictFailBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 10,
    bodySum: 18,
    passByMax: false,
    passBySum: false,
    passDisplacement: false,
  },
  "fvg displacement uses strict greater-than thresholds"
);

assert.equal(
  evaluateDisplacementF1FromTfBars(atrDisplacementH1Bars.slice(0, 13)),
  null,
  "fvg displacement wrapper requires atr at conf time"
);

assert.deepEqual(
  evaluateDisplacementF1FromTfBars(atrDisplacementH1Bars),
  {
    confTime: atrDisplacementH1Bars[14].closeTime,
    atrAtConf: 10,
    bodyMax: 7,
    bodySum: 19,
    passByMax: false,
    passBySum: true,
    passDisplacement: true,
  },
  "fvg displacement wrapper uses conf-time atr"
);

assert.deepEqual(
  resolveSweepRecoveryTarget({
    dir: "BULL",
    atrAtConf: 10,
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
  },
  "fvg sweep target bull uses eql outer line with priority"
);

assert.deepEqual(
  resolveSweepRecoveryTarget({
    dir: "BEAR",
    atrAtConf: 10,
    eqPivotPair: sweepBearEqHighPair,
    lastConfirmedPivotHigh: sweepFallbackHighPivot,
  }),
  {
    targetType: "EQH",
    linePrice: 110,
    usedEqPair: true,
  },
  "fvg sweep target bear uses eqh outer line with priority"
);

assert.deepEqual(
  resolveSweepRecoveryTarget({
    dir: "BULL",
    atrAtConf: 10,
    eqPivotPair: sweepBullWideLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    targetType: "SWING_LOW",
    linePrice: 88,
    usedEqPair: false,
  },
  "fvg sweep target falls back to last confirmed swing low"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBearBarsValid,
    confIndex: 14,
    dir: "BEAR",
  }),
  {
    hasTarget: false,
    targetType: null,
    linePrice: null,
    usedEqPair: false,
    passSweepRecovery: false,
  },
  "fvg sweep no target returns false"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsValid,
    confIndex: 14,
    dir: "BULL",
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    sweepBarTime: sweepBullBarsValid[16].closeTime,
    recoveryBarTime: sweepBullBarsValid[17].closeTime,
    passSweepRecovery: true,
  },
  "fvg sweep bull passes with sweep in conf+2 and recovery in conf+3"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsLateSweep,
    confIndex: 14,
    dir: "BULL",
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    passSweepRecovery: false,
  },
  "fvg sweep rejects sweep occurring at conf+3"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsLateRecovery,
    confIndex: 14,
    dir: "BULL",
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    passSweepRecovery: false,
  },
  "fvg sweep requires next close only recovery"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBearBarsValid,
    confIndex: 14,
    dir: "BEAR",
    eqPivotPair: sweepBearEqHighPair,
    lastConfirmedPivotHigh: sweepFallbackHighPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQH",
    linePrice: 110,
    usedEqPair: true,
    sweepBarTime: sweepBearBarsValid[16].closeTime,
    recoveryBarTime: sweepBearBarsValid[17].closeTime,
    passSweepRecovery: true,
  },
  "fvg sweep bear passes with eqh target"
);

assert.equal(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsValid.slice(0, 13),
    confIndex: 12,
    dir: "BULL",
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  null,
  "fvg sweep wrapper requires atr at conf time"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsValid,
    confIndex: 14,
    dir: "BULL",
    eqPivotPair: sweepBullWideLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "SWING_LOW",
    linePrice: 88,
    usedEqPair: false,
    passSweepRecovery: false,
  },
  "fvg sweep eq pair threshold uses conf atr and falls back"
);

assert.deepEqual(
  evaluateF4Context(f4ContextInput),
  {
    source: "NONE",
    passF4: false,
    providerKind: null,
    providerId: null,
    distanceAtr: null,
  },
  "fvg f4 defaults false without provider or snapshot accessor"
);

assert.deepEqual(
  evaluateF4Context(f4ContextInput, () => true),
  {
    source: "PROVIDER",
    passF4: true,
    providerKind: null,
    providerId: null,
    distanceAtr: null,
  },
  "fvg f4 provider true passes"
);

assert.deepEqual(
  evaluateF4Context(f4ContextInput, () => false),
  {
    source: "PROVIDER",
    passF4: false,
    providerKind: null,
    providerId: null,
    distanceAtr: null,
  },
  "fvg f4 provider false blocks"
);

const f4ProviderSeenInputs: unknown[] = [];
evaluateF4Context(f4ContextInput, (input) => {
  f4ProviderSeenInputs.push(input);
  return true;
});

assert.deepEqual(
  f4ProviderSeenInputs,
  [f4ContextInput],
  "fvg f4 provider receives exact input"
);

const f4SnapshotInput = {
  ...f4ContextInput,
  getPublishedSnapshot: () => [] as const,
};

assert.deepEqual(
  evaluateF4Context(f4SnapshotInput),
  {
    source: "SNAPSHOT",
    passF4: false,
    providerKind: null,
    providerId: null,
    distanceAtr: null,
  },
  "fvg f4 snapshot returns no evidence when no eligible providers exist"
);

assert.deepEqual(
  evaluateF4Context({
    ...f4SnapshotInput,
    getPublishedSnapshot(tf) {
      if (tf !== "H4") {
        return [];
      }

      return [
        {
          id: "CHAN-H4-1",
          symbol: "BTCUSDT",
          kind: "CHANNEL" as const,
          tf: "H4",
          dir: "BULL" as const,
          type: "H4_CHANNEL",
          state: "ENABLED",
          updatedAtMs: Date.UTC(2026, 2, 19, 4, 0, 0),
          lowerBandAt: () => 100.5,
          upperBandAt: () => 104,
        },
      ];
    },
  }),
  {
    source: "SNAPSHOT",
    passF4: true,
    providerKind: "CHANNEL",
    providerId: "CHAN-H4-1",
    distanceAtr: 0,
  },
  "fvg f4 snapshot passes with role-matched channel provider inside zone"
);

assert.deepEqual(
  evaluateF4Context({
    ...f4SnapshotInput,
    getPublishedSnapshot(tf) {
      if (tf === "H4") {
        return [
          {
            id: "TL-H4-OLD",
            symbol: "BTCUSDT",
            kind: "TRENDLINE" as const,
            tf: "H4",
            dir: "BULL" as const,
            type: "TL_SUPPORT",
            state: "ACTIVE",
            updatedAtMs: Date.UTC(2026, 2, 19, 3, 0, 0),
            linePriceAt: () => 100.2,
          },
          {
            id: "TL-H4-NEW",
            symbol: "BTCUSDT",
            kind: "TRENDLINE" as const,
            tf: "H4",
            dir: "BULL" as const,
            type: "TL_SUPPORT",
            state: "ACTIVE",
            updatedAtMs: Date.UTC(2026, 2, 19, 4, 0, 0),
            linePriceAt: () => 100.2,
          },
        ];
      }

      return [];
    },
  }),
  {
    source: "SNAPSHOT",
    passF4: true,
    providerKind: "TRENDLINE",
    providerId: "TL-H4-NEW",
    distanceAtr: 0,
  },
  "fvg f4 best provider tie-break uses latest providerTime after distance"
);

assert.deepEqual(
  evaluateF4Context({
    ...f4SnapshotInput,
    getPublishedSnapshot(tf) {
      if (tf !== "H4") {
        return [];
      }

      return [
        {
          id: "TL-BAD",
          symbol: "BTCUSDT",
          kind: "TRENDLINE" as const,
          tf: "H4",
          dir: "BULL" as const,
          type: "TL_SUPPORT",
          state: "ACTIVE",
          linePriceAt: () => 100.3,
        },
      ];
    },
  }),
  {
    source: "SNAPSHOT",
    passF4: false,
    providerKind: null,
    providerId: null,
    distanceAtr: null,
  },
  "fvg f4 treats malformed providerTime as no evidence"
);

const d1F1Pass = evaluateDisplacementF1FromRecentBars(displacementMaxPassBars, 10)!;
const d1MixedStrongByMax =
  evaluateD1MixedStrongDisplacementFromRecentBars(d1StrongDispMaxBars, 10)!;
const d1MixedStrongBySum =
  evaluateD1MixedStrongDisplacementFromRecentBars(d1StrongDispSumBars, 10)!;

assert.deepEqual(
  d1MixedStrongByMax,
  {
    confTime: d1StrongDispMaxBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 16,
    bodySum: 23,
    passByMax: true,
    passBySum: false,
    passMixedStrongDisp: true,
  },
  "fvg d1 mixed strong displacement passes by max"
);

assert.deepEqual(
  d1MixedStrongBySum,
  {
    confTime: d1StrongDispSumBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 9,
    bodySum: 25,
    passByMax: false,
    passBySum: true,
    passMixedStrongDisp: true,
  },
  "fvg d1 mixed strong displacement passes by sum"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BullDetectedFvg,
    structureAtConf: "UP",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: true,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "UP",
    passStructureRule: true,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration passes for up bull"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BearDetectedFvg,
    structureAtConf: "DOWN",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: true,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "DOWN",
    passStructureRule: true,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration passes for down bear"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BullDetectedFvg,
    structureAtConf: "MIXED",
    displacementEval: d1F1Pass,
    mixedStrongDisplacementEval: d1MixedStrongByMax,
  }),
  {
    canRegister: true,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "MIXED",
    passStructureRule: true,
    passMixedStrongDisp: true,
  },
  "fvg d1 registration allows mixed only with strong displacement"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BullDetectedFvg,
    structureAtConf: "MIXED",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: false,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "MIXED",
    passStructureRule: false,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration rejects mixed without strong displacement"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BearDetectedFvg,
    structureAtConf: "UP",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: false,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "UP",
    passStructureRule: false,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration rejects structure direction mismatch"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: null,
    structureAtConf: "UP",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: false,
    passZoneHeight: false,
    passDisplacement: true,
    structureAtConf: "UP",
    passStructureRule: false,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration requires detected d1 fvg"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1SmallDetectedFvg,
    structureAtConf: "UP",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: false,
    passZoneHeight: false,
    passDisplacement: true,
    structureAtConf: "UP",
    passStructureRule: true,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration requires minimum zone height"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BULL",
    fullFillHit: true,
  }),
  {
    fullFillInvalidated: true,
    oppositeChochInvalidated: false,
    pruneInvalidated: false,
    touchInvalidated: false,
  },
  "fvg d1 invalidates on full fill"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BULL",
    structureBreakType: "CHOCH",
    nextStructureState: "DOWN",
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    pruneInvalidated: false,
    touchInvalidated: false,
  },
  "fvg d1 bull invalidates on opposite choch"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BEAR",
    structureBreakType: "CHOCH",
    nextStructureState: "UP",
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    pruneInvalidated: false,
    touchInvalidated: false,
  },
  "fvg d1 bear invalidates on opposite choch"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BULL",
    prunedByLimit: true,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    pruneInvalidated: true,
    touchInvalidated: false,
  },
  "fvg d1 invalidates on prune"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BULL",
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    pruneInvalidated: false,
    touchInvalidated: false,
  },
  "fvg d1 has no touch-based invalidation"
);

assert.equal(
  getH4CoreConfirmDueTime(h4DetectedFvg.confTime),
  h4DetectedFvg.confTime + 3 * H4_BAR_DURATION_MS,
  "fvg h4 candidate confirm due is conf+3 close"
);

assert.equal(
  getH4CoreDisplayUntil(h4DetectedFvg.confTime),
  h4DetectedFvg.confTime + 300 * H4_BAR_DURATION_MS,
  "fvg h4 candidate display until uses max forward bars"
);

assert.deepEqual(
  createH4CoreFvgCandidate({
    id: "H4-A-1",
    symbol: "btcusdt",
    detectedFvg: h4DetectedFvg,
    displacementEval: h4DisplacementPassEval,
  }),
  {
    id: "H4-A-1",
    symbol: "BTCUSDT",
    type: "H4_CORE_FVG",
    tf: "H4",
    dir: "BULL",
    zone: {
      bottom: 100,
      top: 102,
      height: 2,
    },
    confTime: h4DetectedFvg.confTime,
    createdAt: h4DetectedFvg.confTime,
    state: "CANDIDATE",
    maxForwardBars: 300,
    displayUntil: h4DetectedFvg.confTime + 300 * H4_BAR_DURATION_MS,
    touchCount: 0,
    fullFillHit: false,
    atrAtConf: 10,
    confirmDueTime: h4DetectedFvg.confTime + 3 * H4_BAR_DURATION_MS,
    passF1: true,
    passF2: false,
    passF3: false,
    passF4: false,
  },
  "fvg h4 candidate created at conf with initial flags"
);

assert.equal(
  createH4CoreFvgCandidate({
    id: "H4-A-2",
    symbol: "BTCUSDT",
    detectedFvg: d1BullDetectedFvg,
  }),
  null,
  "fvg h4 candidate only created from h4 detect"
);

assert.equal(
  createH4CoreFvgCandidate({
    id: "H4-A-3",
    symbol: "BTCUSDT",
    detectedFvg: h4DetectedFvg,
    displacementEval: h4DisplacementMismatchedEval,
  })?.passF1,
  false,
  "fvg h4 candidate f1 requires matching conf time"
);

assert.equal(
  createH4CoreFvgCandidate({
    id: "H4-A-4",
    symbol: "BTCUSDT",
    detectedFvg: h4DetectedFvg,
  })?.passF1,
  false,
  "fvg h4 candidate defaults f1 false without eval"
);

assert.deepEqual(
  createH4CoreFvgCandidate({
    id: "H4-A-5",
    symbol: "BTCUSDT",
    detectedFvg: h4DetectedFvg,
    displacementEval: h4DisplacementPassEval,
    initialPassF2: true,
    initialPassF3: true,
  }),
  {
    ...h4CandidatePassF1,
    id: "H4-A-5",
    passF2: true,
    passF3: true,
  },
  "fvg h4 candidate can initialize retrospective f2 and f3 passes"
);

assert.equal(
  evaluateH4CoreFvgPassF2({
    dir: "BULL",
    confTime: h4DetectedFvg.confTime,
    currentCloseTime: h4DetectedFvg.confTime,
    structureBreaks: h4SecondaryBullBreaks,
  }),
  true,
  "fvg h4 f2 retrospective init scans conf minus three to conf"
);

assert.equal(
  evaluateH4CoreFvgPassF2({
    dir: "BEAR",
    confTime: h4DetectedFvg.confTime,
    currentCloseTime: h4DetectedFvg.confTime + H4_BAR_DURATION_MS,
    structureBreaks: h4SecondaryBullBreaks,
  }),
  false,
  "fvg h4 f2 ignores opposite-direction breaks"
);

assert.equal(
  evaluateH4CoreFvgPassF2({
    dir: "BULL",
    confTime: h4DetectedFvg.confTime,
    currentCloseTime: h4DetectedFvg.confTime + H4_BAR_DURATION_MS,
    structureBreaks: [
      {
        tf: "H4",
        closeTime: h4DetectedFvg.confTime + H4_BAR_DURATION_MS,
        nextState: "UP",
        breakType: "CHOCH",
      },
    ],
  }),
  true,
  "fvg h4 f2 future latch accepts same-direction break on c plus one"
);

assert.equal(
  evaluateH4CoreFvgPassF3({
    tfBars: h4SecondaryBullBarsRetrospective,
    dir: "BULL",
    confTime: h4SecondaryRetrospectiveConfTime,
    currentCloseTime: h4SecondaryRetrospectiveConfTime,
    eqPivotPair: sweepBullEqLowPair,
  }),
  true,
  "fvg h4 f3 retrospective init accepts fully observed sweep recovery pairs before conf"
);

assert.equal(
  evaluateH4CoreFvgPassF3({
    tfBars: h4SecondaryBullBarsForward,
    dir: "BULL",
    confTime: h4SecondaryForwardConfTime,
    currentCloseTime: h4SecondaryBullBarsForward[17].closeTime,
    eqPivotPair: sweepBullEqLowPair,
  }),
  true,
  "fvg h4 f3 future latch accepts newly completed pair on current close"
);

assert.equal(
  countH4SecondaryPasses(true, false, true),
  2,
  "fvg h4 confirm counts secondary passes"
);

assert.deepEqual(
  evaluateH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  {
    isDueTime: true,
    passF1: true,
    secondaryPassCount: 2,
    passConfirm: true,
  },
  "fvg h4 confirm passes at due time with f1 and two secondary"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  {
    ...h4CandidatePassF1,
    state: "A_ACTIVE",
    passF2: true,
    passF3: true,
    passF4: false,
  },
  "fvg h4 confirm promotes candidate to a_active"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidateFailF1,
    currentCloseTime: h4CandidateFailF1.confirmDueTime,
    passF2: true,
    passF3: true,
    passF4: true,
  }),
  {
    ...h4CandidateFailF1,
    state: "DELETED",
    passF2: true,
    passF3: true,
    passF4: true,
    invalidReason: "failed_confirm",
    endTime: h4CandidateFailF1.confirmDueTime,
  },
  "fvg h4 confirm deletes candidate when f1 is missing"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: true,
    passF3: false,
    passF4: false,
  }),
  {
    ...h4CandidatePassF1,
    state: "DELETED",
    passF2: true,
    passF3: false,
    passF4: false,
    invalidReason: "failed_confirm",
    endTime: h4CandidatePassF1.confirmDueTime,
  },
  "fvg h4 confirm deletes candidate when secondary passes are below two"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime - H4_BAR_DURATION_MS,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  {
    ...h4CandidatePassF1,
    passF2: true,
    passF3: true,
  },
  "fvg h4 confirm latches secondary passes before due time without state change"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: {
      ...h4CandidatePassF1,
      state: "A_ACTIVE",
    },
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: true,
    passF3: true,
    passF4: true,
  }),
  {
    ...h4CandidatePassF1,
    state: "A_ACTIVE",
  },
  "fvg h4 confirm does not re-evaluate non-candidate state"
);

assert.deepEqual(
  evaluateH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime - H4_BAR_DURATION_MS,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  {
    isDueTime: false,
    passF1: true,
    secondaryPassCount: 2,
    passConfirm: false,
  },
  "fvg h4 confirm timing only due bar can pass"
);

assert.deepEqual(
  evaluateH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime + H4_BAR_DURATION_MS,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  {
    isDueTime: false,
    passF1: true,
    secondaryPassCount: 2,
    passConfirm: false,
  },
  "fvg h4 confirm timing does not pass after due bar"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidateFailF1,
    currentCloseTime: h4CandidateFailF1.confirmDueTime - H4_BAR_DURATION_MS,
    passF2: true,
    passF3: true,
    passF4: true,
  }),
  {
    ...h4CandidateFailF1,
    passF2: true,
    passF3: true,
    passF4: true,
  },
  "fvg h4 confirm timing does not delete before due bar but latches fields"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime + H4_BAR_DURATION_MS,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  {
    ...h4CandidatePassF1,
    passF2: true,
    passF3: true,
  },
  "fvg h4 confirm timing does not late-promote after due bar but latches fields"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: {
      ...h4CandidatePassF1,
      passF2: true,
    },
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: false,
    passF3: true,
    passF4: false,
  }),
  {
    ...h4CandidatePassF1,
    state: "A_ACTIVE",
    passF2: true,
    passF3: true,
    passF4: false,
  },
  "fvg h4 confirm uses latched passes at due bar"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidateFailF1,
    currentCloseTime: h4CandidateFailF1.confirmDueTime + H4_BAR_DURATION_MS,
    passF2: true,
    passF3: true,
    passF4: true,
  }),
  {
    ...h4CandidateFailF1,
    passF2: true,
    passF3: true,
    passF4: true,
  },
  "fvg h4 confirm timing does not late-delete after due bar but latches fields"
);

assert.equal(
  resolveFvgInvalidationReasonWithPriority({
    fullFillInvalidated: true,
    oppositeChochInvalidated: true,
    touchInvalidated: true,
    pruneInvalidated: true,
  }),
  "full_fill",
  "fvg invalidation priority full fill wins"
);

assert.equal(
  resolveFvgInvalidationReasonWithPriority({
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    touchInvalidated: true,
    pruneInvalidated: true,
  }),
  "opposite_choch",
  "fvg invalidation priority opposite choch beats touch and prune"
);

assert.equal(
  resolveFvgInvalidationReasonWithPriority({
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: true,
    pruneInvalidated: true,
  }),
  "touch_3",
  "fvg invalidation priority touch beats prune"
);

assert.equal(
  resolveFvgInvalidationReasonWithPriority({
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: false,
    pruneInvalidated: true,
  }),
  "pruned_by_limit",
  "fvg invalidation priority prune only"
);

assert.deepEqual(
  resolveFvgInvalidationDecision({
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: false,
    pruneInvalidated: false,
  }),
  {
    invalidated: false,
    invalidReason: null,
  },
  "fvg invalidation decision none"
);

assert.deepEqual(
  resolveFvgInvalidationDecision(
    evaluateD1PoiFvgInvalidationFlags({
      boxDir: "BULL",
      structureBreakType: "CHOCH",
      nextStructureState: "DOWN",
    })
  ),
  {
    invalidated: true,
    invalidReason: "opposite_choch",
  },
  "fvg invalidation decision accepts d1 flags shape"
);

assert.equal(
  evaluateFvgFullFillHit({
    dir: "BULL",
    zone: { bottom: 100, top: 102, height: 2 },
    wickHigh: 101,
    wickLow: 99.5,
  }),
  true,
  "fvg full fill bull uses wick low reaching bottom"
);

assert.equal(
  evaluateFvgFullFillHit({
    dir: "BEAR",
    zone: { bottom: 100, top: 102, height: 2 },
    wickHigh: 102.5,
    wickLow: 101,
  }),
  true,
  "fvg full fill bear uses wick high reaching top"
);

assert.deepEqual(
  evaluateH4CoreFvgInvalidationFlags({
    touchCount: 3,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: true,
    pruneInvalidated: false,
  },
  "fvg h4 invalidation touch_3 triggers at third touch"
);

assert.deepEqual(
  evaluateSetupFvgInvalidationFlags({
    h4OppositeChochAffectsParentChain: true,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    touchInvalidated: false,
    pruneInvalidated: false,
  },
  "fvg setup invalidation accepts h4 opposite choch chain"
);

assert.equal(
  computeTouchOverlapLen({
    wickHigh: 105,
    wickLow: 99,
    top: 103,
    bottom: 100,
  }),
  3,
  "fvg touch overlap uses wick-zone intersection"
);

assert.equal(
  computeTouchPenetrationMin(15, 4),
  1.5,
  "fvg touch penetration min uses atr floor when larger"
);

assert.equal(
  computeTouchPenetrationMin(10, 8),
  2,
  "fvg touch penetration min uses zone floor when larger"
);

assert.deepEqual(
  evaluateTouchPenetrationFilter({
    wickHigh: 101,
    wickLow: 99.5,
    top: 104,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 1,
    penetrationMin: 1,
    passTouchPenetration: true,
  },
  "fvg touch passes when overlap equals threshold"
);

assert.deepEqual(
  evaluateTouchPenetrationFilter({
    wickHigh: 101.5,
    wickLow: 99,
    top: 108,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 1.5,
    penetrationMin: 2,
    passTouchPenetration: false,
  },
  "fvg touch fails below threshold"
);

assert.deepEqual(
  evaluateTouchPenetrationFilter({
    wickHigh: 99,
    wickLow: 95,
    top: 104,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 0,
    penetrationMin: 1,
    passTouchPenetration: false,
  },
  "fvg touch fails when there is no overlap"
);

assert.equal(
  evaluateTouchPenetrationFilter({
    wickHigh: 101,
    wickLow: 99,
    top: 100,
    bottom: 100,
    atrForTf: 10,
  }),
  null,
  "fvg touch rejects invalid zone"
);

assert.equal(
  isSetupTf("H1"),
  true,
  "fvg setup tf includes h1"
);

assert.equal(
  isSetupTf("M15"),
  false,
  "fvg setup tf excludes m15"
);

assert.equal(
  isEligibleSetupParentPoi(d1ActiveParentPoi),
  true,
  "fvg setup accepts active d1 parent"
);

assert.equal(
  isEligibleSetupParentPoi(h4CandidateParentPoi),
  false,
  "fvg setup rejects non-a-active h4 parent"
);

assert.equal(
  computeInsideOverlapLen(
    d1ActiveParentPoi.zone,
    setupDetectedH1.zone
  ),
  2,
  "fvg setup inside overlap formula"
);

assert.equal(
  computeInsideOverlapRatio(
    d1ActiveParentPoi.zone,
    setupDetectedH1.zone
  ),
  0.2,
  "fvg setup inside ratio formula"
);

assert.equal(
  getSetupDisplayUntil("M30", setupDetectedM30.confTime),
  setupDetectedM30.confTime + 300 * 30 * 60 * 1000,
  "fvg setup display until uses tf duration"
);

assert.deepEqual(
  createSetupFvg({
    id: "SETUP-1",
    symbol: "btcusdt",
    parentPoi: d1ActiveParentPoi,
    detectedFvg: setupDetectedH1,
    displacementEval: setupH1DisplacementPass,
    h4StructureAtConf: "UP",
  }),
  {
    id: "SETUP-1",
    symbol: "BTCUSDT",
    type: "SETUP_FVG",
    tf: "H1",
    dir: "BULL",
    zone: {
      bottom: 108,
      top: 118,
      height: 10,
    },
    confTime: setupDetectedH1.confTime,
    createdAt: setupDetectedH1.confTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: setupDetectedH1.confTime + 300 * 60 * 60 * 1000,
    touchCount: 0,
    fullFillHit: false,
    atrAtConf: 10,
    parentPoiId: "D1-P-1",
    parentPoiType: "D1_POI_FVG",
    insideOverlapLen: 2,
    insideOverlapRatio: 0.2,
    passInside: true,
    passDirectionAlign: true,
    h4StructureAtConf: "UP",
    passH4StructureFilter: true,
    passDisplacement: true,
  },
  "fvg setup creates from active d1 parent"
);

assert.deepEqual(
  createSetupFvg({
    id: "SETUP-2",
    symbol: "btcusdt",
    parentPoi: h4ActiveParentPoi,
    detectedFvg: setupDetectedM30,
    displacementEval: setupM30DisplacementPass,
    h4StructureAtConf: "UP",
  }),
  {
    id: "SETUP-2",
    symbol: "BTCUSDT",
    type: "SETUP_FVG",
    tf: "M30",
    dir: "BULL",
    zone: {
      bottom: 110,
      top: 118,
      height: 8,
    },
    confTime: setupDetectedM30.confTime,
    createdAt: setupDetectedM30.confTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: setupDetectedM30.confTime + 300 * 30 * 60 * 1000,
    touchCount: 0,
    fullFillHit: false,
    atrAtConf: 10,
    parentPoiId: "H4-P-1",
    parentPoiType: "H4_CORE_FVG",
    insideOverlapLen: 2,
    insideOverlapRatio: 0.25,
    passInside: true,
    passDirectionAlign: true,
    h4StructureAtConf: "UP",
    passH4StructureFilter: true,
    passDisplacement: true,
  },
  "fvg setup creates from a-active h4 parent"
);

assert.equal(
  createSetupFvg({
    id: "SETUP-3",
    symbol: "BTCUSDT",
    parentPoi: d1ActiveParentPoi,
    detectedFvg: setupDetectedH1,
    displacementEval: setupH1DisplacementPass,
    h4StructureAtConf: "MIXED",
  }),
  null,
  "fvg setup rejects mixed h4 structure"
);

assert.equal(
  createSetupFvg({
    id: "SETUP-4",
    symbol: "BTCUSDT",
    parentPoi: d1ActiveParentPoi,
    detectedFvg: setupDetectedH1Bear,
    displacementEval: setupH1DisplacementPass,
    h4StructureAtConf: "UP",
  }),
  null,
  "fvg setup rejects direction mismatch"
);

assert.equal(
  createSetupFvg({
    id: "SETUP-5",
    symbol: "BTCUSDT",
    parentPoi: d1ActiveParentPoi,
    detectedFvg: setupDetectedH1InsideFail,
    displacementEval: setupH1DisplacementPass,
    h4StructureAtConf: "UP",
  }),
  null,
  "fvg setup requires inside ratio at least 0.20"
);

assert.equal(
  createSetupFvg({
    id: "SETUP-6",
    symbol: "BTCUSDT",
    parentPoi: d1ActiveParentPoi,
    detectedFvg: setupDetectedH1,
    displacementEval: setupH1DisplacementMismatch,
    h4StructureAtConf: "UP",
  }),
  null,
  "fvg setup requires displacement at matching conf time"
);

assert.equal(
  createSetupFvg({
    id: "SETUP-7",
    symbol: "BTCUSDT",
    parentPoi: d1ActiveParentPoi,
    detectedFvg: setupDetectedH4,
    displacementEval: setupH1DisplacementPass,
    h4StructureAtConf: "UP",
  }),
  null,
  "fvg setup only allows h1 or m30 detect"
);

const d1SupportParentPoi = {
  ...d1ActiveParentPoi,
  id: "D1-P-2",
  confTime: d1ActiveParentPoi.confTime + 24 * 60 * 60 * 1000,
  createdAt: d1ActiveParentPoi.createdAt + 24 * 60 * 60 * 1000,
  zone: {
    bottom: 107,
    top: 118,
    height: 11,
  },
};

const h4SupportParentPoi = {
  ...h4ActiveParentPoi,
  id: "H4-P-2",
  confTime: h4ActiveParentPoi.confTime + 4 * 60 * 60 * 1000,
  createdAt: h4ActiveParentPoi.createdAt + 4 * 60 * 60 * 1000,
  zone: {
    bottom: 107,
    top: 118,
    height: 11,
  },
};

assert.equal(
  getSetupParentLayer(d1ActiveParentPoi),
  "D1",
  "fvg setup parent layer maps d1 parent"
);

assert.equal(
  getSetupParentLayer(h4ActiveParentPoi),
  "H4",
  "fvg setup parent layer maps h4 parent"
);

assert.deepEqual(
  listValidSetupParentMatches(
    [d1ActiveParentPoi, h4ActiveParentPoi],
    setupDetectedH1
  ).map((match) => ({
    id: match.parent.id,
    layer: match.layer,
    ratio: match.insideOverlapRatio,
  })),
  [
    {
      id: "D1-P-1",
      layer: "D1",
      ratio: 0.2,
    },
    {
      id: "H4-P-1",
      layer: "H4",
      ratio: 0.4,
    },
  ],
  "fvg setup valid parent matches require inside and direction"
);

assert.deepEqual(
  selectCanonicalSetupParentMatch(
    listValidSetupParentMatches(
      [d1ActiveParentPoi, d1SupportParentPoi, h4SupportParentPoi],
      setupDetectedH1
    )
  ),
  {
    parent: d1SupportParentPoi,
    layer: "D1",
    insideOverlapLen: 10,
    insideOverlapRatio: 1,
  },
  "fvg setup canonical parent prefers d1 layer then highest inside overlap"
);

assert.equal(
  selectCanonicalSetupParentMatch(
    listValidSetupParentMatches(
      [
        {
          ...h4ActiveParentPoi,
          id: "H4-P-TIE-A",
          confTime: Date.UTC(2026, 2, 17, 3, 59, 59),
          createdAt: Date.UTC(2026, 2, 17, 3, 59, 59),
          zone: { bottom: 108, top: 118, height: 10 },
        },
        {
          ...h4ActiveParentPoi,
          id: "H4-P-TIE-B",
          confTime: Date.UTC(2026, 2, 17, 7, 59, 59),
          createdAt: Date.UTC(2026, 2, 17, 7, 59, 59),
          zone: { bottom: 108, top: 118, height: 10 },
        },
      ],
      setupDetectedH1
    )
  )?.parent.id,
  "H4-P-TIE-B",
  "fvg setup canonical parent tie-break prefers latest conf time within chosen layer"
);

assert.deepEqual(
  createSetupFvgFromParentPool({
    id: "SETUP-POOL-1",
    symbol: "btcusdt",
    parents: [d1ActiveParentPoi, h4SupportParentPoi],
    detectedFvg: setupDetectedH1,
    displacementEval: setupH1DisplacementPass,
    h4StructureAtConf: "UP",
  }),
  {
    id: "SETUP-POOL-1",
    symbol: "BTCUSDT",
    type: "SETUP_FVG",
    tf: "H1",
    dir: "BULL",
    zone: {
      bottom: 108,
      top: 118,
      height: 10,
    },
    confTime: setupDetectedH1.confTime,
    createdAt: setupDetectedH1.confTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: setupDetectedH1.confTime + 300 * 60 * 60 * 1000,
    touchCount: 0,
    fullFillHit: false,
    atrAtConf: 10,
    parentPoiId: "D1-P-1",
    parentPoiType: "D1_POI_FVG",
    supportingParentIds: ["H4-P-2"],
    tags: ["PARENT_D1_PRIMARY", "PARENT_H4_SUPPORT"],
    insideOverlapLen: 2,
    insideOverlapRatio: 0.2,
    passInside: true,
    passDirectionAlign: true,
    h4StructureAtConf: "UP",
    passH4StructureFilter: true,
    passDisplacement: true,
  },
  "fvg setup parent pool keeps d1 canonical and h4 support informational only"
);

assert.deepEqual(
  listKilledH4CoreFvgsAtCloseTime(
    [killedH4AtSetupClose, h4ActiveParentPoi],
    setupDetectedM30.confTime
  ).map((box) => box.id),
  [killedH4AtSetupClose.id],
  "fvg kill chain lists only opposite choch h4 boxes killed at current close"
);

assert.equal(
  shouldKillSetupFvgByKilledH4(
    activeSetupFromH4Parent,
    [killedH4AtSetupClose]
  ),
  true,
  "fvg kill chain kills setup directly when parent h4 is killed"
);

assert.equal(
  shouldKillSetupFvgByKilledH4(
    activeSetupFromD1Parent,
    [killedH4AtSetupClose]
  ),
  true,
  "fvg kill chain kills d1-parent setup when same-dir killed h4 overlaps by 0.20 or more"
);

assert.equal(
  shouldKillSetupFvgByKilledH4(
    activeSetupFromD1Parent,
    [
      {
        ...killedH4AtSetupClose,
        dir: "BEAR" as const,
      },
    ]
  ),
  false,
  "fvg kill chain ignores killed h4 with opposite direction"
);

assert.deepEqual(
  applySetupFvgOppositeChochKillChain({
    setup: activeSetupFromD1Parent,
    killedH4CoreFvgs: [killedH4AtSetupClose],
    currentCloseTime: setupDetectedM30.confTime,
  }),
  {
    ...activeSetupFromD1Parent,
    state: "INACTIVE",
    invalidReason: "opposite_choch",
    endTime: setupDetectedM30.confTime,
  },
  "fvg kill chain inactivates setup with opposite choch and current h4 close time"
);

assert.equal(
  computeStackOverlapLen(stackD1Source.zone, stackH4Source2.zone),
  4,
  "fvg stack overlap formula"
);

assert.equal(
  computeStackOverlapRatio(stackH4Source2.zone, stackSetupLowOverlap.zone),
  0.25,
  "fvg stack overlap ratio formula"
);

assert.equal(
  getStackTfForPair(stackD1Source, stackH4Source2),
  "H4",
  "fvg stack uses lower tf for d1 h4 pair"
);

assert.equal(
  getStackTfForPair(stackH4Source2, stackSetupSource2),
  "M30",
  "fvg stack uses lower tf for h4 setup pair"
);

assert.equal(
  getStackDisplayUntil("H4", stackCurrentCloseTime),
  stackCurrentCloseTime + 300 * H4_BAR_DURATION_MS,
  "fvg stack display until uses h4 duration"
);

assert.equal(
  getStackDisplayUntil("M30", stackCurrentCloseTime),
  stackCurrentCloseTime + 300 * 30 * 60 * 1000,
  "fvg stack display until uses m30 duration"
);

assert.deepEqual(
  createStackZoneFromPair({
    id: "STACK-Z-1",
    symbol: "btcusdt",
    currentCloseTime: stackCurrentCloseTime,
    a: stackD1Source,
    b: stackH4Source2,
  }),
  {
    id: "STACK-Z-1",
    symbol: "BTCUSDT",
    type: "STACK_ZONE",
    tf: "H4",
    dir: "BULL",
    zone: {
      bottom: 104,
      top: 108,
      height: 4,
    },
    confTime: stackCurrentCloseTime,
    createdAt: stackCurrentCloseTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: stackCurrentCloseTime + 300 * H4_BAR_DURATION_MS,
    touchCount: 0,
    fullFillHit: false,
    aId: "STACK-D1-1",
    bId: "STACK-H4-2",
    aTf: "D1",
    bTf: "H4",
    overlapLen: 4,
    overlapRatio: 1,
    passStack: true,
  },
  "fvg stack creates from d1 h4 active overlap"
);

assert.deepEqual(
  createStackZoneFromPair({
    id: "STACK-Z-2",
    symbol: "btcusdt",
    currentCloseTime: stackCurrentCloseTime,
    a: stackH4Source2,
    b: stackSetupSource2,
  }),
  {
    id: "STACK-Z-2",
    symbol: "BTCUSDT",
    type: "STACK_ZONE",
    tf: "M30",
    dir: "BULL",
    zone: {
      bottom: 105,
      top: 107,
      height: 2,
    },
    confTime: stackCurrentCloseTime,
    createdAt: stackCurrentCloseTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: stackCurrentCloseTime + 300 * 30 * 60 * 1000,
    touchCount: 0,
    fullFillHit: false,
    aId: "STACK-H4-2",
    bId: "STACK-SETUP-2",
    aTf: "H4",
    bTf: "M30",
    overlapLen: 2,
    overlapRatio: 1,
    passStack: true,
  },
  "fvg stack creates from h4 setup active overlap"
);

assert.equal(
  createStackZoneFromPair({
    id: "STACK-Z-3",
    symbol: "BTCUSDT",
    currentCloseTime: stackCurrentCloseTime,
    a: stackD1Source,
    b: stackH4BearSource,
  }),
  null,
  "fvg stack requires same direction"
);

assert.equal(
  createStackZoneFromPair({
    id: "STACK-Z-4",
    symbol: "BTCUSDT",
    currentCloseTime: stackCurrentCloseTime,
    a: stackH4Source2,
    b: stackSetupLowOverlap,
  }),
  null,
  "fvg stack requires overlap ratio at least 0.30"
);

assert.equal(
  createStackZoneFromPair({
    id: "STACK-Z-5",
    symbol: "BTCUSDT",
    currentCloseTime: stackCurrentCloseTime,
    a: stackD1Source,
    b: stackH4CandidateSource,
  }),
  null,
  "fvg stack requires active source states"
);

assert.deepEqual(
  createStackZonesInPriorityOrder({
    symbol: "BTCUSDT",
    currentCloseTime: stackCurrentCloseTime,
    d1Pois: [stackD1Source],
    h4CoreFvgs: [stackH4Source2, stackH4Source1],
    setupFvgs: [stackSetupSource2, stackSetupSource1],
    buildId: ({ pairType, high, low }) => `${pairType}:${high.id}:${low.id}`,
  }).map((stack) => stack.id),
  [
    "D1_H4:STACK-D1-1:STACK-H4-1",
    "D1_H4:STACK-D1-1:STACK-H4-2",
    "H4_SETUP:STACK-H4-1:STACK-SETUP-1",
    "H4_SETUP:STACK-H4-1:STACK-SETUP-2",
    "H4_SETUP:STACK-H4-2:STACK-SETUP-1",
    "H4_SETUP:STACK-H4-2:STACK-SETUP-2",
  ],
  "fvg stack output priority is pair type then stable source order"
);

assert.equal(
  isLtfReactionTf("M15"),
  true,
  "fvg ltf gate tf includes m15"
);

assert.equal(
  isLtfReactionTf("H1"),
  false,
  "fvg ltf gate tf excludes h1"
);

assert.equal(
  isEligibleLtfGatePoi(d1ActiveParentPoi),
  true,
  "fvg ltf gate accepts active d1 poi"
);

assert.equal(
  isEligibleLtfGatePoi(stackSetupSource1),
  true,
  "fvg ltf gate accepts active setup poi"
);

assert.equal(
  isEligibleLtfGatePoi(h4CandidateParentPoi),
  false,
  "fvg ltf gate rejects non-a-active h4 poi"
);

assert.equal(
  getLtfGateBoundary(d1ActiveParentPoi),
  100,
  "fvg ltf gate bull boundary uses bottom"
);

assert.equal(
  getLtfGateBoundary(ltfGateBearParentPoi),
  110,
  "fvg ltf gate bear boundary uses top"
);

assert.deepEqual(
  {
    bull: getLtfGatePriceExtreme(ltfGateCurrentBarBull, "BULL"),
    bear: getLtfGatePriceExtreme(ltfGateCurrentBarBear, "BEAR"),
  },
  {
    bull: 98,
    bear: 113,
  },
  "fvg ltf gate price extreme uses wick low high"
);

assert.equal(
  computeLtfGateDist(98, 100),
  2,
  "fvg ltf gate distance formula"
);

assert.deepEqual(
  evaluateLtfGateOnBar({
    bar: ltfGateCurrentBarBull,
    poi: d1ActiveParentPoi,
    atrAtLtf: 10,
  }),
  {
    poiId: "D1-P-1",
    poiType: "D1_POI_FVG",
    tf: "M15",
    dir: "BULL",
    barCloseTime: ltfGateCurrentBarBull.closeTime,
    boundary: 100,
    priceExtreme: 98,
    dist: 2,
    atrAtLtf: 10,
    passGate: true,
  },
  "fvg ltf gate passes when distance equals atr threshold"
);

assert.deepEqual(
  evaluateLtfGateOnBar({
    bar: ltfGateCurrentBarBear,
    poi: ltfGateBearParentPoi,
    atrAtLtf: 10,
  }),
  {
    poiId: "LTF-D1-BEAR",
    poiType: "D1_POI_FVG",
    tf: "M5",
    dir: "BEAR",
    barCloseTime: ltfGateCurrentBarBear.closeTime,
    boundary: 110,
    priceExtreme: 113,
    dist: 3,
    atrAtLtf: 10,
    passGate: false,
  },
  "fvg ltf gate fails when distance exceeds threshold"
);

assert.equal(
  evaluateLtfGateFromTfBars(
    ltfGateM15Bars.slice(0, 13),
    d1ActiveParentPoi
  ),
  null,
  "fvg ltf gate wrapper requires atr at current close"
);

assert.deepEqual(
  evaluateLtfGateFromTfBars(
    ltfGateM15Bars,
    d1ActiveParentPoi
  ),
  {
    poiId: "D1-P-1",
    poiType: "D1_POI_FVG",
    tf: "M15",
    dir: "BULL",
    barCloseTime: ltfGateM15Bars[14].closeTime,
    boundary: 100,
    priceExtreme: 98,
    dist: 2,
    atrAtLtf: 10,
    passGate: true,
  },
  "fvg ltf gate wrapper uses current close atr"
);

assert.equal(
  FvgConstants.LTF_MICRO_PIVOT_LEN,
  2,
  "fvg ltf micro pivot len constant"
);

assert.equal(
  isLtfTriggerTf("M15"),
  true,
  "fvg ltf trigger tf includes m15"
);

assert.equal(
  isLtfTriggerTf("H1"),
  false,
  "fvg ltf trigger tf excludes h1"
);

assert.equal(
  evaluateLtfChochTrigger(ltfBullChochBars, "BULL"),
  true,
  "fvg ltf choch bull uses close break of last confirmed micro pivot high"
);

assert.equal(
  evaluateLtfChochTrigger(ltfBearChochBars, "BEAR"),
  true,
  "fvg ltf choch bear uses close break of last confirmed micro pivot low"
);

assert.deepEqual(
  resolveLtfSweepRecoveryTarget({
    tfBars: ltfBullSweepEqBars,
    dir: "BULL",
    currentCloseTime: ltfBullSweepEqBars[19].closeTime,
    atrAtEval: 10,
  }),
  {
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
  },
  "fvg ltf sweep target prefers eql outer line"
);

assert.deepEqual(
  resolveLtfSweepRecoveryTarget({
    tfBars: ltfBullSweepFallbackBars,
    dir: "BULL",
    currentCloseTime: ltfBullSweepFallbackBars[19].closeTime,
    atrAtEval: 10,
  }),
  {
    targetType: "SWING_LOW",
    linePrice: 90,
    usedEqPair: false,
  },
  "fvg ltf sweep target falls back to last confirmed swing low"
);

assert.deepEqual(
  evaluateLtfSweepRecTrigger(ltfBullSweepEqBars, "BULL"),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    sweepBarTime: ltfBullSweepEqBars[18].closeTime,
    recoveryBarTime: ltfBullSweepEqBars[19].closeTime,
    passSweepRecovery: true,
  },
  "fvg ltf sweep rec passes on recent completion"
);

assert.deepEqual(
  evaluateLtfSweepRecTrigger(ltfBullChochBars, "BULL"),
  {
    hasTarget: false,
    targetType: null,
    linePrice: null,
    usedEqPair: false,
    passSweepRecovery: false,
  },
  "fvg ltf sweep rec fails without recent completion target"
);

assert.equal(
  evaluateMicroRetestBoundaryTrigger(ltfBoundaryMrBars, d1ActiveParentPoi),
  "MR_FVG_BOUNDARY",
  "fvg ltf micro retest boundary passes"
);

assert.equal(
  evaluateMicroRetestMicroObTrigger(ltfBullMicroObBars, "BULL"),
  "MR_MICRO_OB",
  "fvg ltf micro retest micro ob passes"
);

assert.equal(
  evaluateMicroRetestMicroFvgTrigger(ltfBullMicroFvgBars, "BULL"),
  "MR_MICRO_FVG",
  "fvg ltf micro retest micro fvg passes"
);

assert.deepEqual(
  sortUniqueLtfTriggerTokens([
    "SWEEP_REC",
    "CHOCH",
    "SWEEP_REC",
    "MR_MICRO_OB",
  ]),
  ["CHOCH", "MR_MICRO_OB", "SWEEP_REC"],
  "fvg ltf trigger tokens are unique and lexicographic"
);

assert.deepEqual(
  evaluateLtfTriggers(ltfBullSweepEqBars, ltfBullPoiForAggregate),
  {
    tf: "M15",
    dir: "BULL",
    barCloseTime: ltfBullSweepEqBars[19].closeTime,
    choch: true,
    sweepRec: true,
    microRetestTypes: [],
    tokens: ["CHOCH", "SWEEP_REC"],
  },
  "fvg ltf trigger aggregate output is sorted and deterministic"
);

assert.equal(
  detectNewlyConfirmedFractalPivot(pivotHighD1Bars.slice(0, 6), "HIGH"),
  null,
  "fvg unconfirmed pivot is unavailable before p+3 close"
);

assert.equal(
  detectConfirmedMicroPivotAtIndex(ltfBullUnconfirmedHighBars, "HIGH", 3),
  null,
  "fvg ltf unconfirmed micro pivot high is not usable"
);

assert.equal(
  evaluateLtfChochTrigger(ltfBullUnconfirmedHighBars, "BULL"),
  false,
  "fvg ltf choch ignores unconfirmed micro pivot high"
);

assert.deepEqual(
  resolveLtfSweepRecoveryTarget({
    tfBars: ltfBullUnconfirmedEqLowBars,
    dir: "BULL",
    currentCloseTime: ltfBullUnconfirmedEqLowBars[5].closeTime,
    atrAtEval: 10,
  }),
  {
    targetType: "SWING_LOW",
    linePrice: 90,
    usedEqPair: false,
  },
  "fvg ltf sweep target ignores unconfirmed eq pair"
);

assert.equal(
  detectNewlyConfirmedFractalPivot(pivotHighD1Bars.slice(0, 6), "HIGH"),
  null,
  "fvg unconfirmed pivot is unavailable before p+3 close"
);

assert.equal(
  detectConfirmedMicroPivotAtIndex(ltfBullUnconfirmedHighBars, "HIGH", 3),
  null,
  "fvg ltf unconfirmed micro pivot high is not usable"
);

assert.equal(
  evaluateLtfChochTrigger(ltfBullUnconfirmedHighBars, "BULL"),
  false,
  "fvg ltf choch ignores unconfirmed micro pivot high"
);

assert.deepEqual(
  resolveLtfSweepRecoveryTarget({
    tfBars: ltfBullUnconfirmedEqLowBars,
    dir: "BULL",
    currentCloseTime: ltfBullUnconfirmedEqLowBars[5].closeTime,
    atrAtEval: 10,
  }),
  {
    targetType: "SWING_LOW",
    linePrice: 90,
    usedEqPair: false,
  },
  "fvg ltf sweep target ignores unconfirmed eq pair"
);

assert.equal(
  buildReactionGateKey("btcusdt", "POI-1", "BULL"),
  "BTCUSDT:POI-1:BULL",
  "fvg reaction gate key format"
);

assert.deepEqual(
  createReactionGate("btcusdt", "POI-1", "BULL"),
  {
    key: "BTCUSDT:POI-1:BULL",
  },
  "fvg reaction gate create shape"
);

assert.equal(
  getBlock5mUntilFrom15mReaction(reactionGateBaseTime),
  reactionGateBaseTime + 30 * 60 * 1000,
  "fvg reaction gate 15m reaction blocks 5m for 30m"
);

assert.equal(
  getBlockAllUntilFrom5mEntry(reactionGateBaseTime),
  reactionGateBaseTime + 60 * 60 * 1000,
  "fvg reaction gate 5m entry blocks all for 60m"
);

assert.deepEqual(
  apply15mReactionToGate(
    createReactionGate("btcusdt", "POI-1", "BULL"),
    reactionGateBaseTime
  ),
  {
    key: "BTCUSDT:POI-1:BULL",
    last15mReactionAt: reactionGateBaseTime,
    block5mUntil: reactionGateBaseTime + 30 * 60 * 1000,
  },
  "fvg reaction gate stores 15m reaction cooldown"
);

assert.deepEqual(
  evaluateReactionGate(
    apply15mReactionToGate(
      createReactionGate("btcusdt", "POI-1", "BULL"),
      reactionGateBaseTime
    ),
    "M5",
    reactionGateBaseTime + 10 * 60 * 1000
  ),
  {
    tf: "M5",
    currentCloseTime: reactionGateBaseTime + 10 * 60 * 1000,
    blockedAll: false,
    blockedBy5mCooldown: true,
    reactionBlocked: true,
    entryBlocked: true,
  },
  "fvg reaction gate blocks m5 during 30m cooldown"
);

assert.deepEqual(
  evaluateReactionGate(
    apply15mReactionToGate(
      createReactionGate("btcusdt", "POI-1", "BULL"),
      reactionGateBaseTime
    ),
    "M15",
    reactionGateBaseTime + 10 * 60 * 1000
  ),
  {
    tf: "M15",
    currentCloseTime: reactionGateBaseTime + 10 * 60 * 1000,
    blockedAll: false,
    blockedBy5mCooldown: false,
    reactionBlocked: false,
    entryBlocked: false,
  },
  "fvg reaction gate does not block m15 from 15m reaction cooldown"
);

assert.deepEqual(
  evaluateReactionGate(
    apply5mEntryToGate(
      createReactionGate("btcusdt", "POI-1", "BULL"),
      reactionGateBaseTime
    ),
    "M15",
    reactionGateBaseTime + 10 * 60 * 1000
  ),
  {
    tf: "M15",
    currentCloseTime: reactionGateBaseTime + 10 * 60 * 1000,
    blockedAll: true,
    blockedBy5mCooldown: false,
    reactionBlocked: true,
    entryBlocked: true,
  },
  "fvg reaction gate blocks all after 5m entry"
);

assert.deepEqual(
  evaluateReactionGate(
    apply5mEntryToGate(
      createReactionGate("btcusdt", "POI-1", "BULL"),
      reactionGateBaseTime
    ),
    "M5",
    reactionGateBaseTime + 61 * 60 * 1000
  ),
  {
    tf: "M5",
    currentCloseTime: reactionGateBaseTime + 61 * 60 * 1000,
    blockedAll: false,
    blockedBy5mCooldown: false,
    reactionBlocked: false,
    entryBlocked: false,
  },
  "fvg reaction gate unblocks after cooldown expiry"
);

const prunedReactionBoxes = applyFvgPrune(
  [
    { ...pruneD1Old, zone: { bottom: 94, top: 104, height: 10 } },
    { ...pruneD1Mid, zone: { bottom: 94, top: 104, height: 10 } },
    { ...pruneD1New, zone: { bottom: 94, top: 104, height: 10 } },
    { ...pruneD1Newest, zone: { bottom: 94, top: 104, height: 10 } },
  ],
  pruneNow
);

const prunedOldReactionPoi = prunedReactionBoxes.find(
  (box) => box.id === "PRUNE-D1-OLD"
)!;

const keptNewestReactionPoi = prunedReactionBoxes.find(
  (box) => box.id === "PRUNE-D1-NEWEST"
)!;

assert.equal(
  canIntegratedLtfReaction(
    ltfBullSweepEqBars,
    ltfBullReactionPoi,
    createReactionGate("BTCUSDT", ltfBullReactionPoi.id, "BULL")
  ),
  true,
  "fvg integrated m15 reaction passes with gate and trigger"
);

assert.equal(
  canIntegratedLtfEntry(
    ltfBullM5EntryBars,
    ltfBullEntryPoi,
    createReactionGate("BTCUSDT", ltfBullEntryPoi.id, "BULL")
  ),
  true,
  "fvg integrated m5 entry passes with gate and trigger"
);

assert.equal(
  canIntegratedLtfEntry(
    ltfBullM5EntryBars,
    ltfBullEntryPoi,
    apply15mReactionToGate(
      createReactionGate("BTCUSDT", ltfBullEntryPoi.id, "BULL"),
      ltfBullM5EntryBars[18].closeTime - 10 * 60 * 1000
    )
  ),
  false,
  "fvg integrated 15m reaction blocks m5 entry during cooldown"
);

assert.equal(
  canIntegratedLtfEntry(
    ltfBullM5EntryBars,
    ltfBullEntryPoi,
    apply15mReactionToGate(
      createReactionGate("BTCUSDT", ltfBullEntryPoi.id, "BULL"),
      ltfBullM5EntryBars[18].closeTime - 31 * 60 * 1000
    )
  ),
  true,
  "fvg integrated m5 entry resumes after 15m cooldown expiry"
);

assert.equal(
  canIntegratedLtfReaction(
    ltfBullSweepEqBars,
    ltfBullReactionPoi,
    apply5mEntryToGate(
      createReactionGate("BTCUSDT", ltfBullReactionPoi.id, "BULL"),
      ltfBullSweepEqBars[19].closeTime - 10 * 60 * 1000
    )
  ),
  false,
  "fvg integrated 5m entry blocks m15 reaction during cooldown"
);

assert.equal(
  canIntegratedLtfReaction(
    ltfBullSweepEqBars,
    prunedOldReactionPoi,
    createReactionGate("BTCUSDT", prunedOldReactionPoi.id, "BULL")
  ),
  false,
  "fvg integrated pruned poi cannot trigger reaction"
);

assert.equal(
  canIntegratedLtfReaction(
    ltfBullSweepEqBars,
    keptNewestReactionPoi,
    createReactionGate("BTCUSDT", keptNewestReactionPoi.id, "BULL")
  ),
  true,
  "fvg integrated non-pruned poi can still trigger reaction"
);

assert.equal(
  canIntegratedLtfEntry(
    ltfBullM5EntryBars,
    {
      ...ltfBullEntryPoi,
      state: "INACTIVE" as const,
    },
    createReactionGate("BTCUSDT", ltfBullEntryPoi.id, "BULL")
  ),
  false,
  "fvg integrated inactive poi cannot trigger entry"
);

clearRuntimePoiStore("BTCUSDT");

let fvgRuntimeReactionState = createEmptyFvgRuntimeState("BTCUSDT");
fvgRuntimeReactionState.d1Pois = [ltfBullReactionPoi];
const fvgRuntimeReactionEvents: string[] = [];

for (const bar of ltfBullSweepEqBars) {
  const result = applyFvgBarClose(fvgRuntimeReactionState, bar);
  fvgRuntimeReactionState = result.nextState;
  fvgRuntimeReactionEvents.push(...result.events);
}

assert.deepEqual(
  fvgRuntimeReactionEvents,
  [
    `[ENTRY_WINDOW_OPEN][M15] time=${new Date(ltfBullSweepEqBars[19].closeTime).toISOString().replace(".000Z", "Z")} poi=${ltfBullReactionPoi.id} triggers=2plus:CHOCH|SWEEP_REC`,
  ],
  "fvg runtime emits canonical m15 entry-window event from active d1 poi when triggers reach two"
);

assert.equal(
  fvgRuntimeReactionState.reactionGates.get(
    buildReactionGateKey("BTCUSDT", ltfBullReactionPoi.id, "BULL")
  )?.block5mUntil,
  ltfBullSweepEqBars[19].closeTime + 30 * 60 * 1000,
  "fvg runtime applies 15m reaction cooldown after emission"
);

assert.deepEqual(
  getRuntimePoiStore("BTCUSDT").get(ltfBullReactionPoi.id),
  {
    id: ltfBullReactionPoi.id,
    symbol: "BTCUSDT",
    kind: "FVG",
    tf: "D1",
    dir: "BULL",
    zone: {
      bottom: 94,
      top: 104,
    },
    tags: [],
    type: "D1_POI_FVG",
    state: "ACTIVE",
    confTime: new Date(ltfBullReactionPoi.confTime).toISOString().replace(".000Z", "Z"),
    stackActive: false,
  },
  "fvg runtime registers active fvg poi into runtime poi store"
);

const normalizedZoneTick01 = normalizeFvgZoneToTick({
  bottom: 100.02,
  top: 101.98,
  tick: 0.1,
})!;

assert.deepEqual(
  normalizedZoneTick01,
  {
    bottomTick: 1000,
    topTick: 1020,
    bottomNorm: 100,
    topNorm: 102,
  },
  "fvg tick normalization uses floor and ceil"
);

assert.deepEqual(
  normalizeFvgZoneToTick({
    bottom: 100,
    top: 101,
    tick: 0.1,
  }),
  {
    bottomTick: 1000,
    topTick: 1010,
    bottomNorm: 100,
    topNorm: 101,
  },
  "fvg tick normalization preserves exact boundary with epsilon"
);

assert.equal(
  formatFvgZoneForOutput(normalizedZoneTick01, 0.1),
  "100.0~102.0",
  "fvg normalized zone output uses tick decimals"
);

assert.equal(
  buildNormalizedFvgId({
    symbol: "btcusdt",
    type: "H4_CORE_FVG",
    tf: "H4",
    confTime: 1234567890,
    dir: "BULL",
    zone: normalizedZoneTick01,
  }),
  "BTCUSDT:H4_CORE_FVG:H4:1234567890:BULL:1000:1020",
  "fvg normalized id uses integer ticks"
);

assert.equal(
  formatRatio2(0.299999),
  "0.30",
  "fvg ratio output uses two decimals"
);

assert.equal(
  normalizeFvgZoneToTick({
    bottom: 100,
    top: 101,
    tick: 0,
  }),
  null,
  "fvg tick normalization rejects invalid tick"
);

assert.equal(
  getFvgPruneBucket(pruneD1Old),
  "D1_ACTIVE",
  "fvg prune bucket includes active d1"
);

assert.equal(
  getFvgPruneBucket(pruneH4CandidateOld),
  "H4_POOL",
  "fvg prune bucket includes h4 candidate in pool"
);

assert.equal(
  getFvgPruneBucket(pruneSetupM30Old),
  "SETUP_M30_ACTIVE",
  "fvg prune bucket separates m30 setup"
);

assert.deepEqual(
  {
    d1: getFvgPruneLimit("D1_ACTIVE"),
    h4: getFvgPruneLimit("H4_POOL"),
    h1: getFvgPruneLimit("SETUP_H1_ACTIVE"),
    m30: getFvgPruneLimit("SETUP_M30_ACTIVE"),
  },
  {
    d1: 3,
    h4: 10,
    h1: 6,
    m30: 6,
  },
  "fvg prune limits use constants"
);

assert.deepEqual(
  Array.from(
    buildFvgPruneIdSet([
      pruneD1Newest,
      pruneD1Mid,
      pruneD1New,
      pruneD1Old,
    ])
  ).sort(),
  ["PRUNE-D1-OLD"],
  "fvg prune picks oldest d1 when exceeding limit"
);

assert.deepEqual(
  Array.from(
    buildFvgPruneIdSet([
      pruneH4AActiveNew,
      pruneH4CandidateOld,
      pruneInactiveH4,
    ])
  ).sort(),
  [],
  "fvg prune ignores inactive h4 and does not prune within limit"
);

assert.deepEqual(
  Array.from(
    buildFvgPruneIdSet([
      pruneSetupH1New,
      pruneSetupH1Old,
      pruneSetupM30New,
      pruneSetupM30Old,
    ])
  ).sort(),
  [],
  "fvg prune keeps h1 and m30 setup buckets separate"
);

assert.deepEqual(
  applyFvgPrune(
    [pruneD1Newest, pruneD1Mid, pruneD1New, pruneD1Old, pruneStackUntouched],
    pruneNow
  ),
  [
    pruneD1Newest,
    pruneD1Mid,
    pruneD1New,
    {
      ...pruneD1Old,
      state: "INACTIVE",
      invalidReason: "pruned_by_limit",
      endTime: pruneNow,
    },
    pruneStackUntouched,
  ],
  "fvg prune inactivates oldest and leaves stack untouched"
);

assert.deepEqual(
  applyFvgPrune([pruneInactiveH4], pruneNow),
  [pruneInactiveH4],
  "fvg prune leaves already inactive boxes unchanged"
);

const obBullZoneBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 6, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 6, 3, 59, 59),
    open: 110,
    high: 112,
    low: 105,
    close: 111,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 6, 4, 0, 0),
    closeTime: Date.UTC(2026, 3, 6, 7, 59, 59),
    open: 111,
    high: 113,
    low: 109,
    close: 112,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 6, 8, 0, 0),
    closeTime: Date.UTC(2026, 3, 6, 11, 59, 59),
    open: 112,
    high: 114,
    low: 110,
    close: 111, // bearish
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 6, 12, 0, 0),
    closeTime: Date.UTC(2026, 3, 6, 15, 59, 59),
    open: 111,
    high: 115,
    low: 109,
    close: 113,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 6, 16, 0, 0),
    closeTime: Date.UTC(2026, 3, 6, 19, 59, 59),
    open: 113,
    high: 116,
    low: 111,
    close: 114,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 6, 20, 0, 0),
    closeTime: Date.UTC(2026, 3, 6, 23, 59, 59),
    open: 114,
    high: 117,
    low: 110,
    close: 112, // bearish (latest opposite in k-6~k-1)
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 7, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 7, 3, 59, 59),
    open: 112,
    high: 118,
    low: 111,
    close: 117,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 7, 4, 0, 0),
    closeTime: Date.UTC(2026, 3, 7, 7, 59, 59),
    open: 117,
    high: 120,
    low: 116,
    close: 119, // trigger k
    volume: 0,
  },
];

const obBearZoneBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 8, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 8, 3, 59, 59),
    open: 90,
    high: 93,
    low: 88,
    close: 89,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 8, 4, 0, 0),
    closeTime: Date.UTC(2026, 3, 8, 7, 59, 59),
    open: 89,
    high: 92,
    low: 87,
    close: 88,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 8, 8, 0, 0),
    closeTime: Date.UTC(2026, 3, 8, 11, 59, 59),
    open: 88,
    high: 94,
    low: 87,
    close: 92, // bullish
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 8, 12, 0, 0),
    closeTime: Date.UTC(2026, 3, 8, 15, 59, 59),
    open: 92,
    high: 95,
    low: 90,
    close: 91,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 8, 16, 0, 0),
    closeTime: Date.UTC(2026, 3, 8, 19, 59, 59),
    open: 91,
    high: 96,
    low: 89,
    close: 95, // bullish (latest opposite)
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 8, 20, 0, 0),
    closeTime: Date.UTC(2026, 3, 8, 23, 59, 59),
    open: 95,
    high: 96,
    low: 90,
    close: 92,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 9, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 9, 3, 59, 59),
    open: 92,
    high: 93,
    low: 86,
    close: 87, // trigger k
    volume: 0,
  },
];

const obNoOppositeBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 3, 10, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 10, 23, 59, 59),
    open: 100,
    high: 105,
    low: 99,
    close: 104,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 3, 11, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 11, 23, 59, 59),
    open: 104,
    high: 108,
    low: 103,
    close: 107,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 3, 12, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 12, 23, 59, 59),
    open: 107,
    high: 110,
    low: 106,
    close: 109,
    volume: 0,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 3, 13, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 13, 23, 59, 59),
    open: 109,
    high: 112,
    low: 108,
    close: 111, // trigger k
    volume: 0,
  },
];

const obSampleD1 = {
  id: "OB-SAMPLE-D1",
  symbol: "BTCUSDT",
  type: "D1_POI_OB" as const,
  tf: "D1" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 100,
    top: 104,
    height: 4,
  },
  triggerTime: Date.UTC(2026, 3, 22, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 22, 23, 59, 59),
  state: "ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil:
    Date.UTC(2026, 3, 22, 23, 59, 59) + 300 * 24 * 60 * 60 * 1000,
  confirmDueTime: Date.UTC(2026, 3, 23, 23, 59, 59),
  atrAtTrigger: 10,
  passHeightFilter: true,
  passDisplacement: true,
  passSweepRecovery: true,
  passContextDist: true,
  touchCount: 0,
  fullFillHit: false,
  tags: [],
};

const obSampleH4 = {
  id: "OB-SAMPLE-H4",
  symbol: "BTCUSDT",
  type: "H4_CORE_OB" as const,
  tf: "H4" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 100,
    top: 103,
    height: 3,
  },
  triggerTime: Date.UTC(2026, 3, 23, 7, 59, 59),
  createdAt: Date.UTC(2026, 3, 23, 7, 59, 59),
  state: "POI_ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil: Date.UTC(2026, 3, 23, 7, 59, 59) + 300 * H4_BAR_DURATION_MS,
  confirmDueTime: Date.UTC(2026, 3, 23, 11, 59, 59),
  atrAtTrigger: 10,
  passHeightFilter: true,
  passDisplacement: true,
  passSweepRecovery: true,
  passContextDist: true,
  touchCount: 0,
  fullFillHit: false,
  tags: [],
};

const obSampleSetup = {
  id: "OB-SAMPLE-SETUP",
  symbol: "BTCUSDT",
  type: "SETUP_OB" as const,
  tf: "H1" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 104,
    top: 106,
    height: 2,
  },
  triggerTime: Date.UTC(2026, 3, 23, 11, 59, 59),
  createdAt: Date.UTC(2026, 3, 23, 11, 59, 59),
  state: "ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil: Date.UTC(2026, 3, 23, 11, 59, 59) + 300 * 60 * 60 * 1000,
  atrAtTrigger: 10,
  passHeightFilter: true,
  passDisplacement: true,
  passSweepRecovery: true,
  passContextDist: true,
  touchCount: 0,
  fullFillHit: false,
  tags: [],
  parentPoiId: "OB-SAMPLE-D1",
  parentPoiType: "D1_POI_OB" as const,
  insideOverlapLen: 1,
  insideOverlapRatio: 0.5,
  passInside: true,
  passDirectionAlign: true,
  h4StructureAtConf: "UP" as const,
  hasH4MixedRiskTag: false,
  localOppChochAfterTouchOnly: true,
};

const obCollabTargetOb = {
  ...obSampleD1,
  id: "OB-COLLAB-TARGET",
  symbol: "BTCUSDT",
  dir: "BULL" as const,
  zone: {
    bottom: 100,
    top: 110,
    height: 10,
  },
  tags: [],
};

const obCollabFvgD1Inside = {
  id: "FVG-COL-D1-INSIDE",
  symbol: "BTCUSDT",
  type: "D1_POI_FVG" as const,
  tf: "D1" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 108,
    top: 118,
    height: 10,
  },
  confTime: Date.UTC(2026, 3, 26, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 26, 23, 59, 59),
  state: "ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil:
    Date.UTC(2026, 3, 26, 23, 59, 59) + 300 * 24 * 60 * 60 * 1000,
  touchCount: 0,
  fullFillHit: false,
  atrAtConf: 10,
  structureAtConf: "UP" as const,
  passDisplacement: true,
  passMixedStrongDisp: false,
};

const obCollabFvgH4Overlap = {
  id: "FVG-COL-H4-OVERLAP",
  symbol: "BTCUSDT",
  type: "H4_CORE_FVG" as const,
  tf: "H4" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 107,
    top: 117,
    height: 10,
  },
  confTime: Date.UTC(2026, 3, 27, 7, 59, 59),
  createdAt: Date.UTC(2026, 3, 27, 7, 59, 59),
  state: "A_ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil:
    Date.UTC(2026, 3, 27, 7, 59, 59) + 300 * 4 * 60 * 60 * 1000,
  touchCount: 0,
  fullFillHit: false,
  atrAtConf: 10,
  confirmDueTime: Date.UTC(2026, 3, 27, 11, 59, 59),
  passF1: true,
  passF2: true,
  passF3: false,
  passF4: false,
};

const obCollabFvgSetupHigh = {
  id: "FVG-COL-SETUP-HIGH",
  symbol: "BTCUSDT",
  type: "SETUP_FVG" as const,
  tf: "H1" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 102,
    top: 104,
    height: 2,
  },
  confTime: Date.UTC(2026, 3, 27, 12, 59, 59),
  createdAt: Date.UTC(2026, 3, 27, 12, 59, 59),
  state: "ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil:
    Date.UTC(2026, 3, 27, 12, 59, 59) + 300 * 60 * 60 * 1000,
  touchCount: 0,
  fullFillHit: false,
  atrAtConf: 10,
  parentPoiId: "PARENT-1",
  parentPoiType: "H4_CORE_FVG" as const,
  insideOverlapLen: 2,
  insideOverlapRatio: 1,
  passInside: true,
  passDirectionAlign: true,
  h4StructureAtConf: "UP" as const,
  passH4StructureFilter: true,
  passDisplacement: true,
};

const obCollabFvgTieOld = {
  ...obCollabFvgSetupHigh,
  id: "FVG-COL-TIE-OLD",
  zone: {
    bottom: 105,
    top: 109,
    height: 4,
  },
  confTime: Date.UTC(2026, 3, 27, 10, 59, 59),
  createdAt: Date.UTC(2026, 3, 27, 10, 59, 59),
};

const obCollabFvgTieNew = {
  ...obCollabFvgSetupHigh,
  id: "FVG-COL-TIE-NEW",
  zone: {
    bottom: 105,
    top: 109,
    height: 4,
  },
  confTime: Date.UTC(2026, 3, 27, 11, 59, 59),
  createdAt: Date.UTC(2026, 3, 27, 11, 59, 59),
};

const obCollabFvgTieIdA = {
  ...obCollabFvgSetupHigh,
  id: "FVG-COL-TIE-A",
  zone: {
    bottom: 105,
    top: 109,
    height: 4,
  },
  confTime: Date.UTC(2026, 3, 27, 12, 59, 59),
  createdAt: Date.UTC(2026, 3, 27, 12, 59, 59),
};

const obCollabFvgTieIdB = {
  ...obCollabFvgSetupHigh,
  id: "FVG-COL-TIE-B",
  zone: {
    bottom: 105,
    top: 109,
    height: 4,
  },
  confTime: Date.UTC(2026, 3, 27, 12, 59, 59),
  createdAt: Date.UTC(2026, 3, 27, 12, 59, 59),
};

const obCollabFvgStackExcluded = {
  id: "FVG-COL-STACK",
  symbol: "BTCUSDT",
  type: "STACK_ZONE" as const,
  tf: "H4" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 102,
    top: 106,
    height: 4,
  },
  confTime: Date.UTC(2026, 3, 27, 7, 59, 59),
  createdAt: Date.UTC(2026, 3, 27, 7, 59, 59),
  state: "ACTIVE" as const,
  maxForwardBars: 300,
  displayUntil:
    Date.UTC(2026, 3, 27, 7, 59, 59) + 300 * 4 * 60 * 60 * 1000,
  touchCount: 0,
  fullFillHit: false,
  aId: "A",
  bId: "B",
  aTf: "D1" as const,
  bTf: "H4" as const,
  overlapLen: 4,
  overlapRatio: 1,
  passStack: true,
};

assert.equal(
  formatD1PoiFvgNewEvent(obCollabFvgD1Inside, 1),
  "[NEW][D1][POI_FVG][BULL] zone=108~118",
  "fvg d1 new event output lock"
);

assert.equal(
  formatH4CoreFvgConfirmEvent(obCollabFvgH4Overlap, 1),
  "[CONFIRM][4H][FVG][A] tags=F1+F2 zone=107~117",
  "fvg h4 confirm event output lock"
);

assert.equal(
  formatSetupFvgNewEvent(obCollabFvgSetupHigh, 1),
  "[NEW][H1][SETUP_FVG] inside=4H:PARENT-1 zone=102~104",
  "fvg setup new event output lock"
);

assert.equal(
  formatStackZoneEndEvent(
    obCollabFvgStackExcluded,
    "source_inactive",
    Date.UTC(2026, 3, 27, 8, 0, 0),
    1
  ),
  "[STACK_END][D1\u22294H] reason=source_inactive endTime=2026-04-27T08:00:00Z zone=102~106",
  "fvg stack end event output lock"
);

assert.deepEqual(
  buildFvgLifecycleEvents({
    prevD1Pois: [],
    nextD1Pois: [obCollabFvgD1Inside],
    prevH4CoreFvgs: [
      {
        ...obCollabFvgH4Overlap,
        state: "CANDIDATE" as const,
      },
    ],
    nextH4CoreFvgs: [obCollabFvgH4Overlap],
    prevSetupFvgs: [],
    nextSetupFvgs: [obCollabFvgSetupHigh],
    prevStackZones: [],
    nextStackZones: [obCollabFvgStackExcluded],
    currentCloseTime: Date.UTC(2026, 3, 27, 8, 0, 0),
    tickSize: 1,
  }),
  [
    "[NEW][D1][POI_FVG][BULL] zone=108~118",
    "[CONFIRM][4H][FVG][A] tags=F1+F2 zone=107~117",
    "[NEW][H1][SETUP_FVG] inside=4H:PARENT-1 zone=102~104",
    "[STACK][D1\u22294H] zone=102~106",
  ],
  "fvg lifecycle diff emits new confirm setup and stack in deterministic order"
);

assert.deepEqual(
  buildFvgLifecycleEvents({
    prevD1Pois: [obCollabFvgD1Inside],
    nextD1Pois: [
      {
        ...obCollabFvgD1Inside,
        state: "INACTIVE" as const,
        invalidReason: "full_fill" as const,
        endTime: Date.UTC(2026, 3, 27, 8, 0, 0),
      },
    ],
    prevH4CoreFvgs: [
      {
        ...obCollabFvgH4Overlap,
        id: "H4-CAND-DELETE",
        state: "CANDIDATE" as const,
      },
      obCollabFvgH4Overlap,
    ],
    nextH4CoreFvgs: [
      {
        ...obCollabFvgH4Overlap,
        id: "H4-CAND-DELETE",
        state: "DELETED" as const,
        invalidReason: "failed_confirm" as const,
        endTime: Date.UTC(2026, 3, 27, 8, 0, 0),
      },
      {
        ...obCollabFvgH4Overlap,
        state: "INACTIVE" as const,
        invalidReason: "touch_3" as const,
        endTime: Date.UTC(2026, 3, 27, 8, 0, 0),
      },
    ],
    prevSetupFvgs: [obCollabFvgSetupHigh],
    nextSetupFvgs: [
      {
        ...obCollabFvgSetupHigh,
        state: "INACTIVE" as const,
        invalidReason: "opposite_choch" as const,
        endTime: Date.UTC(2026, 3, 27, 8, 0, 0),
      },
    ],
    prevStackZones: [obCollabFvgStackExcluded],
    nextStackZones: [],
    currentCloseTime: Date.UTC(2026, 3, 27, 8, 0, 0),
    tickSize: 1,
  }),
  [
    "[INVALID][4H][FVG-COL-H4-OVERLAP] reason=touch_3 endTime=2026-04-27T08:00:00Z",
    "[DELETE][4H][FVG][CANDIDATE] reason=failed_confirm endTime=2026-04-27T08:00:00Z zone=107~117",
    "[INVALID][H1][FVG-COL-SETUP-HIGH] reason=opposite_choch endTime=2026-04-27T08:00:00Z",
    "[INVALID][D1][FVG-COL-D1-INSIDE] reason=full_fill endTime=2026-04-27T08:00:00Z",
    "[STACK_END][D1\u22294H] reason=source_inactive endTime=2026-04-27T08:00:00Z zone=102~106",
  ],
  "fvg lifecycle diff emits invalid and stack-end events in deterministic order"
);

const obCollabFvgDirMismatch = {
  ...obCollabFvgH4Overlap,
  id: "FVG-COL-BEAR",
  dir: "BEAR" as const,
};

const obCollabFvgOtherSymbol = {
  ...obCollabFvgH4Overlap,
  id: "FVG-COL-ETH",
  symbol: "ETHUSDT",
};

const trendlineFlatSupportH1 = {
  ...trendlineFlatResistH1,
  id: "TL-H1-SUP",
  type: "TL_SUPPORT" as const,
  tags: [],
  bestMatch: { kind: "NONE" as const },
  roleFlipCount: 0,
  roleFlipWatch: undefined,
  state: "ACTIVE" as const,
};

const trendlineLtfSupportLine = {
  ...trendlineFlatSupportH1,
  id: "TL-LTF-SUP",
};

const trendlineLtfResistLine = {
  ...trendlineFlatResistH1,
  id: "TL-LTF-RES",
};

const trendlineLtfSweepRecSupportBars = buildLtfBars("M15", 3, {
  1: { open: 101, high: 103, low: 99, close: 99 },
  2: { open: 99, high: 103, low: 100, close: 101 },
});

const trendlineLtfSweepRecResistBars = buildLtfBars("M5", 3, {
  1: { open: 99, high: 101, low: 97, close: 101 },
  2: { open: 101, high: 102, low: 98, close: 99 },
});

const trendlineLtfSweepRecCarryBars = buildLtfBars("M15", 4, {
  1: { open: 101, high: 103, low: 99, close: 99 },
  2: { open: 99, high: 103, low: 100, close: 101 },
  3: { open: 101, high: 103, low: 100, close: 101 },
});

const trendlineLtfAggregateBars = buildLtfBars("M15", 20, {
  14: { high: 101 },
  15: { high: 102, close: 97 },
  16: { high: 101 },
  17: { high: 100 },
  18: { open: 101, high: 103, low: 99, close: 99 },
  19: { open: 99, high: 104, low: 100, close: 103 },
});

const trendlineCollabD1ObOk = {
  ...obSampleD1,
  id: "TL-COL-OB-D1-OK",
  symbol: "BTCUSDT",
  dir: "BULL" as const,
  state: "ACTIVE" as const,
  triggerTime: 1000,
  createdAt: 1000,
  zone: {
    bottom: 103,
    top: 104,
    height: 1,
  },
};

const trendlineCollabH4ObWrongLayer = {
  ...obSampleH4,
  id: "TL-COL-OB-H4",
  symbol: "BTCUSDT",
  dir: "BULL" as const,
  state: "POI_ACTIVE" as const,
  zone: {
    bottom: 100.5,
    top: 101.5,
    height: 1,
  },
};

const trendlineCollabD1FvgTight = {
  ...obCollabFvgD1Inside,
  id: "TL-COL-FVG-D1-TIGHT",
  symbol: "BTCUSDT",
  dir: "BULL" as const,
  state: "ACTIVE" as const,
  confTime: 2000,
  createdAt: 2000,
  zone: {
    bottom: 100.5,
    top: 101.5,
    height: 1,
  },
};

const trendlineCollabD1FvgOtherSymbol = {
  ...trendlineCollabD1FvgTight,
  id: "TL-COL-FVG-ETH",
  symbol: "ETHUSDT",
};

const trendlineCollabD1FvgDirMismatch = {
  ...trendlineCollabD1FvgTight,
  id: "TL-COL-FVG-BEAR",
  dir: "BEAR" as const,
};

const trendlineCollabD1ChannelTight = createD1H4OperationalChannel({
  symbol: "BTCUSDT",
  tf: "D1",
  dir: "UP",
  a: channelFlatAnchorA,
  b: channelFlatAnchorB,
  offset: 10,
  createdAt: 3000,
})!;

const trendlineCollabH1ChannelTight = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelFlatAnchorA,
  b: channelFlatAnchorB,
  offset: 5,
  createdAt: 4000,
  activeParentPoiCount: 1,
})!;

const trendlineCollabH1ChannelDown = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "DOWN",
  a: channelFlatAnchorA,
  b: channelFlatAnchorB,
  offset: 5,
  createdAt: 4500,
  activeParentPoiCount: 1,
})!;

const trendlineCollabH1ChannelOtherSymbol = createH1M30OperationalChannel({
  symbol: "ETHUSDT",
  tf: "H1",
  dir: "UP",
  a: channelFlatAnchorA,
  b: channelFlatAnchorB,
  offset: 5,
  createdAt: 4600,
  activeParentPoiCount: 1,
})!;

const trendlineCollabH1FvgTieOld = {
  ...obCollabFvgSetupHigh,
  id: "TL-COL-H1-FVG-OLD",
  symbol: "BTCUSDT",
  tf: "H1" as const,
  dir: "BULL" as const,
  state: "ACTIVE" as const,
  confTime: 1000,
  createdAt: 1000,
  zone: {
    bottom: 100.8,
    top: 101.8,
    height: 1,
  },
};

const trendlineCollabH1FvgTieNew = {
  ...trendlineCollabH1FvgTieOld,
  id: "TL-COL-H1-FVG-NEW",
  confTime: 2000,
  createdAt: 2000,
};

const trendlineCollabH1FvgTieIdA = {
  ...trendlineCollabH1FvgTieOld,
  id: "TL-COL-H1-FVG-A",
  confTime: 3000,
  createdAt: 3000,
};

const trendlineCollabH1FvgTieIdB = {
  ...trendlineCollabH1FvgTieOld,
  id: "TL-COL-H1-FVG-B",
  confTime: 3000,
  createdAt: 3000,
};

const trendlineEventTime = Date.UTC(2026, 5, 22, 12, 34, 56);

const trendlineEventNewLine = trendlineFlatSupportH4;

const trendlineEventTouchedLine = {
  ...trendlineFlatSupportH4,
  touchCount: 1,
  lastTouchTime: trendlineEventTime,
};

const trendlineEventRoleFlipLine = {
  ...trendlineFlatSupportH4,
  type: "TL_RESIST" as const,
  roleFlipCount: 1,
  tags: ["TL_ROLE_FLIP"],
};

const trendlineEventInvalidLine = {
  ...trendlineFlatSupportH4,
  state: "INACTIVE" as const,
  invalidReason: "break_confirmed" as const,
  endTime: trendlineEventTime,
};

const trendlinePoiCandidateInput = {
  tf: "H1" as const,
  id: "TL-H4-SUP",
  time: trendlineEventTime,
  reason: "roleFlip" as const,
  touchCount: 3,
};

const obLtfBullPoi = {
  ...obSampleD1,
  id: "OB-LTF-D1-1",
  state: "ACTIVE" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 100,
    top: 110,
    height: 10,
  },
};

const obLtfBearPoi = {
  ...obSampleD1,
  id: "OB-LTF-D1-BEAR",
  state: "ACTIVE" as const,
  dir: "BEAR" as const,
  zone: {
    bottom: 90,
    top: 110,
    height: 20,
  },
};

const obLtfH4CandidatePoi = {
  ...obSampleH4,
  id: "OB-LTF-H4-CAND",
  state: "CANDIDATE" as const,
};

const obLtfSetupPoi = {
  ...obSampleSetup,
  id: "OB-LTF-SETUP-1",
  state: "ACTIVE" as const,
};

const obLtfAggregatePoi = {
  ...obLtfBullPoi,
  id: "OB-LTF-AGG",
  zone: {
    bottom: 50,
    top: 60,
    height: 10,
  },
};

const obLtfCurrentBarBull: Bar = {
  tf: "M15",
  openTime: Date.UTC(2026, 3, 24, 0, 0, 0),
  closeTime: Date.UTC(2026, 3, 24, 0, 14, 59),
  open: 103,
  high: 108,
  low: 98,
  close: 103,
  volume: 0,
};

const obLtfCurrentBarBear: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 3, 24, 0, 15, 0),
  closeTime: Date.UTC(2026, 3, 24, 0, 19, 59),
  open: 107,
  high: 113,
  low: 103,
  close: 107,
  volume: 0,
};

const obLtfM15Bars: Bar[] = Array.from({ length: 15 }, (_, i) => ({
  tf: "M15" as const,
  openTime: Date.UTC(2026, 3, 24, 0, i * 15, 0),
  closeTime: Date.UTC(2026, 3, 24, 0, i * 15 + 14, 59),
  open: 103,
  high: 108,
  low: 98,
  close: 103,
  volume: 0,
}));

const obLtfNoTargetBars: Bar[] = Array.from({ length: 15 }, (_, i) => {
  const openTime = Date.UTC(2026, 3, 25, 0, i * 15, 0);
  const closeTime = Date.UTC(2026, 3, 25, 0, i * 15 + 14, 59);

  return {
    tf: "M15" as const,
    openTime,
    closeTime,
    open: 90 + i,
    high: 91 + i,
    low: 90 + i,
    close: 90.5 + i,
    volume: 0,
  };
});

const obLtfBearFallbackBars = buildLtfBars("M5", 20, {
  9: { high: 100 },
  10: { high: 101 },
  11: { high: 104, close: 99 },
  12: { high: 101 },
  13: { high: 100 },
  14: { high: 99 },
  15: { high: 98 },
  16: { high: 97 },
  17: { high: 96 },
  18: { high: 95 },
  19: { high: 94 },
});

assert.equal(
  ObConstants.LTF_MICRO_PIVOT_LEN,
  2,
  "ob ltf micro pivot len constant"
);

assert.equal(
  isObLtfReactionTf("M15"),
  true,
  "ob ltf reaction tf includes m15"
);

assert.equal(
  isObLtfReactionTf("H1"),
  false,
  "ob ltf reaction tf excludes h1"
);

assert.equal(
  isEligibleObLtfPoi(obLtfBullPoi),
  true,
  "ob ltf accepts active d1 poi"
);

assert.equal(
  isEligibleObLtfPoi(obLtfSetupPoi),
  true,
  "ob ltf accepts active setup poi"
);

assert.equal(
  isEligibleObLtfPoi(obLtfH4CandidatePoi),
  false,
  "ob ltf rejects non-poi-active h4 poi"
);

assert.equal(
  getObLtfGateBoundary(obLtfBullPoi),
  100,
  "ob ltf bull boundary uses bottom"
);

assert.equal(
  getObLtfGateBoundary(obLtfBearPoi),
  110,
  "ob ltf bear boundary uses top"
);

assert.deepEqual(
  {
    bull: getObLtfGatePriceExtreme(obLtfCurrentBarBull, "BULL"),
    bear: getObLtfGatePriceExtreme(obLtfCurrentBarBear, "BEAR"),
  },
  {
    bull: 98,
    bear: 113,
  },
  "ob ltf price extreme uses wick low high"
);

assert.equal(
  computeObLtfGateDist(98, 100),
  2,
  "ob ltf gate distance formula"
);

assert.deepEqual(
  evaluateObLtfGateOnBar({
    bar: obLtfCurrentBarBull,
    poi: obLtfBullPoi,
    atrAtLtf: 10,
  }),
  {
    poiId: "OB-LTF-D1-1",
    poiType: "D1_POI_OB",
    tf: "M15",
    dir: "BULL",
    barCloseTime: obLtfCurrentBarBull.closeTime,
    boundary: 100,
    priceExtreme: 98,
    dist: 2,
    atrAtLtf: 10,
    passGate: true,
  },
  "ob ltf gate passes when distance equals threshold"
);

assert.deepEqual(
  evaluateObLtfGateOnBar({
    bar: obLtfCurrentBarBear,
    poi: obLtfBearPoi,
    atrAtLtf: 10,
  }),
  {
    poiId: "OB-LTF-D1-BEAR",
    poiType: "D1_POI_OB",
    tf: "M5",
    dir: "BEAR",
    barCloseTime: obLtfCurrentBarBear.closeTime,
    boundary: 110,
    priceExtreme: 113,
    dist: 3,
    atrAtLtf: 10,
    passGate: false,
  },
  "ob ltf gate fails when distance exceeds threshold"
);

assert.equal(
  evaluateObLtfGateFromTfBars(
    obLtfM15Bars.slice(0, 13),
    obLtfBullPoi
  ),
  null,
  "ob ltf gate wrapper requires atr at current close"
);

assert.deepEqual(
  evaluateObLtfGateFromTfBars(
    obLtfM15Bars,
    obLtfBullPoi
  ),
  {
    poiId: "OB-LTF-D1-1",
    poiType: "D1_POI_OB",
    tf: "M15",
    dir: "BULL",
    barCloseTime: obLtfM15Bars[14].closeTime,
    boundary: 100,
    priceExtreme: 98,
    dist: 2,
    atrAtLtf: 10,
    passGate: true,
  },
  "ob ltf gate wrapper uses current close atr"
);

assert.equal(
  evaluateObLtfChochTrigger(ltfBullChochBars, "BULL"),
  true,
  "ob ltf choch bull uses close break of last confirmed micro pivot high"
);

assert.equal(
  evaluateObLtfChochTrigger(ltfBearChochBars, "BEAR"),
  true,
  "ob ltf choch bear uses close break of last confirmed micro pivot low"
);

assert.deepEqual(
  resolveObLtfSweepRecoveryTarget({
    tfBars: ltfBullSweepEqBars,
    dir: "BULL",
    currentCloseTime: ltfBullSweepEqBars[19].closeTime,
    atrAtEval: 10,
  }),
  {
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
  },
  "ob ltf sweep target prefers eql outer line"
);

assert.deepEqual(
  resolveObLtfSweepRecoveryTarget({
    tfBars: obLtfBearFallbackBars,
    dir: "BEAR",
    currentCloseTime: obLtfBearFallbackBars[19].closeTime,
    atrAtEval: 10,
  }),
  {
    targetType: "SWING_HIGH",
    linePrice: 104,
    usedEqPair: false,
  },
  "ob ltf sweep target falls back to last confirmed swing high"
);

assert.deepEqual(
  evaluateObLtfSweepRecTrigger(ltfBullSweepEqBars, "BULL"),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    sweepBarTime: ltfBullSweepEqBars[18].closeTime,
    recoveryBarTime: ltfBullSweepEqBars[19].closeTime,
    passSweepRecovery: true,
  },
  "ob ltf sweep rec passes on recent completion"
);

assert.deepEqual(
  evaluateObLtfSweepRecTrigger(obLtfNoTargetBars, "BULL"),
  {
    hasTarget: false,
    targetType: null,
    linePrice: null,
    usedEqPair: false,
    passSweepRecovery: false,
  },
  "ob ltf sweep rec fails without target"
);

assert.equal(
  evaluateObMicroRetestMicroObTrigger(ltfBullMicroObBars, "BULL"),
  "MR_MICRO_OB",
  "ob ltf micro retest micro ob passes"
);

assert.equal(
  evaluateObMicroRetestMicroFvgTrigger(ltfBullMicroFvgBars, "BULL"),
  "MR_MICRO_FVG",
  "ob ltf micro retest micro fvg passes"
);

assert.deepEqual(
  sortUniqueObLtfTriggerTokens([
    "SWEEP_REC",
    "CHOCH",
    "SWEEP_REC",
    "MR_MICRO_OB",
  ]),
  ["CHOCH", "MR_MICRO_OB", "SWEEP_REC"],
  "ob ltf trigger tokens are unique and lexicographic"
);

assert.deepEqual(
  evaluateObLtfTriggers(ltfBullSweepEqBars, obLtfAggregatePoi),
  {
    tf: "M15",
    dir: "BULL",
    barCloseTime: ltfBullSweepEqBars[19].closeTime,
    choch: true,
    sweepRec: true,
    microRetestTypes: [],
    tokens: ["CHOCH", "SWEEP_REC"],
  },
  "ob ltf trigger aggregate output is sorted and deterministic"
);

const obOutsideWindowBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 14, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 14, 0, 59, 59),
    open: 110,
    high: 112,
    low: 104,
    close: 108, // bearish but outside k-6 for trigger at idx 7
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 14, 1, 0, 0),
    closeTime: Date.UTC(2026, 3, 14, 1, 59, 59),
    open: 108,
    high: 110,
    low: 107,
    close: 109,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 14, 2, 0, 0),
    closeTime: Date.UTC(2026, 3, 14, 2, 59, 59),
    open: 109,
    high: 111,
    low: 108,
    close: 110,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 14, 3, 0, 0),
    closeTime: Date.UTC(2026, 3, 14, 3, 59, 59),
    open: 110,
    high: 112,
    low: 109,
    close: 111,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 14, 4, 0, 0),
    closeTime: Date.UTC(2026, 3, 14, 4, 59, 59),
    open: 111,
    high: 113,
    low: 110,
    close: 112,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 14, 5, 0, 0),
    closeTime: Date.UTC(2026, 3, 14, 5, 59, 59),
    open: 112,
    high: 114,
    low: 111,
    close: 113,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 14, 6, 0, 0),
    closeTime: Date.UTC(2026, 3, 14, 6, 59, 59),
    open: 113,
    high: 115,
    low: 112,
    close: 114,
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 14, 7, 0, 0),
    closeTime: Date.UTC(2026, 3, 14, 7, 59, 59),
    open: 114,
    high: 116,
    low: 113,
    close: 115, // trigger k
    volume: 0,
  },
];

const obDojiOnlyBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 29, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 29, 0, 59, 59),
    open: 110,
    high: 112,
    low: 104,
    close: 108, // bearish but outside search window
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 29, 1, 0, 0),
    closeTime: Date.UTC(2026, 3, 29, 1, 59, 59),
    open: 109,
    high: 111,
    low: 108,
    close: 109, // doji
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 29, 2, 0, 0),
    closeTime: Date.UTC(2026, 3, 29, 2, 59, 59),
    open: 109,
    high: 110,
    low: 108,
    close: 109, // doji
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 29, 3, 0, 0),
    closeTime: Date.UTC(2026, 3, 29, 3, 59, 59),
    open: 109,
    high: 110,
    low: 108,
    close: 109, // doji
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 29, 4, 0, 0),
    closeTime: Date.UTC(2026, 3, 29, 4, 59, 59),
    open: 109,
    high: 110,
    low: 108,
    close: 109, // doji
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 29, 5, 0, 0),
    closeTime: Date.UTC(2026, 3, 29, 5, 59, 59),
    open: 109,
    high: 110,
    low: 108,
    close: 109, // doji
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 29, 6, 0, 0),
    closeTime: Date.UTC(2026, 3, 29, 6, 59, 59),
    open: 109,
    high: 110,
    low: 108,
    close: 109, // doji
    volume: 0,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 3, 29, 7, 0, 0),
    closeTime: Date.UTC(2026, 3, 29, 7, 59, 59),
    open: 109,
    high: 113,
    low: 108,
    close: 112, // trigger k
    volume: 0,
  },
];

const obD1CandidateZone = {
  triggerIndex: 7,
  obCandleIndex: 5,
  triggerTime: Date.UTC(2026, 3, 21, 23, 59, 59),
  obCandleTime: Date.UTC(2026, 3, 19, 23, 59, 59),
  dir: "BULL" as const,
  zone: {
    bottom: 100,
    top: 104,
    height: 4,
  },
};

const obD1HeightPass = {
  tf: "D1" as const,
  zoneHeight: 4,
  atrAtTrigger: 10,
  minAllowed: 1,
  maxAllowed: 20,
  passMin: true,
  passMax: true,
  passHeightFilter: true,
};

const obD1HeightFail = {
  ...obD1HeightPass,
  passHeightFilter: false,
  passMax: false,
};

const obD1DispPass = {
  triggerIndex: 7,
  triggerTime: obD1CandidateZone.triggerTime,
  atrAtTrigger: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const obD1DispFail = {
  ...obD1DispPass,
  passByMax: false,
  passDisplacement: false,
};

const obD1ContextPass = {
  source: "CHANNEL" as const,
  distance: 2,
  atrAtTrigger: 10,
  passContextDist: true,
  passContextTight: false,
};

const obD1ContextFail = {
  ...obD1ContextPass,
  passContextDist: false,
};

const obD1SweepPass = {
  hasTarget: true,
  targetType: "EQL" as const,
  linePrice: 90,
  usedEqPair: true,
  sweepBarTime: obD1CandidateZone.obCandleTime,
  recoveryBarTime: obD1CandidateZone.triggerTime,
  passSweepRecovery: true,
};

const obD1SweepFail = {
  hasTarget: true,
  targetType: "EQL" as const,
  linePrice: 90,
  usedEqPair: true,
  passSweepRecovery: false,
};

const obH4CandidateZone = {
  triggerIndex: 7,
  obCandleIndex: 5,
  triggerTime: Date.UTC(2026, 3, 22, 11, 59, 59),
  obCandleTime: Date.UTC(2026, 3, 22, 3, 59, 59),
  dir: "BULL" as const,
  zone: {
    bottom: 100,
    top: 103,
    height: 3,
  },
};

const obH4HeightPass = {
  tf: "H4" as const,
  zoneHeight: 3,
  atrAtTrigger: 10,
  minAllowed: 1,
  maxAllowed: 15,
  passMin: true,
  passMax: true,
  passHeightFilter: true,
};

const obH4HeightFail = {
  ...obH4HeightPass,
  passHeightFilter: false,
  passMax: false,
};

const obH4DispPass = {
  triggerIndex: 7,
  triggerTime: obH4CandidateZone.triggerTime,
  atrAtTrigger: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const obH4DispFail = {
  ...obH4DispPass,
  passByMax: false,
  passDisplacement: false,
};

const obH4ContextPass = {
  source: "CHANNEL" as const,
  distance: 2,
  atrAtTrigger: 10,
  passContextDist: true,
  passContextTight: false,
};

const obH4ContextFail = {
  ...obH4ContextPass,
  passContextDist: false,
};

const obH4SweepPass = {
  hasTarget: true,
  targetType: "EQL" as const,
  linePrice: 90,
  usedEqPair: true,
  sweepBarTime: obH4CandidateZone.obCandleTime,
  recoveryBarTime: obH4CandidateZone.triggerTime,
  passSweepRecovery: true,
};

const obH4SweepFail = {
  hasTarget: true,
  targetType: "EQL" as const,
  linePrice: 90,
  usedEqPair: true,
  passSweepRecovery: false,
};

const obSetupZoneCandidate = {
  triggerIndex: 7,
  obCandleIndex: 5,
  triggerTime: Date.UTC(2026, 3, 23, 11, 59, 59),
  obCandleTime: Date.UTC(2026, 3, 23, 7, 59, 59),
  dir: "BULL" as const,
  zone: {
    bottom: 104,
    top: 106,
    height: 2,
  },
};

const obSetupZoneCandidateBear = {
  ...obSetupZoneCandidate,
  dir: "BEAR" as const,
};

const obSetupZoneCandidateLowOverlap = {
  ...obSetupZoneCandidate,
  zone: {
    bottom: 105.7,
    top: 107.7,
    height: 2,
  },
};

const obSetupHeightPassH1 = {
  tf: "H1" as const,
  zoneHeight: 2,
  atrAtTrigger: 10,
  minAllowed: 1,
  maxAllowed: 10,
  passMin: true,
  passMax: true,
  passHeightFilter: true,
};

const obSetupHeightPassM30 = {
  ...obSetupHeightPassH1,
  tf: "M30" as const,
};

const obSetupDispPass = {
  triggerIndex: 7,
  triggerTime: obSetupZoneCandidate.triggerTime,
  atrAtTrigger: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const obSetupDispFail = {
  ...obSetupDispPass,
  passByMax: false,
  passDisplacement: false,
};

const obSetupSweepPass = {
  hasTarget: true,
  targetType: "EQL" as const,
  linePrice: 90,
  usedEqPair: true,
  sweepBarTime: obSetupZoneCandidate.obCandleTime,
  recoveryBarTime: obSetupZoneCandidate.triggerTime,
  passSweepRecovery: true,
};

const obSetupSweepFail = {
  hasTarget: true,
  targetType: "EQL" as const,
  linePrice: 90,
  usedEqPair: true,
  passSweepRecovery: false,
};

const obSetupContextFail = {
  source: "NONE" as const,
  distance: null,
  atrAtTrigger: 10,
  passContextDist: false,
  passContextTight: false,
};

const obSetupContextPass = {
  source: "CHANNEL" as const,
  distance: 2,
  atrAtTrigger: 10,
  passContextDist: true,
  passContextTight: false,
};

const obSetupD1ParentPriority = {
  ...obSampleD1,
  id: "OB-SETUP-D1-PRIORITY",
  state: "ACTIVE" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 103,
    top: 105,
    height: 2,
  },
  triggerTime: Date.UTC(2026, 3, 22, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 22, 23, 59, 59),
  confirmDueTime: Date.UTC(2026, 3, 23, 23, 59, 59),
};

const obSetupD1ParentTieOld = {
  ...obSampleD1,
  id: "OB-SETUP-D1-TIE-B",
  state: "ACTIVE" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 104,
    top: 106,
    height: 2,
  },
  triggerTime: Date.UTC(2026, 3, 22, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 22, 23, 59, 59),
  confirmDueTime: Date.UTC(2026, 3, 23, 23, 59, 59),
};

const obSetupD1ParentTieNew = {
  ...obSampleD1,
  id: "OB-SETUP-D1-TIE-C",
  state: "ACTIVE" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 104,
    top: 106,
    height: 2,
  },
  triggerTime: Date.UTC(2026, 3, 23, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 23, 23, 59, 59),
  confirmDueTime: Date.UTC(2026, 3, 24, 23, 59, 59),
};

const obSetupD1ParentTieIdA = {
  ...obSampleD1,
  id: "OB-SETUP-D1-TIE-A",
  state: "ACTIVE" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 104,
    top: 106,
    height: 2,
  },
  triggerTime: Date.UTC(2026, 3, 22, 23, 59, 59),
  createdAt: Date.UTC(2026, 3, 22, 23, 59, 59),
  confirmDueTime: Date.UTC(2026, 3, 23, 23, 59, 59),
};

const obSetupH4ParentPerfect = {
  ...obSampleH4,
  id: "OB-SETUP-H4-PERFECT",
  state: "POI_ACTIVE" as const,
  dir: "BULL" as const,
  zone: {
    bottom: 104,
    top: 106,
    height: 2,
  },
  triggerTime: Date.UTC(2026, 3, 23, 7, 59, 59),
  createdAt: Date.UTC(2026, 3, 23, 7, 59, 59),
  confirmDueTime: Date.UTC(2026, 3, 23, 11, 59, 59),
};

const obSetupH4CandidateParent = {
  ...obSetupH4ParentPerfect,
  state: "CANDIDATE" as const,
};

const obDispMaxPassBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 15, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 15, 3, 59, 59),
    open: 100,
    high: 106,
    low: 99,
    close: 104,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 15, 4, 0, 0),
    closeTime: Date.UTC(2026, 3, 15, 7, 59, 59),
    open: 104,
    high: 116,
    low: 103,
    close: 115,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 15, 8, 0, 0),
    closeTime: Date.UTC(2026, 3, 15, 11, 59, 59),
    open: 115,
    high: 118,
    low: 114,
    close: 117,
    volume: 0,
  },
];

const obDispSumPassBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 16, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 16, 3, 59, 59),
    open: 100,
    high: 109,
    low: 99,
    close: 108,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 16, 4, 0, 0),
    closeTime: Date.UTC(2026, 3, 16, 7, 59, 59),
    open: 108,
    high: 117,
    low: 107,
    close: 116,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 16, 8, 0, 0),
    closeTime: Date.UTC(2026, 3, 16, 11, 59, 59),
    open: 116,
    high: 125,
    low: 115,
    close: 123,
    volume: 0,
  },
];

const obDispStrictFailBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 17, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 17, 3, 59, 59),
    open: 100,
    high: 111,
    low: 99,
    close: 110,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 17, 4, 0, 0),
    closeTime: Date.UTC(2026, 3, 17, 7, 59, 59),
    open: 110,
    high: 115,
    low: 109,
    close: 114,
    volume: 0,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 3, 17, 8, 0, 0),
    closeTime: Date.UTC(2026, 3, 17, 11, 59, 59),
    open: 114,
    high: 115,
    low: 109,
    close: 110,
    volume: 0,
  },
];

const obEqLowPair = [
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 3, 18, 3, 59, 59),
    pivotPrice: 90.5,
    confirmedAt: Date.UTC(2026, 3, 18, 15, 59, 59),
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 3, 19, 3, 59, 59),
    pivotPrice: 90,
    confirmedAt: Date.UTC(2026, 3, 19, 15, 59, 59),
    isConfirmed: true,
  },
] as const;

const obEqHighPair = [
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: Date.UTC(2026, 3, 18, 3, 59, 59),
    pivotPrice: 109.5,
    confirmedAt: Date.UTC(2026, 3, 18, 15, 59, 59),
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: Date.UTC(2026, 3, 19, 3, 59, 59),
    pivotPrice: 110,
    confirmedAt: Date.UTC(2026, 3, 19, 15, 59, 59),
    isConfirmed: true,
  },
] as const;

const obFallbackLowPivot = {
  tf: "H4" as const,
  pivotType: "LOW" as const,
  pivotTime: Date.UTC(2026, 3, 19, 3, 59, 59),
  pivotPrice: 88,
  confirmedAt: Date.UTC(2026, 3, 19, 15, 59, 59),
  isConfirmed: true,
};

const obFallbackHighPivot = {
  tf: "H4" as const,
  pivotType: "HIGH" as const,
  pivotTime: Date.UTC(2026, 3, 19, 3, 59, 59),
  pivotPrice: 112,
  confirmedAt: Date.UTC(2026, 3, 19, 15, 59, 59),
  isConfirmed: true,
};

const obBullSweepBars = [
  ...buildH4SweepBars({
    15: { low: 91, high: 101 },
    16: { open: 97, high: 100, low: 89, close: 89 },
    17: { open: 89, high: 104, low: 94, close: 103 },
  }),
];

const obBullSweepTriggerOnlyBars = [
  ...buildH4SweepBars({
    17: { open: 97, high: 100, low: 89, close: 89 },
  }),
];

assertExactEventLog(
  [...ObConstants.OB_TFS],
  ["D1", "H4", "H1", "M30", "M15", "M5"],
  "ob tf set"
);

assert.deepEqual(
  {
    poi: [...ObConstants.OB_POI_TFS],
    setup: [...ObConstants.OB_SETUP_TFS],
    reaction: [...ObConstants.OB_REACTION_TFS],
    detect: [...ObConstants.OB_DETECT_TFS],
  },
  {
    poi: ["D1", "H4"],
    setup: ["H1", "M30"],
    reaction: ["M15", "M5"],
    detect: ["D1", "H4", "H1", "M30"],
  },
  "ob layer tf sets"
);

assertExactEventLog(
  [...ObConstants.OB_BOX_TYPES],
  ["D1_POI_OB", "H4_CORE_OB", "SETUP_OB", "OB_COLLAB_TAG"],
  "ob box types"
);

assert.deepEqual(
  {
    d1: [...ObConstants.OB_D1_STATES],
    h4: [...ObConstants.OB_H4_STATES],
    setup: [...ObConstants.OB_SETUP_STATES],
  },
  {
    d1: ["CANDIDATE", "ACTIVE", "INACTIVE", "DELETED"],
    h4: ["CANDIDATE", "POI_ACTIVE", "INACTIVE", "DELETED"],
    setup: ["ACTIVE", "INACTIVE"],
  },
  "ob states"
);

assertExactEventLog(
  [...ObConstants.OB_INVALID_REASONS],
  [
    "full_fill",
    "opposite_choch",
    "touch_3",
    "pruned_by_limit",
    "failed_confirm",
  ],
  "ob invalid reasons"
);

assert.deepEqual(
  {
    parentPoiTypes: [...ObConstants.OB_PARENT_POI_TYPES],
    sweepTargetTypes: [...ObConstants.OB_SWEEP_TARGET_TYPES],
    collabKinds: [...ObConstants.OB_COLLAB_KINDS],
  },
  {
    parentPoiTypes: ["D1_POI_OB", "H4_CORE_OB"],
    sweepTargetTypes: ["EQH", "EQL", "SWING_HIGH", "SWING_LOW"],
    collabKinds: ["OB\u2229FVG", "OB\u2229CONTEXT"],
  },
  "ob parent sweep collab enums"
);

assert.deepEqual(
  {
    MAX_FORWARD_BARS: ObConstants.MAX_FORWARD_BARS,
    MIN_OB_HEIGHT_ATR: ObConstants.MIN_OB_HEIGHT_ATR,
    MAX_OB_HEIGHT_ATR_D1: ObConstants.MAX_OB_HEIGHT_ATR_D1,
    MAX_OB_HEIGHT_ATR_H4: ObConstants.MAX_OB_HEIGHT_ATR_H4,
    MAX_OB_HEIGHT_ATR_SETUP: ObConstants.MAX_OB_HEIGHT_ATR_SETUP,
    DISP_BODY_MAX_ATR: ObConstants.DISP_BODY_MAX_ATR,
    DISP_BODY_SUM_ATR: ObConstants.DISP_BODY_SUM_ATR,
    DISP_RANGE_BARS: ObConstants.DISP_RANGE_BARS,
    SWEEP_WINDOW_BARS: ObConstants.SWEEP_WINDOW_BARS,
    EQ_BAND_ATR: ObConstants.EQ_BAND_ATR,
    CONTEXT_DIST_ATR: ObConstants.CONTEXT_DIST_ATR,
    CONTEXT_TIGHT_ATR: ObConstants.CONTEXT_TIGHT_ATR,
    PENETRATION_ATR: ObConstants.PENETRATION_ATR,
    PENETRATION_ZONE: ObConstants.PENETRATION_ZONE,
    MAX_TOUCH_VALID: ObConstants.MAX_TOUCH_VALID,
  },
  {
    MAX_FORWARD_BARS: 300,
    MIN_OB_HEIGHT_ATR: 0.1,
    MAX_OB_HEIGHT_ATR_D1: 2.0,
    MAX_OB_HEIGHT_ATR_H4: 1.5,
    MAX_OB_HEIGHT_ATR_SETUP: 1.0,
    DISP_BODY_MAX_ATR: 1.0,
    DISP_BODY_SUM_ATR: 1.8,
    DISP_RANGE_BARS: 3,
    SWEEP_WINDOW_BARS: 8,
    EQ_BAND_ATR: 0.1,
    CONTEXT_DIST_ATR: 0.25,
    CONTEXT_TIGHT_ATR: 0.1,
    PENETRATION_ATR: 0.1,
    PENETRATION_ZONE: 0.25,
    MAX_TOUCH_VALID: 2,
  },
  "ob numeric constants a"
);

assert.deepEqual(
  {
    INSIDE_OVERLAP_RATIO: ObConstants.INSIDE_OVERLAP_RATIO,
    LTF_GATE_ATR: ObConstants.LTF_GATE_ATR,
    COOLDOWN_AFTER_15M_REACTION_MIN:
      ObConstants.COOLDOWN_AFTER_15M_REACTION_MIN,
    COOLDOWN_AFTER_5M_ENTRY_MIN:
      ObConstants.COOLDOWN_AFTER_5M_ENTRY_MIN,
    MAX_ACTIVE_D1_POI_OB: ObConstants.MAX_ACTIVE_D1_POI_OB,
    MAX_ACTIVE_H4_OB_POOL: ObConstants.MAX_ACTIVE_H4_OB_POOL,
    MAX_ACTIVE_H1_SETUP_OB: ObConstants.MAX_ACTIVE_H1_SETUP_OB,
    MAX_ACTIVE_M30_SETUP_OB: ObConstants.MAX_ACTIVE_M30_SETUP_OB,
  },
  {
    INSIDE_OVERLAP_RATIO: 0.2,
    LTF_GATE_ATR: 0.2,
    COOLDOWN_AFTER_15M_REACTION_MIN: 30,
    COOLDOWN_AFTER_5M_ENTRY_MIN: 60,
    MAX_ACTIVE_D1_POI_OB: 3,
    MAX_ACTIVE_H4_OB_POOL: 10,
    MAX_ACTIVE_H1_SETUP_OB: 6,
    MAX_ACTIVE_M30_SETUP_OB: 6,
  },
  "ob numeric constants b"
);

assert.equal(
  isOppositeColorCandleForOb(obBullZoneBars[5], "BULL"),
  true,
  "ob bull opposite candle is bearish"
);

assert.equal(
  isOppositeColorCandleForOb(obBearZoneBars[4], "BEAR"),
  true,
  "ob bear opposite candle is bullish"
);

assert.deepEqual(
  buildObZoneFromCandle(obBullZoneBars[5], "BULL"),
  {
    bottom: 110,
    top: 114,
    height: 4,
  },
  "ob bull zone uses low to open"
);

assert.deepEqual(
  buildObZoneFromCandle(obBearZoneBars[4], "BEAR"),
  {
    bottom: 91,
    top: 96,
    height: 5,
  },
  "ob bear zone uses open to high"
);

assert.equal(
  findLastOppositeColorCandleIndex(obBullZoneBars, "BULL", 7),
  5,
  "ob finds last opposite candle within k-6 to k-1"
);

assert.deepEqual(
  detectObZoneCandidateFromTriggerIndex(obBullZoneBars, "BULL", 7),
  {
    triggerIndex: 7,
    obCandleIndex: 5,
    triggerTime: obBullZoneBars[7].closeTime,
    obCandleTime: obBullZoneBars[5].closeTime,
    dir: "BULL",
    zone: {
      bottom: 110,
      top: 114,
      height: 4,
    },
  },
  "ob bull candidate picks latest opposite candle and zone"
);

assert.deepEqual(
  detectObZoneCandidateFromTriggerIndex(obBearZoneBars, "BEAR", 6),
  {
    triggerIndex: 6,
    obCandleIndex: 4,
    triggerTime: obBearZoneBars[6].closeTime,
    obCandleTime: obBearZoneBars[4].closeTime,
    dir: "BEAR",
    zone: {
      bottom: 91,
      top: 96,
      height: 5,
    },
  },
  "ob bear candidate picks latest opposite candle and zone"
);

assert.equal(
  detectObZoneCandidateFromTriggerIndex(obOutsideWindowBars, "BULL", 7),
  null,
  "ob ignores opposite candle outside k-6 to k-1 window"
);

assert.equal(
  detectObZoneCandidateFromTriggerIndex(obNoOppositeBars, "BULL", 3),
  null,
  "ob returns null when no opposite candle exists"
);

assert.equal(
  isObHeightFilterTf("D1"),
  true,
  "ob height filter tf includes d1"
);

assert.equal(
  isObHeightFilterTf("M15"),
  false,
  "ob height filter tf excludes m15"
);

assert.deepEqual(
  {
    D1: getMaxObHeightAtrMultiplier("D1"),
    H4: getMaxObHeightAtrMultiplier("H4"),
    H1: getMaxObHeightAtrMultiplier("H1"),
    M30: getMaxObHeightAtrMultiplier("M30"),
  },
  {
    D1: 2,
    H4: 1.5,
    H1: 1,
    M30: 1,
  },
  "ob max height atr multipliers"
);

assert.deepEqual(
  evaluateObZoneHeightFilter({
    tf: "D1",
    zoneHeight: 1,
    atrAtTrigger: 10,
  }),
  {
    tf: "D1",
    zoneHeight: 1,
    atrAtTrigger: 10,
    minAllowed: 1,
    maxAllowed: 20,
    passMin: true,
    passMax: true,
    passHeightFilter: true,
  },
  "ob min height equality passes"
);

assert.deepEqual(
  evaluateObZoneHeightFilter({
    tf: "D1",
    zoneHeight: 0.99,
    atrAtTrigger: 10,
  }),
  {
    tf: "D1",
    zoneHeight: 0.99,
    atrAtTrigger: 10,
    minAllowed: 1,
    maxAllowed: 20,
    passMin: false,
    passMax: true,
    passHeightFilter: false,
  },
  "ob min height below threshold fails"
);

assert.deepEqual(
  evaluateObZoneHeightFilter({
    tf: "D1",
    zoneHeight: 20.01,
    atrAtTrigger: 10,
  }),
  {
    tf: "D1",
    zoneHeight: 20.01,
    atrAtTrigger: 10,
    minAllowed: 1,
    maxAllowed: 20,
    passMin: true,
    passMax: false,
    passHeightFilter: false,
  },
  "ob d1 max height above threshold fails"
);

assert.deepEqual(
  evaluateObZoneHeightFilter({
    tf: "H4",
    zoneHeight: 15.01,
    atrAtTrigger: 10,
  }),
  {
    tf: "H4",
    zoneHeight: 15.01,
    atrAtTrigger: 10,
    minAllowed: 1,
    maxAllowed: 15,
    passMin: true,
    passMax: false,
    passHeightFilter: false,
  },
  "ob h4 max height above threshold fails"
);

assert.deepEqual(
  evaluateObZoneHeightFilter({
    tf: "M30",
    zoneHeight: 10,
    atrAtTrigger: 10,
  }),
  {
    tf: "M30",
    zoneHeight: 10,
    atrAtTrigger: 10,
    minAllowed: 1,
    maxAllowed: 10,
    passMin: true,
    passMax: true,
    passHeightFilter: true,
  },
  "ob setup max height equality passes"
);

assert.equal(
  getObCandleBodySize({
    tf: "H4",
    openTime: Date.UTC(2026, 3, 20, 0, 0, 0),
    closeTime: Date.UTC(2026, 3, 20, 3, 59, 59),
    open: 120,
    high: 121,
    low: 109,
    close: 110,
    volume: 0,
  }),
  10,
  "ob displacement body is abs close-open"
);

assert.deepEqual(
  evaluateObDisplacementAtTrigger({
    tfBars: obDispMaxPassBars,
    triggerIndex: 2,
    atrAtTrigger: 10,
  }),
  {
    triggerIndex: 2,
    triggerTime: obDispMaxPassBars[2].closeTime,
    atrAtTrigger: 10,
    bodyMax: 11,
    bodySum: 17,
    passByMax: true,
    passBySum: false,
    passDisplacement: true,
  },
  "ob displacement passes by max body"
);

assert.deepEqual(
  evaluateObDisplacementAtTrigger({
    tfBars: obDispSumPassBars,
    triggerIndex: 2,
    atrAtTrigger: 10,
  }),
  {
    triggerIndex: 2,
    triggerTime: obDispSumPassBars[2].closeTime,
    atrAtTrigger: 10,
    bodyMax: 8,
    bodySum: 23,
    passByMax: false,
    passBySum: true,
    passDisplacement: true,
  },
  "ob displacement passes by body sum"
);

assert.deepEqual(
  evaluateObDisplacementAtTrigger({
    tfBars: obDispStrictFailBars,
    triggerIndex: 2,
    atrAtTrigger: 10,
  }),
  {
    triggerIndex: 2,
    triggerTime: obDispStrictFailBars[2].closeTime,
    atrAtTrigger: 10,
    bodyMax: 10,
    bodySum: 18,
    passByMax: false,
    passBySum: false,
    passDisplacement: false,
  },
  "ob displacement uses strict greater-than thresholds"
);

assert.deepEqual(
  resolveObSweepRecoveryTarget({
    dir: "BULL",
    atrAtTrigger: 10,
    eqPivotPair: obEqLowPair,
    lastConfirmedPivotLow: obFallbackLowPivot,
  }),
  {
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
  },
  "ob sweep target prefers eql outer line"
);

assert.deepEqual(
  resolveObSweepRecoveryTarget({
    dir: "BEAR",
    atrAtTrigger: 10,
    lastConfirmedPivotHigh: obFallbackHighPivot,
  }),
  {
    targetType: "SWING_HIGH",
    linePrice: 112,
    usedEqPair: false,
  },
  "ob sweep target falls back to last confirmed swing high"
);

assert.deepEqual(
  evaluateObSweepRecoveryAtTrigger({
    tfBars: obBullSweepBars,
    triggerIndex: 17,
    dir: "BULL",
    atrAtTrigger: 10,
    eqPivotPair: obEqLowPair,
    lastConfirmedPivotLow: obFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    sweepBarTime: obBullSweepBars[16].closeTime,
    recoveryBarTime: obBullSweepBars[17].closeTime,
    passSweepRecovery: true,
  },
  "ob sweep recovery passes with fully observed pair"
);

assert.deepEqual(
  evaluateObSweepRecoveryAtTrigger({
    tfBars: obBullSweepTriggerOnlyBars,
    triggerIndex: 17,
    dir: "BULL",
    atrAtTrigger: 10,
    eqPivotPair: obEqLowPair,
    lastConfirmedPivotLow: obFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    passSweepRecovery: false,
  },
  "ob sweep recovery does not pass when sweep exists only on trigger bar"
);

assert.deepEqual(
  evaluateObSweepRecoveryAtTrigger({
    tfBars: obBullSweepBars,
    triggerIndex: 17,
    dir: "BULL",
    atrAtTrigger: 10,
  }),
  {
    hasTarget: false,
    targetType: null,
    linePrice: null,
    usedEqPair: false,
    passSweepRecovery: false,
  },
  "ob sweep recovery returns false when no target exists"
);

assert.deepEqual(
  selectPreferredObContextDistance(2.5, 1.0),
  {
    source: "CHANNEL",
    distance: 2.5,
  },
  "ob context prefers channel over trendline"
);

assert.deepEqual(
  selectPreferredObContextDistance(null, 2.0),
  {
    source: "TRENDLINE",
    distance: 2.0,
  },
  "ob context uses trendline when channel is absent"
);

assert.deepEqual(
  evaluateObContextDistanceFilter({
    atrAtTrigger: 10,
    channelDistance: 2.0,
  }),
  {
    source: "CHANNEL",
    distance: 2.0,
    atrAtTrigger: 10,
    passContextDist: true,
    passContextTight: false,
  },
  "ob context distance passes within 0.25 atr but not tight"
);

assert.deepEqual(
  evaluateObContextDistanceFilter({
    atrAtTrigger: 10,
    trendlineDistance: 0.9,
  }),
  {
    source: "TRENDLINE",
    distance: 0.9,
    atrAtTrigger: 10,
    passContextDist: true,
    passContextTight: true,
  },
  "ob context tight distance passes within 0.10 atr"
);

assert.deepEqual(
  evaluateObContextDistanceFilter({
    atrAtTrigger: 10,
  }),
  {
    source: "NONE",
    distance: null,
    atrAtTrigger: 10,
    passContextDist: false,
    passContextTight: false,
  },
  "ob context distance fails without context source"
);

assert.equal(
  getD1PoiObConfirmDueTime(obD1CandidateZone.triggerTime),
  obD1CandidateZone.triggerTime + 24 * 60 * 60 * 1000,
  "ob d1 confirm due is next d1 close"
);

assert.equal(
  getD1PoiObDisplayUntil(obD1CandidateZone.triggerTime),
  obD1CandidateZone.triggerTime + 300 * 24 * 60 * 60 * 1000,
  "ob d1 display until uses max forward bars"
);

assert.deepEqual(
  createD1PoiObCandidate({
    id: "OB-D1-C-1",
    symbol: "btcusdt",
    zoneCandidate: obD1CandidateZone,
    heightFilterEval: obD1HeightPass,
    structureTriggered: true,
    displacementEval: obD1DispPass,
    contextEval: obD1ContextPass,
  }),
  {
    id: "OB-D1-C-1",
    symbol: "BTCUSDT",
    type: "D1_POI_OB",
    tf: "D1",
    dir: "BULL",
    zone: {
      bottom: 100,
      top: 104,
      height: 4,
    },
    triggerTime: obD1CandidateZone.triggerTime,
    createdAt: obD1CandidateZone.triggerTime,
    state: "CANDIDATE",
    maxForwardBars: 300,
    displayUntil: obD1CandidateZone.triggerTime + 300 * 24 * 60 * 60 * 1000,
    confirmDueTime: obD1CandidateZone.triggerTime + 24 * 60 * 60 * 1000,
    atrAtTrigger: 10,
    passHeightFilter: true,
    passDisplacement: true,
    passSweepRecovery: false,
    passContextDist: true,
    touchCount: 0,
    fullFillHit: false,
    tags: [],
  },
  "ob d1 candidate creates when b1 b2 b3 b5 pass"
);

assert.equal(
  createD1PoiObCandidate({
    id: "OB-D1-C-2",
    symbol: "BTCUSDT",
    zoneCandidate: null,
    heightFilterEval: obD1HeightPass,
    structureTriggered: true,
    displacementEval: obD1DispPass,
    contextEval: obD1ContextPass,
  }),
  null,
  "ob d1 candidate requires zone candidate"
);

assert.equal(
  createD1PoiObCandidate({
    id: "OB-D1-C-3",
    symbol: "BTCUSDT",
    zoneCandidate: obD1CandidateZone,
    heightFilterEval: obD1HeightFail,
    structureTriggered: true,
    displacementEval: obD1DispPass,
    contextEval: obD1ContextPass,
  }),
  null,
  "ob d1 candidate requires height filter pass"
);

assert.equal(
  createD1PoiObCandidate({
    id: "OB-D1-C-4",
    symbol: "BTCUSDT",
    zoneCandidate: obD1CandidateZone,
    heightFilterEval: obD1HeightPass,
    structureTriggered: false,
    displacementEval: obD1DispPass,
    contextEval: obD1ContextPass,
  }),
  null,
  "ob d1 candidate requires structure trigger"
);

assert.equal(
  createD1PoiObCandidate({
    id: "OB-D1-C-5",
    symbol: "BTCUSDT",
    zoneCandidate: obD1CandidateZone,
    heightFilterEval: obD1HeightPass,
    structureTriggered: true,
    displacementEval: obD1DispFail,
    contextEval: obD1ContextPass,
  }),
  null,
  "ob d1 candidate requires displacement pass"
);

assert.equal(
  createD1PoiObCandidate({
    id: "OB-D1-C-6",
    symbol: "BTCUSDT",
    zoneCandidate: obD1CandidateZone,
    heightFilterEval: obD1HeightPass,
    structureTriggered: true,
    displacementEval: obD1DispPass,
    contextEval: obD1ContextFail,
  }),
  null,
  "ob d1 candidate requires context distance pass"
);

const obD1CandidateForConfirm = createD1PoiObCandidate({
  id: "OB-D1-C-7",
  symbol: "BTCUSDT",
  zoneCandidate: obD1CandidateZone,
  heightFilterEval: obD1HeightPass,
  structureTriggered: true,
  displacementEval: obD1DispPass,
  contextEval: obD1ContextPass,
})!;
const obD1CandidateConfirmDueTime = obD1CandidateForConfirm.confirmDueTime!;

assert.deepEqual(
  applyD1PoiObCandidateConfirm({
    candidate: obD1CandidateForConfirm,
    currentCloseTime: obD1CandidateConfirmDueTime - 24 * 60 * 60 * 1000,
    sweepRecoveryEval: obD1SweepPass,
  }),
  obD1CandidateForConfirm,
  "ob d1 confirm does nothing before due time"
);

assert.deepEqual(
  applyD1PoiObCandidateConfirm({
    candidate: obD1CandidateForConfirm,
    currentCloseTime: obD1CandidateConfirmDueTime,
    sweepRecoveryEval: obD1SweepPass,
  }),
  {
    ...obD1CandidateForConfirm,
    state: "ACTIVE",
    passSweepRecovery: true,
  },
  "ob d1 confirm promotes to active on next d1 close when sweep recovery passes"
);

assert.deepEqual(
  applyD1PoiObCandidateConfirm({
    candidate: obD1CandidateForConfirm,
    currentCloseTime: obD1CandidateConfirmDueTime,
    sweepRecoveryEval: obD1SweepFail,
  }),
  {
    ...obD1CandidateForConfirm,
    state: "DELETED",
    passSweepRecovery: false,
    invalidReason: "failed_confirm",
    endTime: obD1CandidateConfirmDueTime,
  },
  "ob d1 confirm deletes on next d1 close when sweep recovery fails"
);

assert.equal(
  getH4CoreObConfirmDueTime(obH4CandidateZone.triggerTime),
  obH4CandidateZone.triggerTime + 4 * 60 * 60 * 1000,
  "ob h4 confirm due is next h4 close"
);

assert.equal(
  getH4CoreObDisplayUntil(obH4CandidateZone.triggerTime),
  obH4CandidateZone.triggerTime + 300 * 4 * 60 * 60 * 1000,
  "ob h4 display until uses max forward bars"
);

assert.deepEqual(
  createH4CoreObCandidate({
    id: "OB-H4-C-1",
    symbol: "btcusdt",
    zoneCandidate: obH4CandidateZone,
    heightFilterEval: obH4HeightPass,
    structureTriggered: true,
    displacementEval: obH4DispPass,
    contextEval: obH4ContextPass,
  }),
  {
    id: "OB-H4-C-1",
    symbol: "BTCUSDT",
    type: "H4_CORE_OB",
    tf: "H4",
    dir: "BULL",
    zone: {
      bottom: 100,
      top: 103,
      height: 3,
    },
    triggerTime: obH4CandidateZone.triggerTime,
    createdAt: obH4CandidateZone.triggerTime,
    state: "CANDIDATE",
    maxForwardBars: 300,
    displayUntil: obH4CandidateZone.triggerTime + 300 * 4 * 60 * 60 * 1000,
    confirmDueTime: obH4CandidateZone.triggerTime + 4 * 60 * 60 * 1000,
    atrAtTrigger: 10,
    passHeightFilter: true,
    passDisplacement: true,
    passSweepRecovery: false,
    passContextDist: true,
    touchCount: 0,
    fullFillHit: false,
    tags: [],
  },
  "ob h4 candidate creates when b1 b2 b3 b5 pass"
);

assert.equal(
  createH4CoreObCandidate({
    id: "OB-H4-C-2",
    symbol: "BTCUSDT",
    zoneCandidate: null,
    heightFilterEval: obH4HeightPass,
    structureTriggered: true,
    displacementEval: obH4DispPass,
    contextEval: obH4ContextPass,
  }),
  null,
  "ob h4 candidate requires zone candidate"
);

assert.equal(
  createH4CoreObCandidate({
    id: "OB-H4-C-3",
    symbol: "BTCUSDT",
    zoneCandidate: obH4CandidateZone,
    heightFilterEval: obH4HeightFail,
    structureTriggered: true,
    displacementEval: obH4DispPass,
    contextEval: obH4ContextPass,
  }),
  null,
  "ob h4 candidate requires height filter pass"
);

assert.equal(
  createH4CoreObCandidate({
    id: "OB-H4-C-4",
    symbol: "BTCUSDT",
    zoneCandidate: obH4CandidateZone,
    heightFilterEval: obH4HeightPass,
    structureTriggered: false,
    displacementEval: obH4DispPass,
    contextEval: obH4ContextPass,
  }),
  null,
  "ob h4 candidate requires structure trigger"
);

assert.equal(
  createH4CoreObCandidate({
    id: "OB-H4-C-5",
    symbol: "BTCUSDT",
    zoneCandidate: obH4CandidateZone,
    heightFilterEval: obH4HeightPass,
    structureTriggered: true,
    displacementEval: obH4DispFail,
    contextEval: obH4ContextPass,
  }),
  null,
  "ob h4 candidate requires displacement pass"
);

assert.equal(
  createH4CoreObCandidate({
    id: "OB-H4-C-6",
    symbol: "BTCUSDT",
    zoneCandidate: obH4CandidateZone,
    heightFilterEval: obH4HeightPass,
    structureTriggered: true,
    displacementEval: obH4DispPass,
    contextEval: obH4ContextFail,
  }),
  null,
  "ob h4 candidate requires context distance pass"
);

const obH4CandidateForConfirm = createH4CoreObCandidate({
  id: "OB-H4-C-7",
  symbol: "BTCUSDT",
  zoneCandidate: obH4CandidateZone,
  heightFilterEval: obH4HeightPass,
  structureTriggered: true,
  displacementEval: obH4DispPass,
  contextEval: obH4ContextPass,
})!;
const obH4CandidateConfirmDueTime = obH4CandidateForConfirm.confirmDueTime!;

assert.deepEqual(
  applyH4CoreObCandidateConfirm({
    candidate: obH4CandidateForConfirm,
    currentCloseTime: obH4CandidateConfirmDueTime - 4 * 60 * 60 * 1000,
    sweepRecoveryEval: obH4SweepPass,
  }),
  obH4CandidateForConfirm,
  "ob h4 confirm does nothing before due time"
);

assert.deepEqual(
  applyH4CoreObCandidateConfirm({
    candidate: obH4CandidateForConfirm,
    currentCloseTime: obH4CandidateConfirmDueTime,
    sweepRecoveryEval: obH4SweepPass,
  }),
  {
    ...obH4CandidateForConfirm,
    state: "POI_ACTIVE",
    passSweepRecovery: true,
  },
  "ob h4 confirm promotes to poi_active on next h4 close when sweep recovery passes"
);

assert.deepEqual(
  applyH4CoreObCandidateConfirm({
    candidate: obH4CandidateForConfirm,
    currentCloseTime: obH4CandidateConfirmDueTime,
    sweepRecoveryEval: obH4SweepFail,
  }),
  {
    ...obH4CandidateForConfirm,
    state: "DELETED",
    passSweepRecovery: false,
    invalidReason: "failed_confirm",
    endTime: obH4CandidateConfirmDueTime,
  },
  "ob h4 confirm deletes on next h4 close when sweep recovery fails"
);

assert.deepEqual(
  evaluateD1PoiObCandidateConfirm({
    candidate: obD1CandidateForConfirm,
    currentCloseTime: obD1CandidateConfirmDueTime + 24 * 60 * 60 * 1000,
    sweepRecoveryEval: obD1SweepPass,
  }),
  {
    isDueTime: false,
    passSweepRecovery: true,
    passConfirm: false,
  },
  "ob d1 confirm timing does not pass after due bar"
);

assert.deepEqual(
  applyD1PoiObCandidateConfirm({
    candidate: obD1CandidateForConfirm,
    currentCloseTime: obD1CandidateConfirmDueTime + 24 * 60 * 60 * 1000,
    sweepRecoveryEval: obD1SweepPass,
  }),
  obD1CandidateForConfirm,
  "ob d1 confirm timing does not late-promote after due bar"
);

assert.deepEqual(
  evaluateH4CoreObCandidateConfirm({
    candidate: obH4CandidateForConfirm,
    currentCloseTime: obH4CandidateConfirmDueTime + 4 * 60 * 60 * 1000,
    sweepRecoveryEval: obH4SweepPass,
  }),
  {
    isDueTime: false,
    passSweepRecovery: true,
    passConfirm: false,
  },
  "ob h4 confirm timing does not pass after due bar"
);

assert.deepEqual(
  applyH4CoreObCandidateConfirm({
    candidate: obH4CandidateForConfirm,
    currentCloseTime: obH4CandidateConfirmDueTime + 4 * 60 * 60 * 1000,
    sweepRecoveryEval: obH4SweepPass,
  }),
  obH4CandidateForConfirm,
  "ob h4 confirm timing does not late-promote after due bar"
);

assert.equal(
  isOppositeColorCandleForOb(
    {
      tf: "H1",
      openTime: Date.UTC(2026, 3, 30, 0, 0, 0),
      closeTime: Date.UTC(2026, 3, 30, 0, 59, 59),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 0,
    },
    "BULL"
  ),
  false,
  "ob doji is not opposite candle for bull"
);

assert.equal(
  isOppositeColorCandleForOb(
    {
      tf: "H1",
      openTime: Date.UTC(2026, 3, 30, 1, 0, 0),
      closeTime: Date.UTC(2026, 3, 30, 1, 59, 59),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 0,
    },
    "BEAR"
  ),
  false,
  "ob doji is not opposite candle for bear"
);

assert.equal(
  findLastOppositeColorCandleIndex(obDojiOnlyBars, "BULL", 7),
  null,
  "ob doji is ignored in last opposite candle search"
);

assert.equal(
  computeObTouchOverlapLen({
    wickHigh: 105,
    wickLow: 99,
    top: 103,
    bottom: 100,
  }),
  3,
  "ob touch overlap uses wick-zone intersection"
);

assert.equal(
  computeObTouchPenetrationMin(15, 4),
  1.5,
  "ob touch penetration min uses atr floor when larger"
);

assert.equal(
  computeObTouchPenetrationMin(10, 8),
  2,
  "ob touch penetration min uses zone floor when larger"
);

assert.deepEqual(
  evaluateObTouchPenetrationFilter({
    wickHigh: 101,
    wickLow: 99.5,
    top: 104,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 1,
    penetrationMin: 1,
    passTouchPenetration: true,
  },
  "ob touch passes when overlap equals threshold"
);

assert.deepEqual(
  evaluateObTouchPenetrationFilter({
    wickHigh: 101.5,
    wickLow: 99,
    top: 108,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 1.5,
    penetrationMin: 2,
    passTouchPenetration: false,
  },
  "ob touch fails below threshold"
);

assert.deepEqual(
  evaluateObTouchPenetrationFilter({
    wickHigh: 99,
    wickLow: 95,
    top: 104,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 0,
    penetrationMin: 1,
    passTouchPenetration: false,
  },
  "ob touch fails when there is no overlap"
);

assert.equal(
  evaluateObTouchPenetrationFilter({
    wickHigh: 101,
    wickLow: 99,
    top: 100,
    bottom: 100,
    atrForTf: 10,
  }),
  null,
  "ob touch rejects invalid zone"
);

assert.equal(
  isObSetupTf("H1"),
  true,
  "ob setup tf includes h1"
);

assert.equal(
  isObSetupTf("M15"),
  false,
  "ob setup tf excludes m15"
);

assert.equal(
  isEligibleObSetupParent(obSetupD1ParentPriority),
  true,
  "ob setup accepts active d1 parent"
);

assert.equal(
  isEligibleObSetupParent(obSetupH4CandidateParent),
  false,
  "ob setup rejects non-poi-active h4 parent"
);

assert.equal(
  computeObInsideOverlapLen(
    obSetupD1ParentPriority.zone,
    obSetupZoneCandidate.zone
  ),
  1,
  "ob setup inside overlap formula"
);

assert.equal(
  computeObInsideOverlapRatio(
    obSetupD1ParentPriority.zone,
    obSetupZoneCandidate.zone
  ),
  0.5,
  "ob setup inside ratio formula"
);

assert.equal(
  selectObSetupParent({
    setupZone: obSetupZoneCandidate.zone,
    d1PoiObs: [obSetupD1ParentPriority],
    h4CoreObs: [obSetupH4ParentPerfect],
  })?.parentPoi.id,
  "OB-SETUP-D1-PRIORITY",
  "ob setup parent selection prefers d1 layer over h4"
);

assert.equal(
  selectObSetupParent({
    setupZone: obSetupZoneCandidate.zone,
    d1PoiObs: [
      obSetupD1ParentPriority,
      obSetupD1ParentTieOld,
      obSetupD1ParentTieNew,
    ],
    h4CoreObs: [],
  })?.parentPoi.id,
  "OB-SETUP-D1-TIE-C",
  "ob setup parent selection uses max overlap then latest confirmDueTime"
);

assert.equal(
  selectObSetupParent({
    setupZone: obSetupZoneCandidate.zone,
    d1PoiObs: [obSetupD1ParentTieOld, obSetupD1ParentTieIdA],
    h4CoreObs: [],
  })?.parentPoi.id,
  "OB-SETUP-D1-TIE-A",
  "ob setup parent selection breaks full tie by id asc"
);

assert.equal(
  getObSetupDisplayUntil("M30", obSetupZoneCandidate.triggerTime),
  obSetupZoneCandidate.triggerTime + 300 * 30 * 60 * 1000,
  "ob setup display until uses tf duration"
);

assert.deepEqual(
  createSetupOb({
    id: "OB-SETUP-1",
    symbol: "btcusdt",
    zoneCandidate: obSetupZoneCandidate,
    heightFilterEval: obSetupHeightPassH1,
    structureTriggered: true,
    displacementEval: obSetupDispPass,
    sweepRecoveryEval: obSetupSweepPass,
    contextEval: obSetupContextFail,
    h4StructureAtConf: "UP",
    d1PoiObs: [obSetupD1ParentPriority],
    h4CoreObs: [obSetupH4ParentPerfect],
  }),
  {
    id: "OB-SETUP-1",
    symbol: "BTCUSDT",
    type: "SETUP_OB",
    tf: "H1",
    dir: "BULL",
    zone: {
      bottom: 104,
      top: 106,
      height: 2,
    },
    triggerTime: obSetupZoneCandidate.triggerTime,
    createdAt: obSetupZoneCandidate.triggerTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: obSetupZoneCandidate.triggerTime + 300 * 60 * 60 * 1000,
    atrAtTrigger: 10,
    passHeightFilter: true,
    passDisplacement: true,
    passSweepRecovery: true,
    passContextDist: false,
    sweepTargetType: "EQL",
    sweepTargetPrice: 90,
    sweepTime: obSetupZoneCandidate.obCandleTime,
    recoveryTime: obSetupZoneCandidate.triggerTime,
    touchCount: 0,
    fullFillHit: false,
    tags: [],
    parentPoiId: "OB-SETUP-D1-PRIORITY",
    parentPoiType: "D1_POI_OB",
    insideOverlapLen: 1,
    insideOverlapRatio: 0.5,
    passInside: true,
    passDirectionAlign: true,
    h4StructureAtConf: "UP",
    hasH4MixedRiskTag: false,
    localOppChochAfterTouchOnly: true,
  },
  "ob setup creates from d1 priority and ignores context as gate"
);

assert.deepEqual(
  createSetupOb({
    id: "OB-SETUP-2",
    symbol: "btcusdt",
    zoneCandidate: obSetupZoneCandidate,
    heightFilterEval: obSetupHeightPassM30,
    structureTriggered: true,
    displacementEval: obSetupDispPass,
    sweepRecoveryEval: obSetupSweepPass,
    contextEval: obSetupContextPass,
    h4StructureAtConf: "UP",
    d1PoiObs: [],
    h4CoreObs: [obSetupH4ParentPerfect],
  }),
  {
    id: "OB-SETUP-2",
    symbol: "BTCUSDT",
    type: "SETUP_OB",
    tf: "M30",
    dir: "BULL",
    zone: {
      bottom: 104,
      top: 106,
      height: 2,
    },
    triggerTime: obSetupZoneCandidate.triggerTime,
    createdAt: obSetupZoneCandidate.triggerTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: obSetupZoneCandidate.triggerTime + 300 * 30 * 60 * 1000,
    atrAtTrigger: 10,
    passHeightFilter: true,
    passDisplacement: true,
    passSweepRecovery: true,
    passContextDist: true,
    sweepTargetType: "EQL",
    sweepTargetPrice: 90,
    sweepTime: obSetupZoneCandidate.obCandleTime,
    recoveryTime: obSetupZoneCandidate.triggerTime,
    touchCount: 0,
    fullFillHit: false,
    tags: [],
    parentPoiId: "OB-SETUP-H4-PERFECT",
    parentPoiType: "H4_CORE_OB",
    insideOverlapLen: 2,
    insideOverlapRatio: 1,
    passInside: true,
    passDirectionAlign: true,
    h4StructureAtConf: "UP",
    hasH4MixedRiskTag: false,
    localOppChochAfterTouchOnly: true,
  },
  "ob setup falls back to h4 parent when no active d1 exists"
);

assert.deepEqual(
  createSetupOb({
    id: "OB-SETUP-3",
    symbol: "BTCUSDT",
    zoneCandidate: obSetupZoneCandidate,
    heightFilterEval: obSetupHeightPassH1,
    structureTriggered: true,
    displacementEval: obSetupDispPass,
    sweepRecoveryEval: obSetupSweepPass,
    contextEval: obSetupContextFail,
    h4StructureAtConf: "MIXED",
    d1PoiObs: [obSetupD1ParentPriority],
    h4CoreObs: [],
  }),
  {
    id: "OB-SETUP-3",
    symbol: "BTCUSDT",
    type: "SETUP_OB",
    tf: "H1",
    dir: "BULL",
    zone: {
      bottom: 104,
      top: 106,
      height: 2,
    },
    triggerTime: obSetupZoneCandidate.triggerTime,
    createdAt: obSetupZoneCandidate.triggerTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: obSetupZoneCandidate.triggerTime + 300 * 60 * 60 * 1000,
    atrAtTrigger: 10,
    passHeightFilter: true,
    passDisplacement: true,
    passSweepRecovery: true,
    passContextDist: false,
    sweepTargetType: "EQL",
    sweepTargetPrice: 90,
    sweepTime: obSetupZoneCandidate.obCandleTime,
    recoveryTime: obSetupZoneCandidate.triggerTime,
    touchCount: 0,
    fullFillHit: false,
    tags: ["H4_MIXED_RISK"],
    parentPoiId: "OB-SETUP-D1-PRIORITY",
    parentPoiType: "D1_POI_OB",
    insideOverlapLen: 1,
    insideOverlapRatio: 0.5,
    passInside: true,
    passDirectionAlign: true,
    h4StructureAtConf: "MIXED",
    hasH4MixedRiskTag: true,
    localOppChochAfterTouchOnly: true,
  },
  "ob setup keeps mixed as risk tag only"
);

assert.equal(
  createSetupOb({
    id: "OB-SETUP-4",
    symbol: "BTCUSDT",
    zoneCandidate: obSetupZoneCandidateBear,
    heightFilterEval: obSetupHeightPassH1,
    structureTriggered: true,
    displacementEval: obSetupDispPass,
    sweepRecoveryEval: obSetupSweepPass,
    contextEval: obSetupContextPass,
    h4StructureAtConf: "UP",
    d1PoiObs: [obSetupD1ParentPriority],
    h4CoreObs: [],
  }),
  null,
  "ob setup rejects direction mismatch"
);

assert.equal(
  createSetupOb({
    id: "OB-SETUP-5",
    symbol: "BTCUSDT",
    zoneCandidate: obSetupZoneCandidateLowOverlap,
    heightFilterEval: obSetupHeightPassH1,
    structureTriggered: true,
    displacementEval: obSetupDispPass,
    sweepRecoveryEval: obSetupSweepPass,
    contextEval: obSetupContextPass,
    h4StructureAtConf: "UP",
    d1PoiObs: [obSetupD1ParentPriority],
    h4CoreObs: [],
  }),
  null,
  "ob setup requires inside ratio at least 0.20"
);

assert.equal(
  createSetupOb({
    id: "OB-SETUP-6",
    symbol: "BTCUSDT",
    zoneCandidate: obSetupZoneCandidate,
    heightFilterEval: obSetupHeightPassH1,
    structureTriggered: true,
    displacementEval: obSetupDispFail,
    sweepRecoveryEval: obSetupSweepPass,
    contextEval: obSetupContextPass,
    h4StructureAtConf: "UP",
    d1PoiObs: [obSetupD1ParentPriority],
    h4CoreObs: [],
  }),
  null,
  "ob setup requires displacement pass"
);

assert.equal(
  createSetupOb({
    id: "OB-SETUP-7",
    symbol: "BTCUSDT",
    zoneCandidate: obSetupZoneCandidate,
    heightFilterEval: obSetupHeightPassH1,
    structureTriggered: true,
    displacementEval: obSetupDispPass,
    sweepRecoveryEval: obSetupSweepFail,
    contextEval: obSetupContextPass,
    h4StructureAtConf: "UP",
    d1PoiObs: [obSetupD1ParentPriority],
    h4CoreObs: [],
  }),
  null,
  "ob setup requires sweep recovery pass"
);

assert.equal(
  createSetupOb({
    id: "OB-SETUP-8",
    symbol: "BTCUSDT",
    zoneCandidate: obSetupZoneCandidate,
    heightFilterEval: obH4HeightPass,
    structureTriggered: true,
    displacementEval: obSetupDispPass,
    sweepRecoveryEval: obSetupSweepPass,
    contextEval: obSetupContextPass,
    h4StructureAtConf: "UP",
    d1PoiObs: [obSetupD1ParentPriority],
    h4CoreObs: [],
  }),
  null,
  "ob setup only allows h1 or m30 detect tf"
);

assert.equal(
  resolveObInvalidationReasonWithPriority({
    fullFillInvalidated: true,
    oppositeChochInvalidated: true,
    touchInvalidated: true,
    pruneInvalidated: true,
  }),
  "full_fill",
  "ob invalidation priority full fill wins"
);

assert.deepEqual(
  evaluateD1PoiObInvalidationFlags({
    fullFillHit: false,
    oppositeChoch: false,
    prunedByLimit: false,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: false,
    pruneInvalidated: false,
  },
  "ob d1 invalidation has no touch rule"
);

assert.deepEqual(
  evaluateD1PoiObInvalidationFlags({
    oppositeChoch: true,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    touchInvalidated: false,
    pruneInvalidated: false,
  },
  "ob d1 invalidation opposite choch works"
);

assert.deepEqual(
  evaluateH4CoreObInvalidationFlags({
    touchCount: 3,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: true,
    pruneInvalidated: false,
  },
  "ob h4 invalidation touch_3 triggers at third touch"
);

assert.deepEqual(
  evaluateH4CoreObInvalidationFlags({
    prunedByLimit: true,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: false,
    pruneInvalidated: true,
  },
  "ob h4 invalidation prune only"
);

assert.deepEqual(
  evaluateSetupObInvalidationFlags({
    localOppositeChoch: true,
    touchCount: 1,
    localOppChochAfterTouchOnly: true,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    touchInvalidated: false,
    pruneInvalidated: false,
  },
  "ob setup local opposite choch requires touch first"
);

assert.deepEqual(
  evaluateSetupObInvalidationFlags({
    localOppositeChoch: true,
    touchCount: 0,
    localOppChochAfterTouchOnly: true,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: false,
    pruneInvalidated: false,
  },
  "ob setup local opposite choch before touch is ignored"
);

assert.deepEqual(
  evaluateSetupObInvalidationFlags({
    h4OppositeChochAffectsParentChain: true,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    touchInvalidated: false,
    pruneInvalidated: false,
  },
  "ob setup h4 opposite choch can invalidate parent chain"
);

assert.equal(
  resolveObInvalidationReasonWithPriority({
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    touchInvalidated: true,
    pruneInvalidated: true,
  }),
  "opposite_choch",
  "ob invalidation priority opposite choch beats touch and prune"
);

assert.deepEqual(
  resolveObInvalidationDecision({
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: false,
    pruneInvalidated: false,
  }),
  {
    invalidated: false,
    invalidReason: null,
  },
  "ob invalidation decision none"
);

assert.deepEqual(
  {
    d1: isEligibleFvgForObCollab(obCollabFvgD1Inside),
    h4: isEligibleFvgForObCollab(obCollabFvgH4Overlap),
    setup: isEligibleFvgForObCollab(obCollabFvgSetupHigh),
    stack: isEligibleFvgForObCollab(obCollabFvgStackExcluded),
  },
  {
    d1: true,
    h4: true,
    setup: true,
    stack: false,
  },
  "ob fvg collab active set excludes stack"
);

assert.equal(
  computeObFvgOverlapLen(
    obCollabTargetOb.zone,
    obCollabFvgH4Overlap.zone
  ),
  3,
  "ob fvg collab overlap formula"
);

assert.equal(
  computeObFvgOverlapRatio(
    obCollabTargetOb.zone,
    obCollabFvgD1Inside.zone
  ),
  0.2,
  "ob fvg collab overlap ratio formula"
);

assert.equal(
  getObFvgCollabTag(0.2),
  "COLLAB_FVG_INSIDE_0.20",
  "ob fvg collab inside threshold tag"
);

assert.equal(
  getObFvgCollabTag(0.3),
  "COLLAB_FVG_OVERLAP_0.30",
  "ob fvg collab overlap threshold tag"
);

assert.deepEqual(
  evaluateObFvgCollab(obCollabTargetOb, [
    obCollabFvgD1Inside,
    obCollabFvgH4Overlap,
    obCollabFvgSetupHigh,
  ]),
  {
    tags: ["COLLAB_FVG_INSIDE_0.20", "COLLAB_FVG_OVERLAP_0.30"],
    bestCollab: {
      kind: "OB\u2229FVG",
      targetId: "FVG-COL-SETUP-HIGH",
      ratioOrDist: 1,
      tag: "COLLAB_FVG_OVERLAP_0.30",
    },
  },
  "ob fvg collab bestCollab picks highest overlap ratio"
);

assert.equal(
  evaluateObFvgCollab(obCollabTargetOb, [
    obCollabFvgTieOld,
    obCollabFvgTieNew,
  ]).bestCollab?.targetId,
  "FVG-COL-TIE-NEW",
  "ob fvg collab tie uses latest confTime"
);

assert.equal(
  evaluateObFvgCollab(obCollabTargetOb, [
    obCollabFvgTieIdB,
    obCollabFvgTieIdA,
  ]).bestCollab?.targetId,
  "FVG-COL-TIE-A",
  "ob fvg collab tie uses id asc after confTime"
);

assert.deepEqual(
  evaluateObFvgCollab(obCollabTargetOb, [
    obCollabFvgD1Inside,
    obCollabFvgH4Overlap,
    obCollabFvgStackExcluded,
    obCollabFvgDirMismatch,
    obCollabFvgOtherSymbol,
  ]),
  {
    tags: ["COLLAB_FVG_INSIDE_0.20", "COLLAB_FVG_OVERLAP_0.30"],
    bestCollab: {
      kind: "OB\u2229FVG",
      targetId: "FVG-COL-H4-OVERLAP",
      ratioOrDist: 0.3,
      tag: "COLLAB_FVG_OVERLAP_0.30",
    },
  },
  "ob fvg collab aggregate tags ignore stack dir mismatch and symbol mismatch"
);

assert.deepEqual(
  evaluateObFvgCollab(
    { ...obCollabTargetOb, dir: "BEAR" as const },
    [obCollabFvgD1Inside, obCollabFvgH4Overlap]
  ),
  {
    tags: [],
  },
  "ob fvg collab returns empty tags when no eligible match exists"
);

const obCollabEventTime = Date.UTC(2026, 3, 28, 12, 34, 56);

const obBestInside = {
  kind: "OB\u2229FVG" as const,
  targetId: "FVG-COL-D1-INSIDE",
  ratioOrDist: 0.2,
  tag: "COLLAB_FVG_INSIDE_0.20",
};

const obBestInsideRatioChanged = {
  ...obBestInside,
  ratioOrDist: 0.21,
};

const obBestOverlapSameTarget = {
  ...obBestInside,
  ratioOrDist: 0.3,
  tag: "COLLAB_FVG_OVERLAP_0.30",
};

const obBestOtherTarget = {
  ...obBestInside,
  targetId: "FVG-COL-H4-OVERLAP",
  ratioOrDist: 0.3,
  tag: "COLLAB_FVG_OVERLAP_0.30",
};

const obBestContextKind = {
  kind: "OB\u2229CONTEXT" as const,
  targetId: "CTX-1",
  ratioOrDist: 0.1,
  tag: "COLLAB_CONTEXT_TIGHT_0.10",
};

assert.equal(
  getObFvgCollabDisplayTag("COLLAB_FVG_INSIDE_0.20"),
  "INSIDE_0.20",
  "ob collab event display tag maps inside"
);

assert.equal(
  formatObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    obBestInside
  ),
  "[COLLAB][OB\u2229FVG] time=2026-04-28T12:34:56Z ob=OB-COLLAB-TARGET fvg=FVG-COL-D1-INSIDE ratio=0.20 tag=INSIDE_0.20",
  "ob collab event string format is exact"
);

assert.equal(
  shouldEmitObFvgCollabEvent(undefined, obBestInside),
  true,
  "ob collab event emits on first appearance"
);

assert.equal(
  shouldEmitObFvgCollabEvent(obBestInside, obBestInside),
  false,
  "ob collab event does not emit when unchanged"
);

assert.equal(
  shouldEmitObFvgCollabEvent(obBestInside, obBestInsideRatioChanged),
  true,
  "ob collab event emits when formatted ratio changes"
);

assert.equal(
  shouldEmitObFvgCollabEvent(obBestInside, obBestOtherTarget),
  true,
  "ob collab event emits when target changes"
);

assert.equal(
  shouldEmitObFvgCollabEvent(obBestInside, obBestOverlapSameTarget),
  true,
  "ob collab event emits on stronger tag upgrade"
);

assert.equal(
  resolveObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    obBestInside,
    undefined
  ),
  null,
  "ob collab event does not emit END when collab disappears"
);

assert.equal(
  resolveObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    undefined,
    obBestContextKind
  ),
  null,
  "ob collab event ignores non-fvg collab kind"
);

const obCollabStepInsideOnly = evaluateObFvgCollab(obCollabTargetOb, [
  obCollabFvgD1Inside,
]);

const obCollabStepOverlap = evaluateObFvgCollab(obCollabTargetOb, [
  obCollabFvgD1Inside,
  obCollabFvgH4Overlap,
]);

const obCollabStepInsideWithIgnoredNoise = evaluateObFvgCollab(
  obCollabTargetOb,
  [
    obCollabFvgD1Inside,
    obCollabFvgStackExcluded,
    obCollabFvgDirMismatch,
    obCollabFvgOtherSymbol,
  ]
);

const obCollabStepGone = evaluateObFvgCollab(obCollabTargetOb, [
  obCollabFvgStackExcluded,
  obCollabFvgDirMismatch,
  obCollabFvgOtherSymbol,
]);

assert.equal(
  resolveObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    undefined,
    obCollabStepInsideOnly.bestCollab
  ),
  "[COLLAB][OB\u2229FVG] time=2026-04-28T12:34:56Z ob=OB-COLLAB-TARGET fvg=FVG-COL-D1-INSIDE ratio=0.20 tag=INSIDE_0.20",
  "ob collab integration first inside appearance logs"
);

assert.equal(
  resolveObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    obCollabStepInsideOnly.bestCollab,
    obCollabStepInsideOnly.bestCollab
  ),
  null,
  "ob collab integration identical state does not log"
);

assert.equal(
  resolveObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    obCollabStepInsideOnly.bestCollab,
    obCollabStepOverlap.bestCollab
  ),
  "[COLLAB][OB\u2229FVG] time=2026-04-28T12:34:56Z ob=OB-COLLAB-TARGET fvg=FVG-COL-H4-OVERLAP ratio=0.30 tag=OVERLAP_0.30",
  "ob collab integration stronger overlap logs change"
);

assert.equal(
  resolveObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    obCollabStepInsideOnly.bestCollab,
    obCollabStepInsideWithIgnoredNoise.bestCollab
  ),
  null,
  "ob collab integration ignored fvg changes do not log"
);

assert.equal(
  resolveObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    obCollabStepOverlap.bestCollab,
    obCollabStepInsideWithIgnoredNoise.bestCollab
  ),
  "[COLLAB][OB\u2229FVG] time=2026-04-28T12:34:56Z ob=OB-COLLAB-TARGET fvg=FVG-COL-D1-INSIDE ratio=0.20 tag=INSIDE_0.20",
  "ob collab integration downgrade to inside logs change"
);

assert.equal(
  resolveObFvgCollabEvent(
    obCollabEventTime,
    obCollabTargetOb,
    obCollabStepInsideWithIgnoredNoise.bestCollab,
    obCollabStepGone.bestCollab
  ),
  null,
  "ob collab integration disappearance still emits no end"
);

const obContextEvalTime = Date.UTC(2026, 4, 1, 12, 0, 0);
const obContextRuntimePoisPreferChannel: RouterRawPoi[] = [
  {
    id: "OB-CTX-CH-1",
    symbol: "BTCUSDT",
    kind: "CHANNEL",
    tf: "H4",
    dir: "BULL",
    updatedAtMs: obContextEvalTime - 1_000,
    lowerBandAt: () => 105,
    upperBandAt: () => 120,
  },
  {
    id: "OB-CTX-TL-1",
    symbol: "BTCUSDT",
    kind: "TRENDLINE",
    tf: "H4",
    dir: "BULL",
    updatedAtMs: obContextEvalTime - 500,
    linePriceAt: () => 104.25,
  },
];

assert.deepEqual(
  evaluateObContextSelectionAtTime({
    symbol: "BTCUSDT",
    dir: "BULL",
    zone: { bottom: 104, top: 106, height: 2 },
    atrAtEval: 10,
    tEval: obContextEvalTime,
    runtimePois: obContextRuntimePoisPreferChannel,
  }),
  {
    source: "CHANNEL",
    targetId: "OB-CTX-CH-1",
    distanceRaw: 0,
    distanceAtr: 0,
    contextTime: obContextEvalTime - 1_000,
    tag: "COLLAB_CONTEXT_TIGHT_0.10",
  },
  "ob context selection prefers channel over trendline using role-matched boundary"
);

assert.equal(
  evaluateObContextSelectionAtTime({
    symbol: "BTCUSDT",
    dir: "BULL",
    zone: { bottom: 104, top: 106, height: 2 },
    atrAtEval: 10,
    tEval: obContextEvalTime,
    runtimePois: [
      {
        id: "OB-CTX-CH-FAR",
        symbol: "BTCUSDT",
        kind: "CHANNEL",
        tf: "H4",
        dir: "BULL",
        updatedAtMs: obContextEvalTime - 1_000,
        lowerBandAt: () => 109,
        upperBandAt: () => 120,
      },
      {
        id: "OB-CTX-TL-TIGHT",
        symbol: "BTCUSDT",
        kind: "TRENDLINE",
        tf: "H4",
        dir: "BULL",
        updatedAtMs: obContextEvalTime - 500,
        linePriceAt: () => 105,
      },
    ],
  }),
  null,
  "ob context selection does not fall back to trendline when any eligible channel exists"
);

assert.deepEqual(
  evaluateObContextCollabAgainstRuntimePois({
    symbol: "BTCUSDT",
    dir: "BULL",
    zone: { bottom: 104, top: 106, height: 2 },
    atrAtEval: 10,
    tEval: obContextEvalTime,
    runtimePois: obContextRuntimePoisPreferChannel,
  }),
  {
    tags: ["COLLAB_CONTEXT_TIGHT_0.10"],
    bestCollab: {
      kind: "OB\u2229CONTEXT",
      targetId: "OB-CTX-CH-1",
      ratioOrDist: 0,
      tag: "COLLAB_CONTEXT_TIGHT_0.10",
    },
  },
  "ob context collab returns tight tag and distanceAtr bestCollab"
);

assert.deepEqual(
  mergeObCollabState({
    baseTags: ["BASE_TAG"],
    fvgTags: ["COLLAB_FVG_OVERLAP_0.30"],
    fvgBestCollab: obBestInside,
    contextTags: ["COLLAB_CONTEXT_OK_0.25"],
    contextBestCollab: {
      kind: "OB\u2229CONTEXT",
      targetId: "OB-CTX-CH-1",
      ratioOrDist: 0.25,
      tag: "COLLAB_CONTEXT_OK_0.25",
    },
  }),
  {
    tags: ["BASE_TAG", "COLLAB_CONTEXT_OK_0.25", "COLLAB_FVG_OVERLAP_0.30"],
    bestCollab: obBestInside,
  },
  "ob collab merge keeps fvg bestCollab over context and merges tags"
);

assert.equal(
  getObPruneBucket(obH4CandidateForConfirm),
  "H4_POOL",
  "ob prune bucket includes h4 candidate and poi_active pool"
);

const obD1PruneOverflow = Array.from(
  { length: ObConstants.MAX_ACTIVE_D1_POI_OB + 1 },
  (_, index) => ({
    ...obSetupD1ParentPriority,
    id: `OB-PRUNE-D1-${index}`,
    triggerTime: obSetupD1ParentPriority.triggerTime + index * 1_000,
    createdAt: obSetupD1ParentPriority.createdAt + index * 1_000,
    confirmDueTime:
      (obSetupD1ParentPriority.confirmDueTime as number) + index * 1_000,
  })
);

assert.deepEqual(
  buildObPruneIdSet(obD1PruneOverflow),
  new Set(["OB-PRUNE-D1-0"]),
  "ob prune removes oldest active d1 poi overflow by confirmDueTime"
);

const obSetupForKillChain = createSetupOb({
  id: "OB-SETUP-KILL-1",
  symbol: "BTCUSDT",
  zoneCandidate: obSetupZoneCandidate,
  heightFilterEval: obSetupHeightPassH1,
  structureTriggered: true,
  displacementEval: obSetupDispPass,
  sweepRecoveryEval: obSetupSweepPass,
  contextEval: obSetupContextFail,
  h4StructureAtConf: "UP",
  d1PoiObs: [obSetupD1ParentPriority],
  h4CoreObs: [obSetupH4ParentPerfect],
})!;

assert.deepEqual(
  applySetupObH4OppositeChochKillChain({
    setup: obSetupForKillChain,
    invalidatedDir: getObSetupInvalidatedDirFromH4OppositeChoch("CHOCH", "DOWN"),
    currentCloseTime: Date.UTC(2026, 4, 2, 0, 0, 0),
  }),
  {
    ...obSetupForKillChain,
    state: "INACTIVE",
    invalidReason: "opposite_choch",
    endTime: Date.UTC(2026, 4, 2, 0, 0, 0),
  },
  "ob setup h4 opposite choch kill chain invalidates d1-parent bull setup by same symbol and dir"
);

clearRuntimePoiStore();
replaceRuntimeObPois("BTCUSDT", [
  obSetupD1ParentPriority,
  obH4CandidateForConfirm,
  obSetupForKillChain,
]);

assert.deepEqual(
  listRuntimePois("BTCUSDT").map((poi) => ({
    id: poi.id,
    kind: poi.kind,
    type: poi.type,
    state: poi.state,
  })),
  [
    {
      id: "OB-SETUP-D1-PRIORITY",
      kind: "OB",
      type: "D1_POI_OB",
      state: "ACTIVE",
    },
    {
      id: "OB-SETUP-KILL-1",
      kind: "OB",
      type: "SETUP_OB",
      state: "ACTIVE",
    },
  ],
  "runtime poi store exports only active ob pois"
);
clearRuntimePoiStore();

const obSetupLifecycleEndTime = Date.UTC(2026, 4, 2, 4, 0, 0);
assert.deepEqual(
  buildObLifecycleEvents({
    prevD1Pois: [],
    nextD1Pois: [],
    prevH4CoreObs: [],
    nextH4CoreObs: [],
    prevSetupObs: [obSetupForKillChain],
    nextSetupObs: [
      {
        ...obSetupForKillChain,
        touchCount: 1,
        lastTouchTime: obSetupLifecycleEndTime,
        state: "INACTIVE",
        invalidReason: "opposite_choch",
        endTime: obSetupLifecycleEndTime,
      },
    ],
    currentCloseTime: obSetupLifecycleEndTime,
    tickSize: 1,
  }),
  [
    "[TOUCH][H1][OB-SETUP-KILL-1] time=2026-05-02T04:00:00Z touchCount=1",
    "[INVALID][H1][OB-SETUP-KILL-1] time=2026-05-02T04:00:00Z reason=opposite_choch endTime=2026-05-02T04:00:00Z",
  ],
  "ob lifecycle events emit setup touch and invalid in locked order"
);

assert.deepEqual(
  (() => {
    const noop = applyObBarClose(createEmptyObRuntimeState("BTCUSDT"), {
      tf: "M15",
      openTime: Date.UTC(2026, 4, 3, 0, 0, 0),
      closeTime: Date.UTC(2026, 4, 3, 0, 14, 59),
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1,
    });

    return {
      events: noop.events,
      m15Bars: noop.nextState.m15.bars.length,
    };
  })(),
  {
    events: [],
    m15Bars: 1,
  },
  "ob runtime m15 path stays deterministic with no active pois"
);
assert.deepEqual(
  {
    all: [...ChannelConstants.CHANNEL_TFS],
    model: [...ChannelConstants.CHANNEL_MODEL_TFS],
    gateOnly: [...ChannelConstants.CHANNEL_GATE_ONLY_TFS],
  },
  {
    all: ["D1", "H4", "H1", "M30", "M15", "M5"],
    model: ["D1", "H4", "H1", "M30"],
    gateOnly: ["M15", "M5"],
  },
  "channel tf set"
);

assert.deepEqual(
  {
    d1Type: getD1H4ChannelType("D1"),
    h4Type: getD1H4ChannelType("H4"),
    d1Pctl: getD1H4OffsetPercentile("D1"),
    h4Pctl: getD1H4OffsetPercentile("H4"),
    d1Mode: getD1H4FixedMode("D1"),
    h4Mode: getD1H4FixedMode("H4"),
  },
  {
    d1Type: "D1_CHANNEL",
    h4Type: "H4_CHANNEL",
    d1Pctl: 95,
    h4Pctl: 90,
    d1Mode: "ENABLED",
    h4Mode: "ENABLED",
  },
  "channel d1 h4 type percentile mode"
);

assert.deepEqual(
  buildAnchorLine2P(channelAnchorA, channelAnchorB),
  {
    a: channelAnchorA,
    b: channelAnchorB,
    slope: 1,
    intercept: -900,
  },
  "channel anchor line formula"
);

assert.equal(
  linePriceAt(
    buildAnchorLine2P(channelAnchorA, channelAnchorB)!,
    1020
  ),
  120,
  "channel line price evaluation"
);

assert.deepEqual(
  createChannelGeometry("UP", channelAnchorA, channelAnchorB, 6),
  {
    dir: "UP",
    anchorLine: {
      a: channelAnchorA,
      b: channelAnchorB,
      slope: 1,
      intercept: -900,
    },
    offset: 6,
    midOffset: 3,
  },
  "channel geometry stores offset and mid offset"
);

assert.deepEqual(
  createD1H4OperationalChannel({
    symbol: "btcusdt",
    tf: "D1",
    dir: "UP",
    a: channelAnchorA,
    b: channelAnchorB,
    offset: 6,
    createdAt: channelD1CreatedAt,
  }),
  {
    id: "BTCUSDT:D1_CHANNEL:1000:UP:95",
    symbol: "BTCUSDT",
    type: "D1_CHANNEL",
    tf: "D1",
    state: "ACTIVE",
    mode: "ENABLED",
    geometry: {
      dir: "UP",
      anchorLine: {
        a: channelAnchorA,
        b: channelAnchorB,
        slope: 1,
        intercept: -900,
      },
      offset: 6,
      midOffset: 3,
    },
    anchorStartTime: 1000,
    anchorEndTime: 1010,
    createdAt: channelD1CreatedAt,
    lastUpdatedAt: channelD1CreatedAt,
    maxForwardBars: 300,
    displayUntil: channelD1CreatedAt + 300 * 24 * 60 * 60 * 1000,
  },
  "channel d1 basic operation creates active model"
);

assert.deepEqual(
  createD1H4OperationalChannel({
    symbol: "btcusdt",
    tf: "H4",
    dir: "DOWN",
    a: channelAnchorA,
    b: channelAnchorB,
    offset: 4,
    createdAt: channelH4CreatedAt,
  }),
  {
    id: "BTCUSDT:H4_CHANNEL:1000:DOWN:90",
    symbol: "BTCUSDT",
    type: "H4_CHANNEL",
    tf: "H4",
    state: "ACTIVE",
    mode: "ENABLED",
    geometry: {
      dir: "DOWN",
      anchorLine: {
        a: channelAnchorA,
        b: channelAnchorB,
        slope: 1,
        intercept: -900,
      },
      offset: 4,
      midOffset: 2,
    },
    anchorStartTime: 1000,
    anchorEndTime: 1010,
    createdAt: channelH4CreatedAt,
    lastUpdatedAt: channelH4CreatedAt,
    maxForwardBars: 300,
    displayUntil: channelH4CreatedAt + 300 * 4 * 60 * 60 * 1000,
  },
  "channel h4 basic operation creates active model"
);

assert.equal(
  createD1H4OperationalChannel({
    symbol: "BTCUSDT",
    tf: "D1",
    dir: "UP",
    a: channelAnchorA,
    b: channelAnchorB,
    offset: 0,
    createdAt: channelD1CreatedAt,
  }),
  null,
  "channel basic operation rejects invalid offset"
);

assert.equal(
  createD1H4OperationalChannel({
    symbol: "BTCUSDT",
    tf: "D1",
    dir: "UP",
    a: channelAnchorB,
    b: channelAnchorA,
    offset: 6,
    createdAt: channelD1CreatedAt,
  }),
  null,
  "channel basic operation rejects invalid anchor order"
);
assert.equal(
  isH1M30ChannelTf("H1"),
  true,
  "channel h1 m30 tf includes h1"
);

assert.equal(
  isH1M30ChannelTf("H4"),
  false,
  "channel h1 m30 tf excludes h4"
);

assert.deepEqual(
  {
    h1Type: getH1M30ChannelType("H1"),
    m30Type: getH1M30ChannelType("M30"),
    h1Pctl: getH1M30OffsetPercentile("H1"),
    m30Pctl: getH1M30OffsetPercentile("M30"),
    h1Ttl: getH1M30TtlBars("H1"),
    m30Ttl: getH1M30TtlBars("M30"),
  },
  {
    h1Type: "H1_CHANNEL",
    m30Type: "M30_CHANNEL",
    h1Pctl: 85,
    m30Pctl: 80,
    h1Ttl: 100,
    m30Ttl: 80,
  },
  "channel h1 m30 type percentile ttl"
);

assert.equal(
  computeH1M30Mode(0),
  "CONTEXT_ONLY",
  "channel h1 m30 no parent means context only"
);

assert.equal(
  computeH1M30Mode(1),
  "ENABLED",
  "channel h1 m30 active parent means enabled"
);

assert.equal(
  getH1M30DisplayUntil("M30", channelM30CreatedAt),
  channelM30CreatedAt + 300 * 30 * 60 * 1000,
  "channel h1 m30 display until uses tf duration"
);

assert.deepEqual(
  createH1M30OperationalChannel({
    symbol: "btcusdt",
    tf: "H1",
    dir: "UP",
    a: channelAnchorA,
    b: channelAnchorB,
    offset: 5,
    createdAt: channelH1CreatedAt,
    activeParentPoiCount: 2,
  }),
  {
    id: "BTCUSDT:H1_CHANNEL:1000:UP:85",
    symbol: "BTCUSDT",
    type: "H1_CHANNEL",
    tf: "H1",
    state: "ACTIVE",
    mode: "ENABLED",
    geometry: {
      dir: "UP",
      anchorLine: {
        a: channelAnchorA,
        b: channelAnchorB,
        slope: 1,
        intercept: -900,
      },
      offset: 5,
      midOffset: 2.5,
    },
    anchorStartTime: 1000,
    anchorEndTime: 1010,
    createdAt: channelH1CreatedAt,
    lastUpdatedAt: channelH1CreatedAt,
    maxForwardBars: 300,
    displayUntil: channelH1CreatedAt + 300 * 60 * 60 * 1000,
    ttlBars: 100,
    ttlStartTime: channelH1CreatedAt,
  },
  "channel h1 operation creates active enabled model"
);

assert.deepEqual(
  createH1M30OperationalChannel({
    symbol: "btcusdt",
    tf: "M30",
    dir: "DOWN",
    a: channelAnchorA,
    b: channelAnchorB,
    offset: 4,
    createdAt: channelM30CreatedAt,
    activeParentPoiCount: 0,
  }),
  {
    id: "BTCUSDT:M30_CHANNEL:1000:DOWN:80",
    symbol: "BTCUSDT",
    type: "M30_CHANNEL",
    tf: "M30",
    state: "ACTIVE",
    mode: "CONTEXT_ONLY",
    geometry: {
      dir: "DOWN",
      anchorLine: {
        a: channelAnchorA,
        b: channelAnchorB,
        slope: 1,
        intercept: -900,
      },
      offset: 4,
      midOffset: 2,
    },
    anchorStartTime: 1000,
    anchorEndTime: 1010,
    createdAt: channelM30CreatedAt,
    lastUpdatedAt: channelM30CreatedAt,
    maxForwardBars: 300,
    displayUntil: channelM30CreatedAt + 300 * 30 * 60 * 1000,
    ttlBars: 80,
    ttlStartTime: channelM30CreatedAt,
  },
  "channel m30 operation creates active context-only model"
);

assert.equal(
  createH1M30OperationalChannel({
    symbol: "BTCUSDT",
    tf: "H1",
    dir: "UP",
    a: channelAnchorA,
    b: channelAnchorB,
    offset: 0,
    createdAt: channelH1CreatedAt,
    activeParentPoiCount: 1,
  }),
  null,
  "channel h1 m30 operation rejects invalid offset"
);

assert.equal(
  createH1M30OperationalChannel({
    symbol: "BTCUSDT",
    tf: "M30",
    dir: "UP",
    a: channelAnchorB,
    b: channelAnchorA,
    offset: 4,
    createdAt: channelM30CreatedAt,
    activeParentPoiCount: 1,
  }),
  null,
  "channel h1 m30 operation rejects invalid anchor order"
);

const channelUpAnchorPivots = [
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 1000,
    pivotPrice: 100,
    confirmedAt: 1200,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 1100,
    pivotPrice: 103,
    confirmedAt: 1300,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "LOW" as const,
    pivotTime: 1200,
    pivotPrice: 105,
    confirmedAt: 1400,
    isConfirmed: true,
  },
] as const;

const channelDownAnchorPivots = [
  {
    tf: "H1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 2000,
    pivotPrice: 120,
    confirmedAt: 2200,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 2100,
    pivotPrice: 118,
    confirmedAt: 2300,
    isConfirmed: true,
  },
  {
    tf: "H1" as const,
    pivotType: "HIGH" as const,
    pivotTime: 2200,
    pivotPrice: 115,
    confirmedAt: 2400,
    isConfirmed: true,
  },
] as const;

assert.deepEqual(
  selectCanonicalUpAnchorPair(channelUpAnchorPivots, 1),
  {
    a: { time: 1100, price: 103 },
    b: { time: 1200, price: 105 },
  },
  "channel up anchor lock uses latest endpoint and first valid backward pair"
);

assert.deepEqual(
  selectCanonicalDownAnchorPair(channelDownAnchorPivots, 2),
  {
    a: { time: 2100, price: 118 },
    b: { time: 2200, price: 115 },
  },
  "channel down anchor lock uses latest endpoint and first valid backward pair"
);

assert.deepEqual(
  {
    upOnly: resolveChannelDirectionFromPairs({
      upPair: { a: { time: 1, price: 100 }, b: { time: 2, price: 104 } },
      downPair: null,
      structureState: "MIXED",
    }),
    downOnly: resolveChannelDirectionFromPairs({
      upPair: null,
      downPair: { a: { time: 3, price: 120 }, b: { time: 4, price: 116 } },
      structureState: "MIXED",
    }),
    bothUp: resolveChannelDirectionFromPairs({
      upPair: { a: { time: 1, price: 100 }, b: { time: 2, price: 104 } },
      downPair: { a: { time: 3, price: 120 }, b: { time: 4, price: 116 } },
      structureState: "UP",
    }),
    bothMixed: resolveChannelDirectionFromPairs({
      upPair: { a: { time: 1, price: 100 }, b: { time: 2, price: 104 } },
      downPair: { a: { time: 3, price: 120 }, b: { time: 4, price: 116 } },
      structureState: "MIXED",
    }),
  },
  {
    upOnly: "UP",
    downOnly: "DOWN",
    bothUp: "UP",
    bothMixed: null,
  },
  "channel direction resolution lock follows single-side then structure tie-break"
);

const channelParentPoolPois = [
  {
    id: "Z_PARENT_H4_FVG",
    kind: "FVG",
    tf: "H4",
    dir: "BULL",
    zone: { bottom: 100, top: 105 },
    type: "H4_CORE_FVG",
    state: "A_ACTIVE",
  },
  {
    id: "A_PARENT_D1_OB",
    kind: "OB",
    tf: "D1",
    dir: "BULL",
    zone: { bottom: 95, top: 101 },
    type: "D1_POI_OB",
    state: "ACTIVE",
  },
  {
    id: "IGNORED_SETUP",
    kind: "OB",
    tf: "H1",
    dir: "BULL",
    zone: { bottom: 96, top: 100 },
    type: "SETUP_OB",
    state: "ACTIVE",
  },
  {
    id: "IGNORED_WRONG_DIR",
    kind: "FVG",
    tf: "D1",
    dir: "BEAR",
    zone: { bottom: 110, top: 120 },
    type: "D1_POI_FVG",
    state: "ACTIVE",
  },
] as const;

assert.deepEqual(
  listActiveChannelParentCandidates(channelParentPoolPois as any, "UP").map(
    (poi) => poi.id
  ),
  ["Z_PARENT_H4_FVG", "A_PARENT_D1_OB"],
  "channel parent pool lock only admits same-dir D1 H4 ob fvg parents"
);

assert.deepEqual(
  {
    bullBoundary: extractChannelParentBoundaryPrice({
      id: "BULL_PARENT",
      kind: "OB",
      tf: "D1",
      dir: "BULL",
      zone: { bottom: 90, top: 100 },
      type: "D1_POI_OB",
      state: "ACTIVE",
    } as any),
    bearBoundary: extractChannelParentBoundaryPrice({
      id: "BEAR_PARENT",
      kind: "FVG",
      tf: "H4",
      dir: "BEAR",
      zone: { bottom: 120, top: 130 },
      type: "H4_CORE_FVG",
      state: "A_ACTIVE",
    } as any),
    referencedIds: buildReferencedChannelParentIds(
      channelParentPoolPois as any
    ),
    contexts: toChannelParentPoiContexts(channelParentPoolPois as any).map(
      (ctx) => `${ctx.id}:${ctx.boundaryPrice}`
    ),
  },
  {
    bullBoundary: 90,
    bearBoundary: 130,
    referencedIds: [
      "A_PARENT_D1_OB",
      "IGNORED_SETUP",
      "IGNORED_WRONG_DIR",
      "Z_PARENT_H4_FVG",
    ],
    contexts: [
      "A_PARENT_D1_OB:95",
      "IGNORED_SETUP:96",
      "IGNORED_WRONG_DIR:120",
      "Z_PARENT_H4_FVG:100",
    ],
  },
  "channel parent helpers lock boundary and referenced-parent sorting"
);

const channelModePrevContextOnly = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 5,
  createdAt: channelH1CreatedAt,
  activeParentPoiCount: 0,
})!;

const channelModeNextEnabled = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 5,
  createdAt: channelH1CreatedAt,
  activeParentPoiCount: 2,
})!;

const channelModePrevEnabled = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "M30",
  dir: "DOWN",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 4,
  createdAt: channelM30CreatedAt,
  activeParentPoiCount: 1,
})!;

const channelModeNextContextOnly = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "M30",
  dir: "DOWN",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 4,
  createdAt: channelM30CreatedAt,
  activeParentPoiCount: 0,
})!;

assert.equal(
  formatChannelModeEvent(channelModeEventTime, channelModeNextEnabled),
  "[CHANNEL][MODE][H1] time=2026-05-25T12:34:56Z mode=ENABLED",
  "channel mode event string format is exact"
);

assert.equal(
  shouldEmitChannelModeEvent(undefined, channelModeNextEnabled),
  false,
  "channel mode event does not emit on first creation"
);

assert.equal(
  resolveChannelModeEvent(
    channelModeEventTime,
    channelModePrevContextOnly,
    channelModePrevContextOnly
  ),
  null,
  "channel mode event does not emit when unchanged"
);

assert.equal(
  resolveChannelModeEvent(
    channelModeEventTime,
    channelModePrevContextOnly,
    channelModeNextEnabled
  ),
  "[CHANNEL][MODE][H1] time=2026-05-25T12:34:56Z mode=ENABLED",
  "channel mode event emits on context_only to enabled"
);

assert.equal(
  resolveChannelModeEvent(
    channelModeEventTime,
    channelModePrevEnabled,
    channelModeNextContextOnly
  ),
  "[CHANNEL][MODE][M30] time=2026-05-25T12:34:56Z mode=CONTEXT_ONLY",
  "channel mode event emits on enabled to context_only"
);

assert.equal(
  resolveChannelModeEvent(
    channelModeEventTime,
    createD1H4OperationalChannel({
      symbol: "BTCUSDT",
      tf: "D1",
      dir: "UP",
      a: channelAnchorA,
      b: channelAnchorB,
      offset: 6,
      createdAt: channelD1CreatedAt,
    }),
    createD1H4OperationalChannel({
      symbol: "BTCUSDT",
      tf: "D1",
      dir: "UP",
      a: channelAnchorA,
      b: channelAnchorB,
      offset: 6,
      createdAt: channelD1CreatedAt,
    })
  ),
  null,
  "channel mode event ignores d1 h4 models"
);

assert.equal(
  resolveChannelModeEvent(
    channelModeEventTime,
    channelModePrevContextOnly,
    {
      ...channelModeNextEnabled,
      state: "INACTIVE",
    }
  ),
  null,
  "channel mode event ignores inactive next model"
);

const channelLifecycleH1 = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 5,
  createdAt: Date.UTC(2026, 4, 26, 0, 0, 0),
  activeParentPoiCount: 1,
  referencedParentIds: ["D1:POI:1", "H4:POI:9"],
})!;

const channelLifecycleM30ContextOnly = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "M30",
  dir: "DOWN",
  a: channelAnchorA,
  b: channelAnchorB,
  offset: 4,
  createdAt: Date.UTC(2026, 4, 26, 0, 0, 0),
  activeParentPoiCount: 0,
})!;

assert.deepEqual(
  {
    h1: isChannelTtlTf("H1"),
    m30: isChannelTtlTf("M30"),
    d1: isChannelTtlTf("D1"),
    h1Bars: getChannelTtlBars("H1"),
    m30Bars: getChannelTtlBars("M30"),
  },
  {
    h1: true,
    m30: true,
    d1: false,
    h1Bars: 100,
    m30Bars: 80,
  },
  "channel ttl tf and ttl bars"
);

assert.deepEqual(
  {
    h1Expiry: getChannelTtlExpiryTime(channelLifecycleH1),
    m30Expiry: getChannelTtlExpiryTime(channelLifecycleM30ContextOnly),
  },
  {
    h1Expiry: channelLifecycleH1.createdAt + 100 * 60 * 60 * 1000,
    m30Expiry: channelLifecycleM30ContextOnly.createdAt + 80 * 30 * 60 * 1000,
  },
  "channel ttl expiry time uses tf bars"
);

assert.equal(
  evaluateChannelTtlExpiration(
    channelLifecycleH1,
    channelLifecycleH1.createdAt + 99 * 60 * 60 * 1000
  ),
  false,
  "channel ttl is false before expiry"
);

assert.equal(
  evaluateChannelTtlExpiration(
    channelLifecycleH1,
    channelLifecycleH1.createdAt + 100 * 60 * 60 * 1000
  ),
  true,
  "channel ttl is true at expiry threshold"
);

assert.equal(
  evaluateChannelParentPoiEnded(channelLifecycleH1, []),
  true,
  "channel parent ended applies to enabled h1 m30"
);

assert.equal(
  evaluateChannelParentPoiEnded(channelLifecycleM30ContextOnly, []),
  false,
  "channel parent ended does not apply to context_only"
);

assert.equal(
  evaluateChannelParentPoiEnded(
    {
      ...channelLifecycleH1,
      referencedParentIds: ["OLD_PARENT_A", "OLD_PARENT_B"],
    },
    ["NEW_PARENT_ONLY"]
  ),
  true,
  "channel parent ended lock uses fixed referenced parents instead of current replacement pool"
);

assert.deepEqual(
  resolveChannelLifecycleInvalidation({
    channel: createD1H4OperationalChannel({
      symbol: "BTCUSDT",
      tf: "D1",
      dir: "UP",
      a: channelAnchorA,
      b: channelAnchorB,
      offset: 6,
      createdAt: channelD1CreatedAt,
    })!,
    currentCloseTime: channelD1CreatedAt + 100 * 24 * 60 * 60 * 1000,
    activeParentPoiIds: [],
  }),
  {
    ttlExpired: false,
    parentPoiEnded: false,
    invalidated: false,
    invalidReason: null,
  },
  "channel lifecycle ignores ttl and parent rules for d1 h4"
);

assert.deepEqual(
  applyChannelLifecycleInvalidation({
    channel: channelLifecycleH1,
    currentCloseTime: channelLifecycleH1.createdAt + 100 * 60 * 60 * 1000,
    activeParentPoiIds: ["D1:POI:1"],
  }),
  {
    ...channelLifecycleH1,
    state: "INACTIVE",
    invalidReason: "ttl_expired",
    endTime: channelLifecycleH1.createdAt + 100 * 60 * 60 * 1000,
  },
  "channel lifecycle apply sets inactive on ttl expiry"
);

assert.deepEqual(
  applyChannelLifecycleInvalidation({
    channel: channelLifecycleH1,
    currentCloseTime: channelLifecycleH1.createdAt + 10 * 60 * 60 * 1000,
    activeParentPoiIds: [],
  }),
  {
    ...channelLifecycleH1,
    state: "INACTIVE",
    invalidReason: "parent_poi_ended",
    endTime: channelLifecycleH1.createdAt + 10 * 60 * 60 * 1000,
  },
  "channel lifecycle apply sets inactive on parent poi ended"
);

clearRuntimePoiStore("BTCUSDT");

const channelRuntimeParentEndedState = createEmptyChannelRuntimeState("BTCUSDT");
channelRuntimeParentEndedState.h1.context = {
  ...createEmptyChannelContextState(),
  bars: buildChannelBars("H1", 15, {}, 0),
};
channelRuntimeParentEndedState.h1.model = {
  ...channelBreakH1Up,
  referencedParentIds: ["D1:POI:1"],
};

const channelRuntimeParentEndedResult = applyChannelBarClose(
  channelRuntimeParentEndedState,
  {
    tf: "H1",
    openTime: 15 * 60 * 60 * 1000,
    closeTime: 16 * 60 * 60 * 1000 - 1000,
    open: 103,
    high: 108,
    low: 98,
    close: 103,
    volume: 0,
  }
);

assert.deepEqual(
  {
    state: channelRuntimeParentEndedResult.nextState.h1.model?.state,
    reason: channelRuntimeParentEndedResult.nextState.h1.model?.invalidReason,
    events: channelRuntimeParentEndedResult.events,
  },
  {
    state: "INACTIVE",
    reason: "parent_poi_ended",
    events: [
      `[CHANNEL][INVALID][H1][${channelBreakH1Up.id}] time=1970-01-01T15:59:59Z reason=parent_poi_ended endTime=1970-01-01T15:59:59Z`,
    ],
  },
  "channel runtime h1 invalidates by parent_poi_ended when fixed referenced parents disappear"
);

assert.equal(
  getChannelPoiDayKeyUtc(Date.UTC(2026, 4, 27, 23, 59, 59)),
  "2026-05-27",
  "channel poi utc day key format"
);

assert.equal(
  buildChannelPoiCapKey("btcusdt", "H1", "2026-05-27"),
  "BTCUSDT:H1:2026-05-27",
  "channel poi cap key format"
);

assert.deepEqual(
  [
    evaluateChannelPoiDayCap({
      symbol: "BTCUSDT",
      tf: "H1",
      time: Date.UTC(2026, 4, 27, 1, 0, 0),
      currentCount: 0,
    }),
    evaluateChannelPoiDayCap({
      symbol: "BTCUSDT",
      tf: "H1",
      time: Date.UTC(2026, 4, 27, 2, 0, 0),
      currentCount: 1,
    }),
    evaluateChannelPoiDayCap({
      symbol: "BTCUSDT",
      tf: "H1",
      time: Date.UTC(2026, 4, 27, 3, 0, 0),
      currentCount: 2,
    }),
  ],
  [
    {
      tf: "H1",
      dayKeyUtc: "2026-05-27",
      capKey: "BTCUSDT:H1:2026-05-27",
      currentCount: 0,
      limit: 2,
      allowed: true,
    },
    {
      tf: "H1",
      dayKeyUtc: "2026-05-27",
      capKey: "BTCUSDT:H1:2026-05-27",
      currentCount: 1,
      limit: 2,
      allowed: true,
    },
    {
      tf: "H1",
      dayKeyUtc: "2026-05-27",
      capKey: "BTCUSDT:H1:2026-05-27",
      currentCount: 2,
      limit: 2,
      allowed: false,
    },
  ],
  "channel poi day cap allows counts below two and blocks at two"
);

assert.deepEqual(
  {
    d1: isChannelPoiTf("D1"),
    h4: isChannelPoiTf("H4"),
    h1: isChannelPoiTf("H1"),
    m30: isChannelPoiTf("M30"),
    m15: isChannelPoiTf("M15"),
    d1Coef: getChannelPoiGateAtrMultiplier("D1"),
    h4Coef: getChannelPoiGateAtrMultiplier("H4"),
    h1Coef: getChannelPoiGateAtrMultiplier("H1"),
    m30Coef: getChannelPoiGateAtrMultiplier("M30"),
  },
  {
    d1: true,
    h4: true,
    h1: true,
    m30: true,
    m15: false,
    d1Coef: 0.15,
    h4Coef: 0.12,
    h1Coef: 0.08,
    m30Coef: 0.06,
  },
  "channel poi tf and gate coefficient map"
);

assert.deepEqual(
  {
    upBoundary: getChannelPoiBoundaryPriceAt(
      channelPoiD1Up,
      channelPoiGateD1Bars[14].closeTime
    ),
    downBoundary: getChannelPoiBoundaryPriceAt(
      channelPoiH4Down,
      channelPoiGateH4Bars[14].closeTime
    ),
  },
  {
    upBoundary: 100,
    downBoundary: 100,
  },
  "channel poi boundary uses lower for up and upper for down"
);

assert.deepEqual(
  {
    upExtreme: getChannelPoiWickExtreme(channelPoiGateD1Bars[14], "UP"),
    downExtreme: getChannelPoiWickExtreme(channelPoiGateH4Bars[14], "DOWN"),
  },
  {
    upExtreme: 98.5,
    downExtreme: 103,
  },
  "channel poi wick extreme uses low high by direction"
);

assert.equal(
  computeChannelPoiGateDist(98.5, 100),
  1.5,
  "channel poi gate distance formula"
);

assert.deepEqual(
  evaluateChannelPoiGateOnBar({
    channel: channelPoiD1Up,
    bar: channelPoiGateD1Bars[14],
    atrAtBar: 10,
  }),
  {
    tf: "D1",
    dir: "BULL",
    currentCloseTime: channelPoiGateD1Bars[14].closeTime,
    boundaryPrice: 100,
    wickExtreme: 98.5,
    dist: 1.5,
    atrAtBar: 10,
    gateAtrMultiplier: 0.15,
    passGate: true,
  },
  "channel poi d1 gate passes on equality threshold"
);

assert.deepEqual(
  evaluateChannelPoiGateOnBar({
    channel: channelPoiH4Down,
    bar: channelPoiGateH4Bars[14],
    atrAtBar: 25,
  }),
  {
    tf: "H4",
    dir: "BEAR",
    currentCloseTime: channelPoiGateH4Bars[14].closeTime,
    boundaryPrice: 100,
    wickExtreme: 103,
    dist: 3,
    atrAtBar: 25,
    gateAtrMultiplier: 0.12,
    passGate: true,
  },
  "channel poi h4 gate passes on equality threshold"
);

assert.deepEqual(
  evaluateChannelPoiGateOnBar({
    channel: channelPoiH1Up,
    bar: channelPoiGateH1Bars[14],
    atrAtBar: 25,
  }),
  {
    tf: "H1",
    dir: "BULL",
    currentCloseTime: channelPoiGateH1Bars[14].closeTime,
    boundaryPrice: 100,
    wickExtreme: 98,
    dist: 2,
    atrAtBar: 25,
    gateAtrMultiplier: 0.08,
    passGate: true,
  },
  "channel poi h1 gate passes on equality threshold"
);

assert.deepEqual(
  evaluateChannelPoiGateOnBar({
    channel: channelPoiM30Down,
    bar: channelPoiGateM30Bars[14],
    atrAtBar: 50,
  }),
  {
    tf: "M30",
    dir: "BEAR",
    currentCloseTime: channelPoiGateM30Bars[14].closeTime,
    boundaryPrice: 100,
    wickExtreme: 104,
    dist: 4,
    atrAtBar: 50,
    gateAtrMultiplier: 0.06,
    passGate: false,
  },
  "channel poi m30 gate fails above threshold"
);

assert.equal(
  evaluateChannelPoiGateFromTfBars(
    channelPoiGateD1Bars.slice(0, 13),
    channelPoiD1Up
  ),
  null,
  "channel poi gate wrapper requires current close atr"
);

assert.deepEqual(
  evaluateChannelPoiGateFromTfBars(
    channelPoiGateD1Bars,
    channelPoiD1Up
  ),
  {
    tf: "D1",
    dir: "BULL",
    currentCloseTime: channelPoiGateD1Bars[14].closeTime,
    boundaryPrice: 100,
    wickExtreme: 98.5,
    dist: 1.5,
    atrAtBar: 10,
    gateAtrMultiplier: 0.15,
    passGate: true,
  },
  "channel poi gate wrapper uses current close atr"
);

assert.equal(
  getChannelCandleBodySize({
    tf: "H4",
    openTime: Date.UTC(2026, 5, 8, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 8, 3, 59, 59),
    open: 120,
    high: 121,
    low: 109,
    close: 110,
    volume: 0,
  }),
  10,
  "channel disp body is abs close-open"
);

assert.deepEqual(
  evaluateChannelDispTriggerAtBar({
    tfBars: channelTriggerDispMaxBars,
    currentIndex: 2,
    atrAtBar: 10,
  }),
  {
    tf: "H4",
    currentCloseTime: channelTriggerDispMaxBars[2].closeTime,
    atrAtBar: 10,
    bodyMax: 11,
    bodySum: 17,
    passByMax: true,
    passBySum: false,
    passDisp: true,
  },
  "channel disp passes by max body"
);

assert.deepEqual(
  evaluateChannelDispTriggerAtBar({
    tfBars: channelTriggerDispSumBars,
    currentIndex: 2,
    atrAtBar: 10,
  }),
  {
    tf: "H1",
    currentCloseTime: channelTriggerDispSumBars[2].closeTime,
    atrAtBar: 10,
    bodyMax: 8,
    bodySum: 23,
    passByMax: false,
    passBySum: true,
    passDisp: true,
  },
  "channel disp passes by body sum"
);

assert.deepEqual(
  evaluateChannelDispTriggerAtBar({
    tfBars: channelTriggerDispStrictFailBars,
    currentIndex: 2,
    atrAtBar: 10,
  }),
  {
    tf: "M30",
    currentCloseTime: channelTriggerDispStrictFailBars[2].closeTime,
    atrAtBar: 10,
    bodyMax: 10,
    bodySum: 18,
    passByMax: false,
    passBySum: false,
    passDisp: false,
  },
  "channel disp uses strict greater-than thresholds"
);

assert.equal(
  evaluateChannelSweepRecTriggerNow({
    channel: channelBreakH1Up,
    tfBars: channelSweepRecUpBars,
    currentIndex: 2,
  }),
  true,
  "channel sweepRec up triggers only on recovery bar"
);

assert.equal(
  evaluateChannelSweepRecTriggerNow({
    channel: channelBreakM30Down,
    tfBars: channelSweepRecDownBars,
    currentIndex: 2,
  }),
  true,
  "channel sweepRec down triggers only on recovery bar"
);

assert.equal(
  evaluateChannelSweepRecTriggerNow({
    channel: channelBreakH1Up,
    tfBars: channelSweepRecCarryBars,
    currentIndex: 3,
  }),
  false,
  "channel sweepRec does not carry over after recovery bar"
);

assert.equal(
  evaluateChannelStructureTrigger("UP", "BOS", "UP"),
  true,
  "channel structure trigger aligns with up nextState"
);

assert.equal(
  evaluateChannelStructureTrigger("DOWN", "CHOCH", "DOWN"),
  true,
  "channel structure trigger aligns with down nextState"
);

assert.equal(
  evaluateChannelStructureTrigger("UP", "BOS", "DOWN"),
  false,
  "channel structure trigger rejects opposite nextState"
);

assert.deepEqual(
  evaluateChannelPoiTriggers({
    channel: channelBreakH1Up,
    tfBars: channelPoiTriggerWrapperBars,
    currentIndex: 14,
    atrAtBar: 10,
    breakType: "BOS",
    nextState: "UP",
  }),
  {
    tf: "H1",
    dir: "BULL",
    currentCloseTime: channelPoiTriggerWrapperBars[14].closeTime,
    sweepRec: true,
    structure: true,
    disp: true,
    triggers: ["sweepRec", "structure", "disp"],
  },
  "channel poi triggers aggregate uses deterministic order"
);

assert.equal(
  evaluateChannelPoiTriggersFromTfBars({
    channel: channelBreakH1Up,
    tfBars: channelPoiTriggerWrapperBars.slice(0, 13),
    breakType: "BOS",
    nextState: "UP",
  }),
  null,
  "channel poi trigger wrapper requires current close atr"
);

assert.deepEqual(
  evaluateChannelPoiTriggersFromTfBars({
    channel: channelBreakH1Up,
    tfBars: channelPoiTriggerWrapperBars,
    breakType: "BOS",
    nextState: "UP",
  }),
  {
    tf: "H1",
    dir: "BULL",
    currentCloseTime: channelPoiTriggerWrapperBars[14].closeTime,
    sweepRec: true,
    structure: true,
    disp: true,
    triggers: ["sweepRec", "structure", "disp"],
  },
  "channel poi trigger wrapper uses current close atr"
);

assert.equal(
  countSatisfiedChannelPoiTriggers(channelPoiTriggerEval3of3H1 as any),
  3,
  "channel poi trigger count helper"
);

assert.deepEqual(
  buildChannelBoundaryZoneProxy("H1", 100, 25),
  {
    bottom: 98,
    top: 102,
    height: 4,
  },
  "channel boundary zone proxy formula"
);

assert.deepEqual(
  evaluateChannelParentNearInside({
    tf: "H1",
    wickExtreme: 98,
    boundaryPrice: 100,
    atrAtBar: 25,
    parentPois: [channelParentNear],
  }),
  {
    near: true,
    inside: true,
    pass: true,
  },
  "channel parent near passes"
);

assert.deepEqual(
  evaluateChannelParentNearInside({
    tf: "M30",
    wickExtreme: 101,
    boundaryPrice: 100,
    atrAtBar: 25,
    parentPois: [channelParentInside],
  }),
  {
    near: false,
    inside: true,
    pass: true,
  },
  "channel parent inside passes"
);

assert.deepEqual(
  evaluateChannelParentNearInside({
    tf: "H1",
    wickExtreme: 98,
    boundaryPrice: 100,
    atrAtBar: 25,
    parentPois: [channelParentFar],
  }),
  {
    near: false,
    inside: false,
    pass: false,
  },
  "channel parent near inside fails when no parent qualifies"
);

assert.deepEqual(
  createChannelPoi({
    channel: channelPoiD1Up,
    gateEval: channelPoiGateEvalD1Pass,
    triggerEval: channelPoiTriggerEval2of3 as any,
  }),
  {
    id: `BTCUSDT:CH_POI:D1:${channelPoiGateEvalD1Pass.currentCloseTime}:BULL:100`,
    symbol: "BTCUSDT",
    tf: "D1",
    dir: "BULL",
    createdAt: channelPoiGateEvalD1Pass.currentCloseTime,
    boundaryPrice: 100,
    triggers: ["sweepRec", "structure"],
    state: "ACTIVE",
  },
  "channel d1 poi creates on 2of3"
);

assert.equal(
  createChannelPoi({
    channel: channelPoiH4Down,
    gateEval: channelPoiGateEvalH4Pass,
    triggerEval: channelPoiTriggerEval1of3H4 as any,
  }),
  null,
  "channel h4 poi rejects when triggers are below 2of3"
);

assert.deepEqual(
  createChannelPoi({
    channel: channelPoiH1Enabled,
    gateEval: channelPoiGateEvalH1Pass,
    triggerEval: channelPoiTriggerEval3of3H1 as any,
    parentNearInsideEval: evaluateChannelParentNearInside({
      tf: "H1",
      wickExtreme: 98,
      boundaryPrice: 100,
      atrAtBar: 25,
      parentPois: [channelParentNear],
    }),
    dayCapEval: evaluateChannelPoiDayCap({
      symbol: "BTCUSDT",
      tf: "H1",
      time: channelPoiGateEvalH1Pass.currentCloseTime,
      currentCount: 1,
    }),
  }),
  {
    id: `BTCUSDT:CH_POI:H1:${channelPoiGateEvalH1Pass.currentCloseTime}:BULL:100`,
    symbol: "BTCUSDT",
    tf: "H1",
    dir: "BULL",
    createdAt: channelPoiGateEvalH1Pass.currentCloseTime,
    boundaryPrice: 100,
    triggers: ["sweepRec", "structure", "disp"],
    state: "ACTIVE",
    dayKeyUtc: getChannelPoiDayKeyUtc(channelPoiGateEvalH1Pass.currentCloseTime),
    parentRelation: "INSIDE",
  },
  "channel h1 poi creates on 3of3 enabled and parent near"
);

assert.equal(
  createChannelPoi({
    channel: channelPoiH1ContextOnly,
    gateEval: channelPoiGateEvalH1Pass,
    triggerEval: channelPoiTriggerEval3of3H1 as any,
    parentNearInsideEval: evaluateChannelParentNearInside({
      tf: "H1",
      wickExtreme: 98,
      boundaryPrice: 100,
      atrAtBar: 25,
      parentPois: [channelParentNear],
    }),
    dayCapEval: evaluateChannelPoiDayCap({
      symbol: "BTCUSDT",
      tf: "H1",
      time: channelPoiGateEvalH1Pass.currentCloseTime,
      currentCount: 0,
    }),
  }),
  null,
  "channel h1 poi rejects in context_only mode"
);

assert.equal(
  createChannelPoi({
    channel: channelPoiH1Enabled,
    gateEval: channelPoiGateEvalH1Pass,
    triggerEval: channelPoiTriggerEval3of3H1 as any,
    parentNearInsideEval: evaluateChannelParentNearInside({
      tf: "H1",
      wickExtreme: 98,
      boundaryPrice: 100,
      atrAtBar: 25,
      parentPois: [channelParentFar],
    }),
    dayCapEval: evaluateChannelPoiDayCap({
      symbol: "BTCUSDT",
      tf: "H1",
      time: channelPoiGateEvalH1Pass.currentCloseTime,
      currentCount: 0,
    }),
  }),
  null,
  "channel h1 poi rejects without parent near or inside"
);

assert.equal(
  createChannelPoi({
    channel: channelPoiH1Enabled,
    gateEval: channelPoiGateEvalH1Pass,
    triggerEval: channelPoiTriggerEval3of3H1 as any,
    parentNearInsideEval: evaluateChannelParentNearInside({
      tf: "H1",
      wickExtreme: 98,
      boundaryPrice: 100,
      atrAtBar: 25,
      parentPois: [channelParentNear],
    }),
    dayCapEval: evaluateChannelPoiDayCap({
      symbol: "BTCUSDT",
      tf: "H1",
      time: channelPoiGateEvalH1Pass.currentCloseTime,
      currentCount: 2,
    }),
  }),
  null,
  "channel h1 poi rejects at day cap"
);

assert.deepEqual(
  createChannelPoi({
    channel: channelPoiM30Enabled,
    gateEval: channelPoiGateEvalM30Pass,
    triggerEval: channelPoiTriggerEval3of3M30 as any,
    parentNearInsideEval: evaluateChannelParentNearInside({
      tf: "M30",
      wickExtreme: 101,
      boundaryPrice: 100,
      atrAtBar: 25,
      parentPois: [channelParentInside],
    }),
    dayCapEval: evaluateChannelPoiDayCap({
      symbol: "BTCUSDT",
      tf: "M30",
      time: channelPoiGateEvalM30Pass.currentCloseTime,
      currentCount: 0,
    }),
  }),
  {
    id: `BTCUSDT:CH_POI:M30:${channelPoiGateEvalM30Pass.currentCloseTime}:BEAR:100`,
    symbol: "BTCUSDT",
    tf: "M30",
    dir: "BEAR",
    createdAt: channelPoiGateEvalM30Pass.currentCloseTime,
    boundaryPrice: 100,
    triggers: ["sweepRec", "structure", "disp"],
    state: "ACTIVE",
    dayKeyUtc: getChannelPoiDayKeyUtc(channelPoiGateEvalM30Pass.currentCloseTime),
    parentRelation: "INSIDE",
  },
  "channel m30 poi creates on inside pass"
);

const channelEventNewModel = channelModeNextEnabled;

const channelEventRebuiltModel = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: { time: 2000, price: 100 },
  b: { time: 2010, price: 110 },
  offset: 5,
  createdAt: channelH1CreatedAt,
  activeParentPoiCount: 1,
})!;

const channelEventInvalidModel = {
  ...channelModeNextEnabled,
  state: "INACTIVE" as const,
  invalidReason: "ttl_expired" as const,
  endTime: channelModeEventTime,
};

const channelUpdateAnchorA = {
  time: channelEventTime - 30 * 60 * 1000,
  price: 100,
};

const channelUpdateAnchorB = {
  time: channelEventTime,
  price: 110,
};

const channelUpdatePrevModel = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelUpdateAnchorA,
  b: channelUpdateAnchorB,
  offset: 5,
  createdAt: channelEventTime - 30 * 60 * 1000,
  activeParentPoiCount: 1,
})!;

const channelUpdateNextModel = createH1M30OperationalChannel({
  symbol: "BTCUSDT",
  tf: "H1",
  dir: "UP",
  a: channelUpdateAnchorA,
  b: channelUpdateAnchorB,
  offset: 6,
  createdAt: channelEventTime - 30 * 60 * 1000,
  activeParentPoiCount: 1,
})!;

const channelUpdateModeChangedModel = {
  ...channelUpdateNextModel,
  mode: "CONTEXT_ONLY" as const,
};

const channelEventPoi = createChannelPoi({
  channel: channelPoiH1Enabled,
  gateEval: channelPoiGateEvalH1Pass,
  triggerEval: channelPoiTriggerEval3of3H1 as any,
  parentNearInsideEval: evaluateChannelParentNearInside({
    tf: "H1",
    wickExtreme: 98,
    boundaryPrice: 100,
    atrAtBar: 25,
    parentPois: [channelParentNear],
  }),
  dayCapEval: evaluateChannelPoiDayCap({
    symbol: "BTCUSDT",
    tf: "H1",
    time: channelPoiGateEvalH1Pass.currentCloseTime,
    currentCount: 0,
  }),
})!;

assert.equal(
  formatChannelNewEvent(channelEventTime, channelEventNewModel),
  "[CHANNEL][NEW][H1][UP] time=2026-05-31T12:34:56Z anchors=1000@100,1010@110 offsetPctl=85 offset=5.00 mid=2.50",
  "channel new event string format is exact"
);

assert.equal(
  shouldEmitChannelNewEvent(undefined, channelEventNewModel),
  true,
  "channel new event emits on first active model"
);

assert.equal(
  resolveChannelNewEvent(
    channelEventTime,
    channelEventNewModel,
    channelEventNewModel
  ),
  null,
  "channel new event does not emit when unchanged"
);

assert.equal(
  resolveChannelNewEvent(
    channelEventTime,
    channelEventNewModel,
    channelEventRebuiltModel
  ),
  "[CHANNEL][NEW][H1][UP] time=2026-05-31T12:34:56Z anchors=2000@100,2010@110 offsetPctl=85 offset=5.00 mid=2.50",
  "channel new event emits when rebuilt id changes"
);

assert.equal(
  formatChannelInvalidEvent(channelEventTime, channelEventInvalidModel),
  `[CHANNEL][INVALID][H1][${channelEventInvalidModel.id}] time=2026-05-31T12:34:56Z reason=ttl_expired endTime=2026-05-25T12:34:56Z`,
  "channel invalid event string format is exact"
);

assert.equal(
  resolveChannelInvalidEvent(
    channelEventTime,
    channelEventNewModel,
    channelEventInvalidModel
  ),
  `[CHANNEL][INVALID][H1][${channelEventInvalidModel.id}] time=2026-05-31T12:34:56Z reason=ttl_expired endTime=2026-05-25T12:34:56Z`,
  "channel invalid event emits on active to inactive"
);

assert.equal(
  resolveChannelInvalidEvent(
    channelEventTime,
    channelEventInvalidModel,
    channelEventInvalidModel
  ),
  null,
  "channel invalid event does not repeat on unchanged inactive model"
);

assert.equal(
  formatChannelUpdateEvent(
    channelEventTime,
    channelUpdateNextModel,
    0.5
  ),
  `[UPDATE][H1][CHANNEL][UP] id=${channelUpdateNextModel.id} reason=geometry lower=110.0 upper=116.0 offset=6.0`,
  "channel update event string format is exact"
);

assert.equal(
  shouldEmitChannelUpdateEvent({
    prevModel: channelUpdatePrevModel,
    nextModel: channelUpdateNextModel,
    tickSize: 0.5,
  }),
  true,
  "channel update emits when same-id source-local geometry changes by at least one tick"
);

assert.equal(
  resolveChannelUpdateEvent({
    time: channelEventTime,
    prevModel: channelUpdatePrevModel,
    nextModel: {
      ...channelUpdatePrevModel,
      lastUpdatedAt: channelEventTime + 60_000,
    },
    tickSize: 0.5,
  }),
  null,
  "channel update does not emit on pure time progression"
);

assert.equal(
  resolveChannelUpdateEvent({
    time: channelEventTime,
    prevModel: channelUpdatePrevModel,
    nextModel: channelUpdateModeChangedModel,
    tickSize: 0.5,
    suppressForModeChange: true,
  }),
  null,
  "channel mode change suppresses update event even if geometry also changed"
);

assert.equal(
  resolveChannelUpdateEvent({
    time: channelEventTime,
    prevModel: channelUpdatePrevModel,
    nextModel: channelEventRebuiltModel,
    tickSize: 0.5,
  }),
  null,
  "channel rebuilt id change is new object not update"
);

assert.equal(
  formatChannelPoiEvent(channelEventPoi.createdAt, channelEventPoi),
  `[CHANNEL][POI][H1][BULL] time=${new Date(channelEventPoi.createdAt).toISOString().replace(".000Z", "Z")} boundary=100 triggers=sweepRec|structure|disp`,
  "channel poi event string format is exact"
);

assert.equal(
  shouldEmitChannelPoiEvent(undefined, channelEventPoi),
  true,
  "channel poi event emits on first active poi"
);

assert.equal(
  resolveChannelPoiEvent(
    channelEventPoi.createdAt,
    channelEventPoi,
    channelEventPoi
  ),
  null,
  "channel poi event does not emit when unchanged"
);

assert.deepEqual(
  {
    all: [...TrendlineConstants.TRENDLINE_TFS],
    model: [...TrendlineConstants.TRENDLINE_MODEL_TFS],
    reaction: [...TrendlineConstants.TRENDLINE_REACTION_TFS],
  },
  {
    all: ["D1", "H4", "H1", "M30", "M15", "M5"],
    model: ["D1", "H4", "H1", "M30"],
    reaction: ["M15", "M5"],
  },
  "trendline tf sets"
);

assert.deepEqual(
  {
    types: [...TrendlineConstants.TRENDLINE_TYPES],
    states: [...TrendlineConstants.LINE_STATES],
    invalids: [...TrendlineConstants.TRENDLINE_INVALID_REASONS],
  },
  {
    types: ["TL_SUPPORT", "TL_RESIST"],
    states: ["ACTIVE", "INACTIVE", "DELETED"],
    invalids: ["break_confirmed", "stale_expired", "pruned_by_limit"],
  },
  "trendline type state invalid enums"
);

assert.deepEqual(
  {
    pivots: [...TrendlineConstants.TRENDLINE_PIVOT_TYPES],
    structures: [...TrendlineConstants.TRENDLINE_STRUCTURE_STATES],
    bestKinds: [...TrendlineConstants.TRENDLINE_BEST_MATCH_KINDS],
    poiReasons: [...TrendlineConstants.TRENDLINE_POI_CANDIDATE_REASONS],
  },
  {
    pivots: ["HIGH", "LOW"],
    structures: ["UP", "DOWN", "MIXED"],
    bestKinds: ["OB", "FVG", "CHANNEL", "NONE"],
    poiReasons: ["roleFlip", "collab"],
  },
  "trendline pivot structure bestmatch poi enums"
);

assert.deepEqual(
  {
    d1: TrendlineConstants.LOOKBACK_D1,
    h4: TrendlineConstants.LOOKBACK_H4,
    h1: TrendlineConstants.LOOKBACK_H1,
    m30: TrendlineConstants.LOOKBACK_M30,
  },
  {
    d1: 300,
    h4: 400,
    h1: 300,
    m30: 200,
  },
  "trendline lookback constants"
);

assert.deepEqual(
  {
    d1: TrendlineConstants.MIN_SWING_ATR_D1,
    h4: TrendlineConstants.MIN_SWING_ATR_H4,
    h1: TrendlineConstants.MIN_SWING_ATR_H1,
    m30: TrendlineConstants.MIN_SWING_ATR_M30,
    mixedMult: TrendlineConstants.MIXED_SWING_MULT,
    mixedRiskTag: TrendlineConstants.MIXED_RISK_TAG,
    mixedBreakCount: TrendlineConstants.MIXED_BREAK_COUNT,
  },
  {
    d1: 0.5,
    h4: 0.4,
    h1: 0.3,
    m30: 0.25,
    mixedMult: 1.4,
    mixedRiskTag: "TL_MIXED_RISK",
    mixedBreakCount: 1,
  },
  "trendline minswing and mixed constants"
);

assert.deepEqual(
  {
    d1Forward: TrendlineConstants.MAX_FORWARD_BARS_D1,
    h4Forward: TrendlineConstants.MAX_FORWARD_BARS_H4,
    h1Forward: TrendlineConstants.MAX_FORWARD_BARS_H1,
    m30Forward: TrendlineConstants.MAX_FORWARD_BARS_M30,
    d1BreakCloses: TrendlineConstants.BREAK_CLOSES_D1,
    h4BreakCloses: TrendlineConstants.BREAK_CLOSES_H4,
    h1BreakCloses: TrendlineConstants.BREAK_CLOSES_H1,
    m30BreakCloses: TrendlineConstants.BREAK_CLOSES_M30,
    d1BreakAtr: TrendlineConstants.BREAK_MARGIN_ATR_D1,
    h4BreakAtr: TrendlineConstants.BREAK_MARGIN_ATR_H4,
    h1BreakAtr: TrendlineConstants.BREAK_MARGIN_ATR_H1,
    m30BreakAtr: TrendlineConstants.BREAK_MARGIN_ATR_M30,
  },
  {
    d1Forward: 300,
    h4Forward: 250,
    h1Forward: 150,
    m30Forward: 100,
    d1BreakCloses: 2,
    h4BreakCloses: 2,
    h1BreakCloses: 1,
    m30BreakCloses: 1,
    d1BreakAtr: 0.2,
    h4BreakAtr: 0.2,
    h1BreakAtr: 0.25,
    m30BreakAtr: 0.3,
  },
  "trendline maxforward and break constants"
);

assert.deepEqual(
  {
    roleFlipTouchMargin: TrendlineConstants.ROLE_FLIP_TOUCH_MARGIN_ATR,
    roleFlipWindow: TrendlineConstants.ROLE_FLIP_CONFIRM_WINDOW_BARS,
    roleFlipTag: TrendlineConstants.ROLE_FLIP_TAG,
    d1Ok: TrendlineConstants.CONTEXT_OK_ATR_D1,
    d1Tight: TrendlineConstants.CONTEXT_TIGHT_ATR_D1,
    h4Ok: TrendlineConstants.CONTEXT_OK_ATR_H4,
    h4Tight: TrendlineConstants.CONTEXT_TIGHT_ATR_H4,
    h1Ok: TrendlineConstants.CONTEXT_OK_ATR_H1,
    h1Tight: TrendlineConstants.CONTEXT_TIGHT_ATR_H1,
    m30Ok: TrendlineConstants.CONTEXT_OK_ATR_M30,
    m30Tight: TrendlineConstants.CONTEXT_TIGHT_ATR_M30,
    poiOkTag: TrendlineConstants.TL_COLLAB_POI_OK,
    poiTightTag: TrendlineConstants.TL_COLLAB_POI_TIGHT,
    channelTightTag: TrendlineConstants.TL_COLLAB_CHANNEL_TIGHT,
  },
  {
    roleFlipTouchMargin: 0.15,
    roleFlipWindow: 2,
    roleFlipTag: "TL_ROLE_FLIP",
    d1Ok: 0.3,
    d1Tight: 0.12,
    h4Ok: 0.25,
    h4Tight: 0.1,
    h1Ok: 0.2,
    h1Tight: 0.08,
    m30Ok: 0.15,
    m30Tight: 0.06,
    poiOkTag: "TL_COLLAB_POI_OK",
    poiTightTag: "TL_COLLAB_POI_TIGHT",
    channelTightTag: "TL_COLLAB_CHANNEL_TIGHT",
  },
  "trendline roleflip context and collab tags"
);

assert.deepEqual(
  {
    h1: TrendlineConstants.DAILY_CAP_H1_POI,
    m30: TrendlineConstants.DAILY_CAP_M30_POI,
  },
  {
    h1: 2,
    m30: 2,
  },
  "trendline daily caps"
);

assert.equal(
  TrendlineConstants.TRENDLINE_PIVOT_LEN,
  3,
  "trendline pivot len constant"
);

assert.deepEqual(
  {
    d1: isTrendlinePivotTf("D1"),
    h4: isTrendlinePivotTf("H4"),
    h1: isTrendlinePivotTf("H1"),
    m30: isTrendlinePivotTf("M30"),
    m15: isTrendlinePivotTf("M15"),
  },
  {
    d1: true,
    h4: true,
    h1: true,
    m30: true,
    m15: false,
  },
  "trendline pivot tf predicate"
);

assert.deepEqual(
  detectConfirmedTrendlinePivotAtIndex(
    trendlineHighPivotBars,
    "HIGH",
    3
  ),
  {
    tf: "H4",
    pivotType: "HIGH",
    pivotTime: trendlineHighPivotBars[3].closeTime,
    pivotPrice: 110,
    confirmedAt: trendlineHighPivotBars[6].closeTime,
    isConfirmed: true,
  },
  "trendline detects confirmed high pivot at index"
);

assert.deepEqual(
  detectConfirmedTrendlinePivotAtIndex(
    trendlineLowPivotBars,
    "LOW",
    3
  ),
  {
    tf: "H1",
    pivotType: "LOW",
    pivotTime: trendlineLowPivotBars[3].closeTime,
    pivotPrice: 90,
    confirmedAt: trendlineLowPivotBars[6].closeTime,
    isConfirmed: true,
  },
  "trendline detects confirmed low pivot at index"
);

assert.equal(
  detectConfirmedTrendlinePivotAtIndex(
    trendlineHighPivotBars.slice(0, 6),
    "HIGH",
    3
  ),
  null,
  "trendline does not detect pivot before p+3 close"
);

assert.deepEqual(
  detectNewlyConfirmedTrendlinePivot(
    trendlineHighPivotBars,
    "HIGH"
  ),
  {
    tf: "H4",
    pivotType: "HIGH",
    pivotTime: trendlineHighPivotBars[3].closeTime,
    pivotPrice: 110,
    confirmedAt: trendlineHighPivotBars[6].closeTime,
    isConfirmed: true,
  },
  "trendline newly confirmed high pivot on current close"
);

assert.deepEqual(
  detectNewlyConfirmedTrendlinePivot(
    trendlineLowPivotBars,
    "LOW"
  ),
  {
    tf: "H1",
    pivotType: "LOW",
    pivotTime: trendlineLowPivotBars[3].closeTime,
    pivotPrice: 90,
    confirmedAt: trendlineLowPivotBars[6].closeTime,
    isConfirmed: true,
  },
  "trendline newly confirmed low pivot on current close"
);

assert.deepEqual(
  appendTrendlinePivotKeepingLast3(
    trendlinePivotBaseHistory,
    trendlinePivotNewHigh
  ),
  [
    trendlinePivotBaseHistory[1],
    trendlinePivotBaseHistory[2],
    trendlinePivotNewHigh,
  ],
  "trendline pivot append keeps latest three"
);

assert.deepEqual(
  appendTrendlinePivotKeepingLast3(
    trendlinePivotBaseHistory,
    trendlinePivotDuplicateHigh
  ),
  trendlinePivotBaseHistory,
  "trendline pivot append ignores duplicate"
);

assert.deepEqual(
  {
    d1: isTrendlineStructureTf("D1"),
    h4: isTrendlineStructureTf("H4"),
    h1: isTrendlineStructureTf("H1"),
    m30: isTrendlineStructureTf("M30"),
    m15: isTrendlineStructureTf("M15"),
  },
  {
    d1: true,
    h4: true,
    h1: true,
    m30: true,
    m15: false,
  },
  "trendline structure tf predicate"
);

assert.deepEqual(
  takeLatestConfirmedTrendlinePivots(
    trendlineHighsWithExtra,
    "HIGH"
  ),
  [
    trendlineStructureHighsUp[1],
    trendlineStructureHighsUp[2],
    trendlineHighsWithExtra[3],
  ],
  "trendline structure latest confirmed pivots keep last three"
);

assert.equal(
  evaluateTrendlineStructureState(
    trendlineStructureHighsUp.slice(0, 2),
    trendlineStructureLowsUp
  ),
  "MIXED",
  "trendline structure is mixed when pivots are insufficient"
);

assert.equal(
  evaluateTrendlineStructureState(
    trendlineStructureHighsUp,
    trendlineStructureLowsUp
  ),
  "UP",
  "trendline structure detects up state"
);

assert.equal(
  evaluateTrendlineStructureState(
    trendlineStructureHighsDown,
    trendlineStructureLowsDown
  ),
  "DOWN",
  "trendline structure detects down state"
);

assert.equal(
  evaluateTrendlineStructureState(
    trendlineStructureHighsUp,
    trendlineStructureLowsMixed
  ),
  "MIXED",
  "trendline structure detects mixed on split signals"
);

assert.deepEqual(
  buildTrendlineStructureSnapshot({
    tf: "H4",
    time: 2000,
    highs: trendlineHighsWithExtra,
    lows: trendlineStructureLowsUp,
  }),
  {
    tf: "H4",
    time: 2000,
    state: "UP",
    lastHighs: [
      trendlineStructureHighsUp[1],
      trendlineStructureHighsUp[2],
      trendlineHighsWithExtra[3],
    ],
    lastLows: trendlineStructureLowsUp,
  },
  "trendline structure snapshot trims pivots and computes state"
);

assert.equal(
  buildTrendlineStructureSnapshot({
    tf: "M15",
    time: 2000,
    highs: trendlineStructureHighsUp,
    lows: trendlineStructureLowsUp,
  }),
  null,
  "trendline structure snapshot rejects non-model tf"
);

assert.deepEqual(
  {
    d1: isTrendlineDetectTf("D1"),
    h4: isTrendlineDetectTf("H4"),
    h1: isTrendlineDetectTf("H1"),
    m30: isTrendlineDetectTf("M30"),
    m15: isTrendlineDetectTf("M15"),
    lookbackH4: getTrendlineLookbackBars("H4"),
    minSwingH4: getTrendlineMinSwingAtrMultiplier("H4"),
    maxForwardH4: getTrendlineMaxForwardBars("H4"),
  },
  {
    d1: true,
    h4: true,
    h1: true,
    m30: true,
    m15: false,
    lookbackH4: 400,
    minSwingH4: 0.4,
    maxForwardH4: 250,
  },
  "trendline detect tf and per-tf config"
);

assert.deepEqual(
  selectAnchorsWithinLookback({
    tf: "H4",
    currentCloseTime: 1000,
    pivots: trendlineStructureLowsUp,
    pivotType: "LOW",
    atrAtAnchor2: 10,
    structureState: "UP",
  }),
  [trendlineStructureLowsUp[1], trendlineStructureLowsUp[2]],
  "trendline detect selects latest two anchors by default"
);

assert.deepEqual(
  selectAnchorsWithinLookback({
    tf: "H4",
    currentCloseTime: 1000,
    pivots: trendlineFallbackLowPivots,
    pivotType: "LOW",
    atrAtAnchor2: 10,
    structureState: "UP",
  }),
  [trendlineFallbackLowPivots[0], trendlineFallbackLowPivots[2]],
  "trendline detect falls back to older anchor when latest pair fails"
);

assert.equal(
  selectAnchorsWithinLookback({
    tf: "D1",
    currentCloseTime: 400 * 24 * 60 * 60 * 1000,
    pivots: trendlineOutOfLookbackLows,
    pivotType: "LOW",
    atrAtAnchor2: 10,
    structureState: "UP",
  }),
  null,
  "trendline detect returns null when pivots are out of lookback"
);

assert.equal(
  checkTrendlineMinSwing({
    tf: "H1",
    a1: trendlineMixedSwingLowA,
    a2: trendlineMixedSwingLowB,
    atrAtA2: 10,
    structureState: "MIXED",
  }),
  false,
  "trendline detect strengthens minSwing in mixed state"
);

assert.deepEqual(
  createTrendlineFromAnchors({
    symbol: "btcusdt",
    tf: "H4",
    type: "TL_SUPPORT",
    a1: trendlineStructureLowsUp[1],
    a2: trendlineStructureLowsUp[2],
    structureState: "UP",
  }),
  {
    id: "BTCUSDT:TL:H4:TL_SUPPORT:320:95:520:100",
    symbol: "BTCUSDT",
    tf: "H4",
    type: "TL_SUPPORT",
    state: "ACTIVE",
    a1Time: 320,
    a1Price: 95,
    a2Time: 520,
    a2Price: 100,
    createdAt: 620,
    lastUpdatedAt: 620,
    touchCount: 0,
    breakStreak: 0,
    roleFlipCount: 0,
    tags: [],
    bestMatch: { kind: "NONE" },
    maxForwardBars: 250,
    displayUntil: getTrendlineDisplayUntil("H4", 620),
  },
  "trendline detect creates trendline object exactly"
);

assert.deepEqual(
  detectTrendlineCandidates({
    symbol: "BTCUSDT",
    tf: "D1",
    currentCloseTime: 1000,
    structureState: "UP",
    highs: trendlineDetectD1HighsUp,
    lows: trendlineDetectD1LowsUp,
    atrAtHighAnchor2: 10,
    atrAtLowAnchor2: 10,
  }).map((line) => line.type),
  ["TL_SUPPORT"],
  "trendline detect d1 up creates support only"
);

assert.deepEqual(
  detectTrendlineCandidates({
    symbol: "BTCUSDT",
    tf: "D1",
    currentCloseTime: 1000,
    structureState: "MIXED",
    highs: trendlineDetectD1HighsUp,
    lows: trendlineDetectD1LowsUp,
    atrAtHighAnchor2: 10,
    atrAtLowAnchor2: 10,
  }).map((line) => ({
    type: line.type,
    tags: line.tags,
  })),
  [
    { type: "TL_SUPPORT", tags: ["TL_MIXED_RISK"] },
    { type: "TL_RESIST", tags: ["TL_MIXED_RISK"] },
  ],
  "trendline detect d1 mixed creates both with mixed risk tag"
);

assert.deepEqual(
  detectTrendlineCandidates({
    symbol: "BTCUSDT",
    tf: "H1",
    currentCloseTime: 1000,
    structureState: "MIXED",
    highs: trendlineDetectH1Highs,
    lows: trendlineDetectH1Lows,
    atrAtHighAnchor2: 10,
    atrAtLowAnchor2: 10,
  }).map((line) => ({
    type: line.type,
    tags: line.tags,
  })),
  [
    { type: "TL_SUPPORT", tags: ["TL_MIXED_RISK"] },
    { type: "TL_RESIST", tags: ["TL_MIXED_RISK"] },
  ],
  "trendline detect h1 mixed creates both with mixed risk tag"
);

assert.deepEqual(
  detectTrendlineCandidates({
    symbol: "BTCUSDT",
    tf: "M15",
    currentCloseTime: 1000,
    structureState: "UP",
    highs: trendlineDetectH1Highs,
    lows: trendlineDetectH1Lows,
    atrAtHighAnchor2: 10,
    atrAtLowAnchor2: 10,
  }),
  [],
  "trendline detect returns no candidates for non-model tf"
);

assert.deepEqual(
  {
    d1: isTrendlineLifecycleTf("D1"),
    h4: isTrendlineLifecycleTf("H4"),
    h1: isTrendlineLifecycleTf("H1"),
    m30: isTrendlineLifecycleTf("M30"),
    m15: isTrendlineLifecycleTf("M15"),
    d1Rule: getTrendlineBreakRule("D1", "UP"),
    h1Rule: getTrendlineBreakRule("H1", "UP"),
    d1MixedRule: getTrendlineBreakRule("D1", "MIXED"),
  },
  {
    d1: true,
    h4: true,
    h1: true,
    m30: true,
    m15: false,
    d1Rule: { requiredCloses: 2, atrMultiplier: 0.2 },
    h1Rule: { requiredCloses: 1, atrMultiplier: 0.25 },
    d1MixedRule: { requiredCloses: 1, atrMultiplier: 0.2 },
  },
  "trendline lifecycle tf and break rules"
);

assert.deepEqual(
  evaluateTrendlineTouchAtBar({
    line: trendlineFlatSupportH4,
    bar: trendlineSupportTouchBar,
    atrAtBar: 10,
  }),
  {
    tf: "H4",
    currentCloseTime: trendlineSupportTouchBar.closeTime,
    linePrice: 100,
    touchMargin: 1.5,
    touched: true,
  },
  "trendline support touch passes within margin"
);

assert.deepEqual(
  evaluateTrendlineTouchAtBar({
    line: trendlineFlatResistH1,
    bar: trendlineResistTouchBar,
    atrAtBar: 10,
  }),
  {
    tf: "H1",
    currentCloseTime: trendlineResistTouchBar.closeTime,
    linePrice: 100,
    touchMargin: 1.5,
    touched: true,
  },
  "trendline resist touch passes within margin"
);

assert.deepEqual(
  evaluateTrendlineBreakAtBar({
    line: trendlineFlatSupportD1,
    tfBars: trendlineD1BreakBars,
    currentIndex: 1,
    atrAtBar: 10,
    structureState: "UP",
  }),
  {
    tf: "D1",
    currentCloseTime: trendlineD1BreakBars[1].closeTime,
    requiredCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    breakCount: 2,
    linePrice: 100,
    closeDeviation: 2.5,
    breakCandidate: true,
    breakConfirmed: true,
  },
  "trendline d1 support break confirms with two closes"
);

assert.deepEqual(
  evaluateTrendlineBreakAtBar({
    line: trendlineFlatResistH1,
    tfBars: trendlineH1BreakBars,
    currentIndex: 0,
    atrAtBar: 10,
    structureState: "DOWN",
  }),
  {
    tf: "H1",
    currentCloseTime: trendlineH1BreakBars[0].closeTime,
    requiredCloses: 1,
    atrAtBar: 10,
    atrMultiplier: 0.25,
    breakCount: 1,
    linePrice: 100,
    closeDeviation: 2.5999999999999943,
    breakCandidate: true,
    breakConfirmed: true,
  },
  "trendline h1 resist break confirms with one close"
);

assert.deepEqual(
  evaluateTrendlineBreakAtBar({
    line: trendlineFlatSupportD1,
    tfBars: trendlineMixedD1BreakBars,
    currentIndex: 0,
    atrAtBar: 10,
    structureState: "MIXED",
  }),
  {
    tf: "D1",
    currentCloseTime: trendlineMixedD1BreakBars[0].closeTime,
    requiredCloses: 1,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    breakCount: 1,
    linePrice: 100,
    closeDeviation: 2.0999999999999943,
    breakCandidate: true,
    breakConfirmed: true,
  },
  "trendline mixed lowers break count to one"
);

assert.deepEqual(
  evaluateTrendlineBreakAtBar({
    line: trendlineFlatSupportD1,
    tfBars: trendlineExactThresholdBars,
    currentIndex: 0,
    atrAtBar: 10,
    structureState: "UP",
  }),
  {
    tf: "D1",
    currentCloseTime: trendlineExactThresholdBars[0].closeTime,
    requiredCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    breakCount: 0,
    linePrice: 100,
    closeDeviation: 2,
    breakCandidate: false,
    breakConfirmed: false,
  },
  "trendline exact-threshold close does not break"
);

assert.deepEqual(
  evaluateTrendlineStaleExpiration(
    trendlineFlatSupportH4,
    trendlineFlatSupportH4.displayUntil!
  ),
  {
    currentCloseTime: trendlineFlatSupportH4.displayUntil!,
    displayUntil: trendlineFlatSupportH4.displayUntil!,
    staleExpired: false,
  },
  "trendline stale equality is not expired"
);

assert.deepEqual(
  evaluateTrendlineStaleExpiration(
    trendlineFlatSupportH4,
    trendlineFlatSupportH4.displayUntil! + 1
  ),
  {
    currentCloseTime: trendlineFlatSupportH4.displayUntil! + 1,
    displayUntil: trendlineFlatSupportH4.displayUntil!,
    staleExpired: true,
  },
  "trendline stale expires after displayUntil"
);

assert.deepEqual(
  applyTrendlineTouchAndBreakStats({
    line: trendlineFlatSupportH4,
    touchEval: evaluateTrendlineTouchAtBar({
      line: trendlineFlatSupportH4,
      bar: trendlineSupportTouchBar,
      atrAtBar: 10,
    }),
    breakEval: {
      tf: "H4",
      currentCloseTime: trendlineSupportTouchBar.closeTime,
      requiredCloses: 2,
      atrAtBar: 10,
      atrMultiplier: 0.2,
      breakCount: 1,
      linePrice: 100,
      closeDeviation: 1,
      breakCandidate: true,
      breakConfirmed: false,
    },
  }),
  {
    ...trendlineFlatSupportH4,
    touchCount: 1,
    lastTouchTime: trendlineSupportTouchBar.closeTime,
    breakStreak: 1,
    lastBreakTime: trendlineSupportTouchBar.closeTime,
  },
  "trendline touch and break stats update counts and timestamps"
);

assert.deepEqual(
  applyTrendlineLifecycleInvalidation({
    line: trendlineFlatSupportD1,
    currentCloseTime: trendlineD1BreakBars[1].closeTime,
    breakEval: evaluateTrendlineBreakAtBar({
      line: trendlineFlatSupportD1,
      tfBars: trendlineD1BreakBars,
      currentIndex: 1,
      atrAtBar: 10,
      structureState: "UP",
    }),
  }),
  {
    ...trendlineFlatSupportD1,
    state: "INACTIVE",
    invalidReason: "break_confirmed",
    endTime: trendlineD1BreakBars[1].closeTime,
  },
  "trendline lifecycle invalidates on confirmed break"
);

assert.deepEqual(
  applyTrendlineLifecycleInvalidation({
    line: trendlineFlatSupportH4,
    currentCloseTime: trendlineFlatSupportH4.displayUntil! + 1,
    staleEval: evaluateTrendlineStaleExpiration(
      trendlineFlatSupportH4,
      trendlineFlatSupportH4.displayUntil! + 1
    ),
  }),
  {
    ...trendlineFlatSupportH4,
    state: "INACTIVE",
    invalidReason: "stale_expired",
    endTime: trendlineFlatSupportH4.displayUntil! + 1,
  },
  "trendline lifecycle invalidates on stale expiry"
);

assert.deepEqual(
  {
    supportToResist: getTrendlineRoleFlipOppositeType("TL_SUPPORT"),
    resistToSupport: getTrendlineRoleFlipOppositeType("TL_RESIST"),
  },
  {
    supportToResist: "TL_RESIST",
    resistToSupport: "TL_SUPPORT",
  },
  "trendline role flip opposite type helper"
);

assert.equal(
  shouldStartTrendlineRoleFlipWatch(
    trendlineRoleFlipSupportLine,
    trendlineRoleFlipBreakCandidateH4
  ),
  true,
  "trendline role flip starts watch on breakCandidate"
);

const trendlineRoleFlipWatchStarted = applyTrendlineRoleFlip({
  line: trendlineRoleFlipSupportLine,
  bar: {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 18, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 18, 3, 59, 59),
    open: 100,
    high: 101,
    low: 97,
    close: 98,
    volume: 0,
  },
  breakEval: trendlineRoleFlipBreakCandidateH4,
});

assert.deepEqual(
  applyTrendlineRoleFlip({
    line: trendlineRoleFlipWatchStarted,
    bar: trendlineRoleFlipBarSupportTouch,
    touchEval: trendlineRoleFlipTouchH4,
  }),
  {
    ...trendlineRoleFlipWatchStarted,
    roleFlipWatch: {
      startedAt: trendlineRoleFlipBreakCandidateH4.currentCloseTime,
      typeBefore: "TL_SUPPORT",
      touchSeen: true,
      touchTime: trendlineRoleFlipBarSupportTouch.closeTime,
      barsSinceTouch: 0,
    },
  },
  "trendline role flip touch sets touchTime and barsSinceTouch zero"
);

const trendlineRoleFlipTouched = applyTrendlineRoleFlip({
  line: trendlineRoleFlipWatchStarted,
  bar: trendlineRoleFlipBarSupportTouch,
  touchEval: trendlineRoleFlipTouchH4,
});

assert.deepEqual(
  applyTrendlineRoleFlip({
    line: trendlineRoleFlipTouched,
    bar: {
      tf: "H4",
      openTime: Date.UTC(2026, 5, 18, 8, 0, 0),
      closeTime: Date.UTC(2026, 5, 18, 11, 59, 59),
      open: 101,
      high: 102,
      low: 100,
      close: 101,
      volume: 0,
    },
  }),
  {
    ...trendlineRoleFlipTouched,
    roleFlipWatch: {
      ...trendlineRoleFlipTouched.roleFlipWatch!,
      barsSinceTouch: 1,
    },
  },
  "trendline role flip increments barsSinceTouch after touch"
);

assert.deepEqual(
  applyTrendlineRoleFlip({
    line: trendlineRoleFlipTouched,
    bar: trendlineRoleFlipBarSupportConfirm,
  }),
  {
    ...trendlineRoleFlipTouched,
    type: "TL_RESIST",
    roleFlipCount: 1,
    tags: ["TL_ROLE_FLIP"],
    roleFlipWatch: undefined,
  },
  "trendline role flip confirms support to resist within window"
);

const trendlineRoleFlipResistWatchStarted = applyTrendlineRoleFlip({
  line: trendlineRoleFlipResistLine,
  bar: {
    tf: "H1",
    openTime: Date.UTC(2026, 5, 19, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 19, 0, 59, 59),
    open: 100,
    high: 103,
    low: 99,
    close: 102,
    volume: 0,
  },
  breakEval: trendlineRoleFlipBreakCandidateH1,
});

const trendlineRoleFlipResistTouched = applyTrendlineRoleFlip({
  line: trendlineRoleFlipResistWatchStarted,
  bar: trendlineRoleFlipBarResistTouch,
  touchEval: trendlineRoleFlipTouchH1,
});

assert.deepEqual(
  applyTrendlineRoleFlip({
    line: trendlineRoleFlipResistTouched,
    bar: trendlineRoleFlipBarResistConfirm,
  }),
  {
    ...trendlineRoleFlipResistTouched,
    type: "TL_SUPPORT",
    roleFlipCount: 1,
    tags: ["TL_ROLE_FLIP"],
    roleFlipWatch: undefined,
  },
  "trendline role flip confirms resist to support within window"
);

assert.deepEqual(
  applyTrendlineRoleFlip({
    line: trendlineRoleFlipExpiredWatchLine,
    bar: trendlineRoleFlipExpiredBar,
  }),
  {
    ...trendlineRoleFlipExpiredWatchLine,
    roleFlipWatch: undefined,
  },
  "trendline role flip clears expired watch after window"
);

assert.deepEqual(
  applyTrendlineRoleFlip({
    line: trendlineRoleFlipTaggedLine,
    bar: {
      tf: "H4",
      openTime: Date.UTC(2026, 5, 21, 4, 0, 0),
      closeTime: Date.UTC(2026, 5, 21, 7, 59, 59),
      open: 100,
      high: 101,
      low: 97,
      close: 99,
      volume: 0,
    },
  }),
  {
    ...trendlineRoleFlipTaggedLine,
    type: "TL_RESIST",
    roleFlipCount: 1,
    tags: ["TL_ROLE_FLIP"],
    roleFlipWatch: undefined,
  },
  "trendline role flip does not duplicate tag"
);

assert.equal(
  applyTrendlineRoleFlip({
    line: trendlineRoleFlipInactiveLine,
    bar: trendlineRoleFlipBarSupportConfirm,
    breakEval: trendlineRoleFlipBreakCandidateH4,
  }),
  trendlineRoleFlipInactiveLine,
  "trendline role flip ignores inactive line"
);

assert.deepEqual(
  {
    obSameLayer: isEligibleObForTrendlineCollab(
      trendlineFlatSupportD1,
      trendlineCollabD1ObOk
    ),
    obWrongLayer: isEligibleObForTrendlineCollab(
      trendlineFlatSupportD1,
      trendlineCollabH4ObWrongLayer
    ),
    fvgSameLayer: isEligibleFvgForTrendlineCollab(
      trendlineFlatSupportD1,
      trendlineCollabD1FvgTight
    ),
    fvgStack: isEligibleFvgForTrendlineCollab(
      trendlineFlatSupportD1,
      obCollabFvgStackExcluded
    ),
    channelSameTf: isEligibleChannelForTrendlineCollab(
      trendlineFlatSupportD1,
      trendlineCollabD1ChannelTight
    ),
    channelWrongTf: isEligibleChannelForTrendlineCollab(
      trendlineFlatSupportD1,
      trendlineCollabH1ChannelTight
    ),
  },
  {
    obSameLayer: true,
    obWrongLayer: false,
    fvgSameLayer: true,
    fvgStack: false,
    channelSameTf: true,
    channelWrongTf: false,
  },
  "trendline collab layer and active filters"
);

assert.deepEqual(
  {
    inside: computeTrendlineDistanceToZone(101, {
      bottom: 100,
      top: 102,
      height: 2,
    }),
    outside: computeTrendlineDistanceToZone(97, {
      bottom: 100,
      top: 102,
      height: 2,
    }),
    ticks: computeTrendlineDistanceTicks(0.31, 0.1),
  },
  {
    inside: 0,
    outside: 3,
    ticks: 4,
  },
  "trendline collab distance and ticks formula"
);

assert.deepEqual(
  {
    ok: getTrendlinePoiCollabTag("D1", 0.3),
    tight: getTrendlinePoiCollabTag("D1", 0.12),
    none: getTrendlinePoiCollabTag("D1", 0.31),
  },
  {
    ok: "TL_COLLAB_POI_OK",
    tight: "TL_COLLAB_POI_TIGHT",
    none: null,
  },
  "trendline collab poi tag thresholds"
);

assert.deepEqual(
  {
    supportDist: computeTrendlineChannelBoundaryDistance(
      trendlineFlatSupportD1,
      trendlineCollabD1ChannelTight,
      9999
    ),
    resistDist: computeTrendlineChannelBoundaryDistance(
      trendlineFlatResistH1,
      trendlineCollabH1ChannelDown,
      9999
    ),
    tightTag: getTrendlineChannelCollabTag("H1", 0.08),
    okTag: getTrendlineChannelCollabTag("H1", 0.2),
  },
  {
    supportDist: 0,
    resistDist: 0,
    tightTag: "TL_COLLAB_CHANNEL_TIGHT",
    okTag: null,
  },
  "trendline collab channel distance and tag thresholds"
);

const trendlineBacktrackEndpointLows = [
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 100,
    pivotPrice: 100,
    confirmedAt: 130,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 200,
    pivotPrice: 105,
    confirmedAt: 230,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 300,
    pivotPrice: 103,
    confirmedAt: 330,
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: 400,
    pivotPrice: 102,
    confirmedAt: 430,
    isConfirmed: true,
  },
];

assert.deepEqual(
  selectAnchorsWithinLookback({
    tf: "H4",
    currentCloseTime: 1000,
    pivots: trendlineBacktrackEndpointLows,
    pivotType: "LOW",
    atrAtAnchor2: 10,
    structureState: "UP",
  }),
  [trendlineBacktrackEndpointLows[0], trendlineBacktrackEndpointLows[1]],
  "trendline detect backtracks endpoint pivot when latest endpoint fails"
);

assert.deepEqual(
  {
    roleFlipWins: getTrendlinePoiCandidateReason({
      roleFlipCount: 1,
      hasCollabTag: true,
    }),
    collabFallback: getTrendlinePoiCandidateReason({
      roleFlipCount: 0,
      hasCollabTag: true,
    }),
    none: getTrendlinePoiCandidateReason({
      roleFlipCount: 0,
      hasCollabTag: false,
    }),
  },
  {
    roleFlipWins: "roleFlip",
    collabFallback: "collab",
    none: null,
  },
  "trendline poi candidate reason lock prefers role flip over collab"
);

assert.equal(
  buildTrendlineDailyCapKey("btcusdt", "H1", Date.UTC(2026, 5, 22, 12, 34, 56)),
  "BTCUSDT:H1:2026-06-22",
  "trendline daily cap key uses uppercase symbol and utc date"
);

assert.deepEqual(
  buildTrendlinePoiCandidateEventInput({
    line: {
      ...trendlineFlatSupportH1,
      state: "ACTIVE",
      touchCount: 3,
      roleFlipCount: 1,
      tags: ["TL_COLLAB_POI_TIGHT"],
    },
    currentCloseTime: Date.UTC(2026, 5, 22, 12, 34, 56),
    currentDailyCapCount: 0,
  }),
  {
    tf: "H1",
    id: trendlineFlatSupportH1.id,
    time: Date.UTC(2026, 5, 22, 12, 34, 56),
    reason: "roleFlip",
    touchCount: 3,
  },
  "trendline poi candidate helper emits roleflip reason when cap is open"
);

const trendlinePruneSupportOld = {
  ...trendlineFlatSupportH1,
  id: "TL-PRUNE-SUP-OLD",
  createdAt: 10,
};
const trendlinePruneSupportMid = {
  ...trendlineFlatSupportH1,
  id: "TL-PRUNE-SUP-MID",
  createdAt: 20,
};
const trendlinePruneSupportNew = {
  ...trendlineFlatSupportH1,
  id: "TL-PRUNE-SUP-NEW",
  createdAt: 30,
};
const trendlinePruneResist = {
  ...trendlineFlatResistH1,
  id: "TL-PRUNE-RESIST",
  createdAt: 15,
};

assert.deepEqual(
  applyTrendlinePruneByType({
    lines: [
      trendlinePruneSupportOld,
      trendlinePruneSupportMid,
      trendlinePruneSupportNew,
      trendlinePruneResist,
    ],
    currentCloseTime: 999,
  }),
  {
    active: [
      trendlinePruneSupportMid,
      trendlinePruneSupportNew,
      trendlinePruneResist,
    ],
    pruned: [
      {
        ...trendlinePruneSupportOld,
        state: "INACTIVE",
        invalidReason: "pruned_by_limit",
        endTime: 999,
      },
    ],
  },
  "trendline prune removes oldest active line by type"
);

assert.deepEqual(
  evaluateTrendlineCollab({
    line: trendlineFlatSupportD1,
    currentCloseTime: 9999,
    atrAtBar: 10,
    tick: 0.1,
    obs: [trendlineCollabD1ObOk],
    fvgs: [trendlineCollabD1FvgTight],
    channels: [trendlineCollabD1ChannelTight],
  }),
  {
    tags: [
      "TL_COLLAB_CHANNEL_TIGHT",
      "TL_COLLAB_POI_OK",
      "TL_COLLAB_POI_TIGHT",
    ],
    bestMatch: {
      kind: "CHANNEL",
      id: trendlineCollabD1ChannelTight.id,
      distAtr: 0,
      meta: "TL_COLLAB_CHANNEL_TIGHT",
    },
  },
  "trendline collab bestMatch picks nearest across poi and channel"
);

assert.equal(
  evaluateTrendlineCollab({
    line: trendlineFlatSupportH1,
    currentCloseTime: 9999,
    atrAtBar: 10,
    tick: 0.1,
    obs: [],
    fvgs: [trendlineCollabH1FvgTieOld, trendlineCollabH1FvgTieNew],
    channels: [],
  }).bestMatch.id,
  "TL-COL-H1-FVG-NEW",
  "trendline collab tie uses latest refTime"
);

assert.equal(
  evaluateTrendlineCollab({
    line: trendlineFlatSupportH1,
    currentCloseTime: 9999,
    atrAtBar: 10,
    tick: 0.1,
    obs: [],
    fvgs: [trendlineCollabH1FvgTieIdB, trendlineCollabH1FvgTieIdA],
    channels: [],
  }).bestMatch.id,
  "TL-COL-H1-FVG-A",
  "trendline collab tie uses id asc"
);

assert.deepEqual(
  evaluateTrendlineCollab({
    line: trendlineFlatSupportD1,
    currentCloseTime: 9999,
    atrAtBar: 10,
    tick: 0.1,
    obs: [trendlineCollabD1ObOk, trendlineCollabH4ObWrongLayer],
    fvgs: [
      trendlineCollabD1FvgDirMismatch,
      trendlineCollabD1FvgOtherSymbol,
      obCollabFvgStackExcluded,
    ],
    channels: [trendlineCollabD1ChannelTight, trendlineCollabH1ChannelOtherSymbol],
  }),
  {
    tags: ["TL_COLLAB_CHANNEL_TIGHT", "TL_COLLAB_POI_OK"],
    bestMatch: {
      kind: "CHANNEL",
      id: trendlineCollabD1ChannelTight.id,
      distAtr: 0,
      meta: "TL_COLLAB_CHANNEL_TIGHT",
    },
  },
  "trendline collab aggregate ignores stack dir symbol and layer mismatch"
);

assert.deepEqual(
  evaluateTrendlineCollab({
    line: trendlineFlatSupportD1,
    currentCloseTime: 9999,
    atrAtBar: 10,
    tick: 0.1,
    obs: [trendlineCollabH4ObWrongLayer],
    fvgs: [
      trendlineCollabD1FvgDirMismatch,
      trendlineCollabD1FvgOtherSymbol,
      obCollabFvgStackExcluded,
    ],
    channels: [trendlineCollabH1ChannelOtherSymbol],
  }),
  {
    tags: [],
    bestMatch: { kind: "NONE" },
  },
  "trendline collab returns none when no eligible match exists"
);

assert.equal(
  TrendlineConstants.TRENDLINE_LTF_MICRO_PIVOT_LEN,
  2,
  "trendline ltf micro pivot len constant"
);

assert.deepEqual(
  {
    m15: isTrendlineReactionTf("M15"),
    m5: isTrendlineReactionTf("M5"),
    h1: isTrendlineReactionTf("H1"),
  },
  {
    m15: true,
    m5: true,
    h1: false,
  },
  "trendline reaction tf predicate"
);

assert.equal(
  evaluateTrendlineLtfChochTrigger(
    ltfBullChochBars,
    "BULL",
    0.1
  ),
  true,
  "trendline ltf choch bull uses confirmed micro pivots"
);

assert.equal(
  evaluateTrendlineLtfChochTrigger(
    ltfBearChochBars,
    "BEAR",
    0.1
  ),
  true,
  "trendline ltf choch bear uses confirmed micro pivots"
);

assert.equal(
  evaluateTrendlineSweepRecTriggerNow({
    line: trendlineLtfSupportLine,
    tfBars: trendlineLtfSweepRecSupportBars,
    currentIndex: 2,
    tickSize: 0.1,
  }),
  true,
  "trendline sweepRec support triggers only on recovery bar"
);

assert.equal(
  evaluateTrendlineSweepRecTriggerNow({
    line: trendlineLtfResistLine,
    tfBars: trendlineLtfSweepRecResistBars,
    currentIndex: 2,
    tickSize: 0.1,
  }),
  true,
  "trendline sweepRec resist triggers only on recovery bar"
);

assert.equal(
  evaluateTrendlineSweepRecTriggerNow({
    line: trendlineLtfSupportLine,
    tfBars: trendlineLtfSweepRecCarryBars,
    currentIndex: 3,
    tickSize: 0.1,
  }),
  false,
  "trendline sweepRec does not carry over after recovery bar"
);

assert.equal(
  evaluateTrendlineMicroObRetestTrigger(
    ltfBullMicroObBars,
    "BULL",
    0.1
  ),
  "MR_MICRO_OB",
  "trendline micro ob retest passes"
);

assert.equal(
  evaluateTrendlineMicroFvgRetestTrigger(
    ltfBullMicroFvgBars,
    "BULL",
    0.1
  ),
  "MR_MICRO_FVG",
  "trendline micro fvg retest passes"
);

assert.deepEqual(
  evaluateTrendlineLtfTriggers({
    line: trendlineLtfSupportLine,
    tfBars: trendlineLtfAggregateBars,
    currentIndex: 19,
    tickSize: 0.1,
  }),
  {
    tf: "M15",
    dir: "BULL",
    currentCloseTime: trendlineLtfAggregateBars[19].closeTime,
    choch: true,
    sweepRec: true,
    microRetestTypes: [],
    triggers: ["CHOCH", "SWEEP_REC"],
  },
  "trendline ltf aggregate uses deterministic sorted triggers"
);

assert.equal(
  evaluateTrendlineLtfTriggersFromTfBars({
    line: trendlineLtfSupportLine,
    tfBars: trendlineLtfAggregateBars.slice(0, 13),
    tickSize: 0.1,
  }),
  null,
  "trendline ltf trigger wrapper requires current close atr"
);

assert.deepEqual(
  evaluateTrendlineLtfTriggersFromTfBars({
    line: trendlineLtfSupportLine,
    tfBars: trendlineLtfAggregateBars,
    tickSize: 0.1,
  }),
  {
    tf: "M15",
    dir: "BULL",
    currentCloseTime: trendlineLtfAggregateBars[19].closeTime,
    choch: true,
    sweepRec: true,
    microRetestTypes: [],
    triggers: ["CHOCH", "SWEEP_REC"],
  },
  "trendline ltf trigger wrapper uses current close atr"
);

assert.deepEqual(
  evaluateTrendlineLtfGateFromTfBars({
    line: trendlineLtfSupportLine,
    tfBars: trendlineLtfAggregateBars,
  }),
  {
    tf: "M15",
    dir: "BULL",
    currentCloseTime: trendlineLtfAggregateBars[19].closeTime,
    boundaryPrice: getTrendlineLinePriceAt(
      trendlineLtfSupportLine,
      trendlineLtfAggregateBars[19].closeTime
    ),
    wickExtreme: trendlineLtfAggregateBars[19].low,
    dist: Math.abs(
      trendlineLtfAggregateBars[19].low -
        getTrendlineLinePriceAt(
          trendlineLtfSupportLine,
          trendlineLtfAggregateBars[19].closeTime
        )
    ),
    atrAtBar: 9.722914798468326,
    gateAtrMultiplier: 0.2,
    passGate: true,
  },
  "trendline ltf gate wrapper uses current close atr"
);

assert.equal(
  computeSourceEmissionStage(true, []),
  "NONE",
  "source emission stage is none when recent trigger set is empty"
);

assert.deepEqual(
  advanceSourceEmissionState({
    prev: null,
    ltf: "M5",
    closeTime: Date.UTC(2026, 5, 1, 0, 5, 0),
    poiId: "TL-1",
    gatePass: true,
    currentTriggers: ["CHOCH"],
  }),
  {
    next: {
      stage: "REACTION",
      weakened: false,
      prevBarCloseTime: Date.UTC(2026, 5, 1, 0, 5, 0),
      prevBarTriggers: ["CHOCH"],
    },
    currStage: "REACTION",
    recentTriggers: ["CHOCH"],
    event:
      "[REACTION][M5] time=2026-06-01T00:05:00Z poi=TL-1 triggers=CHOCH",
  },
  "source emission emits reaction on none to reaction edge"
);

assert.deepEqual(
  advanceSourceEmissionState({
    prev: {
      stage: "REACTION",
      weakened: false,
      prevBarCloseTime: Date.UTC(2026, 5, 1, 0, 5, 0),
      prevBarTriggers: ["CHOCH"],
    },
    ltf: "M5",
    closeTime: Date.UTC(2026, 5, 1, 0, 10, 0),
    poiId: "TL-1",
    gatePass: true,
    currentTriggers: ["SWEEP_REC"],
  }),
  {
    next: {
      stage: "ENTRY_WINDOW_OPEN",
      weakened: false,
      prevBarCloseTime: Date.UTC(2026, 5, 1, 0, 10, 0),
      prevBarTriggers: ["SWEEP_REC"],
    },
    currStage: "ENTRY_WINDOW_OPEN",
    recentTriggers: ["CHOCH", "SWEEP_REC"],
    event:
      "[ENTRY_WINDOW_OPEN][M5] time=2026-06-01T00:10:00Z poi=TL-1 triggers=2plus:CHOCH|SWEEP_REC",
  },
  "source emission upgrades reaction to entry window open using k-1 and k triggers"
);

assert.deepEqual(
  advanceSourceEmissionState({
    prev: {
      stage: "ENTRY_WINDOW_OPEN",
      weakened: false,
      prevBarCloseTime: Date.UTC(2026, 5, 1, 0, 10, 0),
      prevBarTriggers: [],
    },
    ltf: "M5",
    closeTime: Date.UTC(2026, 5, 1, 0, 15, 0),
    poiId: "TL-1",
    gatePass: true,
    currentTriggers: ["CHOCH"],
  }),
  {
    next: {
      stage: "REACTION",
      weakened: true,
      prevBarCloseTime: Date.UTC(2026, 5, 1, 0, 15, 0),
      prevBarTriggers: ["CHOCH"],
    },
    currStage: "REACTION",
    recentTriggers: ["CHOCH"],
    event: null,
  },
  "source emission does not emit on entry to reaction degrade and marks weakened"
);

assert.deepEqual(
  advanceSourceEmissionState({
    prev: {
      stage: "ENTRY_WINDOW_OPEN",
      weakened: false,
      prevBarCloseTime: Date.UTC(2026, 5, 1, 0, 10, 0),
      prevBarTriggers: ["CHOCH", "SWEEP_REC"],
    },
    ltf: "M15",
    closeTime: Date.UTC(2026, 5, 1, 0, 15, 0),
    poiId: "TL-2",
    gatePass: true,
    currentTriggers: ["MR_MICRO_OB", "SWEEP_REC"],
  }).event,
  null,
  "source emission suppresses repeated entry window open spam"
);

const trendlineEventRebuiltLine = {
  ...trendlineFlatSupportH4,
  id: "TL-H4-SUP-NEW",
  a1Time: 3000,
  a2Time: 4000,
};

assert.equal(
  formatTrendlineNewEvent(trendlineEventTime, trendlineEventNewLine),
  "[NEW][H4][TRENDLINE][SUPPORT] time=2026-06-22T12:34:56Z anchors=1000@100;2000@100 tags=-",
  "trendline new event string format is exact"
);

assert.equal(
  shouldEmitTrendlineNewEvent(undefined, trendlineEventNewLine),
  true,
  "trendline new event emits on first active line"
);

assert.equal(
  resolveTrendlineNewEvent(
    trendlineEventTime,
    trendlineEventNewLine,
    trendlineEventNewLine
  ),
  null,
  "trendline new event does not emit when unchanged"
);

assert.equal(
  resolveTrendlineNewEvent(
    trendlineEventTime,
    trendlineEventNewLine,
    trendlineEventRebuiltLine
  ),
  "[NEW][H4][TRENDLINE][SUPPORT] time=2026-06-22T12:34:56Z anchors=3000@100;4000@100 tags=-",
  "trendline new event emits when line id changes"
);

assert.equal(
  formatTrendlineTouchEvent(trendlineEventTime, trendlineEventTouchedLine),
  "[TOUCH][H4][TL-H4-SUP] time=2026-06-22T12:34:56Z touchCount=1",
  "trendline touch event string format is exact"
);

assert.equal(
  resolveTrendlineTouchEvent(
    trendlineEventTime,
    trendlineFlatSupportH4,
    trendlineEventTouchedLine
  ),
  "[TOUCH][H4][TL-H4-SUP] time=2026-06-22T12:34:56Z touchCount=1",
  "trendline touch event emits on touchCount increase"
);

assert.equal(
  resolveTrendlineTouchEvent(
    trendlineEventTime,
    trendlineEventTouchedLine,
    trendlineEventTouchedLine
  ),
  null,
  "trendline touch event does not emit when unchanged"
);

assert.equal(
  formatTrendlineRoleFlipEvent(trendlineEventTime, trendlineEventRoleFlipLine),
  "[ROLE_FLIP][H4][TL-H4-SUP] time=2026-06-22T12:34:56Z newType=RESIST",
  "trendline role flip event string format is exact"
);

assert.equal(
  resolveTrendlineRoleFlipEvent(
    trendlineEventTime,
    trendlineFlatSupportH4,
    trendlineEventRoleFlipLine
  ),
  "[ROLE_FLIP][H4][TL-H4-SUP] time=2026-06-22T12:34:56Z newType=RESIST",
  "trendline role flip event emits on type flip"
);

assert.equal(
  formatTrendlineInvalidEvent(trendlineEventTime, trendlineEventInvalidLine),
  "[INVALID][H4][TL-H4-SUP] time=2026-06-22T12:34:56Z reason=break_confirmed endTime=2026-06-22T12:34:56Z",
  "trendline invalid event string format is exact"
);

assert.equal(
  resolveTrendlineInvalidEvent(
    trendlineEventTime,
    trendlineFlatSupportH4,
    trendlineEventInvalidLine
  ),
  "[INVALID][H4][TL-H4-SUP] time=2026-06-22T12:34:56Z reason=break_confirmed endTime=2026-06-22T12:34:56Z",
  "trendline invalid event emits on active to inactive"
);

assert.equal(
  formatTrendlinePoiCandidateEvent(trendlinePoiCandidateInput),
  "[POI_CANDIDATE][H1][TL-H4-SUP] time=2026-06-22T12:34:56Z reason=roleFlip touchCount=3",
  "trendline poi candidate event string format is exact"
);

assert.equal(
  shouldEmitTrendlinePoiCandidateEvent(
    undefined,
    trendlinePoiCandidateInput
  ),
  true,
  "trendline poi candidate event emits on first candidate"
);

assert.equal(
  resolveTrendlinePoiCandidateEvent(
    buildTrendlinePoiCandidateEventKey(trendlinePoiCandidateInput),
    trendlinePoiCandidateInput
  ),
  null,
  "trendline poi candidate event does not emit duplicate key"
);

assert.deepEqual(
  {
    sources: [...PolicyConstants.POLICY_SOURCES],
    eventTypes: [...PolicyConstants.POLICY_EVENT_TYPES],
    dirs: [...PolicyConstants.POLICY_DIRS],
    poiTiers: [...PolicyConstants.POLICY_POI_TIERS],
  },
  {
    sources: ["FVG", "OB", "CHANNEL", "TRENDLINE"],
    eventTypes: ["REACTION", "ENTRY_WINDOW_OPEN"],
    dirs: ["BULL", "BEAR"],
    poiTiers: ["D1_POI", "H4_CORE", "SETUP", "OTHER"],
  },
  "policy source event dir tier enums"
);

assert.deepEqual(
  {
    decisions: [...PolicyConstants.POLICY_DECISIONS],
    riskModes: [...PolicyConstants.POLICY_RISK_MODES],
    regimeStates: [...PolicyConstants.POLICY_REGIME_STATES],
    volStates: [...PolicyConstants.POLICY_VOL_STATES],
    liquidityStates: [...PolicyConstants.POLICY_LIQUIDITY_STATES],
  },
  {
    decisions: ["ALLOW", "BLOCK"],
    riskModes: ["NORMAL", "L1", "L2", "HALT"],
    regimeStates: ["OK", "CAUTION", "TRANSITION", "HALT"],
    volStates: ["LOW", "NORMAL", "HIGH"],
    liquidityStates: ["NORMAL", "LOW"],
  },
  "policy decision risk regime vol liquidity enums"
);

assert.deepEqual(
  {
    evidenceLevels: [...PolicyConstants.POLICY_EVIDENCE_LEVELS],
    usedSignatures: [...PolicyConstants.POLICY_USED_SIGNATURES],
    collabStrengths: [...PolicyConstants.POLICY_COLLAB_STRENGTHS],
    rewardProxies: [...PolicyConstants.POLICY_REWARD_PROXIES],
  },
  {
    evidenceLevels: ["FINE", "MID", "COARSE", "NO_EVIDENCE"],
    usedSignatures: ["FINE", "MID", "COARSE", "NONE"],
    collabStrengths: ["NONE", "WEAK", "STRONG"],
    rewardProxies: ["HIGH", "MID", "LOW"],
  },
  "policy evidence signature collab reward enums"
);

assert.deepEqual(
  policySampleSignalCandidate,
  {
    symbol: "BTCUSDT",
    time: "2026-06-01T00:00:00Z",
    source: "FVG",
    eventType: "ENTRY_WINDOW_OPEN",
    dir: "BULL",
    poiTier: "H4_CORE",
    poiId: "POI-1",
    entryBoundaryPrice: 100,
    hardInvalidationPrice: 95,
    lastPrice: 101,
    midPrice: 100.5,
    tickSize: 0.1,
    ltAtr14: 2.5,
    triggerCount: 2,
    collabStrength: "STRONG",
    hasStack: true,
    tags: ["A", "B"],
    expectedRR: 1.6,
    tpRefPrice: 108,
  },
  "policy signal candidate contract sample"
);

assert.deepEqual(
  policySampleMarketSnapshot,
  {
    time: "2026-06-01T00:00:00Z",
    symbol: "BTCUSDT",
    bid: 100.4,
    ask: 100.6,
    last: 100.5,
    mid: 100.5,
    atr14_price: 2.2,
    atr14_bps: 218.9,
    volume_m5: 12345,
    barChange_bps_m5: 35,
    dataOk: true,
    dataState: "OK",
  },
  "policy market snapshot contract sample"
);

assert.deepEqual(
  policySampleAccountSnapshot,
  {
    time: "2026-06-01T00:00:00Z",
    equity: 10000,
    riskMode: "NORMAL",
    realizedPnl_24h_pct: -0.4,
    consecutiveLosses: 1,
    openRiskPct: 0.008,
    signalsSent_60m: 3,
  },
  "policy account snapshot contract sample"
);

assert.deepEqual(
  {
    regimeState: policySampleDerived.regimeState,
    evidenceLevel: policySampleDerived.evidenceLevel,
    rewardProxy: policySampleDerived.rewardProxy,
    usedSignature: policySampleDerived.usedSignature,
    isExceptional: policySampleDerived.isExceptional,
  },
  {
    regimeState: "OK",
    evidenceLevel: "MID",
    rewardProxy: "MID",
    usedSignature: "MID",
    isExceptional: false,
  },
  "policy derived values contract sample"
);

assert.deepEqual(
  policySampleResult,
  {
    decision: "ALLOW",
    policyScoreDeltaSum: -5,
    policyTags: ["EDGE_OK", "SC_GOOD"],
    reasons: [],
    riskMode: "NORMAL",
    suggestedRiskPct: 0.01,
    derived: policySampleDerived,
  },
  "policy result contract sample"
);

assert.deepEqual(
  [...PolicyConstants.POLICY_DATA_STATES],
  ["OK", "BACKFILLING", "GAP_DETECTED"],
  "policy data state enum"
);

assert.deepEqual(
  evaluateDataIntegrityGate({
    ...policySampleMarketSnapshot,
    dataState: undefined,
    dataOk: true,
  }),
  {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    skipRemainingGates: false,
  },
  "policy data integrity passes when dataOk true without dataState"
);

assert.deepEqual(
  evaluateDataIntegrityGate({
    ...policySampleMarketSnapshot,
    dataOk: true,
    dataState: "OK",
  }),
  {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    skipRemainingGates: false,
  },
  "policy data integrity passes when dataOk true and state ok"
);

assert.deepEqual(
  evaluateDataIntegrityGate({
    ...policySampleMarketSnapshot,
    dataOk: false,
    dataState: "BACKFILLING",
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: ["DATA_GAP"],
    reasons: ["DATA_INTEGRITY"],
    skipRemainingGates: true,
  },
  "policy data integrity blocks on backfilling"
);

assert.deepEqual(
  evaluateDataIntegrityGate({
    ...policySampleMarketSnapshot,
    dataOk: false,
    dataState: "GAP_DETECTED",
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: ["DATA_GAP"],
    reasons: ["DATA_INTEGRITY"],
    skipRemainingGates: true,
  },
  "policy data integrity blocks on gap detected"
);

assert.deepEqual(
  evaluateDataIntegrityGate({
    ...policySampleMarketSnapshot,
    dataOk: true,
    dataState: "GAP_DETECTED",
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: ["DATA_GAP"],
    reasons: ["DATA_INTEGRITY"],
    skipRemainingGates: true,
  },
  "policy data integrity blocks on inconsistent true gap state"
);

assert.deepEqual(
  evaluateDataIntegrityGate({
    ...policySampleMarketSnapshot,
    dataOk: false,
    dataState: "OK",
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: ["DATA_GAP"],
    reasons: ["DATA_INTEGRITY"],
    skipRemainingGates: true,
  },
  "policy data integrity blocks on inconsistent false ok state"
);

assert.equal(
  evaluateDataIntegrityGate({
    ...policySampleMarketSnapshot,
    dataOk: false,
    dataState: "BACKFILLING",
  })?.skipRemainingGates,
  true,
  "policy data integrity blocked case skips remaining gates"
);

assert.deepEqual(
  {
    regimeBuckets: [...PolicyConstants.POLICY_REGIME_BUCKETS],
    edgeMinSamples: PolicyConstants.EDGE_MIN_SAMPLES,
    lcbZ: PolicyConstants.LCB_Z,
    noEvidencePenalty: PolicyConstants.EDGE_NO_EVIDENCE_PENALTY,
    coldstartPenalty: PolicyConstants.EDGE_COLDSTART_EXTRA_PENALTY,
    lcbNegPenalty: PolicyConstants.EDGE_LCB_NEG_PENALTY,
    lcbBlockSc: PolicyConstants.EDGE_LCB_NEG_BLOCK_SC,
    kellyDefault: PolicyConstants.KELLY_DEFAULT_ENABLED,
  },
  {
    regimeBuckets: ["OK", "TRANSITION", "CAUTION"],
    edgeMinSamples: 30,
    lcbZ: 1.28,
    noEvidencePenalty: -5,
    coldstartPenalty: -10,
    lcbNegPenalty: -35,
    lcbBlockSc: 4.5,
    kellyDefault: false,
  },
  "policy edge constants"
);

assert.deepEqual(
  {
    ok: getPolicyRegimeBucket("OK", "NORMAL"),
    transition: getPolicyRegimeBucket("TRANSITION", "NORMAL"),
    cautionFromLiquidity: getPolicyRegimeBucket("OK", "LOW"),
  },
  {
    ok: "OK",
    transition: "TRANSITION",
    cautionFromLiquidity: "CAUTION",
  },
  "policy edge regime bucket mapping"
);

assert.deepEqual(
  buildEdgeSignatureKeys(
    concentrationSignalBase,
    "TRANSITION",
    "NORMAL"
  ),
  {
    coarse: "H4_CORE|BULL|TRANSITION",
    mid: "FVG|H4_CORE|BULL|TRANSITION",
    fine: "FVG|H4_CORE|BULL|REACTION|TRANSITION",
    regimeBucket: "TRANSITION",
  },
  "policy edge signature key formula"
);

assert.deepEqual(
  evaluateEdgeEvidenceGate({
    signal: concentrationSignalBase,
    regimeState: "OK",
    liquidityState: "NORMAL",
    sc: 5,
    isExceptional: false,
    fineStats: edgeFineInsufficientStats,
    midStats: edgeMidPositiveStats,
    coarseStats: edgeCoarsePositiveStats,
  }),
  {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    evidenceLevel: "MID",
    usedSignature: "MID",
    lcbR: 0.4 - 1.28 * (0.1 / Math.sqrt(35)),
    suggestedRiskMultiplier: null,
  },
  "policy edge falls back from fine to mid by sample threshold"
);

assert.deepEqual(
  evaluateEdgeEvidenceGate({
    signal: concentrationSignalBase,
    regimeState: "OK",
    liquidityState: "NORMAL",
    sc: 5,
    isExceptional: false,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -15,
    tags: ["EDGE_COLDSTART", "EDGE_NO_EVIDENCE"],
    reasons: [],
    evidenceLevel: "NO_EVIDENCE",
    usedSignature: "NONE",
    lcbR: null,
    suggestedRiskMultiplier: null,
  },
  "policy edge no evidence gives coldstart penalties without block"
);

assert.equal(
  computeLcbR(edgeNegativeStats),
  -0.1 - 1.28 * (0.2 / Math.sqrt(30)),
  "policy edge lcbR formula"
);

assert.deepEqual(
  evaluateEdgeEvidenceGate({
    signal: concentrationSignalBase,
    regimeState: "OK",
    liquidityState: "NORMAL",
    sc: 4.4,
    isExceptional: false,
    fineStats: edgeNegativeStats,
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: [],
    reasons: ["EDGE_LCB_NEG_BLOCK"],
    evidenceLevel: "FINE",
    usedSignature: "FINE",
    lcbR: -0.1 - 1.28 * (0.2 / Math.sqrt(30)),
    suggestedRiskMultiplier: null,
  },
  "policy edge blocks on negative lcbR weak non-exceptional and low sc"
);

assert.deepEqual(
  evaluateEdgeEvidenceGate({
    signal: {
      ...concentrationSignalBase,
      collabStrength: "STRONG",
    },
    regimeState: "OK",
    liquidityState: "NORMAL",
    sc: 4.4,
    isExceptional: false,
    fineStats: edgeNegativeStats,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -35,
    tags: ["EDGE_LCB_NEG_OVERRIDE"],
    reasons: [],
    evidenceLevel: "FINE",
    usedSignature: "FINE",
    lcbR: -0.1 - 1.28 * (0.2 / Math.sqrt(30)),
    suggestedRiskMultiplier: null,
  },
  "policy edge strong collab overrides hard block with -35"
);

assert.deepEqual(
  evaluateEdgeEvidenceGate({
    signal: concentrationSignalBase,
    regimeState: "OK",
    liquidityState: "NORMAL",
    sc: 4.4,
    isExceptional: true,
    fineStats: edgeNegativeStats,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -35,
    tags: ["EDGE_LCB_NEG_OVERRIDE"],
    reasons: [],
    evidenceLevel: "FINE",
    usedSignature: "FINE",
    lcbR: -0.1 - 1.28 * (0.2 / Math.sqrt(30)),
    suggestedRiskMultiplier: null,
  },
  "policy edge exceptional overrides hard block with -35"
);

assert.equal(
  computeKellySuggestedRiskMultiplier(edgeKellyStats),
  null,
  "policy edge kelly hint stays null while default off"
);

assert.deepEqual(
  {
    haltEnter: PolicyConstants.HALT_ENTER_PNL_24H,
    haltExit: PolicyConstants.HALT_EXIT_PNL_24H,
    lossL1: PolicyConstants.CONSEC_LOSS_L1,
    lossL2: PolicyConstants.CONSEC_LOSS_L2,
    recoveryL1: PolicyConstants.MIN_RECOVERY_R_L1,
    recoveryL2: PolicyConstants.MIN_RECOVERY_R_L2_SUM2WINS,
    l1Penalty: PolicyConstants.RISK_L1_PENALTY,
    l2Penalty: PolicyConstants.RISK_L2_PENALTY,
  },
  {
    haltEnter: -2,
    haltExit: -1.8,
    lossL1: 3,
    lossL2: 5,
    recoveryL1: 0.3,
    recoveryL2: 0.4,
    l1Penalty: -15,
    l2Penalty: -25,
  },
  "policy risk constants"
);

assert.equal(
  shouldEnterRiskHalt("NORMAL", -2.0),
  true,
  "policy risk halt enters at -2.0"
);

assert.equal(
  shouldStayRiskHalt("HALT", -1.8),
  true,
  "policy risk halt stays at -1.8"
);

assert.deepEqual(
  evaluateRiskManager({
    account: {
      ...riskAccountBase,
      riskMode: "HALT",
      realizedPnl_24h_pct: -1.7,
      consecutiveLosses: 0,
    },
    evidenceLevel: "MID",
  }),
  {
    decision: "ALLOW",
    riskMode: "NORMAL",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    suggestedRiskPct: 0.01,
  },
  "policy risk halt exit reevaluates to normal"
);

assert.deepEqual(
  evaluateRiskManager({
    account: {
      ...riskAccountBase,
      riskMode: "NORMAL",
      consecutiveLosses: 3,
    },
    evidenceLevel: "MID",
  }),
  {
    decision: "ALLOW",
    riskMode: "L1",
    scoreDelta: -15,
    tags: ["RISK_L1"],
    reasons: [],
    suggestedRiskPct: 0.006,
  },
  "policy risk normal escalates to l1 at 3 losses"
);

assert.deepEqual(
  evaluateRiskManager({
    account: {
      ...riskAccountBase,
      riskMode: "NORMAL",
      consecutiveLosses: 5,
    },
    evidenceLevel: "MID",
  }),
  {
    decision: "ALLOW",
    riskMode: "L2",
    scoreDelta: -25,
    tags: ["RISK_L2"],
    reasons: [],
    suggestedRiskPct: 0.003,
  },
  "policy risk normal escalates to l2 at 5 losses"
);

assert.deepEqual(
  evaluateRiskManager({
    account: {
      ...riskAccountBase,
      riskMode: "L1",
      consecutiveLosses: 2,
    },
    evidenceLevel: "MID",
    lastWinRAfterCost: 0.3,
  }),
  {
    decision: "ALLOW",
    riskMode: "NORMAL",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    suggestedRiskPct: 0.01,
  },
  "policy risk l1 recovers to normal on lastWinR threshold"
);

assert.deepEqual(
  evaluateRiskManager({
    account: {
      ...riskAccountBase,
      riskMode: "L2",
      consecutiveLosses: 2,
    },
    evidenceLevel: "MID",
    last2WinsRAfterCostSum: 0.4,
  }),
  {
    decision: "ALLOW",
    riskMode: "L1",
    scoreDelta: -15,
    tags: ["RISK_L1"],
    reasons: [],
    suggestedRiskPct: 0.006,
  },
  "policy risk l2 recovers to l1 on two-win recovery sum"
);

assert.deepEqual(
  evaluateRiskManager({
    account: {
      ...riskAccountBase,
      riskMode: "L2",
      consecutiveLosses: 2,
    },
    evidenceLevel: "MID",
  }),
  {
    decision: "ALLOW",
    riskMode: "L2",
    scoreDelta: -25,
    tags: ["RISK_L2"],
    reasons: [],
    suggestedRiskPct: 0.003,
  },
  "policy risk l2 stays without recovery evidence"
);

assert.equal(
  evaluateRiskManager({
    account: {
      ...riskAccountBase,
      riskMode: "NORMAL",
      consecutiveLosses: 0,
    },
    evidenceLevel: "NO_EVIDENCE",
  })?.suggestedRiskPct,
  0.006,
  "policy risk coldstart clamp limits suggested risk to l1"
);

assert.deepEqual(
  {
    normalCap: PolicyConstants.PORTFOLIO_CAP_NORMAL,
    l1Cap: PolicyConstants.PORTFOLIO_CAP_L1,
    l2Cap: PolicyConstants.PORTFOLIO_CAP_L2,
    haltCap: PolicyConstants.PORTFOLIO_CAP_HALT,
    mapNormal: getPortfolioCapByRiskMode("NORMAL"),
    mapL1: getPortfolioCapByRiskMode("L1"),
    mapL2: getPortfolioCapByRiskMode("L2"),
    mapHalt: getPortfolioCapByRiskMode("HALT"),
  },
  {
    normalCap: 0.02,
    l1Cap: 0.012,
    l2Cap: 0.006,
    haltCap: 0,
    mapNormal: 0.02,
    mapL1: 0.012,
    mapL2: 0.006,
    mapHalt: 0,
  },
  "policy portfolio caps and mapping"
);

assert.deepEqual(
  evaluatePortfolioExposureGate({
    account: {
      ...riskAccountBase,
      openRiskPct: undefined,
    },
    riskMode: "NORMAL",
    suggestedRiskPct: 0.01,
  }),
  {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: ["PORTFOLIO_UNKNOWN"],
    reasons: [],
    suggestedRiskPct: 0.01,
    cap: 0.02,
    skipped: true,
  },
  "policy portfolio missing openRiskPct skips with unknown tag"
);

assert.deepEqual(
  evaluatePortfolioExposureGate({
    account: {
      ...riskAccountBase,
      openRiskPct: 0.02,
    },
    riskMode: "NORMAL",
    suggestedRiskPct: 0.01,
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: [],
    reasons: ["PORTFOLIO_FULL"],
    suggestedRiskPct: 0,
    cap: 0.02,
    skipped: false,
  },
  "policy portfolio normal full blocks"
);

assert.deepEqual(
  evaluatePortfolioExposureGate({
    account: {
      ...riskAccountBase,
      openRiskPct: 0.012,
    },
    riskMode: "L1",
    suggestedRiskPct: 0.006,
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: [],
    reasons: ["PORTFOLIO_FULL"],
    suggestedRiskPct: 0,
    cap: 0.012,
    skipped: false,
  },
  "policy portfolio l1 full blocks"
);

assert.deepEqual(
  evaluatePortfolioExposureGate({
    account: {
      ...riskAccountBase,
      openRiskPct: 0.006,
    },
    riskMode: "L2",
    suggestedRiskPct: 0.003,
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: [],
    reasons: ["PORTFOLIO_FULL"],
    suggestedRiskPct: 0,
    cap: 0.006,
    skipped: false,
  },
  "policy portfolio l2 full blocks"
);

assert.deepEqual(
  evaluatePortfolioExposureGate({
    account: {
      ...riskAccountBase,
      openRiskPct: 0,
    },
    riskMode: "HALT",
    suggestedRiskPct: 0.001,
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: [],
    reasons: ["PORTFOLIO_FULL"],
    suggestedRiskPct: 0,
    cap: 0,
    skipped: false,
  },
  "policy portfolio halt cap zero blocks"
);

assert.deepEqual(
  evaluatePortfolioExposureGate({
    account: {
      ...riskAccountBase,
      openRiskPct: 0.018,
    },
    riskMode: "NORMAL",
    suggestedRiskPct: 0.01,
  }),
  {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: ["PORTFOLIO_TRIMMED"],
    reasons: ["PORTFOLIO_TRIMMED"],
    suggestedRiskPct: 0.0020000000000000018,
    cap: 0.02,
    skipped: false,
  },
  "policy portfolio trims suggested risk instead of blocking"
);

assert.deepEqual(
  evaluatePortfolioExposureGate({
    account: {
      ...riskAccountBase,
      openRiskPct: 0.005,
    },
    riskMode: "NORMAL",
    suggestedRiskPct: 0.01,
  }),
  {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    suggestedRiskPct: 0.01,
    cap: 0.02,
    skipped: false,
  },
  "policy portfolio unchanged under cap"
);

assert.deepEqual(
  {
    decision: evaluatePolicy({
      signal: {
        ...(policySampleSignalCandidate as any),
        symbol: "",
      },
      market: policySampleMarketSnapshot,
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
    })?.decision,
    reasons: evaluatePolicy({
      signal: {
        ...(policySampleSignalCandidate as any),
        symbol: "",
      },
      market: policySampleMarketSnapshot,
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
    })?.reasons,
  },
  {
    decision: "BLOCK",
    reasons: ["missing_required_field"],
  },
  "policy e2e blocks on missing required field"
);

assert.deepEqual(
  {
    decision: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: {
        ...policySampleMarketSnapshot,
        dataOk: false,
        dataState: "BACKFILLING",
        bid: 90,
        ask: 110,
      },
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
    })?.decision,
    policyTags: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: {
        ...policySampleMarketSnapshot,
        dataOk: false,
        dataState: "BACKFILLING",
        bid: 90,
        ask: 110,
      },
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
    })?.policyTags,
    reasons: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: {
        ...policySampleMarketSnapshot,
        dataOk: false,
        dataState: "BACKFILLING",
        bid: 90,
        ask: 110,
      },
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
    })?.reasons,
  },
  {
    decision: "BLOCK",
    policyTags: ["DATA_GAP"],
    reasons: ["DATA_INTEGRITY"],
  },
  "policy e2e data integrity short-circuits before later gates"
);

assert.deepEqual(
  {
    decision: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: {
        ...policySampleMarketSnapshot,
        bid: 99.7,
        ask: 100.3,
        mid: 100,
      },
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
    })?.decision,
    reasons: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: {
        ...policySampleMarketSnapshot,
        bid: 99.7,
        ask: 100.3,
        mid: 100,
      },
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
    })?.reasons,
  },
  {
    decision: "BLOCK",
    reasons: ["REGIME_SPREAD_HALT"],
  },
  "policy e2e regime halt blocks"
);

const policyLowScSignal = {
  ...policySampleSignalCandidate,
  midPrice: 100,
  lastPrice: 100,
  entryBoundaryPrice: 100,
  hardInvalidationPrice: 99.8,
  ltAtr14: 0.1,
  tickSize: 0.1,
  expectedRR: 1.6,
  tpRefPrice: 101,
};

assert.deepEqual(
  {
    decision: evaluatePolicy({
      signal: policyLowScSignal,
      market: {
        ...policySampleMarketSnapshot,
        bid: 99.95,
        ask: 100.05,
        mid: 100,
        last: 100,
        atr14_bps: 200,
        atr14_price: 2,
        volume_m5: 300,
        barChange_bps_m5: 10,
      },
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
      midStats: edgeMidPositiveStats,
    })?.decision,
    reasons: evaluatePolicy({
      signal: policyLowScSignal,
      market: {
        ...policySampleMarketSnapshot,
        bid: 99.95,
        ask: 100.05,
        mid: 100,
        last: 100,
        atr14_bps: 200,
        atr14_price: 2,
        volume_m5: 300,
        barChange_bps_m5: 10,
      },
      account: riskAccountBase,
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
      midStats: edgeMidPositiveStats,
    })?.reasons,
  },
  {
    decision: "BLOCK",
    reasons: ["SC_LT_3"],
  },
  "policy e2e cost gate hard block works"
);

assert.deepEqual(
  evaluatePolicy({
    signal: concentrationExceptionalEntrySignal,
    market: policySampleMarketSnapshot,
    account: {
      ...riskAccountBase,
      openRiskPct: undefined,
    },
    regimeLongAtr14BpsHistory: regimeLongAtrHistory,
    regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
    regimeLongVolumeM5History: regimeLongVolumeHistory,
    recentConcentrationHistory15m: concentrationHistoryFiveUnique,
  }),
  {
    decision: "ALLOW",
    policyScoreDeltaSum: -45,
    policyTags: [
      "CONC_OVERRIDE",
      "EDGE_COLDSTART",
      "EDGE_NO_EVIDENCE",
      "PORTFOLIO_UNKNOWN",
      "RR_OK",
    ],
    reasons: ["CONC_OVERRIDE"],
    riskMode: "NORMAL",
    suggestedRiskPct: 0.006,
    derived: {
      ...evaluatePolicy({
        signal: concentrationExceptionalEntrySignal,
        market: policySampleMarketSnapshot,
        account: {
          ...riskAccountBase,
          openRiskPct: undefined,
        },
        regimeLongAtr14BpsHistory: regimeLongAtrHistory,
        regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
        regimeLongVolumeM5History: regimeLongVolumeHistory,
        recentConcentrationHistory15m: concentrationHistoryFiveUnique,
      })!.derived,
    },
  },
  "policy e2e concentration exceptional override stays allow"
);

const policyNoEvidenceResult = evaluatePolicy({
  signal: concentrationSignalBase,
  market: policySampleMarketSnapshot,
  account: {
    ...riskAccountBase,
    openRiskPct: 0.005,
  },
  regimeLongAtr14BpsHistory: regimeLongAtrHistory,
  regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
  regimeLongVolumeM5History: regimeLongVolumeHistory,
})!;

assert.deepEqual(
  {
    decision: policyNoEvidenceResult.decision,
    policyScoreDeltaSum: policyNoEvidenceResult.policyScoreDeltaSum,
    policyTags: policyNoEvidenceResult.policyTags,
    suggestedRiskPct: policyNoEvidenceResult.suggestedRiskPct,
    evidenceLevel: policyNoEvidenceResult.derived.evidenceLevel,
  },
  {
    decision: "ALLOW",
    policyScoreDeltaSum: -15,
    policyTags: ["EDGE_COLDSTART", "EDGE_NO_EVIDENCE", "RR_OK"],
    suggestedRiskPct: 0.006,
    evidenceLevel: "NO_EVIDENCE",
  },
  "policy e2e no-evidence applies coldstart penalties and risk clamp"
);

assert.deepEqual(
  {
    decision: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: policySampleMarketSnapshot,
      account: {
        ...riskAccountBase,
        realizedPnl_24h_pct: -2.0,
      },
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
      midStats: edgeMidPositiveStats,
    })?.decision,
    reasons: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: policySampleMarketSnapshot,
      account: {
        ...riskAccountBase,
        realizedPnl_24h_pct: -2.0,
      },
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
      midStats: edgeMidPositiveStats,
    })?.reasons,
    riskMode: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: policySampleMarketSnapshot,
      account: {
        ...riskAccountBase,
        realizedPnl_24h_pct: -2.0,
      },
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
      midStats: edgeMidPositiveStats,
    })?.riskMode,
  },
  {
    decision: "BLOCK",
    reasons: ["RISK_HALT_ROLLING_24H"],
    riskMode: "HALT",
  },
  "policy e2e risk halt blocks"
);

assert.deepEqual(
  {
    decision: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: policySampleMarketSnapshot,
      account: {
        ...riskAccountBase,
        openRiskPct: 0.02,
      },
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
      midStats: edgeMidPositiveStats,
    })?.decision,
    reasons: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: policySampleMarketSnapshot,
      account: {
        ...riskAccountBase,
        openRiskPct: 0.02,
      },
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
      midStats: edgeMidPositiveStats,
    })?.reasons,
    suggestedRiskPct: evaluatePolicy({
      signal: policySampleSignalCandidate,
      market: policySampleMarketSnapshot,
      account: {
        ...riskAccountBase,
        openRiskPct: 0.02,
      },
      regimeLongAtr14BpsHistory: regimeLongAtrHistory,
      regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
      regimeLongVolumeM5History: regimeLongVolumeHistory,
      midStats: edgeMidPositiveStats,
    })?.suggestedRiskPct,
  },
  {
    decision: "BLOCK",
    reasons: ["PORTFOLIO_FULL"],
    suggestedRiskPct: 0,
  },
  "policy e2e portfolio full blocks"
);

const policyHappyResult = evaluatePolicy({
  signal: policySampleSignalCandidate,
  market: policySampleMarketSnapshot,
  account: {
    ...riskAccountBase,
    openRiskPct: 0.005,
  },
  regimeLongAtr14BpsHistory: regimeLongAtrHistory,
  regimeShortAtr14BpsHistory: regimeShortAtrHistoryWeak,
  regimeLongVolumeM5History: regimeLongVolumeHistory,
  midStats: edgeMidPositiveStats,
})!;

assert.deepEqual(
  {
    decision: policyHappyResult.decision,
    policyScoreDeltaSum: policyHappyResult.policyScoreDeltaSum,
    policyTags: policyHappyResult.policyTags,
    reasons: policyHappyResult.reasons,
    riskMode: policyHappyResult.riskMode,
    suggestedRiskPct: policyHappyResult.suggestedRiskPct,
    regimeState: policyHappyResult.derived.regimeState,
    evidenceLevel: policyHappyResult.derived.evidenceLevel,
    usedSignature: policyHappyResult.derived.usedSignature,
  },
  {
    decision: "ALLOW",
    policyScoreDeltaSum: 0,
    policyTags: ["RR_OK"],
    reasons: [],
    riskMode: "NORMAL",
    suggestedRiskPct: 0.01,
    regimeState: "OK",
    evidenceLevel: "MID",
    usedSignature: "MID",
  },
  "policy e2e happy path returns sorted result and derived snapshot"
);

const routerSampleCandidate: RouterCandidate = {
  signal: policySampleSignalCandidate,
  tf: "H4",
  policy: policyHappyResult,
  priceExtreme: 100.3,
  poiConfTime: "2026-06-01T01:00:00Z",
  score: 92,
  collabStrength: "STRONG",
  entryFillPrice: 100.5,
  poiZoneBottom: 99.5,
  poiZoneTop: 100.5,
};

const routerBest1D1Candidate: RouterCandidate = {
  ...routerSampleCandidate,
  signal: {
    ...policySampleSignalCandidate,
    poiTier: "D1_POI",
    poiId: "POI-D1",
  },
  tf: "D1",
  priceExtreme: 100.4,
  poiConfTime: "2026-06-01T00:00:00Z",
};

const routerBest1H4Candidate: RouterCandidate = {
  ...routerSampleCandidate,
  signal: {
    ...policySampleSignalCandidate,
    poiTier: "H4_CORE",
    poiId: "POI-H4",
  },
  tf: "H4",
  priceExtreme: 100.3,
  poiConfTime: "2026-06-01T01:00:00Z",
};

const routerBest1H1SetupCandidate: RouterCandidate = {
  ...routerSampleCandidate,
  signal: {
    ...policySampleSignalCandidate,
    poiTier: "SETUP",
    poiId: "POI-H1-SETUP",
  },
  tf: "H1",
  priceExtreme: 100.3,
  poiConfTime: "2026-06-01T00:30:00Z",
};

const routerBest1BlockedCandidate: RouterCandidate = {
  ...routerSampleCandidate,
  signal: {
    ...policySampleSignalCandidate,
    poiId: "POI-BLOCK",
  },
  priceExtreme: 100.1,
  poiConfTime: "2026-06-01T02:00:00Z",
  policy: {
    ...policyHappyResult,
    decision: "BLOCK",
  },
};

const routerBest1TieNewerCandidate: RouterCandidate = {
  ...routerSampleCandidate,
  signal: {
    ...policySampleSignalCandidate,
    poiTier: "H4_CORE",
    poiId: "POI-NEWER",
  },
  tf: "H4",
  priceExtreme: 100.3,
  poiConfTime: "2026-06-01T02:00:00Z",
};

const routerBest1TieOlderCandidate: RouterCandidate = {
  ...routerSampleCandidate,
  signal: {
    ...policySampleSignalCandidate,
    poiTier: "H4_CORE",
    poiId: "POI-OLDER",
  },
  tf: "H4",
  priceExtreme: 100.3,
  poiConfTime: "2026-06-01T01:00:00Z",
};

const routerBest1TieIdA: RouterCandidate = {
  ...routerSampleCandidate,
  signal: {
    ...policySampleSignalCandidate,
    poiTier: "H4_CORE",
    poiId: "A-POI",
  },
  tf: "H4",
  priceExtreme: 100.3,
  poiConfTime: "2026-06-01T01:00:00Z",
};

const routerBest1TieIdB: RouterCandidate = {
  ...routerSampleCandidate,
  signal: {
    ...policySampleSignalCandidate,
    poiTier: "H4_CORE",
    poiId: "B-POI",
  },
  tf: "H4",
  priceExtreme: 100.3,
  poiConfTime: "2026-06-01T01:00:00Z",
};

const routerRawPoiMap = new Map([
  [
    "BTCUSDT:FVG:77",
    {
      id: "BTCUSDT:FVG:77",
      symbol: "BTCUSDT",
      kind: "FVG" as const,
      tf: "H4",
      dir: "BULL" as const,
      zone: { bottom: 100, top: 102 },
      tags: ["Z", "A", "A"],
    },
  ],
  [
    "BTCUSDT:CHANNEL:88",
    {
      id: "BTCUSDT:CHANNEL:88",
      symbol: "BTCUSDT",
      kind: "CHANNEL" as const,
      tf: "H1",
      dir: "BEAR" as const,
      lowerBandAt: (_openTime: string) => 95,
      upperBandAt: (_openTime: string) => 110,
      type: "CHANNEL_POI",
      state: "ACTIVE",
      tags: ["CHANNEL", "B"],
    },
  ],
  [
    "BTCUSDT:TRENDLINE:99",
    {
      id: "BTCUSDT:TRENDLINE:99",
      symbol: "BTCUSDT",
      kind: "TRENDLINE" as const,
      tf: "M30",
      dir: "BULL" as const,
      linePriceAt: (_openTime: string) => 101.2,
      tags: ["TL"],
    },
  ],
]);

const routerRawCtxBase = {
  symbol: "BTCUSDT",
  bar: {
    closeTime: "2026-06-01T00:05:00Z",
    close: 100.4,
    volume: 0,
    high: 101,
    low: 99.5,
    closePriceBasis: 100.5,
  },
  tickSize: 0.1,
  poiStore: {
    get(poiId: string) {
      return routerRawPoiMap.get(poiId) ?? null;
    },
  },
};

const routerRawSeedFvgStrong = toRouterRawSignalCandidate(
  "[ENTRY_WINDOW_OPEN][M15] poi=BTCUSDT:FVG:77 triggers=2plus:SWEEP_REC|CHOCH|CHOCH",
  {
    ...routerRawCtxBase,
    poiStore: {
      get(poiId: string) {
        if (poiId !== "BTCUSDT:FVG:77") {
          return null;
        }

        return {
          ...(routerRawPoiMap.get("BTCUSDT:FVG:77") as any),
          type: "H4_CORE_FVG",
          state: "A_ACTIVE",
          bestCollab: { tag: "COLLAB_FVG_OVERLAP_0.30" },
          stackActive: true,
        };
      },
    },
  }
)!;

const routerRawSeedTrendlineWeak = toRouterRawSignalCandidate(
  "[REACTION][M5] poi=BTCUSDT:TRENDLINE:99 triggers=CHOCH",
  {
    ...routerRawCtxBase,
    poiStore: {
      get(poiId: string) {
        if (poiId !== "BTCUSDT:TRENDLINE:99") {
          return null;
        }

        return {
          ...(routerRawPoiMap.get("BTCUSDT:TRENDLINE:99") as any),
          state: "ACTIVE",
          bestCollab: { tag: "TL_COLLAB_POI_OK" },
        };
      },
    },
  }
)!;

const tradeSendOpen = buildRouterSendOpenPayload(routerSampleCandidate)!;

const tradeDuplicatePlans: TradeActivePlanRef[] = [
  {
    symbol: "BTCUSDT",
    dir: "LONG",
    status: "OPEN",
    zoneKey: "BTCUSDT|LONG|995~1005",
  },
];

const tradeClosedPlanSameZone: TradeActivePlanRef = {
  symbol: "BTCUSDT",
  dir: "LONG",
  status: "CLOSED",
  zoneKey: "BTCUSDT|LONG|995~1005",
};

const tradeOpenConfirmedTpPivots: Pivot[] = [
  {
    tf: "H1",
    pivotType: "HIGH",
    pivotTime: Date.UTC(2026, 4, 31, 22, 0, 0),
    pivotPrice: 110,
    confirmedAt: Date.UTC(2026, 4, 31, 23, 0, 0),
    isConfirmed: true,
  },
  {
    tf: "H1",
    pivotType: "HIGH",
    pivotTime: Date.UTC(2026, 4, 31, 23, 0, 0),
    pivotPrice: 108,
    confirmedAt: Date.UTC(2026, 4, 31, 23, 55, 0),
    isConfirmed: true,
  },
  {
    tf: "H1",
    pivotType: "HIGH",
    pivotTime: Date.UTC(2026, 5, 1, 0, 1, 0),
    pivotPrice: 101,
    confirmedAt: Date.UTC(2026, 5, 1, 0, 5, 0),
    isConfirmed: true,
  },
  {
    tf: "M30",
    pivotType: "HIGH",
    pivotTime: Date.UTC(2026, 4, 31, 23, 0, 0),
    pivotPrice: 107,
    confirmedAt: Date.UTC(2026, 4, 31, 23, 30, 0),
    isConfirmed: true,
  },
];

const tradeOpenBaseArgs = {
  payload: tradeSendOpen,
  signalBarClose: 100.24,
  tickSize: 0.1,
  atrM5_14_atOpen: 2.1,
  atrLiq_14_atOpen: 2,
  confirmedTpPivots: tradeOpenConfirmedTpPivots,
};

const tradeMonitorLongPlan = evaluateTradeOpen(tradeOpenBaseArgs)!.plan!;
const tradeMonitorShortPlan = {
  ...tradeMonitorLongPlan,
  dir: "SHORT" as const,
  stopPrice: 105.7,
  tpPrice: 92,
};
const tradeMonitorEvalBar: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 5, 1, 0, 0, 1),
  closeTime: Date.UTC(2026, 5, 1, 0, 5, 0),
  open: 100.2,
  high: 102.4,
  low: 99.1,
  close: 100.8,
  volume: 0,
};
const tradeMonitorHardTpBar: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 5, 1, 0, 0, 1),
  closeTime: Date.UTC(2026, 5, 1, 0, 5, 0),
  open: 100.2,
  high: 108,
  low: 95,
  close: 107.8,
  volume: 0,
};
const tradeMonitorHardSlBar: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 5, 1, 0, 0, 1),
  closeTime: Date.UTC(2026, 5, 1, 0, 5, 0),
  open: 100.2,
  high: 100.2,
  low: 94.6,
  close: 94.8,
  volume: 0,
};
const tradeMonitorTimeoutBar: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 5, 1, 3, 55, 1),
  closeTime: Date.UTC(2026, 5, 1, 4, 0, 0),
  open: 100.2,
  high: 100.4,
  low: 100.0,
  close: 100.26,
  volume: 0,
};
const tradeReviewHardSlPlan = applyTradeMonitorOnBar({
  plan: tradeMonitorLongPlan,
  bar: tradeMonitorHardSlBar,
  tickSize: 0.1,
  invalidTime: null,
});
const tradeReviewTimeoutPlan = applyTradeMonitorOnBar({
  plan: tradeMonitorLongPlan,
  bar: tradeMonitorTimeoutBar,
  tickSize: 0.1,
  invalidTime: null,
});
const tradeReviewShortClosedPlan: TradePlan = {
  ...tradeMonitorShortPlan,
  status: "CLOSED",
  outcome: "HARD_TP",
  exitPrice: 94.7,
  closeTime: "2026-06-01T00:05:00.000Z",
  bothHit: false,
};
const tradeReviewFillFallbackPlan: TradePlan = {
  ...tradeReviewTimeoutPlan,
  entryFillPrice: 94.7,
};
const tradeReviewStrengthPlan: TradePlan = {
  ...tradeReviewHardSlPlan,
  poiTier: "H4_CORE",
  collabStrength: "STRONG",
  entryQuality: "IDEAL",
  tpMode: "LIQ",
  score: 95,
  policySnapshot: {
    ...(tradeReviewHardSlPlan.policySnapshot as NonNullable<
      TradePlan["policySnapshot"]
    >),
    regimeState: "NORMAL",
  },
};
const tradeReviewWeakPlan: TradePlan = {
  ...tradeReviewHardSlPlan,
  entryQuality: "LATE",
  tpMode: "RR",
  rrChosen: 1.3,
  bothHit: true,
  mfeR: 1.2,
  policySnapshot: {
    ...(tradeReviewHardSlPlan.policySnapshot as NonNullable<
      TradePlan["policySnapshot"]
    >),
    regimeState: "CAUTION",
    sc: 3.4,
  },
};
const tradeReviewedClosePlan = finalizeClosedTradeReview(tradeReviewWeakPlan);
const tradeReplayHardTpPlan: TradePlan = {
  ...tradeReviewedClosePlan,
  outcome: "HARD_TP",
  strengthCodes: [
    "S_SCORE_HIGH",
    "S_POI_TIER_HIGH",
    "S_COLLAB_STRONG",
    "S_ENTRY_IDEAL",
  ],
};
const tradeReplayTimeoutLossPlan: TradePlan = {
  ...tradeReviewedClosePlan,
  outcome: "TIMEOUT",
  timeoutSign: "LOSS",
  weaknessCodes: [
    "W_POLICY_CAUTION",
    "W_GAVE_BACK_PROFIT",
    "W_SC_LOW",
  ],
};

assert.deepEqual(
  {
    emitPolicies: [...RouterConstants.ROUTER_EMIT_POLICIES],
    eventTypes: [...RouterConstants.ROUTER_EVENT_TYPES],
    tradeDirs: [...RouterConstants.ROUTER_TRADE_DIRS],
    policyStates: [...RouterConstants.ROUTER_POLICY_STATES],
    poiTiers: [...RouterConstants.ROUTER_OPEN_INTENT_POI_TIERS],
    tfs: [...RouterConstants.ROUTER_TFS],
  },
  {
    emitPolicies: ["BEST1"],
    eventTypes: ["SEND_OPEN", "SEND_CLOSE"],
    tradeDirs: ["LONG", "SHORT"],
    policyStates: ["NORMAL", "CAUTION", "TRANSITION", "HALT"],
    poiTiers: ["D1_POI", "H4_CORE", "H1_SETUP", "M30_SETUP", "OTHER"],
    tfs: ["D1", "H4", "H1", "M30", "M15", "M5"],
  },
  "router contract enums"
);

assert.deepEqual(
  {
    bull: toRouterTradeDir("BULL"),
    bear: toRouterTradeDir("BEAR"),
  },
  {
    bull: "LONG",
    bear: "SHORT",
  },
  "router trade direction mapping"
);

assert.deepEqual(
  {
    h1Setup: toRouterOpenIntentPoiTier("SETUP", "H1"),
    m30Setup: toRouterOpenIntentPoiTier("SETUP", "M30"),
    d1Poi: toRouterOpenIntentPoiTier("D1_POI", "D1"),
    other: toRouterOpenIntentPoiTier("OTHER", "M15"),
  },
  {
    h1Setup: "H1_SETUP",
    m30Setup: "M30_SETUP",
    d1Poi: "D1_POI",
    other: "OTHER",
  },
  "router poi tier bridge mapping"
);

assert.deepEqual(
  {
    normal: toRouterPolicyState(policyHappyResult),
    halt: toRouterPolicyState({
      ...policyHappyResult,
      riskMode: "HALT",
    }),
  },
  {
    normal: "NORMAL",
    halt: "HALT",
  },
  "router policy state bridge mapping"
);

assert.deepEqual(
  {
    planKey: buildRouterPlanKey("BTCUSDT", "LONG", "POI-1"),
    planId: buildRouterPlanId(
      "BTCUSDT|LONG|POI-1",
      "2026-06-01T00:00:00Z"
    ),
  },
  {
    planKey: "BTCUSDT|LONG|POI-1",
    planId: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
  },
  "router plan key and id formulas"
);

assert.deepEqual(
  buildRouterOpenIntent(routerSampleCandidate),
  {
    symbol: "BTCUSDT",
    dir: "LONG",
    eventType: "ENTRY_WINDOW_OPEN",
    openTime: "2026-06-01T00:00:00Z",
    source: "FVG",
    poiTier: "H4_CORE",
    poiId: "POI-1",
    tf: "H4",
    entryBoundaryPrice: 100,
    hardInvalidationPrice: 95,
    tags: ["A", "B", "RR_OK"],
    policySnapshot: {
      decision: "ALLOW",
      regimeState: "NORMAL",
      c_bps: policyHappyResult.derived.c_bps_roundtrip,
      sc: policyHappyResult.derived.SC,
    },
    score: 92,
    collabStrength: "STRONG",
    entryFillPrice: 100.5,
    riskPctAtOpen: policyHappyResult.suggestedRiskPct,
    poiClusterKey: policyHappyResult.derived.poiClusterKey,
    edgeSigFine: "FVG|H4_CORE|BULL|ENTRY_WINDOW_OPEN|OK",
    edgeSigMid: "FVG|H4_CORE|BULL|OK",
    edgeSigCoarse: "H4_CORE|BULL|OK",
    poiZoneBottom: 99.5,
    poiZoneTop: 100.5,
  },
  "router open intent builder exact"
);

assert.deepEqual(
  buildRouterSendOpenPayload(routerSampleCandidate),
  {
    type: "SEND_OPEN",
    planKey: "BTCUSDT|LONG|POI-1",
    planId: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
    intent: buildRouterOpenIntent(routerSampleCandidate),
  },
  "router send open payload builder exact"
);

assert.equal(
  hasRequiredRouterOpenIntentFields(
    buildRouterOpenIntent(routerSampleCandidate)
  ),
  true,
  "router open intent required field validator passes"
);

assert.equal(
  hasRequiredRouterSendOpenPayloadFields(
    buildRouterSendOpenPayload(routerSampleCandidate)
  ),
  true,
  "router send open payload required field validator passes"
);

assert.equal(
  hasRequiredRouterSendOpenPayloadFields({
    ...buildRouterSendOpenPayload(routerSampleCandidate),
    planKey: "",
  }),
  false,
  "router send open payload validator fails when planKey is missing"
);

assert.deepEqual(
  {
    d1: getRouterPoiTierRank("D1_POI"),
    h4: getRouterPoiTierRank("H4_CORE"),
    h1: getRouterPoiTierRank("H1_SETUP"),
    m30: getRouterPoiTierRank("M30_SETUP"),
    other: getRouterPoiTierRank("OTHER"),
  },
  {
    d1: 1,
    h4: 2,
    h1: 3,
    m30: 3,
    other: 0,
  },
  "router best1 poi tier rank mapping"
);

assert.equal(
  computeRouterCandidateDist(routerBest1D1Candidate),
  0.4000000000000057,
  "router best1 distance formula"
);

assert.equal(
  selectBest1OpenCandidate([
    routerBest1BlockedCandidate,
    routerBest1D1Candidate,
  ])?.signal.poiId,
  "POI-D1",
  "router best1 ignores blocked candidates"
);

assert.equal(
  selectBest1OpenCandidate([
    routerBest1D1Candidate,
    routerBest1H4Candidate,
  ])?.signal.poiId,
  "POI-H4",
  "router best1 picks smaller distance first"
);

assert.equal(
  selectBest1OpenCandidate([
    routerBest1H4Candidate,
    routerBest1H1SetupCandidate,
  ])?.signal.poiId,
  "POI-H1-SETUP",
  "router best1 tie uses setup over h4 core over d1 poi"
);

assert.equal(
  selectBest1OpenCandidate([
    routerBest1TieOlderCandidate,
    routerBest1TieNewerCandidate,
  ])?.signal.poiId,
  "POI-NEWER",
  "router best1 tie uses latest confTime"
);

assert.equal(
  selectBest1OpenCandidate([
    routerBest1TieIdB,
    routerBest1TieIdA,
  ])?.signal.poiId,
  "A-POI",
  "router best1 tie uses poiId asc last"
);

assert.deepEqual(
  buildBest1SendOpenPayload([
    routerBest1D1Candidate,
    routerBest1H4Candidate,
  ]),
  buildRouterSendOpenPayload(routerBest1H4Candidate),
  "router best1 builds send_open from selected candidate"
);

assert.equal(
  buildBest1SendOpenPayload([routerBest1BlockedCandidate]),
  null,
  "router best1 returns null when no allow candidate exists"
);

assert.deepEqual(
  parseEventLine(
    "[REACTION][M5] time=2026-06-01T00:05:00Z poi=BTCUSDT:FVG:77 triggers=CHOCH|SWEEP_REC orphan"
  ),
  {
    raw: "[REACTION][M5] time=2026-06-01T00:05:00Z poi=BTCUSDT:FVG:77 triggers=CHOCH|SWEEP_REC orphan",
    header: ["REACTION", "M5"],
    kv: {
      time: "2026-06-01T00:05:00Z",
      poi: "BTCUSDT:FVG:77",
      triggers: "CHOCH|SWEEP_REC",
    },
    extras: ["orphan"],
    errors: [],
  },
  "router raw event parser exact"
);

assert.deepEqual(
  parseEventLine(
    "[REACTION][M5] poi=BTCUSDT:FVG:77 poi=BTCUSDT:FVG:999 triggers=X"
  ),
  {
    raw: "[REACTION][M5] poi=BTCUSDT:FVG:77 poi=BTCUSDT:FVG:999 triggers=X",
    header: ["REACTION", "M5"],
    kv: {
      poi: "BTCUSDT:FVG:77",
      triggers: "X",
    },
    extras: [],
    errors: ["DUPLICATE_KEY:poi"],
  },
  "router raw event parser duplicate key first wins"
);

assert.equal(
  toRouterRawSignalCandidate(
    "[NEW][M5] poi=BTCUSDT:FVG:77 triggers=CHOCH",
    routerRawCtxBase
  ),
  null,
  "router raw event rejects non candidate header"
);

assert.equal(
  toRouterRawSignalCandidate(
    "[REACTION][H1] poi=BTCUSDT:FVG:77 triggers=CHOCH",
    routerRawCtxBase
  ),
  null,
  "router raw event rejects non ltf"
);

assert.equal(
  toRouterRawSignalCandidate("[REACTION][M5] triggers=CHOCH", routerRawCtxBase),
  null,
  "router raw event rejects missing poi id"
);

assert.deepEqual(
  parseTriggers("2plus:SWEEP_REC|CHOCH|CHOCH"),
  {
    raw: "2plus:SWEEP_REC|CHOCH|CHOCH",
    mode: "2plus",
    tokens: ["CHOCH", "SWEEP_REC"],
  },
  "router raw event trigger parser normalizes 2plus"
);

assert.deepEqual(
  toRouterRawSignalCandidate(
    "[ENTRY_WINDOW_OPEN][M15] poi=BTCUSDT:FVG:77 insidePOI=BTCUSDT:CHANNEL:88 triggers=2plus:SWEEP_REC|CHOCH|CHOCH",
    routerRawCtxBase
  ),
  {
    candidateId: buildRouterRawCandidateId(
      buildRouterRawTradeKey("BTCUSDT", "BTCUSDT:FVG:77", "BULL"),
      "ENTRY_WINDOW_OPEN",
      "M15",
      "2026-06-01T00:05:00Z"
    ),
    tradeKey: "BTCUSDT:BTCUSDT:FVG:77:BULL",
    symbol: "BTCUSDT",
    ltf: "M15",
    eventName: "ENTRY_WINDOW_OPEN",
    openTime: "2026-06-01T00:05:00Z",
    poiId: "BTCUSDT:FVG:77",
    poiKind: "FVG",
    poiTf: "H4",
    dir: "BULL",
    triggersMode: "2plus",
    entryRefPrice: 100.5,
    entryBoundaryPrice: 100,
    hardInvalidationPrice: 100,
    triggers: ["CHOCH", "SWEEP_REC"],
    triggersStr: "CHOCH|SWEEP_REC",
    poiTags: ["A", "Z"],
    rawEvent:
      "[ENTRY_WINDOW_OPEN][M15] poi=BTCUSDT:FVG:77 insidePOI=BTCUSDT:CHANNEL:88 triggers=2plus:SWEEP_REC|CHOCH|CHOCH",
    poiSnapshot: routerRawPoiMap.get("BTCUSDT:FVG:77"),
    barSnapshot: {
      close: 100.5,
      high: 101,
      low: 99.5,
    },
  },
  "router raw event candidate prefers poi over insidePOI and maps fvg seed"
);

assert.equal(
  toRouterRawSignalCandidate(
    "[REACTION][M5] poi=BTCUSDT:CHANNEL:88 triggers=SWEEP_REC",
    routerRawCtxBase
  )?.entryBoundaryPrice,
  110,
  "router raw event candidate maps channel boundary from upper band"
);

assert.equal(
  toRouterRawSignalCandidate(
    "[REACTION][M5] poi=BTCUSDT:TRENDLINE:99 triggers=CHOCH",
    routerRawCtxBase
  )?.entryBoundaryPrice,
  101.2,
  "router raw event candidate maps trendline boundary from line price"
);

assert.deepEqual(
  {
    fvg: mapRouterPoiTier({
      ...routerRawSeedFvgStrong,
      poiSnapshot: {
        ...(routerRawSeedFvgStrong.poiSnapshot as any),
        type: "H4_CORE_FVG",
        state: "A_ACTIVE",
      },
    }),
    ob: mapRouterPoiTier({
      ...routerRawSeedFvgStrong,
      poiKind: "OB",
      poiSnapshot: {
        id: "BTCUSDT:OB:1",
        kind: "OB",
        tf: "D1",
        dir: "BULL",
        zone: { bottom: 100, top: 102 },
        type: "D1_POI_OB",
        state: "POI_ACTIVE",
      } as any,
    }),
    channel: mapRouterPoiTier({
      ...routerRawSeedFvgStrong,
      poiKind: "CHANNEL",
      poiSnapshot: {
        id: "BTCUSDT:CHANNEL:1",
        kind: "CHANNEL",
        tf: "M30",
        dir: "BULL",
        type: "CHANNEL_POI",
        state: "ACTIVE",
        lowerBandAt: () => 99,
        upperBandAt: () => 105,
      } as any,
    }),
    trendline: mapRouterPoiTier({
      ...routerRawSeedTrendlineWeak,
      poiSnapshot: {
        ...(routerRawSeedTrendlineWeak.poiSnapshot as any),
        tf: "H1",
        state: "ACTIVE",
      },
    }),
  },
  {
    fvg: "H4_CORE",
    ob: "D1_POI",
    channel: "SETUP",
    trendline: "SETUP",
  },
  "router candidate addendum poi tier mapping"
);

assert.deepEqual(
  {
    twoPlusEmpty: computeRouterTriggerCount({
      ...routerRawSeedFvgStrong,
      triggersMode: "2plus",
      triggers: [],
    }),
    twoPlusTokens: computeRouterTriggerCount(routerRawSeedFvgStrong),
    rawThree: computeRouterTriggerCount({
      ...routerRawSeedTrendlineWeak,
      triggersMode: "raw",
      triggers: ["A", "B", "C"],
    }),
  },
  {
    twoPlusEmpty: 2,
    twoPlusTokens: 2,
    rawThree: 3,
  },
  "router candidate addendum trigger count lock"
);

assert.deepEqual(
  {
    hasStackStrong: computeRouterHasStack(routerRawSeedFvgStrong),
    strong: computeRouterCollabStrength(routerRawSeedFvgStrong),
    weak: computeRouterCollabStrength(routerRawSeedTrendlineWeak),
    none: computeRouterCollabStrength({
      ...routerRawSeedTrendlineWeak,
      poiTags: [],
      poiSnapshot: {
        ...(routerRawSeedTrendlineWeak.poiSnapshot as any),
        bestCollab: undefined,
      },
    }),
  },
  {
    hasStackStrong: true,
    strong: "STRONG",
    weak: "WEAK",
    none: "NONE",
  },
  "router candidate addendum collab and stack lock"
);

assert.deepEqual(
  buildPolicySignalCandidateFromSeed(routerRawSeedFvgStrong, {
    lastPrice: 100.5,
    midPrice: 100.45,
    tickSize: 0.1,
    ltAtr14: 2.5,
    expectedRR: 1.5,
    tpRefPrice: 108,
  }),
  {
    candidateId: "BTCUSDT:BTCUSDT:FVG:77:BULL:ENTRY_WINDOW_OPEN:M15@2026-06-01T00:05:00Z",
    tradeKey: "BTCUSDT:BTCUSDT:FVG:77:BULL",
    symbol: "BTCUSDT",
    time: "2026-06-01T00:05:00Z",
    source: "FVG",
    eventType: "ENTRY_WINDOW_OPEN",
    dir: "BULL",
    ltf: "M15",
    poiTier: "H4_CORE",
    poiId: "BTCUSDT:FVG:77",
    entryBoundaryPrice: 100,
    hardInvalidationPrice: 100,
    lastPrice: 100.5,
    midPrice: 100.45,
    tickSize: 0.1,
    ltAtr14: 2.5,
    triggerCount: 2,
    collabStrength: "STRONG",
    hasStack: true,
    tags: ["A", "Z"],
    triggers: ["CHOCH", "SWEEP_REC"],
    triggersStr: "CHOCH|SWEEP_REC",
    poiTags: ["A", "Z"],
    rawEvent:
      "[ENTRY_WINDOW_OPEN][M15] poi=BTCUSDT:FVG:77 triggers=2plus:SWEEP_REC|CHOCH|CHOCH",
    poiSnapshot: routerRawSeedFvgStrong.poiSnapshot,
    barSnapshot: {
      close: 100.5,
      high: 101,
      low: 99.5,
    },
    expectedRR: 1.5,
    tpRefPrice: 108,
  },
  "router candidate addendum policy signal mapping exact"
);

assert.deepEqual(
  buildPolicySignalCandidateFromSeedViaDraft(routerRawSeedFvgStrong, {
    lastPrice: 100.5,
    midPrice: 100.45,
    tickSize: 0.1,
    ltAtr14: 2.5,
    atrLiq_14_atOpen: 2,
    confirmedTpPivots: tradeOpenConfirmedTpPivots,
  }),
  {
    ...buildPolicySignalCandidateFromSeed(routerRawSeedFvgStrong, {
      lastPrice: 100.5,
      midPrice: 100.45,
      tickSize: 0.1,
      ltAtr14: 2.5,
      expectedRR: 1.3,
      tpRefPrice: 101.7,
    }),
  },
  "router candidate addendum shared draft bridge locks tp ref and expected rr"
);

const routerCycleCandidateReaction = buildPolicySignalCandidateFromSeed(
  {
    ...routerRawSeedTrendlineWeak,
    candidateId: "K-2",
    tradeKey: "TK",
    eventName: "REACTION",
    ltf: "M5",
    triggersMode: "raw",
    triggers: ["CHOCH"],
  },
  {
    lastPrice: 100.5,
    midPrice: 100.4,
    tickSize: 0.1,
    ltAtr14: 1.2,
    expectedRR: 1.3,
    tpRefPrice: 104,
  }
)!;

const routerCycleCandidateEntry = buildPolicySignalCandidateFromSeed(
  {
    ...routerRawSeedTrendlineWeak,
    candidateId: "K-1",
    tradeKey: "TK",
    eventName: "ENTRY_WINDOW_OPEN",
    ltf: "M15",
    triggersMode: "2plus",
    triggers: ["A", "B"],
  },
  {
    lastPrice: 100.5,
    midPrice: 100.4,
    tickSize: 0.1,
    ltAtr14: 1.2,
    expectedRR: 1.3,
    tpRefPrice: 104,
  }
)!;

assert.equal(
  compareRouterCycleCandidates(
    routerCycleCandidateReaction,
    routerCycleCandidateEntry
  ) > 0,
  true,
  "router candidate addendum strongest compare prefers entry over reaction and m15 over m5"
);

assert.equal(
  selectStrongestRouterCycleCandidate([
    routerCycleCandidateReaction,
    routerCycleCandidateEntry,
  ])?.candidateId,
  "K-1",
  "router candidate addendum strongest coalescing picks one winner"
);

const routerCycleCandidateAltTrade = {
  ...routerCycleCandidateReaction,
  candidateId: "K-3",
  tradeKey: "TK-ALT",
};

assert.deepEqual(
  [...groupRouterCycleCandidatesByTradeKey([
    routerCycleCandidateReaction,
    routerCycleCandidateEntry,
    routerCycleCandidateAltTrade,
  ]).entries()].map(([tradeKey, items]) => ({
    tradeKey,
    ids: items.map((item) => item.candidateId),
  })),
  [
    { tradeKey: "TK", ids: ["K-2", "K-1"] },
    { tradeKey: "TK-ALT", ids: ["K-3"] },
  ],
  "router candidate addendum groups cycle candidates by tradeKey"
);

assert.deepEqual(
  coalesceRouterCycleCandidates([
    routerCycleCandidateReaction,
    routerCycleCandidateEntry,
    routerCycleCandidateAltTrade,
  ]).map((item) => item.candidateId),
  ["K-1", "K-3"],
  "router candidate addendum coalesces strongest one per tradeKey"
);

assert.deepEqual(
  {
    open: hasActiveTradeKey("TK", [
      { tradeKey: "TK", status: "OPEN" },
    ]),
    closing: hasActiveTradeKey("TK", [
      { tradeKey: "TK", status: "CLOSING" },
    ]),
    closed: hasActiveTradeKey("TK", [
      { tradeKey: "TK", status: "CLOSED" },
    ]),
  },
  {
    open: true,
    closing: true,
    closed: false,
  },
  "router candidate addendum active tradeKey blocks open and closing only"
);

assert.deepEqual(
  filterRouterCycleSendOpenCandidates(
    [
      routerCycleCandidateReaction,
      routerCycleCandidateEntry,
      routerCycleCandidateAltTrade,
    ],
    [{ tradeKey: "TK", status: "OPEN" }]
  ).map((item) => item.candidateId),
  ["K-3"],
  "router candidate addendum filters active tradeKey after strongest coalescing"
);

assert.deepEqual(
  {
    statuses: [...TradeLifecycleConstants.TRADE_PLAN_STATUSES],
    reasons: [...TradeLifecycleConstants.TRADE_SUPPRESS_REASONS],
  },
  {
    statuses: ["OPEN", "CLOSING", "CLOSED"],
    reasons: [
      "DUPLICATE",
      "POLICY_MISSING",
      "HALT_OR_BLOCK",
      "LATE_LOW_CONV",
      "INVALID_INPUT",
      "DATA_GAP",
      "DEDUP_ZONE",
    ],
  },
  "trade lifecycle status and suppress enums"
);

assert.equal(
  isContinuousM5Close(
    "2026-06-01T00:00:00Z",
    "2026-06-01T00:05:00Z"
  ),
  true,
  "trade intake exact 5m continuity passes"
);

assert.deepEqual(
  evaluateTradeOpenSuppression({
    payload: tradeSendOpen,
    tickSize: 0.1,
    prevM5CloseTime: "2026-06-01T00:00:00Z",
    currM5CloseTime: "2026-06-01T00:10:00Z",
    activePlans: [],
  }),
  {
    decision: "SUPPRESS",
    reason: "DATA_GAP",
    planKey: tradeSendOpen.planKey,
    planId: tradeSendOpen.planId,
    zoneKey: "BTCUSDT|LONG|995~1005",
  },
  "trade intake detects data gap when m5 close jumps forward"
);

assert.deepEqual(
  evaluateTradeOpenSuppression({
    payload: tradeSendOpen,
    tickSize: 0.1,
    prevM5CloseTime: "2026-06-01T00:05:00Z",
    currM5CloseTime: "2026-06-01T00:00:00Z",
    activePlans: [],
  }),
  {
    decision: "SUPPRESS",
    reason: "DATA_GAP",
    planKey: tradeSendOpen.planKey,
    planId: tradeSendOpen.planId,
    zoneKey: "BTCUSDT|LONG|995~1005",
  },
  "trade intake detects data gap on out of order close"
);

assert.equal(
  buildTradeZoneKey(tradeSendOpen, 0.1),
  "BTCUSDT|LONG|995~1005",
  "trade intake zone key uses provided poi zone first"
);

assert.equal(
  buildTradeZoneKey(
    {
      ...tradeSendOpen,
      intent: {
        ...tradeSendOpen.intent,
        poiZoneBottom: undefined,
        poiZoneTop: undefined,
      },
    },
    0.1
  ),
  "BTCUSDT|LONG|950~1000",
  "trade intake zone key falls back to boundary invalidation range"
);

assert.deepEqual(
  evaluateTradeOpenSuppression({
    payload: tradeSendOpen,
    tickSize: 0.1,
    prevM5CloseTime: "2026-06-01T00:00:00Z",
    currM5CloseTime: "2026-06-01T00:05:00Z",
    activePlans: tradeDuplicatePlans,
  }),
  {
    decision: "SUPPRESS",
    reason: "DEDUP_ZONE",
    planKey: tradeSendOpen.planKey,
    planId: tradeSendOpen.planId,
    zoneKey: "BTCUSDT|LONG|995~1005",
  },
  "trade intake duplicate active zone suppresses dedup_zone"
);

assert.deepEqual(
  evaluateTradeOpenSuppression({
    payload: tradeSendOpen,
    tickSize: 0.1,
    prevM5CloseTime: "2026-06-01T00:00:00Z",
    currM5CloseTime: "2026-06-01T00:05:00Z",
    activePlans: [tradeClosedPlanSameZone],
  }),
  {
    decision: "ALLOW",
    reason: null,
    planKey: tradeSendOpen.planKey,
    planId: tradeSendOpen.planId,
    zoneKey: "BTCUSDT|LONG|995~1005",
  },
  "trade intake ignores closed plan and allows open"
);

assert.deepEqual(
  {
    ok: hasRequiredOpenIntentFields(tradeSendOpen.intent),
    fail: hasRequiredOpenIntentFields({
      ...tradeSendOpen.intent,
      symbol: "",
    }),
  },
  {
    ok: true,
    fail: false,
  },
  "trade open required fields validator"
);

assert.deepEqual(
  evaluateTradeOpen({
    ...tradeOpenBaseArgs,
    payload: {
      ...tradeSendOpen,
      intent: {
        ...tradeSendOpen.intent,
        policySnapshot: undefined as never,
      },
    } as never,
  }),
  {
    decision: "SUPPRESS",
    reason: "POLICY_MISSING",
  },
  "trade open suppresses policy missing"
);

assert.deepEqual(
  {
    block: evaluateTradeOpen({
      ...tradeOpenBaseArgs,
      payload: {
        ...tradeSendOpen,
        intent: {
          ...tradeSendOpen.intent,
          policySnapshot: {
            ...tradeSendOpen.intent.policySnapshot,
            decision: "BLOCK",
          },
        },
      },
    }),
    halt: evaluateTradeOpen({
      ...tradeOpenBaseArgs,
      payload: {
        ...tradeSendOpen,
        intent: {
          ...tradeSendOpen.intent,
          policySnapshot: {
            ...tradeSendOpen.intent.policySnapshot,
            regimeState: "HALT",
          },
        },
      },
    }),
  },
  {
    block: {
      decision: "SUPPRESS",
      reason: "HALT_OR_BLOCK",
    },
    halt: {
      decision: "SUPPRESS",
      reason: "HALT_OR_BLOCK",
    },
  },
  "trade open suppresses halt or block"
);

assert.equal(
  computeTradeEntryRefPrice(100.24, 0.1),
  100.2,
  "trade open computes entryRef from signal bar close"
);

assert.equal(
  computeStopBuffer(0.1, 2),
  0.3,
  "trade open computes stopBuffer with tick floor"
);

assert.equal(
  computeStopPrice("LONG", 100.2, 100.35, 0.1, 0.1),
  100.1,
  "trade open computes stopPrice with safety clamp"
);

assert.deepEqual(
  {
    ideal: computeEntryQuality(100.04, 100, 1),
    valid: computeEntryQuality(100.08, 100, 1),
    late: computeEntryQuality(100.11, 100, 1),
  },
  {
    ideal: "IDEAL",
    valid: "VALID",
    late: "LATE",
  },
  "trade open computes entryQuality ideal valid late"
);

assert.deepEqual(
  {
    d1Strong: getRrMaxUsed("D1_POI", "STRONG"),
    d1: getRrMaxUsed("D1_POI", "WEAK"),
    h4: getRrMaxUsed("H4_CORE", "STRONG"),
    other: getRrMaxUsed("OTHER", "NONE"),
  },
  {
    d1Strong: 4.5,
    d1: 4,
    h4: 3.5,
    other: 3,
  },
  "trade open rr max mapping"
);

assert.deepEqual(
  {
    long: computeTpRr("LONG", 100.2, 94.7, 1.5, 3.5, 0.1),
    short: computeTpRr("SHORT", 100.2, 105.7, 1.5, 3, 0.1),
  },
  {
    long: 108.5,
    short: 91.9,
  },
  "trade open tpRr formula"
);

assert.deepEqual(
  computeTpPrice({
    dir: "LONG",
    entryRefPrice: 100.2,
    stopPrice: 94.7,
    rrBase: 1.5,
    rrMaxUsed: 3.5,
    tickSize: 0.1,
    openTime: "2026-06-01T00:00:00Z",
    atrLiq_14_atOpen: 2,
    tpLiqTf: "H1",
    confirmedPivots: tradeOpenConfirmedTpPivots,
  }),
  {
    tpPrice: 108,
    tpMode: "LIQ",
  },
  "trade open tpLiq chooses nearest confirmed level and mode liq"
);

assert.deepEqual(
  {
    d1: getTimeoutMinutes("D1_POI"),
    h4: getTimeoutMinutes("H4_CORE"),
    h1: getTimeoutMinutes("H1_SETUP"),
    m30: getTimeoutMinutes("M30_SETUP"),
    other: getTimeoutMinutes("OTHER"),
    due: computeTimeoutDueTime("2026-06-01T00:00:00Z", 240),
  },
  {
    d1: 360,
    h4: 240,
    h1: 120,
    m30: 90,
    other: 120,
    due: "2026-06-01T04:00:00.000Z",
  },
  "trade open timeout mapping"
);

assert.deepEqual(
  buildTradePlanDraft({
    intent: tradeSendOpen.intent,
    signalBarClose: tradeOpenBaseArgs.signalBarClose,
    tickSize: tradeOpenBaseArgs.tickSize,
    atrM5_14_atOpen: tradeOpenBaseArgs.atrM5_14_atOpen,
    atrLiq_14_atOpen: tradeOpenBaseArgs.atrLiq_14_atOpen,
    confirmedTpPivots: tradeOpenBaseArgs.confirmedTpPivots,
  }),
  {
    entryRefPrice: 100.2,
    stopPrice: 94.7,
    tpPrice: 108,
    tpMode: "LIQ",
    rrBase: 1.5,
    rrChosen: 1.5,
    rrMaxUsed: 3.5,
    atrM5_14_atOpen: 2.1,
    stopBuffer: 0.3,
    entryQuality: "VALID",
    timeoutMinutes: 240,
    timeoutDueTime: "2026-06-01T04:00:00.000Z",
    tpLiqTf: "H1",
    atrLiq_14_atOpen: 2,
  },
  "trade open draft helper matches frozen math"
);

assert.deepEqual(
  buildTradePlan({
    payload: tradeSendOpen,
    draft: buildTradePlanDraft({
      intent: tradeSendOpen.intent,
      signalBarClose: tradeOpenBaseArgs.signalBarClose,
      tickSize: tradeOpenBaseArgs.tickSize,
      atrM5_14_atOpen: tradeOpenBaseArgs.atrM5_14_atOpen,
      atrLiq_14_atOpen: tradeOpenBaseArgs.atrLiq_14_atOpen,
      confirmedTpPivots: tradeOpenBaseArgs.confirmedTpPivots,
    })!,
  }),
  evaluateTradeOpen(tradeOpenBaseArgs)!.plan!,
  "trade open build trade plan reuses draft exactly"
);

assert.deepEqual(
  evaluateTradeOpen(tradeOpenBaseArgs),
  {
    decision: "OPEN",
    reason: null,
    plan: {
      planId: tradeSendOpen.planId,
      planKey: tradeSendOpen.planKey,
      symbol: "BTCUSDT",
      dir: "LONG",
      source: "FVG",
      poiTier: "H4_CORE",
      poiId: "POI-1",
      invalidationRef: {
        source: "FVG",
        refId: "POI-1",
      },
      eventType: "ENTRY_WINDOW_OPEN",
      tf: "H4",
      openTime: "2026-06-01T00:00:00Z",
      entryRefPrice: 100.2,
      entryBoundaryPrice: 100,
      hardInvalidationPrice: 95,
      stopPrice: 94.7,
      tpPrice: 108,
      tpMode: "LIQ",
      rrBase: 1.5,
      rrChosen: 1.5,
      rrMaxUsed: 3.5,
      atrM5_14_atOpen: 2.1,
      stopBuffer: 0.3,
      entryQuality: "VALID",
      timeoutMinutes: 240,
      timeoutDueTime: "2026-06-01T04:00:00.000Z",
      tpLiqTf: "H1",
      atrLiq_14_atOpen: 2,
      status: "OPEN",
      mfeR: 0,
      maeR: 0,
      score: 92,
      collabStrength: "STRONG",
      entryFillPrice: 100.5,
      riskPctAtOpen: policyHappyResult.suggestedRiskPct,
      poiClusterKey: policyHappyResult.derived.poiClusterKey,
      edgeSigFine: "FVG|H4_CORE|BULL|ENTRY_WINDOW_OPEN|OK",
      edgeSigMid: "FVG|H4_CORE|BULL|OK",
      edgeSigCoarse: "H4_CORE|BULL|OK",
      tags: ["A", "B", "RR_OK"],
      policySnapshot: {
        decision: "ALLOW",
        regimeState: "NORMAL",
        c_bps: policyHappyResult.derived.c_bps_roundtrip,
        sc: policyHappyResult.derived.SC,
      },
    },
  },
  "trade open builds frozen trade plan exactly"
);

assert.deepEqual(
  {
    monitorTf: TradeLifecycleConstants.TRADE_MONITOR_TF,
    closeOutcomes: [...TradeLifecycleConstants.TRADE_CLOSE_OUTCOMES],
    timeoutSigns: [...TradeLifecycleConstants.TRADE_TIMEOUT_SIGNS],
    m5: isTradeMonitorTf("M5"),
    h1: isTradeMonitorTf("H1"),
  },
  {
    monitorTf: "M5",
    closeOutcomes: ["HARD_TP", "HARD_SL", "SOFT_INVALID", "TIMEOUT"],
    timeoutSigns: ["PROFIT", "LOSS", "FLAT", "na"],
    m5: true,
    h1: false,
  },
  "trade monitor tf constant and enums"
);

assert.deepEqual(
  {
    openTimeBar: shouldEvaluateTradeMonitorBar(
      tradeMonitorLongPlan,
      Date.UTC(2026, 5, 1, 0, 0, 0)
    ),
    nextBar: shouldEvaluateTradeMonitorBar(
      tradeMonitorLongPlan,
      Date.UTC(2026, 5, 1, 0, 5, 0)
    ),
  },
  {
    openTimeBar: false,
    nextBar: true,
  },
  "trade monitor excludes openTime bar"
);

assert.deepEqual(
  {
    favR: computeTradeFavR(tradeMonitorLongPlan, tradeMonitorEvalBar),
    advR: computeTradeAdvR(tradeMonitorLongPlan, tradeMonitorEvalBar),
  },
  {
    favR: 0.4000000000000005,
    advR: 0.20000000000000154,
  },
  "trade monitor long fav adv r formula"
);

assert.deepEqual(
  {
    favR: computeTradeFavR(tradeMonitorShortPlan, {
      high: 101.3,
      low: 98.0,
    }),
    advR: computeTradeAdvR(tradeMonitorShortPlan, {
      high: 101.3,
      low: 98.0,
    }),
  },
  {
    favR: 0.4000000000000005,
    advR: 0.19999999999999896,
  },
  "trade monitor short fav adv r formula"
);

assert.deepEqual(
  evaluateTradeHardTpSlHit(tradeMonitorLongPlan, tradeMonitorHardTpBar),
  {
    slHit: false,
    tpHit: true,
    bothHit: false,
  },
  "trade monitor hard tp sl wick logic"
);

assert.equal(
  resolveTradeCloseOutcome({
    slHit: true,
    tpHit: true,
    softInvalid: true,
    timeoutHit: true,
  }),
  "HARD_SL",
  "trade monitor both hit resolves to hard sl"
);

assert.equal(
  evaluateTradeSoftInvalid(
    tradeMonitorLongPlan,
    {
      close: 94.6,
      closeTime: Date.UTC(2026, 5, 1, 0, 5, 0),
    },
    0.1
  ),
  true,
  "trade monitor soft invalid uses close rule"
);

assert.equal(
  evaluateTradeTimeoutHit(
    tradeMonitorLongPlan,
    tradeMonitorLongPlan.timeoutDueTime
  ),
  true,
  "trade monitor timeout hits on due bar"
);

assert.deepEqual(
  {
    hardSl: resolveTradeExitPrice(
      tradeMonitorLongPlan,
      tradeMonitorTimeoutBar,
      "HARD_SL",
      0.1
    ),
    hardTp: resolveTradeExitPrice(
      tradeMonitorLongPlan,
      tradeMonitorTimeoutBar,
      "HARD_TP",
      0.1
    ),
    softInvalid: resolveTradeExitPrice(
      tradeMonitorLongPlan,
      tradeMonitorTimeoutBar,
      "SOFT_INVALID",
      0.1
    ),
    timeout: resolveTradeExitPrice(
      tradeMonitorLongPlan,
      tradeMonitorTimeoutBar,
      "TIMEOUT",
      0.1
    ),
    rounded: roundTradeMonitorTick(100.26, 0.1),
  },
  {
    hardSl: 94.7,
    hardTp: 108,
    softInvalid: 100.3,
    timeout: 100.3,
    rounded: 100.3,
  },
  "trade monitor exit price mapping"
);

assert.deepEqual(
  {
    status: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorEvalBar,
      tickSize: 0.1,
      invalidTime: null,
    }).status,
    mfeR: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorEvalBar,
      tickSize: 0.1,
      invalidTime: null,
    }).mfeR,
    maeR: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorEvalBar,
      tickSize: 0.1,
      invalidTime: null,
    }).maeR,
    outcome: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorEvalBar,
      tickSize: 0.1,
      invalidTime: null,
    }).outcome,
  },
  {
    status: "OPEN",
    mfeR: 0.4000000000000005,
    maeR: 0.20000000000000154,
    outcome: undefined,
  },
  "trade monitor updates open plan mfe mae when no close"
);

assert.deepEqual(
  {
    status: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorHardSlBar,
      tickSize: 0.1,
      invalidTime: null,
    }).status,
    outcome: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorHardSlBar,
      tickSize: 0.1,
      invalidTime: null,
    }).outcome,
    exitPrice: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorHardSlBar,
      tickSize: 0.1,
      invalidTime: null,
    }).exitPrice,
    bothHit: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorHardSlBar,
      tickSize: 0.1,
      invalidTime: null,
    }).bothHit,
    closeTime: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorHardSlBar,
      tickSize: 0.1,
      invalidTime: null,
    }).closeTime,
  },
  {
    status: "CLOSED",
    outcome: "HARD_SL",
    exitPrice: 94.7,
    bothHit: false,
    closeTime: "2026-06-01T00:05:00.000Z",
  },
  "trade monitor closes plan with hard sl"
);

assert.deepEqual(
  {
    status: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorTimeoutBar,
      tickSize: 0.1,
      invalidTime: null,
    }).status,
    outcome: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorTimeoutBar,
      tickSize: 0.1,
      invalidTime: null,
    }).outcome,
    exitPrice: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorTimeoutBar,
      tickSize: 0.1,
      invalidTime: null,
    }).exitPrice,
    closeTime: applyTradeMonitorOnBar({
      plan: tradeMonitorLongPlan,
      bar: tradeMonitorTimeoutBar,
      tickSize: 0.1,
      invalidTime: null,
    }).closeTime,
  },
  {
    status: "CLOSED",
    outcome: "TIMEOUT",
    exitPrice: 100.3,
    closeTime: "2026-06-01T04:00:00.000Z",
  },
  "trade monitor closes plan with timeout"
);

assert.deepEqual(
  {
    profit: computeTradeTimeoutSign({
      ...tradeReviewTimeoutPlan,
      outcome: "TIMEOUT",
      rGross: 0.11,
    }),
    loss: computeTradeTimeoutSign({
      ...tradeReviewTimeoutPlan,
      outcome: "TIMEOUT",
      rGross: -0.11,
    }),
    flat: computeTradeTimeoutSign({
      ...tradeReviewTimeoutPlan,
      outcome: "TIMEOUT",
      rGross: 0.05,
    }),
    hardTp: computeTradeTimeoutSign({
      ...tradeReviewTimeoutPlan,
      outcome: "HARD_TP",
      rGross: 0.11,
    }),
    hardSl: computeTradeTimeoutSign({
      ...tradeReviewTimeoutPlan,
      outcome: "HARD_SL",
      rGross: -0.11,
    }),
    softInvalid: computeTradeTimeoutSign({
      ...tradeReviewTimeoutPlan,
      outcome: "SOFT_INVALID",
      rGross: 0.05,
    }),
  },
  {
    profit: "PROFIT",
    loss: "LOSS",
    flat: "FLAT",
    hardTp: "na",
    hardSl: "na",
    softInvalid: "na",
  },
  "trade review timeoutSign rules"
);

assert.deepEqual(
  {
    long: computeTradeRGross(tradeReviewHardSlPlan),
    short: computeTradeRGross(tradeReviewShortClosedPlan),
  },
  {
    long: -1,
    short: 1,
  },
  "trade review rGross long short"
);

assert.equal(
  computeTradeRAfterCost(tradeReviewHardSlPlan),
  -1.0725826865671608,
  "trade review rAfterCost formula"
);

assert.deepEqual(
  {
    rFillGross: computeTradeRFillGross(tradeReviewFillFallbackPlan),
    rFillAfterCost: computeTradeRFillAfterCost(tradeReviewFillFallbackPlan),
  },
  {
    rFillGross: 1.0181818181818172,
    rFillAfterCost: 0.9495832112166461,
  },
  "trade review rFill fallback when sFill <= 0"
);

assert.deepEqual(
  collectTradeStrengthCodes(tradeReviewStrengthPlan),
  [
    "S_COLLAB_STRONG",
    "S_ENTRY_IDEAL",
    "S_POI_TIER_HIGH",
    "S_POLICY_OK",
    "S_SCORE_HIGH",
    "S_TP_MODE_LIQ",
  ],
  "trade review strength code inclusion"
);

assert.deepEqual(
  {
    hardSl: collectTradeWeaknessCodes(tradeReviewWeakPlan),
    timeoutLoss: collectTradeWeaknessCodes({
      ...tradeReviewTimeoutPlan,
      outcome: "TIMEOUT",
      rGross: -0.11,
      mfeR: 1.2,
    }),
  },
  {
    hardSl: [
      "W_BOTH_HIT",
      "W_ENTRY_LATE",
      "W_GAVE_BACK_PROFIT",
      "W_POLICY_CAUTION",
      "W_RR_LOW",
      "W_SC_LOW",
      "W_TP_MODE_RR",
    ],
    timeoutLoss: ["W_GAVE_BACK_PROFIT"],
  },
  "trade review weakness code inclusion"
);

assert.deepEqual(
  {
    strength: collectTradeStrengthCodes(tradeReviewStrengthPlan),
    weakness: collectTradeWeaknessCodes(tradeReviewWeakPlan),
  },
  {
    strength: [
      "S_COLLAB_STRONG",
      "S_ENTRY_IDEAL",
      "S_POI_TIER_HIGH",
      "S_POLICY_OK",
      "S_SCORE_HIGH",
      "S_TP_MODE_LIQ",
    ],
    weakness: [
      "W_BOTH_HIT",
      "W_ENTRY_LATE",
      "W_GAVE_BACK_PROFIT",
      "W_POLICY_CAUTION",
      "W_RR_LOW",
      "W_SC_LOW",
      "W_TP_MODE_RR",
    ],
  },
  "trade review weak/strong codes are unique sorted"
);

assert.deepEqual(
  finalizeClosedTradeReview(tradeReviewWeakPlan),
  {
    ...tradeReviewWeakPlan,
    rGross: -1,
    rAfterCost: -1.0725826865671608,
    rFillGross: -1,
    rFillAfterCost: -1.0690344827586176,
    timeoutSign: "na",
    strengthCodes: [
      "S_COLLAB_STRONG",
      "S_POI_TIER_HIGH",
      "S_SCORE_HIGH",
    ],
    weaknessCodes: [
      "W_BOTH_HIT",
      "W_ENTRY_LATE",
      "W_GAVE_BACK_PROFIT",
      "W_POLICY_CAUTION",
      "W_RR_LOW",
      "W_SC_LOW",
      "W_TP_MODE_RR",
    ],
  },
  "trade review finalize closed trade attaches derived close fields"
);

assert.deepEqual(
  {
    hardTp: getTradeReplayRootMessage("HARD_TP"),
    hardSl: getTradeReplayRootMessage("HARD_SL"),
    softInvalid: getTradeReplayRootMessage("SOFT_INVALID"),
    timeout: getTradeReplayRootMessage("TIMEOUT"),
  },
  {
    hardTp: "\uC775\uC808(TP) \uCCB4\uACB0",
    hardSl: "\uD558\uB4DC \uC2A4\uD0D1(SL) \uCCB4\uACB0",
    softInvalid: "\uC885\uAC00 \uAE30\uC900 \uBB34\uD6A8\uD654(\uC544\uC774\uB514\uC5B4 \uBD95\uAD34)",
    timeout: "\uD0C0\uC784\uC544\uC6C3(\uAE30\uB300 \uC9C4\uD589 \uBD80\uC7AC)",
  },
  "trade replay root message mapping"
);

assert.deepEqual(
  {
    profit: getTradeTimeoutSubMessage("PROFIT"),
    loss: getTradeTimeoutSubMessage("LOSS"),
    flat: getTradeTimeoutSubMessage("FLAT"),
    na: getTradeTimeoutSubMessage("na"),
  },
  {
    profit: "\uC218\uC775 \uAD6C\uAC04\uC5D0\uC11C \uC2DC\uAC04 \uC885\uB8CC",
    loss: "\uC190\uC2E4 \uAD6C\uAC04\uC5D0\uC11C \uBC18\uB4F1 \uC2E4\uD328\uB85C \uC2DC\uAC04 \uC885\uB8CC",
    flat: "\uBC29\uD5A5\uC131 \uBD80\uC871\uC73C\uB85C \uC2DC\uAC04 \uC885\uB8CC",
    na: null,
  },
  "trade replay timeout sub message mapping"
);

assert.deepEqual(
  pickTopStrengthCodes(tradeReplayHardTpPlan),
  ["S_COLLAB_STRONG", "S_ENTRY_IDEAL"],
  "trade replay picks top two strengths for hard tp"
);

assert.deepEqual(
  pickTopWeaknessCodes(tradeReviewedClosePlan),
  ["W_RR_LOW", "W_GAVE_BACK_PROFIT"],
  "trade replay picks top two weaknesses for hard sl"
);

assert.equal(
  buildTradeReplayNote(tradeReplayTimeoutLossPlan),
  "\uD0C0\uC784\uC544\uC6C3(\uAE30\uB300 \uC9C4\uD589 \uBD80\uC7AC) | \uC190\uC2E4 \uAD6C\uAC04\uC5D0\uC11C \uBC18\uB4F1 \uC2E4\uD328\uB85C \uC2DC\uAC04 \uC885\uB8CC | \uBCF4\uC644: W_GAVE_BACK_PROFIT, W_POLICY_CAUTION",
  "trade replay timeout includes timeout sub message"
);

assert.equal(
  formatTradePlanCloseEvent(tradeReviewedClosePlan),
  "[PLAN][CLOSE] time=2026-06-01T00:05:00.000Z planId=BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z symbol=BTCUSDT dir=LONG outcome=HARD_SL exit=94.7 bothHit=true timeoutSign=na mfeR=1.20 maeR=1.02 openTime=2026-06-01T00:00:00Z closeTime=2026-06-01T00:05:00.000Z rGross=-1.00 rAfterCost=-1.07 rFillGross=-1.00 rFillAfterCost=-1.07 strengths=S_COLLAB_STRONG|S_POI_TIER_HIGH|S_SCORE_HIGH weaknesses=W_BOTH_HIT|W_ENTRY_LATE|W_GAVE_BACK_PROFIT|W_POLICY_CAUTION|W_RR_LOW|W_SC_LOW|W_TP_MODE_RR",
  "trade close formatter exact string"
);

assert.deepEqual(
  {
    high: getRouterCloseSeverity(90),
    mid: getRouterCloseSeverity(80),
    low: getRouterCloseSeverity(79),
    defaultMid: getRouterCloseSeverity(undefined),
  },
  {
    high: "HIGH",
    mid: "MID",
    low: "LOW",
    defaultMid: "MID",
  },
  "router close severity mapping"
);

assert.equal(
  buildRouterSendCloseId(tradeReviewedClosePlan.planId),
  `${tradeReviewedClosePlan.planId}|CLOSE`,
  "router send close id formula"
);

assert.deepEqual(
  buildRouterSendClosePayload(tradeReviewedClosePlan),
  {
    id: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z|CLOSE",
    type: "SEND_CLOSE",
    symbol: "BTCUSDT",
    tf: "H4",
    time: "2026-06-01T00:05:00.000Z",
    direction: "LONG",
    planId: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
    exitTime: "2026-06-01T00:05:00.000Z",
    outcome: "HARD_SL",
    exitPrice: 94.7,
    rGross: -1,
    mfeR: 1.2,
    maeR: 1.0181818181818196,
    bothHit: true,
    weaknessCodes: [
      "W_BOTH_HIT",
      "W_ENTRY_LATE",
      "W_GAVE_BACK_PROFIT",
      "W_POLICY_CAUTION",
      "W_RR_LOW",
      "W_SC_LOW",
      "W_TP_MODE_RR",
    ],
    replayNote: "\uD558\uB4DC \uC2A4\uD0D1(SL) \uCCB4\uACB0 | \uBCF4\uC644: W_RR_LOW, W_GAVE_BACK_PROFIT",
    policyState: "CAUTION",
    entryQuality: "LATE",
    collabStrength: "STRONG",
    score: 92,
    severity: "HIGH",
    poiRef: "POI-1",
  },
  "router send close payload exact"
);

assert.equal(
  hasRequiredRouterSendClosePayloadFields(
    buildRouterSendClosePayload(tradeReviewedClosePlan)
  ),
  true,
  "router send close validator passes"
);

assert.equal(
  hasRequiredRouterSendClosePayloadFields({
    ...buildRouterSendClosePayload(tradeReviewedClosePlan),
    planId: "",
  }),
  false,
  "router send close validator fails missing planId"
);

assert.equal(
  buildRouterSendClosePayload(tradeReviewedClosePlan).replayNote,
  "\uD558\uB4DC \uC2A4\uD0D1(SL) \uCCB4\uACB0 | \uBCF4\uC644: W_RR_LOW, W_GAVE_BACK_PROFIT",
  "router send close payload includes replayNote"
);

assert.deepEqual(
  {
    referenceLeverage: DEFAULT_TELEGRAM_REFERENCE_LEVERAGE,
    retryDelays: [...TELEGRAM_RETRY_DELAYS_MIN],
  },
  {
    referenceLeverage: 20,
    retryDelays: [1, 5, 15],
  },
  "telegram constants and defaults"
);

assert.deepEqual(
  loadTelegramDispatchConfig({}),
  {
    enabled: false,
    botToken: null,
    chatId: null,
  },
  "telegram dispatch config defaults disabled"
);

assert.deepEqual(
  {
    disabled: evaluateTelegramDispatchReadiness({
      enabled: false,
      botToken: "token",
      chatId: "chat",
    }),
    missingToken: evaluateTelegramDispatchReadiness({
      enabled: true,
      botToken: null,
      chatId: "chat",
    }),
    missingChat: evaluateTelegramDispatchReadiness({
      enabled: true,
      botToken: "token",
      chatId: null,
    }),
    ok: evaluateTelegramDispatchReadiness({
      enabled: true,
      botToken: "token",
      chatId: "chat",
    }),
  },
  {
    disabled: {
      shouldDispatch: false,
      reason: "TELEGRAM_DISABLED",
    },
    missingToken: {
      shouldDispatch: false,
      reason: "MISSING_BOT_TOKEN",
    },
    missingChat: {
      shouldDispatch: false,
      reason: "MISSING_CHAT_ID",
    },
    ok: {
      shouldDispatch: true,
      reason: "OK",
    },
  },
  "telegram dispatch readiness rules"
);

assert.deepEqual(
  {
    stopPct: computeDirectionalPriceMovePct({
      dir: "LONG",
      fromPrice: tradeMonitorLongPlan.entryRefPrice,
      toPrice: tradeMonitorLongPlan.stopPrice,
    }),
    tpPct: computeDirectionalPriceMovePct({
      dir: "LONG",
      fromPrice: tradeMonitorLongPlan.entryRefPrice,
      toPrice: tradeMonitorLongPlan.tpPrice,
    }),
    closePct: computeDirectionalPriceMovePct({
      dir: "LONG",
      fromPrice:
        tradeReviewedClosePlan.entryFillPrice ??
        tradeReviewedClosePlan.entryRefPrice,
      toPrice: tradeReviewedClosePlan.exitPrice!,
    }),
    ref20x: computeReferenceLeverageRoiPct(-5.77, 20),
  },
  {
    stopPct: -5.489021956087824,
    tpPct: 7.784431137724549,
    closePct: -5.771144278606962,
    ref20x: -115.39999999999999,
  },
  "telegram price move and reference leverage helpers"
);

assert.equal(
  formatTelegramTradeOpenMessage({
    ...tradeMonitorLongPlan,
    entryQuality: "IDEAL",
    collabStrength: "STRONG",
  }),
  ["[OPEN] BTCUSDT LONG H4", "\uC2DC\uAC01: 2026-06-01T00:00:00Z", "\uC9C4\uC785 \uC774\uC720: FVG / H4_CORE / STRONG / IDEAL", "\uC9C4\uC785\uAC00: 100.20", "\uC190\uC808\uAC00: 94.70 (-5.49%, \uCC38\uACE020x -109.78%)", "\uC775\uC808\uAC00: 108.00 (+7.78%, \uCC38\uACE020x +155.69%)", "RR: 1.50 | \uC815\uCC45: NORMAL"].join("\n"),
  "telegram open formatter exact"
);

assert.equal(
  formatTelegramTradeCloseMessage(tradeReviewedClosePlan),
  ["[CLOSE] BTCUSDT LONG H4", "\uACB0\uACFC: HARD_SL", "\uC885\uB8CC\uC2DC\uAC01: 2026-06-01T00:05:00.000Z", "\uC885\uB8CC\uAC00: 94.70", "\uAC00\uACA9\uBCC0\uB3D9: -5.77% | \uCC38\uACE020x: -115.42%", "R: -1.00R", "\uC790\uB3D9\uBCF5\uAE30: " + buildTradeReplayNote(tradeReviewedClosePlan), "\uC57D\uC810: W_BOTH_HIT, W_ENTRY_LATE, W_GAVE_BACK_PROFIT, W_POLICY_CAUTION, W_RR_LOW, W_SC_LOW, W_TP_MODE_RR"].join("\n"),
  "telegram close formatter exact"
);

assert.deepEqual(
  {
    key: buildTelegramOpenIdempotencyKey(tradeMonitorLongPlan.planId),
    row: buildTelegramOpenOutboxCreateInput({
      ...tradeMonitorLongPlan,
      entryQuality: "IDEAL",
      collabStrength: "STRONG",
    }),
  },
  {
    key: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z|TELEGRAM|OPEN",
    row: {
      idempotencyKey:
        "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z|TELEGRAM|OPEN",
      messageType: "SEND_OPEN",
      planId: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
      symbol: "BTCUSDT",
      tf: "H4",
      direction: "LONG",
      payloadText:
        ["[OPEN] BTCUSDT LONG H4", "\uC2DC\uAC01: 2026-06-01T00:00:00Z", "\uC9C4\uC785 \uC774\uC720: FVG / H4_CORE / STRONG / IDEAL", "\uC9C4\uC785\uAC00: 100.20", "\uC190\uC808\uAC00: 94.70 (-5.49%, \uCC38\uACE020x -109.78%)", "\uC775\uC808\uAC00: 108.00 (+7.78%, \uCC38\uACE020x +155.69%)", "RR: 1.50 | \uC815\uCC45: NORMAL"].join("\n"),
    },
  },
  "telegram open outbox create input exact"
);

assert.deepEqual(
  {
    key: buildTelegramCloseIdempotencyKey(tradeReviewedClosePlan.planId),
    row: buildTelegramCloseOutboxCreateInput(tradeReviewedClosePlan),
  },
  {
    key: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z|TELEGRAM|CLOSE",
    row: {
      idempotencyKey:
        "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z|TELEGRAM|CLOSE",
      messageType: "SEND_CLOSE",
      planId: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
      symbol: "BTCUSDT",
      tf: "H4",
      direction: "LONG",
      payloadText:
        ["[CLOSE] BTCUSDT LONG H4", "\uACB0\uACFC: HARD_SL", "\uC885\uB8CC\uC2DC\uAC01: 2026-06-01T00:05:00.000Z", "\uC885\uB8CC\uAC00: 94.70", "\uAC00\uACA9\uBCC0\uB3D9: -5.77% | \uCC38\uACE020x: -115.42%", "R: -1.00R", "\uC790\uB3D9\uBCF5\uAE30: " + buildTradeReplayNote(tradeReviewedClosePlan), "\uC57D\uC810: W_BOTH_HIT, W_ENTRY_LATE, W_GAVE_BACK_PROFIT, W_POLICY_CAUTION, W_RR_LOW, W_SC_LOW, W_TP_MODE_RR"].join("\n"),
    },
  },
  "telegram close outbox create input exact"
);

assert.deepEqual(
  {
    first: computeTelegramNextAttemptAt(
      1,
      new Date("2026-06-01T00:00:00.000Z")
    ).toISOString(),
    second: computeTelegramNextAttemptAt(
      2,
      new Date("2026-06-01T00:00:00.000Z")
    ).toISOString(),
    later: computeTelegramNextAttemptAt(
      4,
      new Date("2026-06-01T00:00:00.000Z")
    ).toISOString(),
  },
  {
    first: "2026-06-01T00:01:00.000Z",
    second: "2026-06-01T00:05:00.000Z",
    later: "2026-06-01T00:15:00.000Z",
  },
  "telegram retry backoff mapping"
);

appendSignalEvent({
  id: "alert-open-113",
  type: "SEND_OPEN",
  symbol: "ALRTBTC",
  tf: "H4",
  time: "2026-06-01T00:00:00Z",
  direction: "LONG",
  planId: "ALRTBTC|LONG|POI-OPEN",
  poiRef: "POI-OPEN",
  entryRefPrice: 100.5,
  stopPrice: 95,
  tpPrice: 109.5,
  rrChosen: 1.8,
});

appendSignalEvent({
  id: "alert-close-113",
  type: "SEND_CLOSE",
  symbol: "ALRTBTC",
  tf: "H4",
  time: "2026-06-01T00:05:00Z",
  direction: "LONG",
  planId: "ALRTBTC|LONG|POI-OPEN",
  poiRef: "POI-OPEN",
  outcome: "HARD_TP",
  exitPrice: 109.5,
  rGross: 1.8,
});

assert.deepEqual(
  listSignalEvents({
    symbol: "ALRTBTC",
    limit: 2,
  }).map((event) => ({
    id: event.id,
    type: event.type,
  })),
  [
    { id: "alert-close-113", type: "SEND_CLOSE" },
    { id: "alert-open-113", type: "SEND_OPEN" },
  ],
  "alerts store appends send_open and send_close"
);

appendSignalEvent({
  id: "alert-filter-old",
  type: "SEND_OPEN",
  symbol: "FILTBTC",
  tf: "H1",
  time: "2026-06-01T00:00:00Z",
  direction: "LONG",
});
appendSignalEvent({
  id: "alert-filter-other",
  type: "SEND_OPEN",
  symbol: "FILTETH",
  tf: "H1",
  time: "2026-06-01T00:20:00Z",
  direction: "SHORT",
});
appendSignalEvent({
  id: "alert-filter-new",
  type: "SEND_CLOSE",
  symbol: "FILTBTC",
  tf: "H1",
  time: "2026-06-01T00:30:00Z",
  direction: "LONG",
  outcome: "TIMEOUT",
  exitPrice: 100,
  rGross: 0.1,
});

assert.deepEqual(
  listSignalEvents({
    symbol: "FILTBTC",
    limit: 2,
  }).map((event) => event.id),
  ["alert-filter-new", "alert-filter-old"],
  "alerts store list filters by symbol and sorts desc"
);

assert.deepEqual(
  {
    first: upsertReviewNote(
      "PLAN-113-UPSERT",
      "first",
      "2026-06-01T00:00:00Z"
    ),
    second: upsertReviewNote(
      "PLAN-113-UPSERT",
      "second",
      "2026-06-01T00:05:00Z"
    ),
    stored: getReviewNote("PLAN-113-UPSERT"),
  },
  {
    first: {
      planId: "PLAN-113-UPSERT",
      reviewNoteText: "first",
      reviewNoteUpdatedAtUtc: "2026-06-01T00:00:00Z",
    },
    second: {
      planId: "PLAN-113-UPSERT",
      reviewNoteText: "second",
      reviewNoteUpdatedAtUtc: "2026-06-01T00:05:00Z",
    },
    stored: {
      planId: "PLAN-113-UPSERT",
      reviewNoteText: "second",
      reviewNoteUpdatedAtUtc: "2026-06-01T00:05:00Z",
    },
  },
  "alerts review note upsert keeps one row per planId"
);

assert.deepEqual(
  upsertReviewNote(
    "PLAN-113-REFRESH",
    "updated",
    "2026-06-01T00:10:00Z"
  ),
  {
    planId: "PLAN-113-REFRESH",
    reviewNoteText: "updated",
    reviewNoteUpdatedAtUtc: "2026-06-01T00:10:00Z",
  },
  "alerts review note update refreshes timestamp"
);

assert.deepEqual(
  {
    spreadCautionPenalty: PolicyConstants.SPREAD_CAUTION_PENALTY,
    liquidityLowPenalty: PolicyConstants.LIQUIDITY_LOW_PENALTY,
    regimeCautionPenalty: PolicyConstants.REGIME_CAUTION_PENALTY,
    regimeTransitionPenalty: PolicyConstants.REGIME_TRANSITION_PENALTY,
  },
  {
    spreadCautionPenalty: -5,
    liquidityLowPenalty: -10,
    regimeCautionPenalty: -10,
    regimeTransitionPenalty: -20,
  },
  "policy regime penalty constants"
);

assert.deepEqual(
  {
    q20: quantileNearestRank(regimeLongAtrHistory, 0.2),
    q80: quantileNearestRank(regimeLongAtrHistory, 0.8),
    mean: meanOf(regimeLongAtrHistory),
  },
  {
    q20: 100,
    q80: 400,
    mean: 300,
  },
  "policy regime quantile and mean helpers"
);

assert.deepEqual(
  {
    low: computeVolState(100, regimeLongAtrHistory),
    high: computeVolState(500, regimeLongAtrHistory),
    normal: computeVolState(250, regimeLongAtrHistory),
  },
  {
    low: "LOW",
    high: "HIGH",
    normal: "NORMAL",
  },
  "policy regime volState low high normal"
);

assert.deepEqual(
  evaluateRegimeGate({
    spreadBps: 51,
    atr14BpsNow: 250,
    volumeM5: 200,
    longAtr14BpsHistory: regimeLongAtrHistory,
    shortAtr14BpsHistory: regimeShortAtrHistoryWeak,
    longVolumeM5History: regimeLongVolumeHistory,
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: [],
    reasons: ["REGIME_SPREAD_HALT"],
    regimeState: "HALT",
    volState: "NORMAL",
    liquidityState: "NORMAL",
    atrRatio: 250 / 300,
    q95Short: 600,
  },
  "policy regime halt blocks on spread"
);

assert.deepEqual(
  evaluateRegimeGate({
    spreadBps: 10,
    atr14BpsNow: 450,
    volumeM5: 200,
    longAtr14BpsHistory: regimeLongAtrHistory,
    shortAtr14BpsHistory: regimeShortAtrHistoryWeak,
    longVolumeM5History: regimeLongVolumeHistory,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -10,
    tags: ["REGIME_CAUTION"],
    reasons: [],
    regimeState: "CAUTION",
    volState: "HIGH",
    liquidityState: "NORMAL",
    atrRatio: 1.5,
    q95Short: 600,
  },
  "policy regime shiftWeak yields caution and -10"
);

assert.deepEqual(
  evaluateRegimeGate({
    spreadBps: 10,
    atr14BpsNow: 450,
    volumeM5: 200,
    longAtr14BpsHistory: regimeLongAtrHistory,
    shortAtr14BpsHistory: regimeShortAtrHistoryStrong,
    longVolumeM5History: regimeLongVolumeHistory,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -20,
    tags: ["REGIME_TRANSITION"],
    reasons: [],
    regimeState: "TRANSITION",
    volState: "HIGH",
    liquidityState: "NORMAL",
    atrRatio: 1.5,
    q95Short: 450,
  },
  "policy regime shiftStrong yields transition and -20"
);

assert.deepEqual(
  evaluateRegimeGate({
    spreadBps: 10,
    atr14BpsNow: 250,
    volumeM5: 100,
    longAtr14BpsHistory: regimeLongAtrHistory,
    shortAtr14BpsHistory: regimeShortAtrHistoryWeak,
    longVolumeM5History: regimeLongVolumeHistory,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -10,
    tags: ["LIQUIDITY_LOW"],
    reasons: [],
    regimeState: "OK",
    volState: "NORMAL",
    liquidityState: "LOW",
    atrRatio: 250 / 300,
    q95Short: 600,
  },
  "policy regime liquidity low adds -10"
);

assert.deepEqual(
  evaluateRegimeGate({
    spreadBps: 21,
    atr14BpsNow: 450,
    volumeM5: 100,
    longAtr14BpsHistory: regimeLongAtrHistory,
    shortAtr14BpsHistory: regimeShortAtrHistoryWeak,
    longVolumeM5History: regimeLongVolumeHistory,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -25,
    tags: ["LIQUIDITY_LOW", "REGIME_CAUTION", "SPREAD_CAUTION"],
    reasons: [],
    regimeState: "CAUTION",
    volState: "HIGH",
    liquidityState: "LOW",
    atrRatio: 1.5,
    q95Short: 600,
  },
  "policy regime combines caution spread and liquidity penalties"
);

assert.deepEqual(
  {
    atrRatio: computeAtrRatio(450, regimeLongAtrHistory),
    liquidityLow: computeLiquidityState(100, regimeLongVolumeHistory),
    liquidityNormal: computeLiquidityState(200, regimeLongVolumeHistory),
  },
  {
    atrRatio: 1.5,
    liquidityLow: "LOW",
    liquidityNormal: "NORMAL",
  },
  "policy regime atr ratio and liquidity helpers"
);

assert.deepEqual(
  evaluateRegimeGate({
    spreadBps: 21,
    atr14BpsNow: 450,
    volumeM5: 100,
    longAtr14BpsHistory: regimeLongAtrHistory,
    shortAtr14BpsHistory: regimeShortAtrHistoryWeak,
    longVolumeM5History: regimeLongVolumeHistory,
  })?.tags,
  ["LIQUIDITY_LOW", "REGIME_CAUTION", "SPREAD_CAUTION"],
  "policy regime tags are unique and lexicographic"
);

assert.deepEqual(
  {
    scBlock: PolicyConstants.SC_BLOCK,
    scPenalty1: PolicyConstants.SC_PENALTY_1,
    scPenalty2: PolicyConstants.SC_PENALTY_2,
    marginalPenalty: PolicyConstants.SC_MARGINAL_PENALTY,
    okPenalty: PolicyConstants.SC_OK_PENALTY,
  },
  {
    scBlock: 3,
    scPenalty1: 4,
    scPenalty2: 5,
    marginalPenalty: -15,
    okPenalty: -5,
  },
  "policy cost gate constants"
);

assert.deepEqual(
  evaluateCostGate(2.99),
  {
    decision: "BLOCK",
    sc: 2.99,
    scoreDelta: 0,
    tags: [],
    reasons: ["SC_LT_3"],
  },
  "policy cost gate blocks below 3"
);

assert.deepEqual(
  evaluateCostGate(3.0),
  {
    decision: "ALLOW",
    sc: 3,
    scoreDelta: -15,
    tags: ["SC_MARGINAL"],
    reasons: [],
  },
  "policy cost gate allows exact 3 with marginal penalty"
);

assert.deepEqual(
  evaluateCostGate(3.999),
  {
    decision: "ALLOW",
    sc: 3.999,
    scoreDelta: -15,
    tags: ["SC_MARGINAL"],
    reasons: [],
  },
  "policy cost gate keeps marginal band below 4"
);

assert.deepEqual(
  evaluateCostGate(4.0),
  {
    decision: "ALLOW",
    sc: 4,
    scoreDelta: -5,
    tags: ["SC_OK"],
    reasons: [],
  },
  "policy cost gate exact 4 enters ok band"
);

assert.deepEqual(
  evaluateCostGate(4.999),
  {
    decision: "ALLOW",
    sc: 4.999,
    scoreDelta: -5,
    tags: ["SC_OK"],
    reasons: [],
  },
  "policy cost gate keeps ok band below 5"
);

assert.deepEqual(
  evaluateCostGate(5.0),
  {
    decision: "ALLOW",
    sc: 5,
    scoreDelta: 0,
    tags: ["SC_GOOD"],
    reasons: [],
  },
  "policy cost gate exact 5 enters good band"
);

assert.deepEqual(
  evaluateCostGate(6.2),
  {
    decision: "ALLOW",
    sc: 6.2,
    scoreDelta: 0,
    tags: ["SC_GOOD"],
    reasons: [],
  },
  "policy cost gate keeps good band above 5"
);

assert.deepEqual(
  {
    baseTf: PolicyConstants.POLICY_BASE_TF,
    longBars: PolicyConstants.W_LONG_BARS,
    shortBars: PolicyConstants.W_SHORT_BARS,
    fee: PolicyConstants.FEE_BPS_ROUNDTRIP_DEFAULT,
    slipFloor: PolicyConstants.SLIPPAGE_BPS_FLOOR,
    stopTicksMin: PolicyConstants.STOP_BUFFER_TICKS_MIN,
    stopLow: PolicyConstants.STOP_BUFFER_ATR_LOW,
    stopNormal: PolicyConstants.STOP_BUFFER_ATR_NORMAL,
    stopHigh: PolicyConstants.STOP_BUFFER_ATR_HIGH,
    clusterStepBps: PolicyConstants.POI_CLUSTER_STEP_BPS,
  },
  {
    baseTf: "M5",
    longBars: 2016,
    shortBars: 288,
    fee: 8,
    slipFloor: 1,
    stopTicksMin: 2,
    stopLow: 0.08,
    stopNormal: 0.1,
    stopHigh: 0.15,
    clusterStepBps: 10,
  },
  "policy numeric constants for derived pool"
);

assert.equal(
  computeSpreadBps(99, 101, 100),
  200,
  "policy spread bps formula"
);

assert.equal(
  estimateSlippageBpsP95(200),
  120,
  "policy slippage estimate formula"
);

assert.equal(
  computeSlippageMultiplier({
    liquidityState: "LOW",
    regimeState: "TRANSITION",
    fastMove: true,
  }),
  6,
  "policy slippage multiplier composes liquidity transition and fastMove"
);

assert.deepEqual(
  {
    mid: computeEntryRefPrice(100.5, 101),
    lastFallback: computeEntryRefPrice(0, 101),
  },
  {
    mid: 100.5,
    lastFallback: 101,
  },
  "policy entryRef uses mid else last"
);

assert.deepEqual(
  {
    low: getStopBufferAtrFactor("LOW"),
    normalPrice: computeStopBufferPrice(0.1, 2.5, "NORMAL"),
    tickFloorPrice: computeStopBufferPrice(0.25, 1, "LOW"),
  },
  {
    low: 0.08,
    normalPrice: 0.25,
    tickFloorPrice: 0.5,
  },
  "policy stop buffer uses atr factor and tick floor"
);

assert.deepEqual(
  {
    sRaw: computeSRawBps(100, 95),
    stopBufferBps: computeStopBufferBps(100, 0.25),
    sEffective: computeSEffectiveBps(500, 25),
  },
  {
    sRaw: 500,
    stopBufferBps: 25,
    sEffective: 525,
  },
  "policy stop and effective bps formulas"
);

assert.deepEqual(
  {
    c: computeCostRoundtripBps({
      spreadBps: 10,
      slippageBpsP95: 3,
      slippageMultiplier: 2,
    }),
    sc: computeSC(60, 24),
  },
  {
    c: 24,
    sc: 2.5,
  },
  "policy cost roundtrip and sc formulas"
);

assert.equal(
  computeRewardBpsFromTpRefPrice(100, 105),
  500,
  "policy reward bps from tp ref price"
);

assert.deepEqual(
  {
    explicit: computeExpectedRRUsed({
      expectedRR: 1.6,
      entryRefPrice: 100,
      sEffectiveBps: 500,
    }),
    fallback: computeExpectedRRUsed({
      tpRefPrice: 105,
      entryRefPrice: 100,
      sEffectiveBps: 500,
    }),
  },
  {
    explicit: 1.6,
    fallback: 1,
  },
  "policy expected rr prefers explicit then tp fallback"
);

assert.deepEqual(
  {
    high: computeRewardProxy({
      poiTier: "D1_POI",
      hasStack: false,
      sc: 5,
    }),
    mid: computeRewardProxy({
      poiTier: "H4_CORE",
      hasStack: false,
      sc: 4,
    }),
    low: computeRewardProxy({
      poiTier: "OTHER",
      hasStack: false,
      sc: 10,
    }),
  },
  {
    high: "HIGH",
    mid: "MID",
    low: "LOW",
  },
  "policy reward proxy mapping"
);

assert.deepEqual(
  {
    rrLt10: PolicyConstants.RR_PENALTY_LT_1_0,
    rrLt12: PolicyConstants.RR_PENALTY_LT_1_2,
    lowPenalty: PolicyConstants.REWARDPROXY_LOW_PENALTY,
    midPenalty: PolicyConstants.REWARDPROXY_MID_PENALTY,
    highPenalty: PolicyConstants.REWARDPROXY_HIGH_PENALTY,
  },
  {
    rrLt10: -15,
    rrLt12: -8,
    lowPenalty: -10,
    midPenalty: -5,
    highPenalty: 0,
  },
  "policy reward proxy constants"
);

assert.deepEqual(
  evaluateRewardProxyAdjust({
    expectedRRUsed: 0.99,
    rewardProxy: "HIGH",
  }),
  {
    scoreDelta: -15,
    tags: ["RR_LT_1_0"],
    reasons: [],
    expectedRRUsed: 0.99,
    rewardProxy: "HIGH",
  },
  "policy reward proxy penalizes rr below 1.0"
);

assert.deepEqual(
  evaluateRewardProxyAdjust({
    expectedRRUsed: 1.0,
    rewardProxy: "LOW",
  }),
  {
    scoreDelta: -8,
    tags: ["RR_LT_1_2"],
    reasons: [],
    expectedRRUsed: 1,
    rewardProxy: "LOW",
  },
  "policy reward proxy exact 1.0 enters rr lt 1.2 band"
);

assert.deepEqual(
  evaluateRewardProxyAdjust({
    expectedRRUsed: 1.2,
    rewardProxy: "MID",
  }),
  {
    scoreDelta: 0,
    tags: ["RR_OK"],
    reasons: [],
    expectedRRUsed: 1.2,
    rewardProxy: "MID",
  },
  "policy reward proxy exact 1.2 yields rr ok"
);

assert.deepEqual(
  evaluateRewardProxyAdjust({
    expectedRRUsed: computeExpectedRRUsed({
      tpRefPrice: 105,
      entryRefPrice: 100,
      sEffectiveBps: 500,
    }),
    rewardProxy: "LOW",
  }),
  {
    scoreDelta: -8,
    tags: ["RR_LT_1_2"],
    reasons: [],
    expectedRRUsed: 1,
    rewardProxy: "LOW",
  },
  "policy reward proxy uses tpRefPrice-derived expected rr when present"
);

assert.deepEqual(
  evaluateRewardProxyAdjust({
    expectedRRUsed: null,
    rewardProxy: "LOW",
  }),
  {
    scoreDelta: -10,
    tags: ["REWARDPROXY_LOW", "RR_UNKNOWN"],
    reasons: [],
    expectedRRUsed: null,
    rewardProxy: "LOW",
  },
  "policy reward proxy low fallback applies when rr unknown"
);

assert.deepEqual(
  evaluateRewardProxyAdjust({
    expectedRRUsed: null,
    rewardProxy: "MID",
  }),
  {
    scoreDelta: -5,
    tags: ["REWARDPROXY_MID", "RR_UNKNOWN"],
    reasons: [],
    expectedRRUsed: null,
    rewardProxy: "MID",
  },
  "policy reward proxy mid fallback applies when rr unknown"
);

assert.deepEqual(
  evaluateRewardProxyAdjust({
    expectedRRUsed: null,
    rewardProxy: "HIGH",
  }),
  {
    scoreDelta: 0,
    tags: ["REWARDPROXY_HIGH", "RR_UNKNOWN"],
    reasons: [],
    expectedRRUsed: null,
    rewardProxy: "HIGH",
  },
  "policy reward proxy high fallback is neutral"
);

assert.deepEqual(
  {
    maxClusters: PolicyConstants.MAX_UNIQUE_CLUSTERS_15M_PER_DIR,
    overridePenalty: PolicyConstants.CONC_OVERRIDE_PENALTY,
    duplicatePenalty: PolicyConstants.CONC_DUPLICATE_PENALTY,
  },
  {
    maxClusters: 5,
    overridePenalty: -30,
    duplicatePenalty: -10,
  },
  "policy concentration constants"
);

assert.deepEqual(
  {
    entryExceptional: isExceptionalSignal(concentrationExceptionalEntrySignal),
    reactionExceptional: isExceptionalSignal(concentrationExceptionalReactionSignal),
    normal: isExceptionalSignal(concentrationSignalBase),
  },
  {
    entryExceptional: true,
    reactionExceptional: true,
    normal: false,
  },
  "policy concentration exceptional helper"
);

assert.equal(
  countUniquePoiClusters15m(
    concentrationSignalBase,
    concentrationHistorySameCluster
  ),
  1,
  "policy concentration same cluster multi-confirm counts unique one"
);

assert.deepEqual(
  evaluateConcentrationGate({
    signal: concentrationSignalBase,
    poiClusterKey: "1000",
    recentHistory15m: concentrationHistorySameCluster,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -10,
    tags: ["CONC_DUPLICATE"],
    reasons: [],
    uniqueClusters15m: 1,
    duplicate: true,
    isExceptional: false,
  },
  "policy concentration duplicate applies -10 only"
);

assert.deepEqual(
  evaluateConcentrationGate({
    signal: concentrationSignalBase,
    poiClusterKey: "1005",
    recentHistory15m: concentrationHistoryFiveUnique,
  }),
  {
    decision: "BLOCK",
    scoreDelta: 0,
    tags: [],
    reasons: ["CONC_TOO_MANY"],
    uniqueClusters15m: 5,
    duplicate: false,
    isExceptional: false,
  },
  "policy concentration sixth unique cluster blocks"
);

assert.deepEqual(
  evaluateConcentrationGate({
    signal: concentrationExceptionalEntrySignal,
    poiClusterKey: "1005",
    recentHistory15m: concentrationHistoryFiveUnique,
  }),
  {
    decision: "ALLOW",
    scoreDelta: -30,
    tags: ["CONC_OVERRIDE"],
    reasons: ["CONC_OVERRIDE"],
    uniqueClusters15m: 5,
    duplicate: false,
    isExceptional: true,
  },
  "policy concentration exceptional overrides block with -30"
);

assert.equal(
  countUniquePoiClusters15m(
    concentrationSignalBase,
    concentrationHistoryMixed
  ),
  1,
  "policy concentration ignores other symbol dir and out-of-window"
);

assert.equal(
  hasDuplicatePoiCluster(
    concentrationSignalBase,
    "1000",
    concentrationHistoryMixed
  ),
  true,
  "policy concentration duplicate check matches only valid windowed cluster"
);

assert.equal(
  evaluateConcentrationGate({
    signal: concentrationSignalBase,
    poiClusterKey: null,
    recentHistory15m: concentrationHistorySameCluster,
  }),
  null,
  "policy concentration returns null when cluster key is missing"
);

assert.equal(
  computePoiClusterKey({
    entryBoundaryPrice: 100,
    midPrice: 100,
    tickSize: 0.1,
  }),
  "1000",
  "policy poi cluster key formula"
);

const trendlineIntegratedDetected = detectTrendlineCandidates({
  symbol: "BTCUSDT",
  tf: "D1",
  currentCloseTime: 1000,
  structureState: "UP",
  highs: trendlineDetectD1HighsUp,
  lows: trendlineDetectD1LowsUp,
  atrAtHighAnchor2: 10,
  atrAtLowAnchor2: 10,
})[0]!;

assert.equal(
  resolveTrendlineNewEvent(
    trendlineEventTime,
    undefined,
    trendlineIntegratedDetected
  ),
  "[NEW][D1][TRENDLINE][SUPPORT] time=2026-06-22T12:34:56Z anchors=320@95;520@100 tags=-",
  "trendline integration detect to new event works"
);

const trendlineIntegratedTouched = applyTrendlineTouchAndBreakStats({
  line: trendlineFlatSupportH4,
  touchEval: evaluateTrendlineTouchAtBar({
    line: trendlineFlatSupportH4,
    bar: trendlineSupportTouchBar,
    atrAtBar: 10,
  }),
});

assert.equal(
  resolveTrendlineTouchEvent(
    trendlineSupportTouchBar.closeTime,
    trendlineFlatSupportH4,
    trendlineIntegratedTouched
  ),
  `[TOUCH][H4][TL-H4-SUP] time=${new Date(trendlineSupportTouchBar.closeTime).toISOString().replace(".000Z", "Z")} touchCount=1`,
  "trendline integration touch stats emit touch event"
);

const trendlineIntegratedRoleFlipStarted = applyTrendlineRoleFlip({
  line: trendlineRoleFlipSupportLine,
  bar: {
    tf: "H4",
    openTime: Date.UTC(2026, 5, 18, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 18, 3, 59, 59),
    open: 100,
    high: 101,
    low: 97,
    close: 98,
    volume: 0,
  },
  breakEval: trendlineRoleFlipBreakCandidateH4,
});

const trendlineIntegratedRoleFlipTouched = applyTrendlineRoleFlip({
  line: trendlineIntegratedRoleFlipStarted,
  bar: trendlineRoleFlipBarSupportTouch,
  touchEval: trendlineRoleFlipTouchH4,
});

const trendlineIntegratedRoleFlipConfirmed = applyTrendlineRoleFlip({
  line: trendlineIntegratedRoleFlipTouched,
  bar: trendlineRoleFlipBarSupportConfirm,
});

assert.equal(
  resolveTrendlineRoleFlipEvent(
    trendlineRoleFlipBarSupportConfirm.closeTime,
    trendlineIntegratedRoleFlipTouched,
    trendlineIntegratedRoleFlipConfirmed
  ),
  `[ROLE_FLIP][H4][TL-H4-SUP] time=${new Date(trendlineRoleFlipBarSupportConfirm.closeTime).toISOString().replace(".000Z", "Z")} newType=RESIST`,
  "trendline integration role flip emits event"
);

const trendlineIntegratedInvalid = applyTrendlineLifecycleInvalidation({
  line: trendlineFlatSupportD1,
  currentCloseTime: trendlineD1BreakBars[1].closeTime,
  breakEval: evaluateTrendlineBreakAtBar({
    line: trendlineFlatSupportD1,
    tfBars: trendlineD1BreakBars,
    currentIndex: 1,
    atrAtBar: 10,
    structureState: "UP",
  }),
});

assert.equal(
  resolveTrendlineInvalidEvent(
    trendlineD1BreakBars[1].closeTime,
    trendlineFlatSupportD1,
    trendlineIntegratedInvalid
  ),
  `[INVALID][D1][TL-D1-SUP] time=${new Date(trendlineD1BreakBars[1].closeTime).toISOString().replace(".000Z", "Z")} reason=break_confirmed endTime=${new Date(trendlineD1BreakBars[1].closeTime).toISOString().replace(".000Z", "Z")}`,
  "trendline integration break invalidation emits invalid event"
);

assert.deepEqual(
  evaluateTrendlineCollab({
    line: trendlineFlatSupportD1,
    currentCloseTime: 9999,
    atrAtBar: 10,
    tick: 0.1,
    obs: [trendlineCollabD1ObOk],
    fvgs: [trendlineCollabD1FvgTight],
    channels: [trendlineCollabD1ChannelTight],
  }),
  {
    tags: [
      "TL_COLLAB_CHANNEL_TIGHT",
      "TL_COLLAB_POI_OK",
      "TL_COLLAB_POI_TIGHT",
    ],
    bestMatch: {
      kind: "CHANNEL",
      id: trendlineCollabD1ChannelTight.id,
      distAtr: 0,
      meta: "TL_COLLAB_CHANNEL_TIGHT",
    },
  },
  "trendline integration collab pipeline returns tags and bestMatch"
);

assert.deepEqual(
  evaluateTrendlineLtfTriggersFromTfBars({
    line: trendlineLtfSupportLine,
    tfBars: trendlineLtfAggregateBars,
    tickSize: 0.1,
  }),
  {
    tf: "M15",
    dir: "BULL",
    currentCloseTime: trendlineLtfAggregateBars[19].closeTime,
    choch: true,
    sweepRec: true,
    microRetestTypes: [],
    triggers: ["CHOCH", "SWEEP_REC"],
  },
  "trendline integration ltf pipeline returns sorted triggers"
);

assert.equal(
  resolveTrendlinePoiCandidateEvent(
    undefined,
    trendlinePoiCandidateInput
  ),
  "[POI_CANDIDATE][H1][TL-H4-SUP] time=2026-06-22T12:34:56Z reason=roleFlip touchCount=3",
  "trendline integration poi candidate first emit works"
);

assert.deepEqual(
  {
    d1: isTrendlineLifecycleTf("D1"),
    h4: isTrendlineLifecycleTf("H4"),
    h1: isTrendlineLifecycleTf("H1"),
    m30: isTrendlineLifecycleTf("M30"),
    m15: isTrendlineLifecycleTf("M15"),
    d1Rule: getTrendlineBreakRule("D1", "UP"),
    h1Rule: getTrendlineBreakRule("H1", "UP"),
    d1MixedRule: getTrendlineBreakRule("D1", "MIXED"),
  },
  {
    d1: true,
    h4: true,
    h1: true,
    m30: true,
    m15: false,
    d1Rule: { requiredCloses: 2, atrMultiplier: 0.2 },
    h1Rule: { requiredCloses: 1, atrMultiplier: 0.25 },
    d1MixedRule: { requiredCloses: 1, atrMultiplier: 0.2 },
  },
  "trendline lifecycle tf and break rules"
);

assert.deepEqual(
  evaluateTrendlineTouchAtBar({
    line: trendlineFlatSupportH4,
    bar: trendlineSupportTouchBar,
    atrAtBar: 10,
  }),
  {
    tf: "H4",
    currentCloseTime: trendlineSupportTouchBar.closeTime,
    linePrice: 100,
    touchMargin: 1.5,
    touched: true,
  },
  "trendline support touch passes within margin"
);

assert.deepEqual(
  evaluateTrendlineTouchAtBar({
    line: trendlineFlatResistH1,
    bar: trendlineResistTouchBar,
    atrAtBar: 10,
  }),
  {
    tf: "H1",
    currentCloseTime: trendlineResistTouchBar.closeTime,
    linePrice: 100,
    touchMargin: 1.5,
    touched: true,
  },
  "trendline resist touch passes within margin"
);

assert.deepEqual(
  evaluateTrendlineBreakAtBar({
    line: trendlineFlatSupportD1,
    tfBars: trendlineD1BreakBars,
    currentIndex: 1,
    atrAtBar: 10,
    structureState: "UP",
  }),
  {
    tf: "D1",
    currentCloseTime: trendlineD1BreakBars[1].closeTime,
    requiredCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    breakCount: 2,
    linePrice: 100,
    closeDeviation: 2.5,
    breakCandidate: true,
    breakConfirmed: true,
  },
  "trendline d1 support break confirms with two closes"
);

assert.deepEqual(
  evaluateTrendlineBreakAtBar({
    line: trendlineFlatResistH1,
    tfBars: trendlineH1BreakBars,
    currentIndex: 0,
    atrAtBar: 10,
    structureState: "DOWN",
  }),
  {
    tf: "H1",
    currentCloseTime: trendlineH1BreakBars[0].closeTime,
    requiredCloses: 1,
    atrAtBar: 10,
    atrMultiplier: 0.25,
    breakCount: 1,
    linePrice: 100,
    closeDeviation: 2.5999999999999943,
    breakCandidate: true,
    breakConfirmed: true,
  },
  "trendline h1 resist break confirms with one close"
);

assert.deepEqual(
  evaluateTrendlineBreakAtBar({
    line: trendlineFlatSupportD1,
    tfBars: trendlineMixedD1BreakBars,
    currentIndex: 0,
    atrAtBar: 10,
    structureState: "MIXED",
  }),
  {
    tf: "D1",
    currentCloseTime: trendlineMixedD1BreakBars[0].closeTime,
    requiredCloses: 1,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    breakCount: 1,
    linePrice: 100,
    closeDeviation: 2.0999999999999943,
    breakCandidate: true,
    breakConfirmed: true,
  },
  "trendline mixed lowers break count to one"
);

assert.deepEqual(
  evaluateTrendlineBreakAtBar({
    line: trendlineFlatSupportD1,
    tfBars: trendlineExactThresholdBars,
    currentIndex: 0,
    atrAtBar: 10,
    structureState: "UP",
  }),
  {
    tf: "D1",
    currentCloseTime: trendlineExactThresholdBars[0].closeTime,
    requiredCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    breakCount: 0,
    linePrice: 100,
    closeDeviation: 2,
    breakCandidate: false,
    breakConfirmed: false,
  },
  "trendline exact-threshold close does not break"
);

assert.deepEqual(
  evaluateTrendlineStaleExpiration(
    trendlineFlatSupportH4,
    trendlineFlatSupportH4.displayUntil!
  ),
  {
    currentCloseTime: trendlineFlatSupportH4.displayUntil!,
    displayUntil: trendlineFlatSupportH4.displayUntil!,
    staleExpired: false,
  },
  "trendline stale equality is not expired"
);

assert.deepEqual(
  evaluateTrendlineStaleExpiration(
    trendlineFlatSupportH4,
    trendlineFlatSupportH4.displayUntil! + 1
  ),
  {
    currentCloseTime: trendlineFlatSupportH4.displayUntil! + 1,
    displayUntil: trendlineFlatSupportH4.displayUntil!,
    staleExpired: true,
  },
  "trendline stale expires after displayUntil"
);

assert.deepEqual(
  applyTrendlineTouchAndBreakStats({
    line: trendlineFlatSupportH4,
    touchEval: evaluateTrendlineTouchAtBar({
      line: trendlineFlatSupportH4,
      bar: trendlineSupportTouchBar,
      atrAtBar: 10,
    }),
    breakEval: {
      tf: "H4",
      currentCloseTime: trendlineSupportTouchBar.closeTime,
      requiredCloses: 2,
      atrAtBar: 10,
      atrMultiplier: 0.2,
      breakCount: 1,
      linePrice: 100,
      closeDeviation: 1,
      breakCandidate: true,
      breakConfirmed: false,
    },
  }),
  {
    ...trendlineFlatSupportH4,
    touchCount: 1,
    lastTouchTime: trendlineSupportTouchBar.closeTime,
    breakStreak: 1,
    lastBreakTime: trendlineSupportTouchBar.closeTime,
  },
  "trendline touch and break stats update counts and timestamps"
);

assert.deepEqual(
  applyTrendlineLifecycleInvalidation({
    line: trendlineFlatSupportD1,
    currentCloseTime: trendlineD1BreakBars[1].closeTime,
    breakEval: evaluateTrendlineBreakAtBar({
      line: trendlineFlatSupportD1,
      tfBars: trendlineD1BreakBars,
      currentIndex: 1,
      atrAtBar: 10,
      structureState: "UP",
    }),
  }),
  {
    ...trendlineFlatSupportD1,
    state: "INACTIVE",
    invalidReason: "break_confirmed",
    endTime: trendlineD1BreakBars[1].closeTime,
  },
  "trendline lifecycle invalidates on confirmed break"
);

assert.deepEqual(
  applyTrendlineLifecycleInvalidation({
    line: trendlineFlatSupportH4,
    currentCloseTime: trendlineFlatSupportH4.displayUntil! + 1,
    staleEval: evaluateTrendlineStaleExpiration(
      trendlineFlatSupportH4,
      trendlineFlatSupportH4.displayUntil! + 1
    ),
  }),
  {
    ...trendlineFlatSupportH4,
    state: "INACTIVE",
    invalidReason: "stale_expired",
    endTime: trendlineFlatSupportH4.displayUntil! + 1,
  },
  "trendline lifecycle invalidates on stale expiry"
);

assert.deepEqual(
  {
    D1: getChannelBreakRule("D1"),
    H4: getChannelBreakRule("H4"),
    H1: getChannelBreakRule("H1"),
    M30: getChannelBreakRule("M30"),
  },
  {
    D1: { requiredConsecutiveCloses: 2, atrMultiplier: 0.2 },
    H4: { requiredConsecutiveCloses: 2, atrMultiplier: 0.2 },
    H1: { requiredConsecutiveCloses: 1, atrMultiplier: 0.3 },
    M30: { requiredConsecutiveCloses: 1, atrMultiplier: 0.35 },
  },
  "channel break rules by tf"
);

assert.deepEqual(
  {
    upBoundary: getChannelBreakBoundaryPriceAt(channelBreakD1Up, d1BreakBars[1].closeTime),
    downBoundary: getChannelBreakBoundaryPriceAt(channelBreakH4Down, h4BreakBars[1].closeTime),
    upAnchor: getChannelAnchorPriceAt(channelBreakD1Up, d1BreakBars[1].closeTime),
    downAnchor: getChannelAnchorPriceAt(channelBreakH4Down, h4BreakBars[1].closeTime),
  },
  {
    upBoundary: 110,
    downBoundary: 90,
    upAnchor: 100,
    downAnchor: 100,
  },
  "channel boundary and anchor prices by direction"
);

assert.deepEqual(
  evaluateChannelBreakAtBar({
    channel: channelBreakD1Up,
    tfBars: d1BreakBars,
    currentIndex: 1,
    atrAtBar: 10,
  }),
  {
    tf: "D1",
    currentCloseTime: d1BreakBars[1].closeTime,
    requiredConsecutiveCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    closeCount: 2,
    boundaryPrice: 110,
    closeDeviation: 2,
    pass: true,
  },
  "channel d1 break passes with two closes and atr threshold"
);

assert.deepEqual(
  evaluateChannelBreakAtBar({
    channel: channelBreakH4Down,
    tfBars: h4BreakBars,
    currentIndex: 1,
    atrAtBar: 10,
  }),
  {
    tf: "H4",
    currentCloseTime: h4BreakBars[1].closeTime,
    requiredConsecutiveCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    closeCount: 2,
    boundaryPrice: 90,
    closeDeviation: 2,
    pass: true,
  },
  "channel h4 break passes with two closes and atr threshold"
);

assert.deepEqual(
  evaluateChannelBreakAtBar({
    channel: channelBreakH1Up,
    tfBars: h1BreakBars,
    currentIndex: 0,
    atrAtBar: 10,
  }),
  {
    tf: "H1",
    currentCloseTime: h1BreakBars[0].closeTime,
    requiredConsecutiveCloses: 1,
    atrAtBar: 10,
    atrMultiplier: 0.3,
    closeCount: 1,
    boundaryPrice: 110,
    closeDeviation: 3,
    pass: true,
  },
  "channel h1 break passes on equality threshold"
);

assert.deepEqual(
  evaluateChannelBreakAtBar({
    channel: channelBreakM30Down,
    tfBars: m30BreakBars,
    currentIndex: 0,
    atrAtBar: 10,
  }),
  {
    tf: "M30",
    currentCloseTime: m30BreakBars[0].closeTime,
    requiredConsecutiveCloses: 1,
    atrAtBar: 10,
    atrMultiplier: 0.35,
    closeCount: 1,
    boundaryPrice: 90,
    closeDeviation: 3.5,
    pass: true,
  },
  "channel m30 break passes on equality threshold"
);

assert.deepEqual(
  evaluateChannelAnchorInvalidAtBar({
    channel: channelBreakD1Up,
    tfBars: d1AnchorInvalidBars,
    currentIndex: 1,
    atrAtBar: 10,
  }),
  {
    tf: "D1",
    currentCloseTime: d1AnchorInvalidBars[1].closeTime,
    requiredConsecutiveCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    closeCount: 2,
    boundaryPrice: 100,
    closeDeviation: 2,
    pass: true,
  },
  "channel up anchor invalid passes below lower anchor line"
);

assert.deepEqual(
  evaluateChannelAnchorInvalidAtBar({
    channel: channelBreakH4Down,
    tfBars: h4AnchorInvalidBars,
    currentIndex: 1,
    atrAtBar: 10,
  }),
  {
    tf: "H4",
    currentCloseTime: h4AnchorInvalidBars[1].closeTime,
    requiredConsecutiveCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    closeCount: 2,
    boundaryPrice: 100,
    closeDeviation: 2,
    pass: true,
  },
  "channel down anchor invalid passes above upper anchor line"
);

assert.deepEqual(
  evaluateChannelBreakAtBar({
    channel: channelBreakD1Up,
    tfBars: d1BreakNotEnoughBars,
    currentIndex: 1,
    atrAtBar: 10,
  }),
  {
    tf: "D1",
    currentCloseTime: d1BreakNotEnoughBars[1].closeTime,
    requiredConsecutiveCloses: 2,
    atrAtBar: 10,
    atrMultiplier: 0.2,
    closeCount: 1,
    boundaryPrice: 110,
    closeDeviation: 2,
    pass: false,
  },
  "channel break fails when consecutive closes are insufficient"
);

assert.deepEqual(
  evaluateChannelBreakAtBar({
    channel: channelBreakH1Up,
    tfBars: h1BreakLowDeviationBars,
    currentIndex: 0,
    atrAtBar: 10,
  }),
  {
    tf: "H1",
    currentCloseTime: h1BreakLowDeviationBars[0].closeTime,
    requiredConsecutiveCloses: 1,
    atrAtBar: 10,
    atrMultiplier: 0.3,
    closeCount: 1,
    boundaryPrice: 110,
    closeDeviation: 2.9000000000000057,
    pass: false,
  },
  "channel break fails when deviation is below atr threshold"
);

assert.deepEqual(
  {
    d1: isChannelResidualTf("D1"),
    m5: isChannelResidualTf("M5"),
    d1Pctl: getChannelOffsetPercentile("D1"),
    h4Pctl: getChannelOffsetPercentile("H4"),
    h1Pctl: getChannelOffsetPercentile("H1"),
    m30Pctl: getChannelOffsetPercentile("M30"),
  },
  {
    d1: true,
    m5: false,
    d1Pctl: 95,
    h4Pctl: 90,
    h1Pctl: 85,
    m30Pctl: 80,
  },
  "channel residual tf and percentile map"
);

assert.deepEqual(
  {
    up: computeChannelResidualRaw(
      "UP",
      channelResidualD1Bars[0],
      buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!
    ),
    down: computeChannelResidualRaw(
      "DOWN",
      buildChannelResidualBars(
        "H4",
        "DOWN",
        [1],
        Date.UTC(2026, 4, 24, 0, 0, 0)
      )[0],
      buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!
    ),
  },
  {
    up: 1,
    down: 1,
  },
  "channel residual formula up and down"
);

assert.deepEqual(
  collectPositiveResidualSamples({
    tfBars: channelResidualUpMixedBars,
    dir: "UP",
    anchorLine: buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!,
  }),
  [1, 3, 5, 6],
  "channel collects positive residual samples only"
);

assert.deepEqual(
  evaluateChannelOffsetFromResiduals({
    tf: "H1",
    tfBars: channelResidualUpMixedBars,
    dir: "UP",
    anchorLine: buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!,
  }),
  {
    tf: "H1",
    percentile: 85,
    positiveResidualCount: 4,
    offset: null,
    enoughSamples: false,
  },
  "channel offset requires at least five positive residual samples"
);

assert.deepEqual(
  evaluateChannelOffsetFromResiduals({
    tf: "D1",
    tfBars: channelResidualD1Bars,
    dir: "UP",
    anchorLine: buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!,
  }),
  {
    tf: "D1",
    percentile: 95,
    positiveResidualCount: 10,
    offset: 10,
    enoughSamples: true,
  },
  "channel d1 offset uses p95 nearest-rank"
);

assert.deepEqual(
  evaluateChannelOffsetFromResiduals({
    tf: "H4",
    tfBars: channelResidualH4Bars,
    dir: "UP",
    anchorLine: buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!,
  }),
  {
    tf: "H4",
    percentile: 90,
    positiveResidualCount: 10,
    offset: 9,
    enoughSamples: true,
  },
  "channel h4 offset uses p90 nearest-rank"
);

assert.deepEqual(
  evaluateChannelOffsetFromResiduals({
    tf: "H1",
    tfBars: channelResidualH1Bars,
    dir: "UP",
    anchorLine: buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!,
  }),
  {
    tf: "H1",
    percentile: 85,
    positiveResidualCount: 10,
    offset: 9,
    enoughSamples: true,
  },
  "channel h1 offset uses p85 nearest-rank"
);

assert.deepEqual(
  evaluateChannelOffsetFromResiduals({
    tf: "M30",
    tfBars: channelResidualM30Bars,
    dir: "UP",
    anchorLine: buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!,
  }),
  {
    tf: "M30",
    percentile: 80,
    positiveResidualCount: 10,
    offset: 8,
    enoughSamples: true,
  },
  "channel m30 offset uses p80 nearest-rank"
);

assert.deepEqual(
  evaluateChannelOffsetFromResiduals({
    tf: "H1",
    tfBars: channelResidualH1LongLookbackBars,
    dir: "UP",
    anchorLine: buildAnchorLine2P(channelFlatAnchorA, channelFlatAnchorB)!,
  }),
  {
    tf: "H1",
    percentile: 85,
    positiveResidualCount: 300,
    offset: 1,
    enoughSamples: true,
  },
  "channel offset uses latest 300-bar lookback only"
);

const obNormalizedZoneTick01 = normalizeObZoneToTick({
  bottom: 100.02,
  top: 101.98,
  tick: 0.1,
})!;

const obRawZoneCheck = {
  bottom: 100.02,
  top: 101.98,
  height: 1.96,
};

const obRawZoneCheckSnapshot = {
  ...obRawZoneCheck,
};

assert.deepEqual(
  obNormalizedZoneTick01,
  {
    bottomTick: 1000,
    topTick: 1020,
    bottomNorm: 100,
    topNorm: 102,
  },
  "ob tick normalization uses floor and ceil"
);

assert.deepEqual(
  normalizeObZoneToTick({
    bottom: 100,
    top: 101,
    tick: 0.1,
  }),
  {
    bottomTick: 1000,
    topTick: 1010,
    bottomNorm: 100,
    topNorm: 101,
  },
  "ob tick normalization preserves exact boundary with epsilon"
);

assert.equal(
  formatObZoneForOutput(obNormalizedZoneTick01, 0.1),
  "100.0~102.0",
  "ob normalized zone output uses tick decimals"
);

assert.equal(
  buildNormalizedObId({
    symbol: "btcusdt",
    type: "D1_POI_OB",
    tf: "D1",
    triggerTime: 1234567890,
    dir: "BULL",
    zone: obNormalizedZoneTick01,
  }),
  "BTCUSDT:D1_POI_OB:D1:1234567890:BULL:1000:1020",
  "ob normalized id uses integer ticks"
);

assert.equal(
  formatObRatio2(0.299999),
  "0.30",
  "ob ratio output uses two decimals"
);

assert.equal(
  getObCmpEpsilon(0.1),
  1e-7,
  "ob cmp epsilon uses tick factor"
);

assert.equal(
  normalizeObZoneToTick({
    bottom: 100,
    top: 101,
    tick: 0,
  }),
  null,
  "ob tick normalization rejects invalid tick"
);

normalizeObZoneToTick({
  bottom: obRawZoneCheck.bottom,
  top: obRawZoneCheck.top,
  tick: 0.1,
});

assert.deepEqual(
  obRawZoneCheck,
  obRawZoneCheckSnapshot,
  "ob raw zone remains unchanged"
);

const run1 = collectEventLog(bars);
const run2 = collectEventLog(bars);

assertExactEventLog(run1, run2, "same input same output");
assertExactEventLog(run1, [], "composite stub emits no events yet");

const alertSendOpenSelected = {
  id: "alert-nav-open-selected",
  type: "SEND_OPEN" as const,
  symbol: "BTCUSDT",
  tf: "H4",
  time: "2026-06-01T00:00:00Z",
  direction: "LONG" as const,
  planId: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
  poiRef: "POI-1",
  entryRefPrice: 100,
  stopPrice: 95,
  tpPrice: 108,
  rrChosen: 1.5,
  seen: false,
};

const alertSendCloseSelected = {
  id: "alert-nav-close-selected",
  type: "SEND_CLOSE" as const,
  symbol: "BTCUSDT",
  tf: "H4",
  time: "2026-06-01T01:00:00Z",
  exitTime: "2026-06-01T01:00:00Z",
  direction: "LONG" as const,
  planId: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
  outcome: "HARD_TP" as const,
  seen: false,
};

const alertOtherInboxOpen = {
  id: "alert-nav-open-other",
  type: "SEND_OPEN" as const,
  symbol: "ETHUSDT",
  tf: "H1",
  time: "2026-06-01T02:00:00Z",
  direction: "SHORT" as const,
  planId: "PLAN-118-OTHER",
  poiRef: "POI-118-OTHER",
  entryRefPrice: 200,
  stopPrice: 210,
  tpPrice: 180,
  seen: false,
};

const alertOpenLinkEvents = [
  alertSendCloseSelected,
  alertSendOpenSelected,
];

const alertSendCloseSelectedWithReview = {
  ...alertSendCloseSelected,
  exitPrice: 108,
  rGross: 1.42,
  mfeR: 1.8,
  maeR: 0.6,
  bothHit: false,
  weaknessCodes: ["W_RR_LOW", "W_ENTRY_LATE", "W_POLICY_CAUTION"],
  replayNote: "auto close summary",
};

const watchlistStatusSample = [
  { symbol: "BTC", state: "LIVE" as const },
  { symbol: "ETH", state: "LIVE" as const },
  {
    symbol: "SOL",
    state: "SYNCING" as const,
    lastBarCloseTimeUtc: "2026-06-01T00:00:00Z",
  },
];

const alertPanelsCoverageMatrix = readFileSync(
  "docs/spec/ALERT_PANELS_COVERAGE_MATRIX_v0.1.1.md",
  "utf8"
);

assert.deepEqual(
  {
    autoTf: DEFAULT_AUTO_TF_SWITCH_ENABLED,
    barsAround: ALERT_NAV_BARS_AROUND,
    poiMs: ALERT_POI_HIGHLIGHT_MS,
    linesMs: ALERT_PLAN_LINES_HIGHLIGHT_MS,
    openLinkMs: ALERT_OPEN_LINK_HIGHLIGHT_MS,
  },
  {
    autoTf: true,
    barsAround: 60,
    poiMs: 10000,
    linesMs: 10000,
    openLinkMs: 3000,
  },
  "alerts navigation constants"
);

assert.equal(
  getAlertTrafficLightState({
    ...alertSendOpenSelected,
    entryQuality: "IDEAL",
    collabStrength: "STRONG",
    policyState: "NORMAL",
  }),
  "STRONG",
  "alerts selected feed trafficlight strong"
);

assert.equal(
  getAlertTrafficLightState({
    ...alertSendOpenSelected,
    policyState: "HALT",
  }),
  "SKIP",
  "alerts selected feed trafficlight skip on halt"
);

assert.equal(
  getAlertTrafficLightState({
    ...alertSendOpenSelected,
    entryQuality: "LATE",
    collabStrength: "NONE",
    policyState: "NORMAL",
  }),
  "SKIP",
  "alerts selected feed trafficlight skip on late none"
);

assert.equal(
  getAlertTrafficLightState({
    ...alertSendOpenSelected,
    entryQuality: "VALID",
    collabStrength: "WEAK",
    policyState: "NORMAL",
  }),
  "CAUTION",
  "alerts selected feed trafficlight caution default"
);

assert.deepEqual(
  pickCloseWeaknessPreview(alertSendCloseSelectedWithReview),
  ["W_RR_LOW", "W_ENTRY_LATE"],
  "alerts close weakness preview takes top two"
);

assert.equal(
  buildSelectedFeedCloseCard(
    alertSendCloseSelectedWithReview,
    "stored review"
  )?.weaknessMoreCount,
  1,
  "alerts close weakness preview counts more"
);

assert.deepEqual(
  {
    withNote: hasReviewNoteBadge(alertSendCloseSelectedWithReview, "stored review"),
    withoutNote: hasReviewNoteBadge(alertSendCloseSelectedWithReview, ""),
  },
  {
    withNote: true,
    withoutNote: false,
  },
  "alerts close review note badge depends on stored review note"
);

assert.deepEqual(
  {
    close: resolveOpenLinkPlanId(alertSendCloseSelectedWithReview),
    open: resolveOpenLinkPlanId(alertSendOpenSelected),
  },
  {
    close: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
    open: null,
  },
  "alerts close open link uses planId only for send_close"
);

assert.deepEqual(
  buildSelectedFeedOpenCard({
    ...alertSendOpenSelected,
    entryQuality: "IDEAL",
    collabStrength: "STRONG",
    policyState: "NORMAL",
  }),
  {
    kind: "OPEN",
    id: "alert-nav-open-selected",
    symbol: "BTCUSDT",
    tf: "H4",
    time: "2026-06-01T00:00:00Z",
    direction: "LONG",
    entryRefPrice: 100,
    stopPrice: 95,
    tpPrice: 108,
    rrChosen: 1.5,
    policyState: "NORMAL",
    trafficLight: "STRONG",
    entryQuality: "IDEAL",
    collabStrength: "STRONG",
  },
  "alerts selected feed open card exact"
);

assert.deepEqual(
  buildSelectedFeedCloseCard(
    alertSendCloseSelectedWithReview,
    "stored review"
  ),
  {
    kind: "CLOSE",
    id: "alert-nav-close-selected",
    symbol: "BTCUSDT",
    tf: "H4",
    time: "2026-06-01T01:00:00Z",
    direction: "LONG",
    outcome: "HARD_TP",
    exitPrice: 108,
    rGross: 1.42,
    mfeR: 1.8,
    maeR: 0.6,
    bothHit: false,
    weaknessPreview: ["W_RR_LOW", "W_ENTRY_LATE"],
    weaknessMoreCount: 1,
    replayNote: "auto close summary",
    hasReviewNoteBadge: true,
    openLinkPlanId: "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z",
  },
  "alerts selected feed close card exact"
);

assert.deepEqual(
  {
    live: isAlertBackendState("LIVE"),
    syncing: isAlertBackendState("SYNCING"),
    error: isAlertBackendState("ERROR"),
    invalid: isAlertBackendState("PAUSED"),
  },
  {
    live: true,
    syncing: true,
    error: true,
    invalid: false,
  },
  "alerts backend state enum"
);

assert.deepEqual(
  watchlistStatusSample.map(formatWatchlistStatusToken),
  ["BTC \u2705", "ETH \u2705", "SOL \u23F3(SYNCING)"],
  "alerts watchlist token formatting"
);

assert.equal(
  buildWatchlistStatusLine(watchlistStatusSample),
  "Watch: BTC \u2705 ETH \u2705 SOL \u23F3(SYNCING)",
  "alerts watchlist line formatting"
);

assert.deepEqual(
  buildSelectedFeedStatusView({
    selectedSymbol: "BTCUSDT",
    eventCount: 0,
    backendState: "LIVE",
    lastUpdateTime: null,
  }),
  {
    state: "EMPTY",
    message: "\uC544\uC9C1 \uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. (\uC120\uD0DD\uD55C \uC2EC\uBCFC: BTCUSDT)",
    showRetry: false,
    lastUpdateTime: null,
  },
  "alerts selected feed empty state message"
);

assert.deepEqual(
  buildSelectedFeedStatusView({
    selectedSymbol: "BTCUSDT",
    eventCount: 3,
    backendState: "SYNCING",
    lastUpdateTime: "2026-06-01T00:00:00Z",
  }),
  {
    state: "SYNCING",
    message: "\uB3D9\uAE30\uD654 \uC911\u2026 \uC54C\uB9BC \uC0DD\uC131\uC774 \uC77C\uC2DC \uC911\uC9C0\uB429\uB2C8\uB2E4.",
    showRetry: false,
    lastUpdateTime: "2026-06-01T00:00:00Z",
  },
  "alerts selected feed syncing state message"
);

assert.deepEqual(
  buildSelectedFeedStatusView({
    selectedSymbol: "BTCUSDT",
    eventCount: 3,
    backendState: "ERROR",
    lastUpdateTime: "2026-06-01T00:00:00Z",
  }),
  {
    state: "ERROR",
    message: "\uC11C\uBC84 \uC5F0\uACB0 \uC2E4\uD328. \uB9C8\uC9C0\uB9C9 \uC5C5\uB370\uC774\uD2B8: 2026-06-01T00:00:00Z",
    showRetry: true,
    lastUpdateTime: "2026-06-01T00:00:00Z",
  },
  "alerts selected feed error state shows retry"
);

assert.deepEqual(
  {
    error: buildSelectedFeedStatusView({
      selectedSymbol: "BTCUSDT",
      eventCount: 0,
      backendState: "ERROR",
      lastUpdateTime: "2026-06-01T00:00:00Z",
    }).state,
    syncing: buildSelectedFeedStatusView({
      selectedSymbol: "BTCUSDT",
      eventCount: 0,
      backendState: "SYNCING",
      lastUpdateTime: "2026-06-01T00:00:00Z",
    }).state,
    empty: buildSelectedFeedStatusView({
      selectedSymbol: "BTCUSDT",
      eventCount: 0,
      backendState: "LIVE",
      lastUpdateTime: null,
    }).state,
  },
  {
    error: "ERROR",
    syncing: "SYNCING",
    empty: "EMPTY",
  },
  "alerts selected feed state precedence error over syncing over empty"
);

assert.deepEqual(
  [...CHART_TIMEFRAMES],
  ["3m", "5m", "15m", "30m", "1h", "2h", "4h", "1D"],
  "chart timeframes include 1d"
);

assert.equal(
  toBinanceInterval("1D"),
  "1d",
  "chart timeframe maps 1d to binance interval"
);

assert.equal(
  fromBinanceInterval("1d"),
  "1D",
  "chart timeframe parses binance 1d interval"
);

assert.equal(
  tfToSeconds("1D"),
  86400,
  "chart timeframe 1d seconds mapping"
);

assert.equal(
  normalizeChartTimeframe("1D"),
  "1D",
  "chart timeframe normalization preserves 1d"
);

assert.equal(
  normalizeChartTimeframe("weird"),
  "15m",
  "chart timeframe normalization falls back for invalid value"
);

assert.deepEqual(
  buildOtherInboxStatusView({
    selectedSymbol: "BTCUSDT",
    eventCount: 0,
    backendState: "LIVE",
    lastUpdateTime: null,
    watchlist: watchlistStatusSample,
  }),
  {
    state: "EMPTY",
    message: "\uD604\uC7AC BTCUSDT \uC678 \uB2E4\uB978 \uC2EC\uBCFC \uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
    showRetry: false,
    lastUpdateTime: null,
    watchlistLine: "Watch: BTC \u2705 ETH \u2705 SOL \u23F3(SYNCING)",
  },
  "alerts other inbox empty message uses selected symbol"
);

assert.equal(
  buildOtherInboxStatusView({
    selectedSymbol: "BTCUSDT",
    eventCount: 2,
    backendState: "LIVE",
    lastUpdateTime: null,
    watchlist: watchlistStatusSample,
  }).watchlistLine,
  "Watch: BTC \u2705 ETH \u2705 SOL \u23F3(SYNCING)",
  "alerts other inbox watchlist line is always present"
);

assert.deepEqual(
  buildOtherInboxStatusView({
    selectedSymbol: "BTCUSDT",
    eventCount: 3,
    backendState: "ERROR",
    lastUpdateTime: "2026-06-01T00:00:00Z",
    watchlist: watchlistStatusSample,
  }),
  {
    state: "ERROR",
    message: "\uC11C\uBC84 \uC5F0\uACB0 \uC2E4\uD328. \uB9C8\uC9C0\uB9C9 \uC5C5\uB370\uC774\uD2B8: 2026-06-01T00:00:00Z",
    showRetry: true,
    lastUpdateTime: "2026-06-01T00:00:00Z",
    watchlistLine: "Watch: BTC \u2705 ETH \u2705 SOL \u23F3(SYNCING)",
  },
  "alerts other inbox error state shows retry and last update"
);

assert.equal(
  alertPanelsCoverageMatrix.includes("# Alert Panels Coverage Matrix v0.1.1"),
  true,
  "alert panels coverage matrix exists"
);

assert.deepEqual(
  {
    rowsPresent: [
      "UI-113",
      "UI-114",
      "UI-115",
      "UI-116",
      "UI-117",
      "UI-118",
      "UI-119",
      "UI-120",
      "UI-121",
      "UI-122",
    ].every((row) => {
      return alertPanelsCoverageMatrix.includes(`| ${row} |`);
    }),
    doneCount: (alertPanelsCoverageMatrix.match(/\| DONE \|/g) ?? []).length,
  },
  {
    rowsPresent: true,
    doneCount: 10,
  },
  "alert panels coverage matrix marks ui 113 to 122 done"
);

{
  appendSignalEvent({
    id: "smoke-selected-open-122",
    type: "SEND_OPEN",
    symbol: "SMOKESEL122",
    tf: "H4",
    time: "2026-06-01T09:00:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "smoke-selected-close-122",
    type: "SEND_CLOSE",
    symbol: "SMOKESEL122",
    tf: "H4",
    time: "2026-06-01T09:05:00Z",
    direction: "LONG",
    outcome: "HARD_TP",
    exitPrice: 100,
    rGross: 1,
    severity: "MID",
  });

  assert.deepEqual(
    listSelectedSymbolEvents({
      symbol: "SMOKESEL122",
      limit: 10,
      filterState: {
        eventType: "OPEN_ONLY",
      },
    }).map((event) => event.id),
    ["smoke-selected-open-122"],
    "alert panels selected feed remains flat after eventType filter"
  );
}

{
  const filteredOtherInboxEvents = applyOtherInboxFilters(
    [
      {
        ...alertOtherInboxOpen,
        id: "smoke-other-unread-high-open-122",
        symbol: "SMOKEOTH122",
        tf: "H1",
        time: "2026-06-01T09:20:00Z",
        seen: false,
        severity: "HIGH" as const,
      },
      {
        ...alertSendCloseSelectedWithReview,
        id: "smoke-other-unread-high-close-122",
        symbol: "SMOKEOTH122",
        tf: "H1",
        time: "2026-06-01T09:19:00Z",
        seen: false,
        severity: "HIGH" as const,
      },
      {
        ...alertOtherInboxOpen,
        id: "smoke-other-unread-low-open-122",
        symbol: "SMOKEOTH122",
        tf: "H1",
        time: "2026-06-01T09:18:00Z",
        seen: false,
        severity: "LOW" as const,
      },
      {
        ...alertOtherInboxOpen,
        id: "smoke-other-seen-high-open-122",
        symbol: "SMOKEOTH122",
        tf: "H1",
        time: "2026-06-01T09:17:00Z",
        seen: true,
        severity: "HIGH" as const,
      },
    ],
    {
      tab: "Unread",
      eventType: "OPEN_ONLY",
      severity: "HIGH",
    }
  );

  assert.deepEqual(
    filteredOtherInboxEvents.map((event) => event.id),
    ["smoke-other-unread-high-open-122"],
    "alert panels other inbox applies unread type severity before grouping"
  );
}

{
  const groupedAfterFiltering = groupSignalEvents(
    applyOtherInboxFilters(
      [
        {
          ...alertOtherInboxOpen,
          id: "smoke-group-after-filter-1",
          symbol: "SMOKEGROUP122",
          tf: "H1",
          time: "2026-06-01T09:35:00Z",
          seen: false,
          severity: "HIGH" as const,
        },
        {
          ...alertOtherInboxOpen,
          id: "smoke-group-after-filter-2",
          symbol: "SMOKEGROUP122",
          tf: "H1",
          time: "2026-06-01T09:33:00Z",
          seen: false,
          severity: "HIGH" as const,
        },
        {
          ...alertOtherInboxOpen,
          id: "smoke-group-after-filter-3",
          symbol: "SMOKEGROUP122",
          tf: "H1",
          time: "2026-06-01T09:31:00Z",
          seen: false,
          severity: "LOW" as const,
        },
      ],
      {
        tab: "All",
        eventType: "OPEN_ONLY",
        severity: "HIGH",
      }
    )
  );

  assert.deepEqual(
    groupedAfterFiltering.map((item) => {
      return item.kind === "group" ? "group" : item.event.id;
    }),
    ["smoke-group-after-filter-1", "smoke-group-after-filter-2"],
    "alert panels other inbox grouping only after filtering"
  );
}

{
  const mutedOtherInboxEvents = listOtherInboxEvents({
    selectedSymbol: "BTCUSDT",
    limit: 20,
    filterState: {
      tab: "All",
      eventType: "ALL",
      severity: "ALL",
    },
    mutedKeys: new Set<string>(["SMOKEMUTE122|H1"]),
  });

  appendSignalEvent({
    id: "smoke-muted-hidden-122",
    type: "SEND_OPEN",
    symbol: "SMOKEMUTE122",
    tf: "H1",
    time: "2026-06-01T09:40:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "smoke-muted-visible-122",
    type: "SEND_OPEN",
    symbol: "SMOKEVISIBLE122",
    tf: "H1",
    time: "2026-06-01T09:41:00Z",
    direction: "LONG",
    severity: "HIGH",
  });

  const afterMutedOtherInboxEvents = listOtherInboxEvents({
    selectedSymbol: "BTCUSDT",
    limit: 20,
    filterState: {
      tab: "All",
      eventType: "ALL",
      severity: "ALL",
    },
    mutedKeys: new Set<string>(["SMOKEMUTE122|H1"]),
  });

  assert.deepEqual(
    afterMutedOtherInboxEvents
      .slice(
        0,
        afterMutedOtherInboxEvents.length - mutedOtherInboxEvents.length
      )
      .map((event) => event.id),
    ["smoke-muted-visible-122"],
    "alert panels mute still excludes muted symbol tf from other inbox"
  );
}

{
  const profileId = "profile-122-unseen-high";
  for (const event of listSignalEvents()) {
    upsertSeenState({
      profileId,
      eventId: event.id,
      seenAtUtc: "2026-06-01T00:00:00Z",
    });
  }

  appendSignalEvent({
    id: "smoke-unseen-high-counted-122",
    type: "SEND_OPEN",
    symbol: "SMOKEHIGH122",
    tf: "H1",
    time: "2026-06-01T09:50:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "smoke-unseen-high-seen-122",
    type: "SEND_OPEN",
    symbol: "SMOKEHIGH122",
    tf: "H4",
    time: "2026-06-01T09:49:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "smoke-unseen-high-muted-122",
    type: "SEND_OPEN",
    symbol: "SMOKEHIGHMUTED122",
    tf: "H1",
    time: "2026-06-01T09:48:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "smoke-unseen-mid-122",
    type: "SEND_CLOSE",
    symbol: "SMOKEHIGH122",
    tf: "H1",
    time: "2026-06-01T09:47:00Z",
    direction: "LONG",
    outcome: "TIMEOUT",
    exitPrice: 100,
    rGross: 0.1,
    severity: "MID",
  });
  appendSignalEvent({
    id: "smoke-unseen-selected-symbol-122",
    type: "SEND_OPEN",
    symbol: "BTCUSDT",
    tf: "H1",
    time: "2026-06-01T09:46:00Z",
    direction: "LONG",
    severity: "HIGH",
  });

  upsertSeenState({
    profileId,
    eventId: "smoke-unseen-high-seen-122",
    seenAtUtc: "2026-06-01T09:55:00Z",
  });

  assert.equal(
    computeUnseenHighCountOther({
      profileId,
      selectedSymbol: "BTCUSDT",
      mutedKeys: new Set<string>(["SMOKEHIGHMUTED122|H1"]),
    }),
    1,
    "alert panels unseen high count excludes seen and muted"
  );
}

assert.equal(
  (() => {
    const steps = buildAlertCardNavigationPlan({
      event: alertOtherInboxOpen,
      source: "OTHER_SYMBOLS_INBOX",
      currentSymbol: "BTCUSDT",
      currentTf: "M30",
      autoTfSwitch: true,
    }).steps.map((step) => step.type);

    return steps.indexOf("whenReady") < steps.indexOf("markSeen");
  })(),
  true,
  "alert panels click contract keeps whenReady before markSeen"
);

assert.deepEqual(
  {
    eventTypeFilters: [...ALERT_EVENT_TYPE_FILTERS],
    severityFilters: [...ALERT_SEVERITY_FILTERS],
    openBucket: getEventTypeBucket(alertSendOpenSelected),
    closeBucket: getEventTypeBucket(alertSendCloseSelected),
  },
  {
    eventTypeFilters: ["ALL", "OPEN_ONLY", "CLOSE_ONLY"],
    severityFilters: ["ALL", "HIGH", "MID", "LOW"],
    openBucket: "OPEN",
    closeBucket: "CLOSE",
  },
  "alerts filter enums"
);

assert.deepEqual(
  applySelectedFeedFilters(
    [
      alertSendOpenSelected,
      {
        ...alertSendCloseSelectedWithReview,
        id: "filter-close-selected-121",
      },
    ],
    {
      eventType: "OPEN_ONLY",
    }
  ).map((event) => event.id),
  ["alert-nav-open-selected"],
  "alerts selected feed type filter open only"
);

assert.deepEqual(
  applySelectedFeedFilters(
    [
      alertSendOpenSelected,
      {
        ...alertSendCloseSelectedWithReview,
        id: "filter-close-selected-121",
      },
    ],
    {
      eventType: "CLOSE_ONLY",
    }
  ).map((event) => event.id),
  ["filter-close-selected-121"],
  "alerts selected feed type filter close only"
);

assert.deepEqual(
  applyOtherInboxFilters(
    [
      {
        ...alertOtherInboxOpen,
        id: "other-type-open-121",
        severity: "HIGH" as const,
      },
      {
        ...alertSendCloseSelectedWithReview,
        id: "other-type-close-121",
        symbol: "XRPUSDT",
        tf: "H1",
        time: "2026-06-01T02:10:00Z",
        seen: false,
        severity: "HIGH" as const,
      },
    ],
    {
      tab: "All",
      eventType: "OPEN_ONLY",
      severity: "ALL",
    }
  ).map((event) => event.id),
  ["other-type-open-121"],
  "alerts other inbox type filter open only"
);

assert.deepEqual(
  applyOtherInboxFilters(
    [
      {
        ...alertOtherInboxOpen,
        id: "other-severity-high-121",
        severity: "HIGH" as const,
      },
      {
        ...alertSendCloseSelectedWithReview,
        id: "other-severity-mid-121",
        symbol: "AVAXUSDT",
        tf: "H1",
        time: "2026-06-01T02:20:00Z",
        seen: false,
      },
      {
        ...alertSendOpenSelected,
        id: "other-severity-low-121",
        symbol: "ADAUSDT",
        tf: "H1",
        time: "2026-06-01T02:30:00Z",
        seen: false,
        severity: "LOW" as const,
      },
    ],
    {
      tab: "All",
      eventType: "ALL",
      severity: "HIGH",
    }
  ).map((event) => event.id),
  ["other-severity-high-121"],
  "alerts other inbox severity filter high only"
);

assert.deepEqual(
  applyOtherInboxFilters(
    [
      {
        ...alertSendCloseSelectedWithReview,
        id: "other-order-seen-close-high-121",
        symbol: "ORDER121",
        tf: "H1",
        time: "2026-06-01T05:00:00Z",
        seen: true,
        severity: "HIGH" as const,
      },
      {
        ...alertOtherInboxOpen,
        id: "other-order-unseen-open-low-121",
        symbol: "ORDER121",
        tf: "H1",
        time: "2026-06-01T04:59:00Z",
        seen: false,
        severity: "LOW" as const,
      },
      {
        ...alertSendCloseSelectedWithReview,
        id: "other-order-unseen-close-high-121",
        symbol: "ORDER121",
        tf: "H1",
        time: "2026-06-01T04:58:00Z",
        seen: false,
        severity: "HIGH" as const,
      },
    ],
    {
      tab: "Unread",
      eventType: "CLOSE_ONLY",
      severity: "HIGH",
    }
  ).map((event) => event.id),
  ["other-order-unseen-close-high-121"],
  "alerts other inbox applies tab before type and severity"
);

assert.deepEqual(
  buildAlertCardNavigationPlan({
    event: alertSendOpenSelected,
    source: "SELECTED_SYMBOL_FEED",
    currentSymbol: "BTCUSDT",
    currentTf: "H4",
  }),
  {
    source: "SELECTED_SYMBOL_FEED",
    steps: [
      { type: "whenReady", symbol: "BTCUSDT", tf: "H4" },
      {
        type: "goToTime",
        centerTime: "2026-06-01T00:00:00Z",
        barsAround: 60,
      },
      { type: "highlightPOI", poiRef: "POI-1", durationMs: 10000 },
      {
        type: "showTradePlanLines",
        entryRefPrice: 100,
        stopPrice: 95,
        tpPrice: 108,
        durationMs: 10000,
      },
      { type: "markSeen", eventId: "alert-nav-open-selected" },
    ],
  },
  "alerts selected feed open click keeps symbol tf and uses open time"
);

assert.deepEqual(
  buildAlertCardNavigationPlan({
    event: alertSendCloseSelected,
    source: "SELECTED_SYMBOL_FEED",
    currentSymbol: "BTCUSDT",
    currentTf: "H4",
  }),
  {
    source: "SELECTED_SYMBOL_FEED",
    steps: [
      { type: "whenReady", symbol: "BTCUSDT", tf: "H4" },
      {
        type: "goToTime",
        centerTime: "2026-06-01T01:00:00Z",
        barsAround: 60,
      },
      { type: "markSeen", eventId: "alert-nav-close-selected" },
    ],
  },
  "alerts selected feed close click uses exit time"
);

assert.deepEqual(
  buildAlertCardNavigationPlan({
    event: alertOtherInboxOpen,
    source: "OTHER_SYMBOLS_INBOX",
    currentSymbol: "BTCUSDT",
    currentTf: "H4",
    autoTfSwitch: true,
  }),
  {
    source: "OTHER_SYMBOLS_INBOX",
    steps: [
      { type: "setSelectedSymbol", symbol: "ETHUSDT" },
      { type: "setSelectedTf", tf: "H1" },
      { type: "whenReady", symbol: "ETHUSDT", tf: "H1" },
      {
        type: "goToTime",
        centerTime: "2026-06-01T02:00:00Z",
        barsAround: 60,
      },
      {
        type: "highlightPOI",
        poiRef: "POI-118-OTHER",
        durationMs: 10000,
      },
      {
        type: "showTradePlanLines",
        entryRefPrice: 200,
        stopPrice: 210,
        tpPrice: 180,
        durationMs: 10000,
      },
      { type: "markSeen", eventId: "alert-nav-open-other" },
    ],
  },
  "alerts other inbox click switches symbol and tf when auto switch on"
);

assert.deepEqual(
  buildAlertCardNavigationPlan({
    event: alertOtherInboxOpen,
    source: "OTHER_SYMBOLS_INBOX",
    currentSymbol: "BTCUSDT",
    currentTf: "M30",
    autoTfSwitch: false,
  }),
  {
    source: "OTHER_SYMBOLS_INBOX",
    steps: [
      { type: "setSelectedSymbol", symbol: "ETHUSDT" },
      { type: "whenReady", symbol: "ETHUSDT", tf: "M30" },
      {
        type: "goToTime",
        centerTime: "2026-06-01T02:00:00Z",
        barsAround: 60,
      },
      {
        type: "highlightPOI",
        poiRef: "POI-118-OTHER",
        durationMs: 10000,
      },
      {
        type: "showTradePlanLines",
        entryRefPrice: 200,
        stopPrice: 210,
        tpPrice: 180,
        durationMs: 10000,
      },
      { type: "markSeen", eventId: "alert-nav-open-other" },
    ],
  },
  "alerts other inbox click keeps current tf when auto switch off"
);

assert.deepEqual(
  buildAlertCardNavigationPlan({
    event: alertOtherInboxOpen,
    source: "OTHER_SYMBOLS_INBOX",
    currentSymbol: "BTCUSDT",
    currentTf: "H4",
    autoTfSwitch: true,
  }).steps.map((step) => step.type),
  [
    "setSelectedSymbol",
    "setSelectedTf",
    "whenReady",
    "goToTime",
    "highlightPOI",
    "showTradePlanLines",
    "markSeen",
  ],
  "alerts navigation click sequence order is exact"
);

assert.deepEqual(
  buildAlertCardNavigationPlan({
    event: {
      ...alertSendOpenSelected,
      poiRef: undefined,
    },
    source: "SELECTED_SYMBOL_FEED",
    currentSymbol: "BTCUSDT",
    currentTf: "H4",
  }).steps.map((step) => step.type),
  ["whenReady", "goToTime", "showTradePlanLines", "markSeen"],
  "alerts navigation skips poi highlight when poiRef missing"
);

assert.deepEqual(
  buildAlertCardNavigationPlan({
    event: {
      ...alertSendOpenSelected,
      tpPrice: undefined,
    },
    source: "SELECTED_SYMBOL_FEED",
    currentSymbol: "BTCUSDT",
    currentTf: "H4",
  }).steps.map((step) => step.type),
  ["whenReady", "goToTime", "highlightPOI", "markSeen"],
  "alerts navigation skips trade plan lines when price lines missing"
);

assert.deepEqual(
  {
    linkedOpenId:
      findLinkedOpenEvent(alertOpenLinkEvents, "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z")?.id,
    plan: buildOpenLinkPlan(alertOpenLinkEvents, "BTCUSDT|LONG|POI-1@2026-06-01T00:00:00Z"),
  },
  {
    linkedOpenId: "alert-nav-open-selected",
    plan: {
      source: "OPEN_LINK",
      steps: [
        { type: "scrollToEvent", eventId: "alert-nav-open-selected" },
        {
          type: "highlightEvent",
          eventId: "alert-nav-open-selected",
          durationMs: 3000,
        },
      ],
    },
  },
  "alerts open link finds matching send_open by planId"
);

assert.equal(
  buildOpenLinkPlan(alertOpenLinkEvents, "PLAN-118-MISSING"),
  null,
  "alerts open link returns null when no matching open exists"
);

assert.deepEqual(
  {
    defaultProfile: DEFAULT_ALERT_PROFILE_ID,
    tabs: [...ALERT_SEEN_TABS],
  },
  {
    defaultProfile: "default",
    tabs: ["Unread", "All"],
  },
  "alerts seen constants and default profile"
);

assert.deepEqual(
  upsertSeenState({
    eventId: "E1",
    seenAtUtc: "2026-06-01T01:00:00Z",
  }),
  {
    profileId: "default",
    eventId: "E1",
    seenAtUtc: "2026-06-01T01:00:00Z",
  },
  "alerts seen upsert uses event id and default profile"
);

upsertSeenState({
  eventId: "E1",
  seenAtUtc: "2026-06-01T01:05:00Z",
});

assert.deepEqual(
  getSeenState(undefined, "E1"),
  {
    profileId: "default",
    eventId: "E1",
    seenAtUtc: "2026-06-01T01:05:00Z",
  },
  "alerts seen upsert overwrites timestamp"
);

appendSignalEvent({
  id: "seen-signal-older",
  type: "SEND_OPEN",
  symbol: "SEENBTC",
  tf: "H4",
  time: "2026-06-01T00:00:00Z",
  direction: "LONG",
});
appendSignalEvent({
  id: "seen-signal-newer",
  type: "SEND_CLOSE",
  symbol: "SEENBTC",
  tf: "H4",
  time: "2026-06-01T00:30:00Z",
  direction: "LONG",
  outcome: "TIMEOUT",
  exitPrice: 100,
  rGross: 0.2,
});
upsertSeenState({
  eventId: "seen-signal-older",
  seenAtUtc: "2026-06-01T00:40:00Z",
});

assert.deepEqual(
  listSignalEventsWithSeen({
    symbol: "SEENBTC",
    limit: 2,
    tab: "All",
  }).map((event) => ({
    id: event.id,
    seen: event.seen,
  })),
  [
    { id: "seen-signal-newer", seen: false },
    { id: "seen-signal-older", seen: true },
  ],
  "alerts signals with seen filters selected symbol and sorts desc"
);

appendSignalEvent({
  id: "unread-seen",
  type: "SEND_OPEN",
  symbol: "UNREADBTC",
  tf: "H1",
  time: "2026-06-01T00:00:00Z",
  direction: "LONG",
});
appendSignalEvent({
  id: "unread-fresh",
  type: "SEND_CLOSE",
  symbol: "UNREADBTC",
  tf: "H1",
  time: "2026-06-01T00:10:00Z",
  direction: "LONG",
  outcome: "HARD_TP",
  exitPrice: 101,
  rGross: 1.1,
});
upsertSeenState({
  eventId: "unread-seen",
  seenAtUtc: "2026-06-01T00:20:00Z",
});

assert.deepEqual(
  listSignalEventsWithSeen({
    symbol: "UNREADBTC",
    limit: 10,
    tab: "Unread",
  }).map((event) => event.id),
  ["unread-fresh"],
  "alerts signals unread tab excludes seen"
);

appendSignalEvent({
  id: "other-inbox-selected",
  type: "SEND_OPEN",
  symbol: "MAIN114",
  tf: "H1",
  time: "2026-06-01T00:00:00Z",
  direction: "LONG",
});
appendSignalEvent({
  id: "other-inbox-other",
  type: "SEND_OPEN",
  symbol: "OTHER114",
  tf: "H1",
  time: "2026-06-01T00:10:00Z",
  direction: "SHORT",
});

assert.deepEqual(
  {
    hasSelected: listSignalEventsWithSeen({
      excludeSymbol: "MAIN114",
      limit: 9999,
      tab: "All",
    }).some((event) => event.symbol === "MAIN114"),
    hasOther: listSignalEventsWithSeen({
      excludeSymbol: "MAIN114",
      limit: 9999,
      tab: "All",
    }).some((event) => event.symbol === "OTHER114"),
  },
  {
    hasSelected: false,
    hasOther: true,
  },
  "alerts other inbox excludes selected symbol"
);

const unseenHighCountOtherBase = computeUnseenHighCountOther({
  selectedSymbol: "SEL114",
  mutedKeys: new Set(["MUTED114|H1"]),
});

appendSignalEvent({
  id: "high-count-keep",
  type: "SEND_OPEN",
  symbol: "KEEP114",
  tf: "H1",
  time: "2026-06-01T00:00:00Z",
  direction: "LONG",
  severity: "HIGH",
});
appendSignalEvent({
  id: "high-count-seen",
  type: "SEND_OPEN",
  symbol: "SEEN114",
  tf: "H1",
  time: "2026-06-01T00:01:00Z",
  direction: "LONG",
  severity: "HIGH",
});
appendSignalEvent({
  id: "high-count-low",
  type: "SEND_OPEN",
  symbol: "LOW114",
  tf: "H1",
  time: "2026-06-01T00:02:00Z",
  direction: "LONG",
  severity: "LOW",
});
appendSignalEvent({
  id: "high-count-selected",
  type: "SEND_OPEN",
  symbol: "SEL114",
  tf: "H1",
  time: "2026-06-01T00:03:00Z",
  direction: "LONG",
  severity: "HIGH",
});
appendSignalEvent({
  id: "high-count-muted",
  type: "SEND_OPEN",
  symbol: "MUTED114",
  tf: "H1",
  time: "2026-06-01T00:04:00Z",
  direction: "LONG",
  severity: "HIGH",
});
upsertSeenState({
  eventId: "high-count-seen",
  seenAtUtc: "2026-06-01T00:05:00Z",
});

assert.equal(
  computeUnseenHighCountOther({
    selectedSymbol: "SEL114",
    mutedKeys: new Set(["MUTED114|H1"]),
  }) - unseenHighCountOtherBase,
  1,
  "alerts unseen high count other ignores seen and muted"
);

assert.equal(
  DEFAULT_MUTE_DURATION_MIN,
  60,
  "alerts mute default duration constant"
);

assert.equal(
  buildMuteStateKey("default", "BTCUSDT", "H1"),
  "default|BTCUSDT|H1",
  "alerts mute key uses profile symbol tf"
);

upsertMuteState({
  symbol: "DELMUTE1",
  tf: "H1",
  muteUntilUtc: "2026-06-01T03:00:00Z",
});

clearMuteState("default", "DELMUTE1", "H1");

assert.equal(
  getMuteState("default", "DELMUTE1", "H1"),
  null,
  "alerts mute delete clears stored mute"
);

upsertMuteState({
  profileId: "default",
  symbol: "EXPMUTE1",
  tf: "M5",
  muteUntilUtc: "2026-06-01T01:00:00Z",
});

assert.equal(
  isMuted("default", "EXPMUTE1", "M5", "2026-06-01T01:00:00Z"),
  false,
  "alerts mute isMuted returns false after expiry"
);

const muteBaseUnseenHighCount = computeUnseenHighCountOther({
  profileId: "default",
  selectedSymbol: "SELECT115",
  mutedKeys: buildMutedKeySet("default", "2026-06-01T04:30:00Z"),
});

appendSignalEvent({
  id: "mute-other-hidden",
  type: "SEND_OPEN",
  symbol: "MUTEHIDE",
  tf: "H1",
  time: "2026-06-01T04:00:00Z",
  direction: "LONG",
  severity: "HIGH",
});
appendSignalEvent({
  id: "mute-other-visible",
  type: "SEND_OPEN",
  symbol: "MUTEKEEP",
  tf: "H1",
  time: "2026-06-01T04:10:00Z",
  direction: "LONG",
  severity: "HIGH",
});
upsertMuteState({
  profileId: "default",
  symbol: "MUTEHIDE",
  tf: "H1",
  muteUntilUtc: "2026-06-01T05:00:00Z",
});

assert.equal(
  computeUnseenHighCountOther({
    profileId: "default",
    selectedSymbol: "SELECT115",
    mutedKeys: buildMutedKeySet("default", "2026-06-01T04:30:00Z"),
  }),
  muteBaseUnseenHighCount + 1,
  "alerts unseen high count other ignores muted symbol tf"
);

assert.deepEqual(
  {
    windowMin: ALERT_GROUP_WINDOW_MIN,
    minCount: ALERT_GROUP_MIN_COUNT,
  },
  {
    windowMin: 5,
    minCount: 3,
  },
  "alerts grouping constants"
);

assert.equal(
  buildSignalGroupKey({
    id: "group-key-1",
    type: "SEND_OPEN",
    symbol: "BTCUSDT",
    tf: "H1",
    time: "2026-06-01T10:00:00Z",
    direction: "LONG",
    seen: false,
  }),
  "BTCUSDT|H1|SEND_OPEN|LONG",
  "alerts signal group key formula"
);

const groupedThreeSameKeyItems = groupSignalEvents([
  {
    id: "group-three-1",
    type: "SEND_OPEN",
    symbol: "GROUP3",
    tf: "H1",
    time: "2026-06-01T10:00:00Z",
    direction: "LONG",
    severity: "MID",
    seen: false,
  },
  {
    id: "group-three-2",
    type: "SEND_OPEN",
    symbol: "GROUP3",
    tf: "H1",
    time: "2026-06-01T09:58:00Z",
    direction: "LONG",
    severity: "MID",
    seen: false,
  },
  {
    id: "group-three-3",
    type: "SEND_OPEN",
    symbol: "GROUP3",
    tf: "H1",
    time: "2026-06-01T09:56:00Z",
    direction: "LONG",
    severity: "MID",
    seen: false,
  },
]);

assert.deepEqual(
  groupedThreeSameKeyItems,
  [
    {
      kind: "group",
      group: {
        groupKey: "GROUP3|H1|SEND_OPEN|LONG",
        symbol: "GROUP3",
        tf: "H1",
        eventType: "SEND_OPEN",
        direction: "LONG",
        count: 3,
        latestTime: "2026-06-01T10:00:00Z",
        earliestTime: "2026-06-01T09:56:00Z",
        severity: "MID",
        eventIds: ["group-three-1", "group-three-2", "group-three-3"],
        seen: false,
        unseenCount: 3,
      },
    },
  ],
  "alerts grouping collapses three same-key events within five minutes"
);

assert.deepEqual(
  groupSignalEvents([
    {
      id: "group-two-1",
      type: "SEND_OPEN",
      symbol: "GROUP2",
      tf: "H1",
      time: "2026-06-01T10:00:00Z",
      direction: "LONG",
      seen: false,
    },
    {
      id: "group-two-2",
      type: "SEND_OPEN",
      symbol: "GROUP2",
      tf: "H1",
      time: "2026-06-01T09:58:00Z",
      direction: "LONG",
      seen: false,
    },
  ]).map((item) => item.kind),
  ["event", "event"],
  "alerts grouping does not collapse two events"
);

assert.equal(
  groupSignalEvents([
    {
      id: "group-window-1",
      type: "SEND_OPEN",
      symbol: "GROUPWIN",
      tf: "H1",
      time: "2026-06-01T10:00:00Z",
      direction: "LONG",
      seen: false,
    },
    {
      id: "group-window-2",
      type: "SEND_OPEN",
      symbol: "GROUPWIN",
      tf: "H1",
      time: "2026-06-01T09:54:00Z",
      direction: "LONG",
      seen: false,
    },
    {
      id: "group-window-3",
      type: "SEND_OPEN",
      symbol: "GROUPWIN",
      tf: "H1",
      time: "2026-06-01T09:53:00Z",
      direction: "LONG",
      seen: false,
    },
  ]).some((item) => item.kind === "group"),
  false,
  "alerts grouping does not collapse when outside five-minute window"
);

assert.deepEqual(
  groupSignalEvents([
    {
      id: "group-boundary-a1",
      type: "SEND_OPEN",
      symbol: "GROUPBOUND",
      tf: "H1",
      time: "2026-06-01T10:00:00Z",
      direction: "LONG",
      seen: false,
    },
    {
      id: "group-boundary-b1",
      type: "SEND_CLOSE",
      symbol: "GROUPBOUND",
      tf: "H1",
      time: "2026-06-01T09:59:00Z",
      direction: "LONG",
      seen: false,
    },
    {
      id: "group-boundary-a2",
      type: "SEND_OPEN",
      symbol: "GROUPBOUND",
      tf: "H1",
      time: "2026-06-01T09:58:00Z",
      direction: "LONG",
      seen: false,
    },
    {
      id: "group-boundary-a3",
      type: "SEND_OPEN",
      symbol: "GROUPBOUND",
      tf: "H1",
      time: "2026-06-01T09:57:00Z",
      direction: "LONG",
      seen: false,
    },
  ]).map((item) => {
    return item.kind === "event" ? item.event.id : item.group.groupKey;
  }),
  [
    "group-boundary-a1",
    "group-boundary-b1",
    "group-boundary-a2",
    "group-boundary-a3",
  ],
  "alerts grouping does not cross key boundary"
);

assert.equal(
  (
    groupSignalEvents([
      {
        id: "group-sev-1",
        type: "SEND_OPEN",
        symbol: "GROUPSEV",
        tf: "H1",
        time: "2026-06-01T10:00:00Z",
        direction: "LONG",
        severity: "LOW",
        seen: false,
      },
      {
        id: "group-sev-2",
        type: "SEND_OPEN",
        symbol: "GROUPSEV",
        tf: "H1",
        time: "2026-06-01T09:59:00Z",
        direction: "LONG",
        severity: "MID",
        seen: false,
      },
      {
        id: "group-sev-3",
        type: "SEND_OPEN",
        symbol: "GROUPSEV",
        tf: "H1",
        time: "2026-06-01T09:58:00Z",
        direction: "LONG",
        severity: "HIGH",
        seen: false,
      },
    ])[0] as { kind: "group"; group: { severity: string } }
  ).group.severity,
  "HIGH",
  "alerts grouping summary severity uses max severity"
);

assert.deepEqual(
  (
    groupSignalEvents([
      {
        id: "group-seen-1",
        type: "SEND_CLOSE",
        symbol: "GROUPSEEN",
        tf: "M30",
        time: "2026-06-01T10:00:00Z",
        direction: "SHORT",
        seen: true,
      },
      {
        id: "group-seen-2",
        type: "SEND_CLOSE",
        symbol: "GROUPSEEN",
        tf: "M30",
        time: "2026-06-01T09:59:00Z",
        direction: "SHORT",
        seen: false,
      },
      {
        id: "group-seen-3",
        type: "SEND_CLOSE",
        symbol: "GROUPSEEN",
        tf: "M30",
        time: "2026-06-01T09:58:00Z",
        direction: "SHORT",
        seen: false,
      },
    ])[0] as { kind: "group"; group: { seen: boolean; unseenCount: number } }
  ).group,
  {
    groupKey: "GROUPSEEN|M30|SEND_CLOSE|SHORT",
    symbol: "GROUPSEEN",
    tf: "M30",
    eventType: "SEND_CLOSE",
    direction: "SHORT",
    count: 3,
    latestTime: "2026-06-01T10:00:00Z",
    earliestTime: "2026-06-01T09:58:00Z",
    severity: "LOW",
    eventIds: ["group-seen-1", "group-seen-2", "group-seen-3"],
    seen: false,
    unseenCount: 2,
  },
  "alerts grouping summary seen and unseenCount are correct"
);

assert.deepEqual(
  {
    enabled: DEFAULT_SOUND_ALERT_HIGH_ENABLED,
    eventTypes: ALERT_SOUND_EVENT_TYPES,
    pref: getSoundPreference(undefined),
  },
  {
    enabled: false,
    eventTypes: ["SEND_OPEN", "SEND_CLOSE"],
    pref: {
      profileId: "default",
      enabled: false,
      updatedAtUtc: null,
    },
  },
  "alerts sound default preference is off"
);

assert.deepEqual(
  upsertSoundPreference(undefined, true, "2026-06-01T12:00:00Z"),
  {
    profileId: "default",
    enabled: true,
    updatedAtUtc: "2026-06-01T12:00:00Z",
  },
  "alerts sound preference upsert uses default profile"
);

assert.equal(
  buildSoundPlayedKey("default", "E1"),
  "default|E1",
  "alerts sound played key uses profile and event id"
);

assert.deepEqual(
  markSoundPlayed(undefined, "PLAYED-EVENT-1", "2026-06-01T12:05:00Z"),
  {
    profileId: "default",
    eventId: "PLAYED-EVENT-1",
    playedAtUtc: "2026-06-01T12:05:00Z",
  },
  "alerts sound mark played stores one event id record"
);

assert.equal(
  hasSoundPlayed(undefined, "PLAYED-EVENT-1"),
  true,
  "alerts sound mark played stores one event id record"
);

assert.deepEqual(
  {
    sendOpen: getAlertSeverity({
      id: "sound-open",
      type: "SEND_OPEN",
      symbol: "BTCUSDT",
      tf: "H1",
      time: "2026-06-01T12:10:00Z",
      direction: "LONG",
      seen: false,
    }),
    sendClose: getAlertSeverity({
      id: "sound-close",
      type: "SEND_CLOSE",
      symbol: "BTCUSDT",
      tf: "H1",
      time: "2026-06-01T12:11:00Z",
      direction: "LONG",
      seen: false,
    }),
    scoreHigh: getAlertSeverity({
      id: "sound-score-high",
      type: "UNKNOWN" as "SEND_OPEN" | "SEND_CLOSE",
      symbol: "BTCUSDT",
      tf: "H1",
      time: "2026-06-01T12:12:00Z",
      direction: "LONG",
      score: 95,
      seen: false,
    }),
    scoreLow: getAlertSeverity({
      id: "sound-score-low",
      type: "UNKNOWN" as "SEND_OPEN" | "SEND_CLOSE",
      symbol: "BTCUSDT",
      tf: "H1",
      time: "2026-06-01T12:13:00Z",
      direction: "LONG",
      score: 70,
      seen: false,
    }),
  },
  {
    sendOpen: "HIGH",
    sendClose: "MID",
    scoreHigh: "HIGH",
    scoreLow: "LOW",
  },
  "alerts sound severity mapping follows ui spec"
);

assert.deepEqual(
  shouldPlayHighOtherSymbolSound({
    profileId: "default",
    selectedSymbol: "BTCUSDT",
    event: {
      id: "sound-allow",
      type: "SEND_OPEN",
      symbol: "ETHUSDT",
      tf: "H1",
      time: "2026-06-01T12:20:00Z",
      direction: "LONG",
      seen: false,
    },
    soundEnabled: true,
    alreadyPlayed: false,
  }),
  {
    shouldPlay: true,
    reason: "OK",
  },
  "alerts sound play allowed for high other symbol not muted unplayed"
);

assert.deepEqual(
  shouldPlayHighOtherSymbolSound({
    selectedSymbol: "BTCUSDT",
    event: {
      id: "sound-selected",
      type: "SEND_OPEN",
      symbol: "BTCUSDT",
      tf: "H1",
      time: "2026-06-01T12:21:00Z",
      direction: "LONG",
      seen: false,
    },
    soundEnabled: true,
    alreadyPlayed: false,
  }),
  {
    shouldPlay: false,
    reason: "NOT_OTHER_SYMBOL",
  },
  "alerts sound blocks on selected symbol"
);

assert.deepEqual(
  shouldPlayHighOtherSymbolSound({
    selectedSymbol: "BTCUSDT",
    event: {
      id: "sound-muted",
      type: "SEND_OPEN",
      symbol: "ETHUSDT",
      tf: "H1",
      time: "2026-06-01T12:22:00Z",
      direction: "LONG",
      seen: false,
    },
    mutedKeys: new Set(["ETHUSDT|H1"]),
    soundEnabled: true,
    alreadyPlayed: false,
  }),
  {
    shouldPlay: false,
    reason: "MUTED",
  },
  "alerts sound blocks on muted key"
);

assert.deepEqual(
  shouldPlayHighOtherSymbolSound({
    selectedSymbol: "BTCUSDT",
    event: {
      id: "sound-played",
      type: "SEND_OPEN",
      symbol: "ETHUSDT",
      tf: "H1",
      time: "2026-06-01T12:23:00Z",
      direction: "LONG",
      seen: false,
    },
    soundEnabled: true,
    alreadyPlayed: true,
  }),
  {
    shouldPlay: false,
    reason: "ALREADY_PLAYED",
  },
  "alerts sound blocks already played event id"
);

async function runAlertsApiExactTests(): Promise<void> {
  appendSignalEvent({
    id: "alert-api-latest",
    type: "SEND_CLOSE",
    symbol: "APIBTC",
    tf: "H4",
    time: "2026-06-01T00:20:00Z",
    direction: "LONG",
    planId: "PLAN-113-API",
    outcome: "TIMEOUT",
    exitPrice: 101,
    rGross: 0.25,
  });
  appendSignalEvent({
    id: "alert-api-older",
    type: "SEND_OPEN",
    symbol: "APIBTC",
    tf: "H4",
    time: "2026-06-01T00:10:00Z",
    direction: "LONG",
    planId: "PLAN-113-API",
  });
  appendSignalEvent({
    id: "alert-api-other",
    type: "SEND_OPEN",
    symbol: "APIETH",
    tf: "H1",
    time: "2026-06-01T00:30:00Z",
    direction: "SHORT",
  });

  const signalsResponse = await getSignalsRoute(
    new NextRequest(
      "http://localhost/api/signals?symbol=APIBTC&limit=2"
    )
  );
  const signalsJson = (await signalsResponse.json()) as {
    events: Array<{ id: string }>;
    unseenHighCountOther?: number;
  };

  assert.deepEqual(
    signalsJson.events.map((event) => event.id),
    ["alert-api-latest", "alert-api-older"],
    "alerts api signals returns selected symbol latest first"
  );

  upsertReviewNote(
    "PLAN-113-GET",
    "stored note",
    "2026-06-01T00:15:00Z"
  );
  const getReviewResponse = await getReviewNoteRoute(
    new NextRequest(
      "http://localhost/api/reviewNote?planId=PLAN-113-GET"
    )
  );
  const getReviewJson = (await getReviewResponse.json()) as {
    planId: string;
    reviewNoteText: string;
    reviewNoteUpdatedAtUtc: string | null;
  };

  assert.deepEqual(
    getReviewJson,
    {
      planId: "PLAN-113-GET",
      reviewNoteText: "stored note",
      reviewNoteUpdatedAtUtc: "2026-06-01T00:15:00Z",
    },
    "alerts api reviewNote get returns record by planId"
  );

  const postReviewResponse = await postReviewNoteRoute(
    new NextRequest("http://localhost/api/reviewNote", {
      method: "POST",
      body: JSON.stringify({
        planId: "PLAN-113-POST",
        text: "saved via api",
      }),
      headers: {
        "content-type": "application/json",
      },
    })
  );
  const postReviewJson = (await postReviewResponse.json()) as {
    planId: string;
    reviewNoteText: string;
    reviewNoteUpdatedAtUtc: string;
  };

  assert.equal(
    postReviewJson.planId,
    "PLAN-113-POST",
    "alerts api reviewNote post upserts by planId"
  );
  assert.equal(
    postReviewJson.reviewNoteText,
    "saved via api",
    "alerts api reviewNote post upserts by planId"
  );
  assert.equal(
    getReviewNote("PLAN-113-POST")?.reviewNoteText,
    "saved via api",
    "alerts api reviewNote post upserts by planId"
  );

  upsertSeenState({
    eventId: "API-SEEN-GET",
    seenAtUtc: "2026-06-01T02:00:00Z",
  });
  const getSeenResponse = await getSeenRoute(
    new NextRequest(
      "http://localhost/api/seen?eventId=API-SEEN-GET"
    )
  );
  const getSeenJson = (await getSeenResponse.json()) as {
    profileId: string;
    eventId: string;
    seenAtUtc: string | null;
    seen: boolean;
  };

  assert.deepEqual(
    getSeenJson,
    {
      profileId: "default",
      eventId: "API-SEEN-GET",
      seenAtUtc: "2026-06-01T02:00:00Z",
      seen: true,
    },
    "alerts api seen get returns default profile record"
  );

  const postSeenResponse = await postSeenRoute(
    new NextRequest("http://localhost/api/seen", {
      method: "POST",
      body: JSON.stringify({
        eventId: "API-SEEN-POST",
        seenAtUtc: "2026-06-01T02:05:00Z",
      }),
      headers: {
        "content-type": "application/json",
      },
    })
  );
  const postSeenJson = (await postSeenResponse.json()) as {
    profileId: string;
    eventId: string;
    seenAtUtc: string;
  };

  assert.deepEqual(
    postSeenJson,
    {
      profileId: "default",
      eventId: "API-SEEN-POST",
      seenAtUtc: "2026-06-01T02:05:00Z",
    },
    "alerts api seen post upserts server state"
  );

  appendSignalEvent({
    id: "api-seen-hidden",
    type: "SEND_OPEN",
    symbol: "SEENAPI",
    tf: "H4",
    time: "2026-06-01T03:00:00Z",
    direction: "LONG",
  });
  appendSignalEvent({
    id: "api-seen-visible",
    type: "SEND_CLOSE",
    symbol: "SEENAPI",
    tf: "H4",
    time: "2026-06-01T03:10:00Z",
    direction: "LONG",
    outcome: "TIMEOUT",
    exitPrice: 100,
    rGross: 0.15,
    severity: "HIGH",
  });
  upsertSeenState({
    eventId: "api-seen-hidden",
    seenAtUtc: "2026-06-01T03:20:00Z",
  });

  const seenSignalsResponse = await getSignalsRoute(
    new NextRequest(
      "http://localhost/api/signals?symbol=SEENAPI&limit=10&tab=Unread&profileId=default"
    )
  );
  const seenSignalsJson = (await seenSignalsResponse.json()) as {
    events: Array<{ id: string; seen: boolean }>;
    unseenHighCountOther?: number;
  };

  assert.deepEqual(
    {
      events: seenSignalsJson.events.map((event) => ({
        id: event.id,
        seen: event.seen,
      })),
      unseenHighCountOther: seenSignalsJson.unseenHighCountOther,
    },
    {
      events: [
        {
          id: "api-seen-visible",
          seen: false,
        },
        {
          id: "api-seen-hidden",
          seen: true,
        },
      ],
      unseenHighCountOther: undefined,
    },
    "alerts api signals returns seen projection and ignores unread tab on selected feed"
  );

  {
    const profileId = "profile-121-default-unread";
    for (const event of listSignalEvents()) {
      upsertSeenState({
        profileId,
        eventId: event.id,
        seenAtUtc: "2026-06-01T00:00:00Z",
      });
    }

    appendSignalEvent({
      id: "other-default-unread-seen",
      type: "SEND_OPEN",
      symbol: "OTHDEF121",
      tf: "H1",
      time: "2026-06-01T04:00:00Z",
      direction: "LONG",
      severity: "HIGH",
    });
    appendSignalEvent({
      id: "other-default-unread-visible",
      type: "SEND_CLOSE",
      symbol: "OTHDEF121",
      tf: "H1",
      time: "2026-06-01T04:05:00Z",
      direction: "LONG",
      outcome: "TIMEOUT",
      exitPrice: 100,
      rGross: 0.2,
      severity: "MID",
    });
    upsertSeenState({
      profileId,
      eventId: "other-default-unread-seen",
      seenAtUtc: "2026-06-01T04:10:00Z",
    });

    const json = (await getSignalsRoute(
      new NextRequest(
        `http://localhost/api/signals?excludeSymbol=BTCUSDT&limit=20&profileId=${profileId}`
      )
    ).then((response) => response.json())) as {
      events: Array<{ id: string }>;
    };

    assert.deepEqual(
      json.events
        .filter((event) => event.id.startsWith("other-default-unread-"))
        .map((event) => event.id),
      ["other-default-unread-visible"],
      "alerts other inbox default tab is unread"
    );
  }

  appendSignalEvent({
    id: "selected-api-open-121",
    type: "SEND_OPEN",
    symbol: "SELAPI121",
    tf: "H4",
    time: "2026-06-01T06:00:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "selected-api-close-121",
    type: "SEND_CLOSE",
    symbol: "SELAPI121",
    tf: "H4",
    time: "2026-06-01T06:05:00Z",
    direction: "LONG",
    outcome: "HARD_TP",
    exitPrice: 100,
    rGross: 1,
    severity: "MID",
  });

  const selectedApiFilteredJson = (await getSignalsRoute(
    new NextRequest(
      "http://localhost/api/signals?symbol=SELAPI121&limit=10&eventType=CLOSE_ONLY"
    )
  ).then((response) => response.json())) as {
    events: Array<{ id: string }>;
  };

  assert.deepEqual(
    selectedApiFilteredJson.events
      .filter((event) => event.id.startsWith("selected-api-"))
      .map((event) => event.id),
    ["selected-api-close-121"],
    "alerts api signals selected feed supports eventType filter"
  );

  {
    const profileId = "profile-121-other-api";
    for (const event of listSignalEvents()) {
      upsertSeenState({
        profileId,
        eventId: event.id,
        seenAtUtc: "2026-06-01T00:00:00Z",
      });
    }

    appendSignalEvent({
      id: "other-api-open-high-121",
      type: "SEND_OPEN",
      symbol: "OTHERAPI121",
      tf: "H1",
      time: "2026-06-01T07:00:00Z",
      direction: "LONG",
      severity: "HIGH",
    });
    appendSignalEvent({
      id: "other-api-close-high-121",
      type: "SEND_CLOSE",
      symbol: "OTHERAPI121",
      tf: "H1",
      time: "2026-06-01T07:01:00Z",
      direction: "LONG",
      outcome: "TIMEOUT",
      exitPrice: 100,
      rGross: 0.1,
      severity: "HIGH",
    });
    appendSignalEvent({
      id: "other-api-open-low-121",
      type: "SEND_OPEN",
      symbol: "OTHERAPI121",
      tf: "H1",
      time: "2026-06-01T07:02:00Z",
      direction: "LONG",
      severity: "LOW",
    });

    const json = (await getSignalsRoute(
      new NextRequest(
        `http://localhost/api/signals?excludeSymbol=BTCUSDT&limit=20&tab=Unread&eventType=OPEN_ONLY&severity=HIGH&profileId=${profileId}`
      )
    ).then((response) => response.json())) as {
      events: Array<{ id: string }>;
    };

    assert.deepEqual(
      json.events
        .filter((event) => event.id.startsWith("other-api-"))
        .map((event) => event.id),
      ["other-api-open-high-121"],
      "alerts api signals other inbox supports tab type severity filters"
    );
  }

  {
    const profileId = "profile-121-group-after-filters";
    for (const event of listSignalEvents()) {
      upsertSeenState({
        profileId,
        eventId: event.id,
        seenAtUtc: "2026-06-01T00:00:00Z",
      });
    }

    appendSignalEvent({
      id: "group-after-filters-1",
      type: "SEND_OPEN",
      symbol: "GROUPFILT121",
      tf: "H1",
      time: "2026-06-01T08:05:00Z",
      direction: "LONG",
      severity: "HIGH",
    });
    appendSignalEvent({
      id: "group-after-filters-2",
      type: "SEND_OPEN",
      symbol: "GROUPFILT121",
      tf: "H1",
      time: "2026-06-01T08:03:00Z",
      direction: "LONG",
      severity: "HIGH",
    });
    appendSignalEvent({
      id: "group-after-filters-3",
      type: "SEND_OPEN",
      symbol: "GROUPFILT121",
      tf: "H1",
      time: "2026-06-01T08:01:00Z",
      direction: "LONG",
      severity: "HIGH",
    });
    upsertSeenState({
      profileId,
      eventId: "group-after-filters-3",
      seenAtUtc: "2026-06-01T08:06:00Z",
    });

    const json = (await getSignalsRoute(
      new NextRequest(
        `http://localhost/api/signals?excludeSymbol=BTCUSDT&limit=20&tab=Unread&eventType=ALL&severity=ALL&group=true&profileId=${profileId}`
      )
    ).then((response) => response.json())) as {
      items?: Array<{ kind: "event" | "group"; event?: { id: string } }>;
    };

    assert.deepEqual(
      (json.items ?? [])
        .filter((item) => {
          return (
            (item.kind === "event" &&
              item.event?.id.startsWith("group-after-filters-")) ||
            item.kind === "group"
          );
        })
        .map((item) => {
          return item.kind === "group" ? "group" : item.event?.id;
        }),
      ["group-after-filters-1", "group-after-filters-2"],
      "alerts api signals other inbox applies grouping after filters"
    );
  }

  appendSignalEvent({
    id: "api-group-1",
    type: "SEND_CLOSE",
    symbol: "GRPAPI116",
    tf: "M30",
    time: "2026-06-01T10:10:00Z",
    direction: "SHORT",
    severity: "MID",
    outcome: "TIMEOUT",
    exitPrice: 100,
    rGross: 0.1,
  });
  appendSignalEvent({
    id: "api-group-2",
    type: "SEND_CLOSE",
    symbol: "GRPAPI116",
    tf: "M30",
    time: "2026-06-01T10:08:00Z",
    direction: "SHORT",
    severity: "HIGH",
    outcome: "TIMEOUT",
    exitPrice: 99,
    rGross: 0.2,
  });
  appendSignalEvent({
    id: "api-group-3",
    type: "SEND_CLOSE",
    symbol: "GRPAPI116",
    tf: "M30",
    time: "2026-06-01T10:06:00Z",
    direction: "SHORT",
    severity: "LOW",
    outcome: "TIMEOUT",
    exitPrice: 98,
    rGross: 0.3,
  });

  const groupedSignalsResponse = await getSignalsRoute(
    new NextRequest(
      "http://localhost/api/signals?symbol=GRPAPI116&limit=10&tab=All&group=true&profileId=default"
    )
  );
  const groupedSignalsJson = (await groupedSignalsResponse.json()) as {
    events: Array<{ id: string }>;
    items?: Array<
      | {
          kind: "event";
          event: { id: string; symbol: string };
        }
      | {
          kind: "group";
          group: {
            groupKey: string;
            symbol: string;
            count: number;
            severity: string;
            eventIds: string[];
          };
        }
    >;
  };

  assert.deepEqual(
    {
      eventIds: groupedSignalsJson.events.map((event) => event.id),
      items: groupedSignalsJson.items,
    },
    {
      eventIds: ["api-group-1", "api-group-2", "api-group-3"],
      items: [
        {
          kind: "group",
          group: {
            groupKey: "GRPAPI116|M30|SEND_CLOSE|SHORT",
            symbol: "GRPAPI116",
            tf: "M30",
            eventType: "SEND_CLOSE",
            direction: "SHORT",
            count: 3,
            latestTime: "2026-06-01T10:10:00Z",
            earliestTime: "2026-06-01T10:06:00Z",
            severity: "HIGH",
            eventIds: ["api-group-1", "api-group-2", "api-group-3"],
            seen: false,
            unseenCount: 3,
          },
        },
      ],
    },
    "alerts api signals group=true returns grouped items"
  );

  await withMockedNowIso("2026-06-01T06:00:00Z", async () => {
    const postMuteResponse = await postMuteRoute(
      new NextRequest("http://localhost/api/mute", {
        method: "POST",
        body: JSON.stringify({
          symbol: "APIMUTE1",
          tf: "H1",
        }),
        headers: {
          "content-type": "application/json",
        },
      })
    );
    const postMuteJson = (await postMuteResponse.json()) as {
      profileId: string;
      symbol: string;
      tf: string;
      muteUntilUtc: string;
    };

    assert.deepEqual(
      getMuteState(undefined, "APIMUTE1", "H1"),
      {
        profileId: "default",
        symbol: "APIMUTE1",
        tf: "H1",
        muteUntilUtc: "2026-06-01T07:00:00.000Z",
      },
      "alerts mute post writes default profile 60m mute"
    );

    assert.deepEqual(
      postMuteJson,
      {
        profileId: "default",
        symbol: "APIMUTE1",
        tf: "H1",
        muteUntilUtc: "2026-06-01T07:00:00.000Z",
      },
      "alerts api mute post returns stored record"
    );
  });

  await withMockedNowIso("2026-06-01T06:30:00Z", async () => {
    upsertMuteState({
      profileId: "default",
      symbol: "GETMUTE_ACTIVE",
      tf: "M30",
      muteUntilUtc: "2026-06-01T07:00:00Z",
    });
    upsertMuteState({
      profileId: "default",
      symbol: "GETMUTE_EXPIRED",
      tf: "M30",
      muteUntilUtc: "2026-06-01T06:00:00Z",
    });

    const getMuteResponse = await getMuteRoute(
      new NextRequest("http://localhost/api/mute")
    );
    const getMuteJson = (await getMuteResponse.json()) as {
      items: Array<{ symbol: string; tf: string }>;
    };

    assert.equal(
      getMuteJson.items.some((item) => item.symbol === "GETMUTE_ACTIVE"),
      true,
      "alerts mute get lists only active mute states"
    );
    assert.equal(
      getMuteJson.items.some((item) => item.symbol === "GETMUTE_EXPIRED"),
      false,
      "alerts mute get lists only active mute states"
    );
  });

  appendSignalEvent({
    id: "api-mute-hidden",
    type: "SEND_OPEN",
    symbol: "SIGMUTEHIDE",
    tf: "H4",
    time: "2026-06-01T08:00:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "api-mute-visible",
    type: "SEND_OPEN",
    symbol: "SIGMUTEKEEP",
    tf: "H4",
    time: "2026-06-01T08:10:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  upsertMuteState({
    profileId: "default",
    symbol: "SIGMUTEHIDE",
    tf: "H4",
    muteUntilUtc: "2026-06-01T09:00:00Z",
  });

  await withMockedNowIso("2026-06-01T08:30:00Z", async () => {
    const mutedSignalsResponse = await getSignalsRoute(
      new NextRequest(
        "http://localhost/api/signals?excludeSymbol=SELECT115API&limit=20&tab=All&profileId=default"
      )
    );
    const mutedSignalsJson = (await mutedSignalsResponse.json()) as {
      events: Array<{ symbol: string }>;
      unseenHighCountOther?: number;
    };

    assert.equal(
      mutedSignalsJson.events.some((event) => event.symbol === "SIGMUTEHIDE"),
      false,
      "alerts signals other inbox excludes muted symbol tf"
    );
  });

  appendSignalEvent({
    id: "api-group-filter-seen-1",
    type: "SEND_OPEN",
    symbol: "GRPFILTSEEN",
    tf: "H1",
    time: "2026-06-01T11:10:00Z",
    direction: "LONG",
    severity: "MID",
  });
  appendSignalEvent({
    id: "api-group-filter-seen-2",
    type: "SEND_OPEN",
    symbol: "GRPFILTSEEN",
    tf: "H1",
    time: "2026-06-01T11:09:00Z",
    direction: "LONG",
    severity: "MID",
  });
  appendSignalEvent({
    id: "api-group-filter-seen-3",
    type: "SEND_OPEN",
    symbol: "GRPFILTSEEN",
    tf: "H1",
    time: "2026-06-01T11:08:00Z",
    direction: "LONG",
    severity: "MID",
  });
  upsertSeenState({
    profileId: "default",
    eventId: "api-group-filter-seen-3",
    seenAtUtc: "2026-06-01T11:20:00Z",
  });

  appendSignalEvent({
    id: "api-group-filter-muted-1",
    type: "SEND_OPEN",
    symbol: "GRPFILTMUTED",
    tf: "H1",
    time: "2026-06-01T11:07:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "api-group-filter-muted-2",
    type: "SEND_OPEN",
    symbol: "GRPFILTMUTED",
    tf: "H1",
    time: "2026-06-01T11:06:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  appendSignalEvent({
    id: "api-group-filter-muted-3",
    type: "SEND_OPEN",
    symbol: "GRPFILTMUTED",
    tf: "H1",
    time: "2026-06-01T11:05:00Z",
    direction: "LONG",
    severity: "HIGH",
  });
  upsertMuteState({
    profileId: "default",
    symbol: "GRPFILTMUTED",
    tf: "H1",
    muteUntilUtc: "2026-06-01T12:00:00Z",
  });

  await withMockedNowIso("2026-06-01T11:30:00Z", async () => {
    const groupedFilteredResponse = await getSignalsRoute(
      new NextRequest(
        "http://localhost/api/signals?excludeSymbol=SELECT116API&limit=200&tab=Unread&group=true&profileId=default"
      )
    );
    const groupedFilteredJson = (await groupedFilteredResponse.json()) as {
      events: Array<{ id: string; symbol: string }>;
      items?: Array<
        | {
            kind: "event";
            event: { id: string; symbol: string };
          }
        | {
            kind: "group";
            group: { symbol: string; count: number };
          }
      >;
    };

    assert.deepEqual(
      {
        mutedPresentInEvents: groupedFilteredJson.events.some(
          (event) => event.symbol === "GRPFILTMUTED"
        ),
        mutedPresentInItems: groupedFilteredJson.items?.some((item) => {
          return item.kind === "event"
            ? item.event.symbol === "GRPFILTMUTED"
            : item.group.symbol === "GRPFILTMUTED";
        }) ?? false,
        seenFilteredItems: (groupedFilteredJson.items ?? []).flatMap((item) => {
          if (item.kind === "event" && item.event.symbol === "GRPFILTSEEN") {
            return [item.event.id];
          }

          return [];
        }),
        seenFilteredGrouped: groupedFilteredJson.items?.some((item) => {
          return item.kind === "group" && item.group.symbol === "GRPFILTSEEN";
        }) ?? false,
      },
      {
        mutedPresentInEvents: false,
        mutedPresentInItems: false,
        seenFilteredItems: [
          "api-group-filter-seen-1",
          "api-group-filter-seen-2",
        ],
        seenFilteredGrouped: false,
      },
      "alerts api signals grouping runs after seen and mute filtering"
    );
  });

  const soundApiNonce = String(Date.now());
  const soundApiProfileId = `SOUND_API_EXACT_PROFILE_${soundApiNonce}`;
  const soundApiEventId = `SOUND-API-EXACT-E1-${soundApiNonce}`;

  const getSoundResponse = await getSoundRoute(
    new NextRequest(
      `http://localhost/api/sound?profileId=${soundApiProfileId}`
    )
  );
  const getSoundJson = (await getSoundResponse.json()) as {
    profileId: string;
    enabled: boolean;
    updatedAtUtc: string | null;
  };

  const postSoundResponse = await postSoundRoute(
    new NextRequest("http://localhost/api/sound", {
      method: "POST",
      body: JSON.stringify({
        profileId: soundApiProfileId,
        enabled: true,
      }),
      headers: {
        "content-type": "application/json",
      },
    })
  );
  const postSoundJson = (await postSoundResponse.json()) as {
    profileId: string;
    enabled: boolean;
    updatedAtUtc: string;
  };

  const getSoundPlayedResponse = await getSoundPlayedRoute(
    new NextRequest(
      `http://localhost/api/soundPlayed?profileId=${soundApiProfileId}&eventId=${soundApiEventId}`
    )
  );
  const getSoundPlayedJson = (await getSoundPlayedResponse.json()) as {
    profileId: string;
    eventId: string;
    played: boolean;
    playedAtUtc: string | null;
  };

  const postSoundPlayedResponse = await postSoundPlayedRoute(
    new NextRequest("http://localhost/api/soundPlayed", {
      method: "POST",
      body: JSON.stringify({
        profileId: soundApiProfileId,
        eventId: soundApiEventId,
      }),
      headers: {
        "content-type": "application/json",
      },
    })
  );
  const postSoundPlayedJson = (await postSoundPlayedResponse.json()) as {
    profileId: string;
    eventId: string;
    playedAtUtc: string;
  };

  assert.deepEqual(
    {
      getSound: getSoundJson,
      postSound: {
        profileId: postSoundJson.profileId,
        enabled: postSoundJson.enabled,
      },
      getSoundPlayed: getSoundPlayedJson,
      postSoundPlayed: {
        profileId: postSoundPlayedJson.profileId,
        eventId: postSoundPlayedJson.eventId,
        stored: getSoundPlayed(soundApiProfileId, soundApiEventId),
      },
    },
    {
      getSound: {
        profileId: soundApiProfileId,
        enabled: false,
        updatedAtUtc: null,
      },
      postSound: {
        profileId: soundApiProfileId,
        enabled: true,
      },
      getSoundPlayed: {
        profileId: soundApiProfileId,
        eventId: soundApiEventId,
        played: false,
        playedAtUtc: null,
      },
      postSoundPlayed: {
        profileId: soundApiProfileId,
        eventId: soundApiEventId,
        stored: {
          profileId: soundApiProfileId,
          eventId: soundApiEventId,
          playedAtUtc: postSoundPlayedJson.playedAtUtc,
        },
      },
    },
    "alerts sound api get post and played api work"
  );

  const deleteMuteResponse = await deleteMuteRoute(
    new NextRequest(
      "http://localhost/api/mute?symbol=APIMUTE1&tf=H1"
    )
  );
  const deleteMuteJson = (await deleteMuteResponse.json()) as {
    ok: boolean;
  };

  assert.deepEqual(
    deleteMuteJson,
    { ok: true },
    "alerts api mute delete returns ok"
  );
  assert.equal(
    getMuteState(undefined, "APIMUTE1", "H1"),
    null,
    "alerts api mute delete returns ok"
  );
}

clearMarketContext("CTXTEST");

const marketContextH1Bars: Bar[] = Array.from({ length: 20 }, (_, index) => ({
  tf: "H1" as const,
  openTime: Date.UTC(2026, 5, 1, index, 0, 0),
  closeTime: Date.UTC(2026, 5, 1, index + 1, 0, 0),
  open: 100 + index,
  high:
    index === 7 ? 120 :
    index === 15 ? 118 :
    101 + index,
  low:
    index === 12 ? 90 :
    99 + index,
  close: 100.5 + index,
  volume: 0,
}));

for (const bar of marketContextH1Bars) {
  appendMarketBar("CTXTEST", bar);
}

assert.deepEqual(
  getMarketAtr14AtCloseTime("CTXTEST", "H1", marketContextH1Bars[13].closeTime),
  4.357142857142857,
  "engine market context atr14 lookup works"
);

assert.deepEqual(
  detectMarketConfirmedFractalPivotAtIndex(
    [],
    "HIGH",
    0
  ),
  null,
  "engine market context generic pivot detector handles empty bars"
);

assert.deepEqual(
  detectMarketConfirmedFractalPivotAtIndex(
    ((): Bar[] => getMarketBars("CTXTEST", "H1"))(),
    "HIGH",
    7
  ),
  {
    tf: "H1",
    pivotType: "HIGH",
    pivotTime: marketContextH1Bars[7].closeTime,
    pivotPrice: 120,
    confirmedAt: marketContextH1Bars[10].closeTime,
    isConfirmed: true,
  },
  "engine market context detects generic confirmed fractal pivot"
);

assert.deepEqual(
  listConfirmedFractalPivots("CTXTEST", "H1").map((pivot) => ({
    tf: pivot.tf,
    pivotType: pivot.pivotType,
    pivotTime: pivot.pivotTime,
    confirmedAt: pivot.confirmedAt,
  })),
  [
    {
      tf: "H1",
      pivotType: "HIGH",
      pivotTime: marketContextH1Bars[7].closeTime,
      confirmedAt: marketContextH1Bars[10].closeTime,
    },
    {
      tf: "H1",
      pivotType: "LOW",
      pivotTime: marketContextH1Bars[12].closeTime,
      confirmedAt: marketContextH1Bars[15].closeTime,
    },
  ],
  "engine market context lists confirmed fractal pivots in confirmed order"
);

assert.deepEqual(
  listConfirmedFractalPivotsBeforeCloseTime(
    "CTXTEST",
    "H1",
    marketContextH1Bars[16].closeTime
  ).map((pivot) => pivot.confirmedAt),
  [
    marketContextH1Bars[10].closeTime,
    marketContextH1Bars[15].closeTime,
  ],
  "engine market context filters confirmed pivots before close time"
);

clearRuntimePoiStore();

const runtimePoiTrendlineFixture = {
  id: "POITEST:TRENDLINE:1",
  symbol: "POITEST",
  tf: "H4" as const,
  type: "TL_SUPPORT" as const,
  state: "ACTIVE" as const,
  a1Time: Date.UTC(2026, 5, 1, 0, 0, 0),
  a1Price: 100,
  a2Time: Date.UTC(2026, 5, 1, 1, 0, 0),
  a2Price: 101,
  createdAt: Date.UTC(2026, 5, 1, 1, 0, 0),
  touchCount: 0,
  breakStreak: 0,
  roleFlipCount: 0,
  tags: ["TL_COLLAB_POI_OK"],
  bestMatch: { kind: "NONE" as const },
  maxForwardBars: 300,
};

replaceRuntimeTrendlinePois("POITEST", [runtimePoiTrendlineFixture]);

const runtimeTrendlinePoi = getRuntimePoiStore("POITEST").get(
  "POITEST:TRENDLINE:1"
);

assert.deepEqual(
  {
    ids: listRuntimePois("POITEST").map((poi) => poi.id),
    dir: runtimeTrendlinePoi?.dir,
    tf: runtimeTrendlinePoi?.tf,
    state: runtimeTrendlinePoi?.state,
    lineAt:
      runtimeTrendlinePoi?.kind === "TRENDLINE"
        ? runtimeTrendlinePoi.linePriceAt("2026-06-01T02:00:00Z")
        : null,
  },
  {
    ids: ["POITEST:TRENDLINE:1"],
    dir: "BULL",
    tf: "H4",
    state: "ACTIVE",
    lineAt: 102,
  },
  "engine runtime poi store adapts active trendline into router poi"
);

const runtimePoiChannelFixture = {
  id: "POITEST:H4_CHANNEL:1",
  symbol: "POITEST",
  type: "H4_CHANNEL" as const,
  tf: "H4" as const,
  state: "ACTIVE" as const,
  mode: "ENABLED" as const,
  geometry: {
    dir: "UP" as const,
    anchorLine: {
      a: { time: Date.UTC(2026, 5, 1, 0, 0, 0), price: 100 },
      b: { time: Date.UTC(2026, 5, 1, 1, 0, 0), price: 101 },
      slope: (101 - 100) / (60 * 60 * 1000),
      intercept: 100 - ((101 - 100) / (60 * 60 * 1000)) * Date.UTC(2026, 5, 1, 0, 0, 0),
    },
    offset: 3,
    midOffset: 1.5,
  },
  createdAt: Date.UTC(2026, 5, 1, 1, 0, 0),
  lastUpdatedAt: Date.UTC(2026, 5, 1, 1, 0, 0),
  maxForwardBars: 300,
};

replaceRuntimeChannelPois("POITEST", runtimePoiChannelFixture);

const runtimeChannelPoi = getRuntimePoiStore("POITEST").get(
  "POITEST:H4_CHANNEL:1"
);

assert.deepEqual(
  {
    ids: listRuntimePois("POITEST").map((poi) => poi.id),
    dir: runtimeChannelPoi?.dir,
    state: runtimeChannelPoi?.state,
    lower:
      runtimeChannelPoi?.kind === "CHANNEL"
        ? runtimeChannelPoi.lowerBandAt("2026-06-01T02:00:00Z")
        : null,
    upper:
      runtimeChannelPoi?.kind === "CHANNEL"
        ? runtimeChannelPoi.upperBandAt("2026-06-01T02:00:00Z")
        : null,
  },
  {
    ids: ["POITEST:H4_CHANNEL:1", "POITEST:TRENDLINE:1"],
    dir: "BULL",
    state: "ENABLED",
    lower: 102,
    upper: 105,
  },
  "engine runtime poi store adapts active channel bands exactly"
);

replaceRuntimeChannelPois("POITEST", [
  runtimePoiChannelFixture,
  createD1H4OperationalChannel({
    symbol: "POITEST",
    tf: "D1",
    dir: "DOWN",
    a: channelFlatAnchorA,
    b: channelFlatAnchorB,
    offset: 8,
    createdAt: 7000,
  })!,
]);

assert.deepEqual(
  listRuntimePois("POITEST")
    .filter((poi) => poi.kind === "CHANNEL")
    .map((poi) => poi.id),
  [
    "POITEST:D1_CHANNEL:1000:DOWN:95",
    "POITEST:H4_CHANNEL:1",
  ],
  "engine runtime poi store exports multiple active channel models"
);

replaceRuntimeChannelExecutionPois("POITEST", [
  {
    poiId: "POITEST:CH_POI:H4:1:BULL:102",
    model: runtimePoiChannelFixture,
    createdAt: Date.UTC(2026, 5, 1, 1, 0, 0),
    tags: [],
  },
]);

const runtimeChannelExecutionPoi = getRuntimePoiStore("POITEST").get(
  "POITEST:CH_POI:H4:1:BULL:102"
);

assert.deepEqual(
  {
    listedIds: listRuntimePois("POITEST").map((poi) => poi.id),
    execId: runtimeChannelExecutionPoi?.id,
    execType: runtimeChannelExecutionPoi?.type,
    execState: runtimeChannelExecutionPoi?.state,
    execLower:
      runtimeChannelExecutionPoi?.kind === "CHANNEL"
        ? runtimeChannelExecutionPoi.lowerBandAt("2026-06-01T02:00:00Z")
        : null,
    execUpper:
      runtimeChannelExecutionPoi?.kind === "CHANNEL"
        ? runtimeChannelExecutionPoi.upperBandAt("2026-06-01T02:00:00Z")
        : null,
  },
  {
    listedIds: [
      "POITEST:D1_CHANNEL:1000:DOWN:95",
      "POITEST:H4_CHANNEL:1",
      "POITEST:TRENDLINE:1",
    ],
    execId: "POITEST:CH_POI:H4:1:BULL:102",
    execType: "CHANNEL_POI",
    execState: "ACTIVE",
    execLower: 102,
    execUpper: 105,
  },
  "engine runtime poi store keeps channel execution poi separately from context listing"
);

replaceRuntimeObPois("POITEST", [
  {
    id: "POITEST:D1_POI_OB:2026-06-01T00:00:00Z:BULL:100~105",
    symbol: "POITEST",
    type: "D1_POI_OB",
    tf: "D1",
    dir: "BULL",
    zone: {
      bottom: 100,
      top: 105,
      height: 5,
    },
    triggerTime: Date.UTC(2026, 5, 1, 0, 0, 0),
    createdAt: Date.UTC(2026, 5, 1, 0, 0, 0),
    confirmDueTime: Date.UTC(2026, 5, 2, 0, 0, 0),
    atrAtTrigger: 2,
    passHeightFilter: true,
    passDisplacement: true,
    passSweepRecovery: true,
    passContextDist: true,
    state: "INACTIVE",
    invalidReason: "full_fill",
    endTime: Date.UTC(2026, 5, 1, 12, 0, 0),
    tags: [],
    bestCollab: undefined,
    touchCount: 0,
    fullFillHit: true,
    maxForwardBars: 400,
  },
]);

assert.deepEqual(
  resolveRuntimeInvalidationTime({
    symbol: "POITEST",
    invalidationRef: {
      source: "OB",
      refId: "POITEST:D1_POI_OB:2026-06-01T00:00:00Z:BULL:100~105",
    },
  }),
  {
    invalidTime: "2026-06-01T12:00:00Z",
    lookupMissing: false,
  },
  "engine runtime invalidation lookup returns closed OB endTime only when inactive"
);

assert.deepEqual(
  resolveRuntimeInvalidationTime({
    symbol: "POITEST",
    invalidationRef: {
      source: "FVG",
      refId: "POITEST:FVG:MISSING",
    },
  }),
  {
    invalidTime: null,
    lookupMissing: true,
  },
  "engine runtime invalidation lookup does not hard-invalidate on missing ref"
);

syncRuntimeTrendlineInvalidationPois("POITEST", [
  {
    ...runtimePoiTrendlineFixture,
    state: "INACTIVE",
    invalidReason: "break_confirmed",
    endTime: Date.UTC(2026, 5, 1, 3, 0, 0),
  },
]);

assert.deepEqual(
  resolveRuntimeInvalidationTime({
    symbol: "POITEST",
    invalidationRef: {
      source: "TRENDLINE",
      refId: "POITEST:TRENDLINE:1",
    },
  }),
  {
    invalidTime: "2026-06-01T03:00:00Z",
    lookupMissing: false,
  },
  "engine runtime invalidation lookup uses ended trendline snapshot"
);

syncRuntimeChannelExecutionInvalidationPois("POITEST", [
  {
    id: "POITEST:CH_POI:H4:1:BULL:102",
    symbol: "POITEST",
    tf: "H4",
    dir: "BULL",
    createdAt: Date.UTC(2026, 5, 1, 1, 0, 0),
    boundaryPrice: 102,
    triggers: ["structure", "sweepRec"],
    state: "INACTIVE",
    endTime: Date.UTC(2026, 5, 1, 4, 0, 0),
    invalidReason: "expired_forward",
  },
]);

assert.deepEqual(
  resolveRuntimeInvalidationTime({
    symbol: "POITEST",
    invalidationRef: {
      source: "CHANNEL_POI",
      refId: "POITEST:CH_POI:H4:1:BULL:102",
    },
  }),
  {
    invalidTime: "2026-06-01T04:00:00Z",
    lookupMissing: false,
  },
  "engine runtime invalidation lookup uses CHANNEL_POI endTime instead of underlying channel model"
);

replaceRuntimeTrendlinePois("POITEST", []);

assert.deepEqual(
  listRuntimePois("POITEST").map((poi) => poi.id),
  [
    "POITEST:D1_CHANNEL:1000:DOWN:95",
    "POITEST:H4_CHANNEL:1",
  ],
  "engine runtime poi store replaces one kind without deleting another kind"
);

resetEngine("POITEST");

assert.deepEqual(
  listRuntimePois("POITEST"),
  [],
  "engine runtime reset clears stale runtime poi cache"
);

assert.deepEqual(
  buildRouterRawSignalCandidatesForBar({
    symbol: "POITEST",
    bar: {
      tf: "M5",
      openTime: Date.UTC(2026, 5, 1, 0, 0, 0),
      closeTime: Date.UTC(2026, 5, 1, 0, 5, 0),
      open: 103,
      high: 104,
      low: 101.9,
      close: 103.4,
      volume: 0,
    },
    tickSize: 0.1,
    poiStore: {
      get(poiId: string) {
        return poiId === "POITEST:CH_POI:H4:1:BULL:102"
          ? runtimeChannelExecutionPoi ?? null
          : null;
      },
    },
    rawEvents: [
      "[REACTION][M5] time=2026-06-01T00:05:00Z poi=POITEST:CH_POI:H4:1:BULL:102 triggers=STRUCTURE",
      "[ENTRY_WINDOW_OPEN][M5] time=2026-06-01T00:05:00Z poi=POITEST:CH_POI:H4:1:BULL:102 triggers=2plus:STRUCTURE|SWEEP_REC",
    ],
  }).map((seed) => ({
    eventName: seed.eventName,
    poiKind: seed.poiKind,
    poiId: seed.poiId,
  })),
  [
    {
      eventName: "ENTRY_WINDOW_OPEN",
      poiKind: "CHANNEL",
      poiId: "POITEST:CH_POI:H4:1:BULL:102",
    },
  ],
  "router runtime bridge excludes channel reaction candidates and keeps channel entry candidates"
);

const channelDirectSeed = buildRouterRawSignalCandidatesForBar({
  symbol: "POITEST",
  bar: {
    tf: "M5",
    openTime: Date.UTC(2026, 5, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 5, 1, 0, 5, 0),
    open: 103,
    high: 104,
    low: 101.9,
    close: 103.4,
    volume: 0,
  },
  tickSize: 0.1,
  poiStore: {
    get(poiId: string) {
      return poiId === "POITEST:CH_POI:H4:1:BULL:102"
        ? runtimeChannelExecutionPoi ?? null
        : null;
    },
  },
  rawEvents: [
    "[ENTRY_WINDOW_OPEN][M5] time=2026-06-01T00:05:00Z poi=POITEST:CH_POI:H4:1:BULL:102 triggers=2plus:STRUCTURE|SWEEP_REC",
  ],
})[0]!;

const channelDirectEntryBoundary =
  runtimeChannelExecutionPoi?.kind === "CHANNEL"
    ? runtimeChannelExecutionPoi.lowerBandAt("2026-06-01T00:05:00Z")
    : Number.NaN;
const channelDirectTpRef =
  runtimeChannelExecutionPoi?.kind === "CHANNEL"
    ? runtimeChannelExecutionPoi.upperBandAt("2026-06-01T00:05:00Z")
    : Number.NaN;
const channelDirectStopBuffer = computeStopBuffer(0.1, 2)!;
const channelDirectStopPrice = computeStopPrice(
  "LONG",
  channelDirectSeed.entryRefPrice,
  channelDirectSeed.hardInvalidationPrice,
  channelDirectStopBuffer,
  0.1
)!;

assert.deepEqual(
  buildPolicySignalCandidateFromSeedViaDraft(channelDirectSeed, {
    lastPrice: channelDirectSeed.entryRefPrice,
    midPrice: channelDirectSeed.entryRefPrice,
    tickSize: 0.1,
    ltAtr14: 2,
    atrLiq_14_atOpen: 5,
    confirmedTpPivots: [],
  }),
  {
    candidateId: channelDirectSeed.candidateId,
    tradeKey: channelDirectSeed.tradeKey,
    symbol: "POITEST",
    time: channelDirectSeed.openTime,
    source: "CHANNEL",
    eventType: "ENTRY_WINDOW_OPEN",
    dir: "BULL",
    ltf: "M5",
    poiTier: "H4_CORE",
    poiId: "POITEST:CH_POI:H4:1:BULL:102",
    entryBoundaryPrice: channelDirectSeed.entryBoundaryPrice,
    hardInvalidationPrice: channelDirectSeed.hardInvalidationPrice,
    lastPrice: 103.4,
    midPrice: 103.4,
    tickSize: 0.1,
    ltAtr14: 2,
    triggerCount: 2,
    collabStrength: "NONE",
    hasStack: false,
    tags: [],
    triggers: ["STRUCTURE", "SWEEP_REC"],
    triggersStr: "STRUCTURE|SWEEP_REC",
    poiTags: [],
    rawEvent:
      "[ENTRY_WINDOW_OPEN][M5] time=2026-06-01T00:05:00Z poi=POITEST:CH_POI:H4:1:BULL:102 triggers=2plus:STRUCTURE|SWEEP_REC",
    poiSnapshot: channelDirectSeed.poiSnapshot,
    barSnapshot: {
      close: 103.4,
      high: 104,
      low: 101.9,
    },
    expectedRR:
      Math.abs((channelDirectTpRef as number) - 103.4) /
      Math.abs(103.4 - channelDirectStopPrice),
    tpRefPrice: channelDirectTpRef,
  },
  "channel direct-open candidate uses opposite boundary tpRef and boundary hard invalidation"
);

assert.deepEqual(
  buildRouterRawSignalCandidatesForBar({
    symbol: "BTCUSDT",
    bar: {
      tf: "M15",
      openTime: Date.UTC(2026, 5, 1, 0, 0, 0),
      closeTime: Date.UTC(2026, 5, 1, 0, 15, 0),
      open: 100,
      high: 101,
      low: 99.5,
      close: 100.5,
      volume: 0,
    },
    tickSize: 0.1,
    poiStore: routerRawCtxBase.poiStore,
    rawEvents: [
      "[ENTRY_WINDOW_OPEN][M15] poi=BTCUSDT:FVG:77 triggers=2plus:SWEEP_REC|CHOCH",
      "[TRENDLINE][NEW][H4][TL_SUPPORT] time=2026-06-01T00:00:00Z id=IGNORED",
    ],
  }).map((seed) => seed.candidateId),
  [
    "BTCUSDT:BTCUSDT:FVG:77:BULL:ENTRY_WINDOW_OPEN:M15@2026-06-01T00:15:00Z",
  ],
  "router runtime bridge builds seeds only from canonical candidate raw events"
);

assert.deepEqual(
  buildRouterRawSignalCandidatesForBar({
    symbol: "BTCUSDT",
    bar: {
      tf: "M5",
      openTime: Date.UTC(2026, 5, 1, 0, 0, 0),
      closeTime: Date.UTC(2026, 5, 1, 0, 5, 0),
      open: 100,
      high: 101,
      low: 99.5,
      close: 100.5,
      volume: 0,
    },
    poiStore: routerRawCtxBase.poiStore,
    rawEvents: [
      "[REACTION][M5] poi=BTCUSDT:FVG:77 triggers=CHOCH",
    ],
  }),
  [],
  "router runtime bridge returns empty when tickSize is unavailable"
);

clearRouterCloseSyncBatches();

assert.equal(
  buildRouterCloseSyncKey("btcusdt", Date.UTC(2026, 5, 1, 0, 15, 0)),
  "BTCUSDT|1780272900000",
  "router close sync key normalizes symbol and closeTime"
);

const routerCloseSyncH1Bar: Bar = {
  tf: "H1",
  openTime: Date.UTC(2026, 5, 1, 0, 0, 0),
  closeTime: Date.UTC(2026, 5, 1, 1, 0, 0),
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 0,
};

const routerCloseSyncM30Bar: Bar = {
  tf: "M30",
  openTime: Date.UTC(2026, 5, 1, 0, 30, 0),
  closeTime: Date.UTC(2026, 5, 1, 1, 0, 0),
  open: 100,
  high: 101,
  low: 99.2,
  close: 100.2,
  volume: 0,
};

const routerCloseSyncM5Bar: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 5, 1, 0, 55, 0),
  closeTime: Date.UTC(2026, 5, 1, 1, 0, 0),
  open: 100,
  high: 100.8,
  low: 99.8,
  close: 100.1,
  volume: 10,
};

assert.deepEqual(
  {
    released: bufferOrReleaseRouterCandidateEvaluationItem(
      {
        symbol: "BTCUSDT",
        bar: routerCloseSyncH1Bar,
        rawEvents: ["[REACTION][H1] poi=BTCUSDT:TRENDLINE:1 triggers=CHOCH"],
      },
      false
    ),
    pending: listPendingRouterCandidateEvaluationItems("BTCUSDT", routerCloseSyncH1Bar.closeTime).map(
      (item) => item.bar.tf
    ),
  },
  {
    released: [],
    pending: ["H1"],
  },
  "router close sync buffers higher tf candidate evaluation until same-closeTime m5 exists"
);

bufferOrReleaseRouterCandidateEvaluationItem(
  {
    symbol: "BTCUSDT",
    bar: routerCloseSyncM30Bar,
    rawEvents: ["[REACTION][M30] poi=BTCUSDT:CHANNEL:1 triggers=STRUCTURE"],
  },
  false
);

assert.deepEqual(
  releaseRouterCandidateEvaluationBatchForM5("BTCUSDT", routerCloseSyncM5Bar, [
    "[REACTION][M5] poi=BTCUSDT:FVG:1 triggers=CHOCH",
  ]).map((item) => item.bar.tf),
  ["H1", "M30", "M5"],
  "router close sync releases buffered batch in canonical d1-h4-h1-m30-m15-m5 order once m5 commits"
);

bufferOrReleaseRouterCandidateEvaluationItem(
  {
    symbol: "ETHUSDT",
    bar: {
      ...routerCloseSyncH1Bar,
      closeTime: Date.UTC(2026, 5, 1, 2, 0, 0),
    },
    rawEvents: ["[REACTION][H1] poi=ETHUSDT:TRENDLINE:1 triggers=CHOCH"],
  },
  false
);

assert.deepEqual(
  releaseRouterCandidateEvaluationBatchForM5(
    "ETHUSDT",
    {
      ...routerCloseSyncM5Bar,
      closeTime: Date.UTC(2026, 5, 1, 2, 0, 0),
    },
    []
  ).map((item) => item.bar.tf),
  ["H1"],
  "router close sync releases buffered higher tf candidates even when the m5 bar itself has no raw events"
);

clearMarketContext("M5SYNCTEST");
appendMarketBar("M5SYNCTEST", {
  tf: "M5",
  openTime: Date.UTC(2026, 5, 1, 3, 55, 0),
  closeTime: Date.UTC(2026, 5, 1, 4, 0, 0),
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 25,
});

assert.deepEqual(
  getMarketBarAtCloseTime("M5SYNCTEST", "M5", Date.UTC(2026, 5, 1, 4, 0, 0)),
  {
    tf: "M5",
    openTime: Date.UTC(2026, 5, 1, 3, 55, 0),
    closeTime: Date.UTC(2026, 5, 1, 4, 0, 0),
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 25,
  },
  "engine market context can resolve same-closeTime m5 directly for runtime sync gating"
);

clearMarketContext("RUNOPEN1");
clearBookTickerCache("RUNOPEN1");
clearRuntimeTradeStore("RUNOPEN1");
setCachedTickSize("RUNOPEN1", 0.1);

const runtimeOpenM5Bars: Bar[] = Array.from({ length: 40 }, (_, index) => {
  const openTime = Date.UTC(2026, 5, 1, 0, index * 5, 0);
  return {
    tf: "M5" as const,
    openTime,
    closeTime: openTime + 5 * 60 * 1000,
    open: 100 + index * 0.2,
    high: 100.4 + index * 0.2,
    low: 99.8 + index * 0.2,
    close: 100.2 + index * 0.2,
    volume: 1000 + index * 10,
  };
});

const runtimeOpenM15Bars: Bar[] = Array.from({ length: 40 }, (_, index) => {
  const openTime = Date.UTC(2026, 4, 31, 18, index * 15, 0);
  return {
    tf: "M15" as const,
    openTime,
    closeTime: openTime + 15 * 60 * 1000,
    open: 98 + index * 0.3,
    high: 98.6 + index * 0.3,
    low: 97.6 + index * 0.3,
    close: 98.3 + index * 0.3,
    volume: 2200 + index * 20,
  };
});

const runtimeOpenH1Bars: Bar[] = Array.from({ length: 40 }, (_, index) => {
  const openTime = Date.UTC(2026, 4, 31, index, 0, 0);
  return {
    tf: "H1" as const,
    openTime,
    closeTime: openTime + 60 * 60 * 1000,
    open: 90 + index,
    high: 91.5 + index,
    low: 89.5 + index,
    close: 91 + index,
    volume: 5000 + index * 100,
  };
});

for (const bar of runtimeOpenM5Bars) {
  appendMarketBar("RUNOPEN1", bar);
}

for (const bar of runtimeOpenM15Bars) {
  appendMarketBar("RUNOPEN1", bar);
}

for (const bar of runtimeOpenH1Bars) {
  appendMarketBar("RUNOPEN1", bar);
}

const runtimeOpenTime = "2026-06-01T03:15:00Z";
const runtimeOpenTimeMs = Date.parse(runtimeOpenTime);

upsertBookTicker({
  symbol: "RUNOPEN1",
  bid: 107.95,
  ask: 108.05,
  eventTime: runtimeOpenTimeMs,
  recvTime: runtimeOpenTimeMs,
});

const runtimeOpenSeed = {
  candidateId: "RUNOPEN1:RUNOPEN1:FVG:1:BULL:ENTRY_WINDOW_OPEN:M15@2026-06-01T03:15:00Z",
  tradeKey: "RUNOPEN1:RUNOPEN1:FVG:1:BULL",
  symbol: "RUNOPEN1",
  ltf: "M15" as const,
  eventName: "ENTRY_WINDOW_OPEN" as const,
  openTime: runtimeOpenTime,
  poiId: "RUNOPEN1:FVG:1",
  poiKind: "FVG" as const,
  poiTf: "H4",
  dir: "BULL" as const,
  triggersMode: "2plus" as const,
  entryRefPrice: 108,
  entryBoundaryPrice: 107.8,
  hardInvalidationPrice: 107.8,
  triggers: ["CHOCH", "SWEEP_REC"],
  triggersStr: "CHOCH|SWEEP_REC",
  poiTags: ["A"],
  rawEvent:
    "[ENTRY_WINDOW_OPEN][M15] poi=RUNOPEN1:FVG:1 triggers=2plus:CHOCH|SWEEP_REC",
  poiSnapshot: {
    id: "RUNOPEN1:FVG:1",
    symbol: "RUNOPEN1",
    kind: "FVG" as const,
    tf: "H4",
    dir: "BULL" as const,
    zone: {
      bottom: 107.8,
      top: 109.2,
    },
    type: "H4_CORE_FVG",
    state: "A_ACTIVE",
    confTime: "2026-06-01T00:00:00Z",
    tags: ["A"],
    stackActive: true,
  },
  barSnapshot: {
    close: 108,
    high: 108.4,
    low: 107.6,
  },
};

const runtimePolicyBridge = buildRuntimePolicyResultFromSeed({
  seed: runtimeOpenSeed,
  syncState: {
    syncing: false,
    dataOk: true,
    gapDetected: false,
    syncSource: null,
  },
  recentConcentrationHistory15m: [],
});

assert.deepEqual(
  {
    exists: Boolean(runtimePolicyBridge),
    dataReason: runtimePolicyBridge?.market.dataReason ?? null,
    accountMode: runtimePolicyBridge?.account.accountMode ?? null,
    expectedRR: runtimePolicyBridge?.signal.expectedRR != null,
    tpRefPrice: runtimePolicyBridge?.signal.tpRefPrice != null,
    policyDecision: runtimePolicyBridge?.policy.decision ?? null,
  },
  {
    exists: true,
    dataReason: "OK",
    accountMode: "ALERT_ONLY",
    expectedRR: true,
    tpRefPrice: true,
    policyDecision: "BLOCK",
  },
  "router runtime open bridge builds policy result from seed using live market and draft context"
);

assert.deepEqual(
  {
    bull: buildRuntimeRouterCandidate({
      seed: runtimeOpenSeed,
      signal: runtimePolicyBridge!.signal,
      policy: runtimePolicyBridge!.policy,
      emissionBar: {
        high: 108.4,
        low: 107.6,
      },
    })?.priceExtreme,
    bear: buildRuntimeRouterCandidate({
      seed: {
        ...runtimeOpenSeed,
        candidateId: "RUNOPEN1:RUNOPEN1:FVG:2:BEAR:REACTION:M5@2026-06-01T03:20:00Z",
        tradeKey: "RUNOPEN1:RUNOPEN1:FVG:2:BEAR",
        dir: "BEAR",
        poiId: "RUNOPEN1:FVG:2",
        poiSnapshot: {
          ...runtimeOpenSeed.poiSnapshot,
          id: "RUNOPEN1:FVG:2",
          dir: "BEAR",
        },
      },
      signal: {
        ...runtimePolicyBridge!.signal,
        candidateId: "RUNOPEN1:RUNOPEN1:FVG:2:BEAR:REACTION:M5@2026-06-01T03:20:00Z",
        tradeKey: "RUNOPEN1:RUNOPEN1:FVG:2:BEAR",
        dir: "BEAR",
        poiId: "RUNOPEN1:FVG:2",
      },
      policy: runtimePolicyBridge!.policy,
      emissionBar: {
        high: 108.9,
        low: 107.1,
      },
    })?.priceExtreme,
  },
  {
    bull: 107.6,
    bear: 108.9,
  },
  "router runtime open candidate maps priceExtreme from current emission wick only"
);

assert.equal(
  getRuntimePreviousM5CloseTimeIso("RUNOPEN1", runtimeOpenTime),
  "2026-06-01T03:10:00Z",
  "router runtime open bridge resolves previous closed m5 exactly"
);

const runtimeOpenedPlan = evaluateTradeOpen({
  payload: buildRouterSendOpenPayload(routerSampleCandidate),
  signalBarClose: 100.5,
  tickSize: 0.1,
  atrM5_14_atOpen: 2.5,
  atrLiq_14_atOpen: 2,
  confirmedTpPivots: tradeOpenConfirmedTpPivots,
})?.plan;

clearRuntimeTradeStore();
registerRuntimeOpenedTrade({
  tradeKey: "TK-RUNTIME-1",
  zoneKey: "ZONE-RUNTIME-1",
  plan: runtimeOpenedPlan!,
  poiClusterKey: "CLUSTER-RUNTIME-1",
});

assert.deepEqual(
  {
    tradeKeys: listRuntimeActiveTradeKeyRefs(),
    tradePlans: listRuntimeActiveTradePlanRefs(),
    concentration: listRuntimeConcentrationHistory(),
    plans: listRuntimeOpenedTradePlans().map((plan) => plan.planId),
  },
  {
    tradeKeys: [
      {
        tradeKey: "TK-RUNTIME-1",
        status: "OPEN",
      },
    ],
    tradePlans: [
      {
        symbol: runtimeOpenedPlan!.symbol,
        dir: runtimeOpenedPlan!.dir,
        status: "OPEN",
        zoneKey: "ZONE-RUNTIME-1",
      },
    ],
    concentration: [
      {
        time: runtimeOpenedPlan!.openTime,
        symbol: runtimeOpenedPlan!.symbol,
        dir: "BULL",
        poiClusterKey: "CLUSTER-RUNTIME-1",
      },
    ],
    plans: [runtimeOpenedPlan!.planId],
  },
  "trade runtime store tracks active trade refs and concentration history for send-open dedupe"
);

runAlertsApiExactTests()
  .then(() => {
    console.log(
      "[ENGINE_EXACT_MATCH_OK]",
      JSON.stringify({
        cases: 951,
        emitted: run1.length,
      })
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });






















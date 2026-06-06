import { getAtrValueAtCloseTime } from "../../atr";
import type { IndicatorEngine } from "../../contracts";
import {
  listRuntimePois,
  replaceRuntimeChannelExecutionPois,
  replaceRuntimeChannelPois,
  syncRuntimeChannelExecutionInvalidationPois,
} from "../../runtime-poi-store";
import {
  advanceSourceEmissionState,
  type SourceEmissionState,
} from "../../source-emission";
import { getCachedTickSize } from "../../ticksize";
import type { Bar } from "../../types";
import {
  buildChannelModelFromResolvedAnchors,
  createEmptyChannelContextState,
  updateChannelContextState,
  type ChannelContextState,
} from "./anchors";
import {
  evaluateChannelAnchorInvalidAtBar,
  evaluateChannelBreakAtBar,
} from "./breaks";
import {
  formatChannelInvalidEvent,
  formatChannelNewEvent,
  formatChannelPoiEvent,
  resolveChannelUpdateEvent,
  shouldEmitChannelInvalidEvent,
  shouldEmitChannelNewEvent,
  shouldEmitChannelPoiEvent,
} from "./events";
import { computeH1M30Mode, isH1M30ChannelTf } from "./h1m30";
import {
  applyChannelLifecycleInvalidation,
  buildChannelPoiCapKey,
  evaluateChannelPoiDayCap,
} from "./lifecycle";
import {
  formatChannelModeEvent,
  shouldEmitChannelModeEvent,
} from "./mode-event";
import {
  buildReferencedChannelParentIds,
  listActiveChannelParentCandidates,
  toChannelParentPoiContexts,
} from "./parent";
import { evaluateChannelPoiGateFromTfBars } from "./poi-gate";
import { getChannelPoiBoundaryPriceAt } from "./poi-gate";
import { createChannelPoi, evaluateChannelParentNearInside } from "./poi";
import { evaluateChannelPoiTriggersFromTfBars } from "./poi-triggers";
import type {
  ChannelBar,
  ChannelModel,
  ChannelModelTf,
  ChannelPoiParentRelation,
  ChannelPoi,
} from "./types";

export type ChannelIndicatorEngine = IndicatorEngine;

const CHANNEL_DETECT_TFS = ["D1", "H4", "H1", "M30"] as const;
const CHANNEL_REACTION_TFS = ["M15", "M5"] as const;
const CHANNEL_BAR_BUFFER_SIZE = 512;
const CHANNEL_REACTION_BAR_BUFFER_SIZE = 128;
const CHANNEL_EXEC_GATE_ATR = 0.20;

type ChannelDetectTf = (typeof CHANNEL_DETECT_TFS)[number];
type ChannelReactionTf = (typeof CHANNEL_REACTION_TFS)[number];

type ChannelDetectState = {
  context: ChannelContextState;
  model: ChannelModel | null;
  lastPoi: ChannelPoi | null;
};

type ChannelReactionState = {
  context: ChannelContextState;
  emissionStates: Map<string, SourceEmissionState>;
  lastStructureEval: ReturnType<typeof updateChannelContextState>["structureEval"] | null;
};

type ChannelExecutionSource = {
  poi: ChannelPoi;
  model: ChannelModel;
};

export interface ChannelRuntimeState {
  symbol: string;
  d1: ChannelDetectState;
  h4: ChannelDetectState;
  h1: ChannelDetectState;
  m30: ChannelDetectState;
  m15: ChannelReactionState;
  m5: ChannelReactionState;
  poiCapCounts: Map<string, number>;
}

function isChannelDetectTf(tf: string): tf is ChannelDetectTf {
  return (CHANNEL_DETECT_TFS as readonly string[]).includes(tf);
}

function isChannelReactionTf(tf: string): tf is ChannelReactionTf {
  return (CHANNEL_REACTION_TFS as readonly string[]).includes(tf);
}

function createEmptyDetectState(): ChannelDetectState {
  return {
    context: createEmptyChannelContextState(),
    model: null,
    lastPoi: null,
  };
}

function createEmptyReactionState(): ChannelReactionState {
  return {
    context: createEmptyChannelContextState(),
    emissionStates: new Map(),
    lastStructureEval: null,
  };
}

export function createEmptyChannelRuntimeState(
  symbol: string = "UNKNOWN"
): ChannelRuntimeState {
  return {
    symbol: symbol.toUpperCase(),
    d1: createEmptyDetectState(),
    h4: createEmptyDetectState(),
    h1: createEmptyDetectState(),
    m30: createEmptyDetectState(),
    m15: createEmptyReactionState(),
    m5: createEmptyReactionState(),
    poiCapCounts: new Map(),
  };
}

function getDetectState(
  state: ChannelRuntimeState,
  tf: ChannelDetectTf
): ChannelDetectState {
  if (tf === "D1") {
    return state.d1;
  }

  if (tf === "H4") {
    return state.h4;
  }

  if (tf === "H1") {
    return state.h1;
  }

  return state.m30;
}

function collectActiveChannelModels(state: ChannelRuntimeState): ChannelModel[] {
  return [
    state.d1.model,
    state.h4.model,
    state.h1.model,
    state.m30.model,
  ].filter((model): model is ChannelModel => Boolean(model && model.state === "ACTIVE"));
}

function collectActiveChannelExecutionSources(
  state: ChannelRuntimeState
): ChannelExecutionSource[] {
  const detectStates = [state.d1, state.h4, state.h1, state.m30];

  return detectStates.flatMap((tfState) => {
    const model = tfState.model;
    const poi = tfState.lastPoi;

    if (!model || model.state !== "ACTIVE" || !poi || poi.state !== "ACTIVE") {
      return [];
    }

    if (isH1M30ChannelTf(model.tf) && model.mode !== "ENABLED") {
      return [];
    }

    return [{ poi, model }];
  });
}

function getReactionState(
  state: ChannelRuntimeState,
  tf: ChannelReactionTf
): ChannelReactionState {
  return tf === "M15" ? state.m15 : state.m5;
}

function mapChannelExecutionTags(
  relation?: ChannelPoiParentRelation
): string[] {
  if (relation === "INSIDE") {
    return ["COLLAB_CONTEXT_TIGHT_0.10"];
  }

  if (relation === "NEAR") {
    return ["COLLAB_CONTEXT_OK_0.25"];
  }

  return [];
}

function cloneModelWithFreshTimestamp(
  model: ChannelModel,
  currentCloseTime: number
): ChannelModel {
  return model.state === "ACTIVE"
    ? {
        ...model,
        lastUpdatedAt: currentCloseTime,
      }
    : model;
}

function buildCandidateReferencedParentIds(
  candidate: ChannelModel | null,
  currentParentIds: readonly string[]
): string[] | undefined {
  if (!candidate || !isH1M30ChannelTf(candidate.tf)) {
    return undefined;
  }

  if (candidate.mode !== "ENABLED") {
    return undefined;
  }

  return currentParentIds.length > 0 ? [...currentParentIds] : undefined;
}

function attachCandidateParentRefs(
  candidate: ChannelModel | null,
  currentParentIds: readonly string[]
): ChannelModel | null {
  if (!candidate || !isH1M30ChannelTf(candidate.tf)) {
    return candidate;
  }

  const referencedParentIds = buildCandidateReferencedParentIds(
    candidate,
    currentParentIds
  );

  return referencedParentIds?.length
    ? {
        ...candidate,
        referencedParentIds,
      }
    : candidate;
}

function mergeSameIdentityChannelModel(args: {
  prevModel: ChannelModel;
  candidateModel: ChannelModel;
  currentCloseTime: number;
}): ChannelModel {
  const { prevModel, candidateModel, currentCloseTime } = args;

  return {
    ...candidateModel,
    createdAt: prevModel.createdAt,
    lastUpdatedAt: currentCloseTime,
    displayUntil: prevModel.displayUntil ?? candidateModel.displayUntil,
    ttlStartTime: prevModel.ttlStartTime ?? candidateModel.ttlStartTime,
    mode: prevModel.mode,
    referencedParentIds: prevModel.referencedParentIds,
  };
}

function applyChannelBoundaryInvalidation(args: {
  model: ChannelModel | null;
  tfBars: readonly ChannelBar[];
  currentCloseTime: number;
}): ChannelModel | null {
  const { model, tfBars, currentCloseTime } = args;

  if (!model || model.state !== "ACTIVE") {
    return model;
  }

  const atrAtBar = getAtrValueAtCloseTime(tfBars, currentCloseTime);
  const currentIndex = tfBars.length - 1;

  if (!(Number.isFinite(atrAtBar) && (atrAtBar as number) > 0)) {
    return model;
  }

  const breakEval = evaluateChannelBreakAtBar({
    channel: model,
    tfBars,
    currentIndex,
    atrAtBar: atrAtBar as number,
  });

  if (breakEval?.pass) {
    return {
      ...model,
      state: "INACTIVE",
      invalidReason: "break",
      endTime: currentCloseTime,
    };
  }

  const anchorEval = evaluateChannelAnchorInvalidAtBar({
    channel: model,
    tfBars,
    currentIndex,
    atrAtBar: atrAtBar as number,
  });

  if (anchorEval?.pass) {
    return {
      ...model,
      state: "INACTIVE",
      invalidReason: "anchor_invalid",
      endTime: currentCloseTime,
    };
  }

  return model;
}

function applyChannelLifecycleForTf(args: {
  model: ChannelModel | null;
  currentCloseTime: number;
  currentParentIds: readonly string[];
}): ChannelModel | null {
  const { model, currentCloseTime, currentParentIds } = args;

  if (!model || model.state !== "ACTIVE") {
    return model;
  }

  if (!isH1M30ChannelTf(model.tf)) {
    return model;
  }

  return applyChannelLifecycleInvalidation({
    channel: model,
    currentCloseTime,
    activeParentPoiIds: currentParentIds,
  });
}

function applyCurrentModeAndParentRefs(args: {
  prevModel?: ChannelModel | null;
  nextModel: ChannelModel;
  currentParentIds: readonly string[];
}): ChannelModel {
  const { prevModel, nextModel, currentParentIds } = args;

  if (!isH1M30ChannelTf(nextModel.tf) || nextModel.state !== "ACTIVE") {
    return nextModel;
  }

  const nextMode = computeH1M30Mode(currentParentIds.length);

  if (nextMode !== "ENABLED") {
    return {
      ...nextModel,
      mode: nextMode,
    };
  }

  const referencedParentIds =
    prevModel?.state === "ACTIVE" &&
    prevModel.id === nextModel.id &&
    prevModel.mode === "ENABLED" &&
    prevModel.referencedParentIds?.length
      ? [...prevModel.referencedParentIds]
      : nextModel.referencedParentIds?.length
        ? [...nextModel.referencedParentIds]
        : [...currentParentIds];

  return {
    ...nextModel,
    mode: nextMode,
    referencedParentIds,
  };
}

function buildModeEvent(
  time: number,
  prevModel?: ChannelModel | null,
  nextModel?: ChannelModel | null
): string | null {
  if (!shouldEmitChannelModeEvent(prevModel, nextModel)) {
    return null;
  }

  return formatChannelModeEvent(time, nextModel as ChannelModel);
}

function evaluateChannelPoiForBar(args: {
  model: ChannelModel | null;
  tfState: ChannelDetectState;
  currentParentIds: readonly string[];
  currentParentContexts: ReturnType<typeof toChannelParentPoiContexts>;
  structureEval: ReturnType<typeof updateChannelContextState>["structureEval"];
  poiCapCounts: Map<string, number>;
}): ChannelPoi | null {
  const {
    model,
    tfState,
    currentParentIds,
    currentParentContexts,
    structureEval,
    poiCapCounts,
  } = args;

  if (!model || model.state !== "ACTIVE") {
    return null;
  }

  const gateEval = evaluateChannelPoiGateFromTfBars(tfState.context.bars, model);
  const triggerEval = evaluateChannelPoiTriggersFromTfBars({
    channel: model,
    tfBars: tfState.context.bars,
    breakType: structureEval.breakType,
    nextState: tfState.context.structureState,
  });

  if (model.tf === "D1" || model.tf === "H4") {
    return createChannelPoi({
      channel: model,
      gateEval,
      triggerEval,
    });
  }

  if (!isH1M30ChannelTf(model.tf) || !gateEval) {
    return null;
  }

  const parentNearInsideEval = evaluateChannelParentNearInside({
    tf: model.tf,
    wickExtreme: gateEval.wickExtreme,
    boundaryPrice: gateEval.boundaryPrice,
    atrAtBar: gateEval.atrAtBar,
    parentPois: currentParentContexts,
  });

  const dayKeyEval = evaluateChannelPoiDayCap({
    symbol: model.symbol,
    tf: model.tf,
    time: gateEval.currentCloseTime,
    currentCount:
      poiCapCounts.get(
        buildChannelPoiCapKey(
          model.symbol,
          model.tf,
          new Date(gateEval.currentCloseTime).toISOString().slice(0, 10)
        )
      ) ?? 0,
  });

  return createChannelPoi({
    channel: model,
    gateEval,
    triggerEval,
    parentNearInsideEval,
    dayCapEval: dayKeyEval,
  });
}

function incrementChannelPoiCap(
  poiCapCounts: Map<string, number>,
  poi: ChannelPoi | null
): void {
  if (!poi || !isH1M30ChannelTf(poi.tf) || !poi.dayKeyUtc) {
    return;
  }

  const capKey = buildChannelPoiCapKey(poi.symbol, poi.tf, poi.dayKeyUtc);
  poiCapCounts.set(capKey, (poiCapCounts.get(capKey) ?? 0) + 1);
}

function endChannelPoi(
  poi: ChannelPoi,
  currentCloseTime: number,
  invalidReason?: ChannelPoi["invalidReason"]
): ChannelPoi {
  return {
    ...poi,
    state: "INACTIVE",
    endTime: currentCloseTime,
    invalidReason: invalidReason ?? poi.invalidReason ?? "expired_forward",
  };
}

function isChannelExecutionModelEligible(
  model: ChannelModel | null
): boolean {
  if (!model || model.state !== "ACTIVE") {
    return false;
  }

  if (isH1M30ChannelTf(model.tf)) {
    return model.mode === "ENABLED";
  }

  return true;
}

function resolveChannelExecutionPoiState(args: {
  prevPoi: ChannelPoi | null;
  candidatePoi: ChannelPoi | null;
  prevModel: ChannelModel | null;
  nextModel: ChannelModel | null;
  currentCloseTime: number;
}): { nextPoi: ChannelPoi | null; endedPois: ChannelPoi[] } {
  const {
    prevPoi,
    candidatePoi,
    prevModel,
    nextModel,
    currentCloseTime,
  } = args;

  const endedPois: ChannelPoi[] = [];

  if (prevPoi?.state === "ACTIVE" && !isChannelExecutionModelEligible(nextModel)) {
    const invalidReason =
      nextModel?.state === "INACTIVE"
        ? nextModel.invalidReason ?? "expired_forward"
        : prevModel?.state === "ACTIVE" &&
            isH1M30ChannelTf(prevModel.tf) &&
            prevModel.mode === "ENABLED"
          ? "parent_poi_ended"
          : "expired_forward";

    const endedPoi = endChannelPoi(prevPoi, currentCloseTime, invalidReason);
    endedPois.push(endedPoi);

    return {
      nextPoi: endedPoi,
      endedPois,
    };
  }

  if (
    prevPoi?.state === "ACTIVE" &&
    candidatePoi &&
    candidatePoi.id !== prevPoi.id
  ) {
    endedPois.push(endChannelPoi(prevPoi, currentCloseTime, "expired_forward"));
    return {
      nextPoi: candidatePoi,
      endedPois,
    };
  }

  if (candidatePoi) {
    return {
      nextPoi: candidatePoi,
      endedPois,
    };
  }

  return {
    nextPoi: prevPoi,
    endedPois,
  };
}

function buildDetectTfEvents(args: {
  currentCloseTime: number;
  prevModel: ChannelModel | null;
  nextModel: ChannelModel | null;
  prevPoi: ChannelPoi | null;
  nextPoi: ChannelPoi | null;
  tickSize?: number | null;
}): string[] {
  const {
    currentCloseTime,
    prevModel,
    nextModel,
    prevPoi,
    nextPoi,
    tickSize,
  } = args;
  const modeChanged = shouldEmitChannelModeEvent(prevModel, nextModel);

  const out = [
    shouldEmitChannelNewEvent(prevModel, nextModel)
      ? formatChannelNewEvent(currentCloseTime, nextModel as ChannelModel)
      : null,
    buildModeEvent(currentCloseTime, prevModel, nextModel),
    resolveChannelUpdateEvent({
      time: currentCloseTime,
      prevModel,
      nextModel,
      tickSize,
      suppressForModeChange: modeChanged,
    }),
    shouldEmitChannelInvalidEvent(prevModel, nextModel)
      ? formatChannelInvalidEvent(currentCloseTime, nextModel as ChannelModel)
      : null,
    shouldEmitChannelPoiEvent(prevPoi, nextPoi)
      ? formatChannelPoiEvent(currentCloseTime, nextPoi as ChannelPoi)
      : null,
  ];

  return out.filter((event): event is string => Boolean(event));
}

function getChannelExecutionGateBoundaryPrice(
  model: ChannelModel,
  time: number
): number | null {
  return getChannelPoiBoundaryPriceAt(model, time);
}

function evaluateChannelExecutionGate(args: {
  model: ChannelModel;
  bars: readonly ChannelBar[];
}): boolean {
  const { model, bars } = args;
  if (!bars.length || !model.geometry) {
    return false;
  }

  const currentBar = bars[bars.length - 1];
  const atrAtBar = getAtrValueAtCloseTime(bars, currentBar.closeTime);
  if (!(Number.isFinite(atrAtBar) && (atrAtBar as number) > 0)) {
    return false;
  }

  const boundaryPrice = getChannelExecutionGateBoundaryPrice(
    model,
    currentBar.closeTime
  );
  if (!Number.isFinite(boundaryPrice)) {
    return false;
  }

  const wickExtreme =
    model.geometry.dir === "UP" ? currentBar.low : currentBar.high;
  const dist = Math.abs(wickExtreme - (boundaryPrice as number));

  return dist <= (atrAtBar as number) * CHANNEL_EXEC_GATE_ATR;
}

function mapChannelExecutionTriggerTokens(
  triggerEval: ReturnType<typeof evaluateChannelPoiTriggersFromTfBars>
): string[] {
  if (!triggerEval) {
    return [];
  }

  const out: string[] = [];
  if (triggerEval.structure) {
    out.push("STRUCTURE");
  }
  if (triggerEval.sweepRec) {
    out.push("SWEEP_REC");
  }
  return out;
}

function evaluateReactionTfBarClose(
  state: ChannelRuntimeState,
  tf: ChannelReactionTf,
  bar: ChannelBar,
  advanceContext: boolean,
  emitEvents: boolean
): string[] {
  const reactionState = getReactionState(state, tf);
  if (advanceContext) {
    const updatedContext = updateChannelContextState(
      reactionState.context,
      bar,
      CHANNEL_REACTION_BAR_BUFFER_SIZE
    );
    reactionState.context = updatedContext.next;
    reactionState.lastStructureEval = updatedContext.structureEval;
  }

  const activeSources = collectActiveChannelExecutionSources(state);
  const activeIds = new Set(activeSources.map((source) => source.poi.id));
  const out: string[] = [];

  if (!emitEvents) {
    for (const key of [...reactionState.emissionStates.keys()]) {
      const [poiId] = key.split("|");
      if (!activeIds.has(poiId)) {
        reactionState.emissionStates.delete(key);
      }
    }

    return out;
  }

  for (const source of activeSources) {
    const emissionKey = `${source.poi.id}|${tf}`;
    const gatePass = evaluateChannelExecutionGate({
      model: source.model,
      bars: reactionState.context.bars,
    });
    const triggerEval = gatePass
      ? evaluateChannelPoiTriggersFromTfBars({
          channel: source.model,
          tfBars: reactionState.context.bars,
          breakType: reactionState.lastStructureEval?.breakType ?? null,
          nextState: reactionState.context.structureState,
        })
      : null;

    const transition = advanceSourceEmissionState({
      prev: reactionState.emissionStates.get(emissionKey),
      ltf: tf,
      closeTime: bar.closeTime,
      poiId: source.poi.id,
      gatePass,
      currentTriggers: mapChannelExecutionTriggerTokens(triggerEval),
    });

    reactionState.emissionStates.set(emissionKey, transition.next);

    if (transition.event) {
      out.push(transition.event);
    }
  }

  for (const key of [...reactionState.emissionStates.keys()]) {
    const [poiId] = key.split("|");
    if (!activeIds.has(poiId)) {
      reactionState.emissionStates.delete(key);
    }
  }

  return out;
}

function processDetectTfBarClose(
  state: ChannelRuntimeState,
  tf: ChannelDetectTf,
  bar: ChannelBar,
  trackedExecutionPois: Map<string, ChannelPoi>
): string[] {
  const tfState = getDetectState(state, tf);
  const prevModel = tfState.model;
  const prevPoi = tfState.lastPoi;

  const updatedContext = updateChannelContextState(
    tfState.context,
    bar,
    CHANNEL_BAR_BUFFER_SIZE
  );
  tfState.context = updatedContext.next;
  const tickSize = getCachedTickSize(state.symbol);

  const runtimePois = listRuntimePois(state.symbol);

  const directionProbe = buildChannelModelFromResolvedAnchors({
    symbol: state.symbol,
    tf,
    bars: updatedContext.next.bars,
    structureState: updatedContext.next.structureState,
    pivotHighs: updatedContext.next.highs,
    pivotLows: updatedContext.next.lows,
    createdAt: bar.closeTime,
    activeParentPoiCount: 0,
  });

  const parentDir =
    directionProbe?.geometry?.dir ??
    (prevModel?.state === "ACTIVE" && prevModel.geometry
      ? prevModel.geometry.dir
      : null);

  const candidateParentPois =
    (tf === "H1" || tf === "M30") && parentDir
      ? listActiveChannelParentCandidates(runtimePois, parentDir)
      : [];
  const currentParentIds = buildReferencedChannelParentIds(candidateParentPois);
  const currentParentContexts = toChannelParentPoiContexts(candidateParentPois);

  let candidateModel =
    directionProbe && (tf === "D1" || tf === "H4")
      ? directionProbe
      : buildChannelModelFromResolvedAnchors({
          symbol: state.symbol,
          tf,
          bars: updatedContext.next.bars,
          structureState: updatedContext.next.structureState,
          pivotHighs: updatedContext.next.highs,
          pivotLows: updatedContext.next.lows,
          createdAt: bar.closeTime,
          activeParentPoiCount: currentParentIds.length,
        });

  candidateModel = attachCandidateParentRefs(candidateModel, currentParentIds);

  let replacementCandidate: ChannelModel | null = null;
  let workingModel: ChannelModel | null = prevModel;

  if (prevModel?.state === "ACTIVE") {
    if (candidateModel?.id === prevModel.id) {
      workingModel = mergeSameIdentityChannelModel({
        prevModel,
        candidateModel,
        currentCloseTime: bar.closeTime,
      });
    } else {
      workingModel = cloneModelWithFreshTimestamp(prevModel, bar.closeTime);
      replacementCandidate = candidateModel;
    }
  } else {
    workingModel = candidateModel ?? prevModel;
  }

  workingModel = applyChannelBoundaryInvalidation({
    model: workingModel,
    tfBars: updatedContext.next.bars,
    currentCloseTime: bar.closeTime,
  });

  workingModel = applyChannelLifecycleForTf({
    model: workingModel,
    currentCloseTime: bar.closeTime,
    currentParentIds,
  });

  if (workingModel?.state === "ACTIVE") {
    workingModel = applyCurrentModeAndParentRefs({
      prevModel,
      nextModel: workingModel,
      currentParentIds,
    });

    if (
      replacementCandidate &&
      replacementCandidate.id !== workingModel.id
    ) {
      let nextReplacement = applyChannelBoundaryInvalidation({
        model: replacementCandidate,
        tfBars: updatedContext.next.bars,
        currentCloseTime: bar.closeTime,
      });

      nextReplacement = applyChannelLifecycleForTf({
        model: nextReplacement,
        currentCloseTime: bar.closeTime,
        currentParentIds,
      });

      if (nextReplacement?.state === "ACTIVE") {
        workingModel = applyCurrentModeAndParentRefs({
          prevModel: null,
          nextModel: nextReplacement,
          currentParentIds,
        });
      }
    }
  }

  const candidatePoi = evaluateChannelPoiForBar({
      model: workingModel,
      tfState,
      currentParentIds,
      currentParentContexts,
      structureEval: updatedContext.structureEval,
      poiCapCounts: state.poiCapCounts,
    });
  const resolvedPoi = resolveChannelExecutionPoiState({
    prevPoi,
    candidatePoi,
    prevModel,
    nextModel: workingModel,
    currentCloseTime: bar.closeTime,
  });
  const nextPoi = resolvedPoi.nextPoi;

  if (nextPoi && shouldEmitChannelPoiEvent(prevPoi, nextPoi)) {
    incrementChannelPoiCap(state.poiCapCounts, nextPoi);
  }

  for (const endedPoi of resolvedPoi.endedPois) {
    trackedExecutionPois.set(endedPoi.id, endedPoi);
  }
  if (nextPoi) {
    trackedExecutionPois.set(nextPoi.id, nextPoi);
  }

  tfState.model = workingModel;
  tfState.lastPoi = nextPoi;

  return buildDetectTfEvents({
    currentCloseTime: bar.closeTime,
    prevModel,
    nextModel: workingModel,
    prevPoi,
    nextPoi,
    tickSize: Number.isFinite(tickSize) ? (tickSize as number) : null,
  });
}

function refreshRuntimeChannels(
  state: ChannelRuntimeState,
  trackedExecutionPois: Map<string, ChannelPoi>
): void {
  replaceRuntimeChannelPois(state.symbol, collectActiveChannelModels(state));
  replaceRuntimeChannelExecutionPois(
    state.symbol,
    collectActiveChannelExecutionSources(state).map((source) => ({
      poiId: source.poi.id,
      model: source.model,
      createdAt: source.poi.createdAt,
      tags: mapChannelExecutionTags(source.poi.parentRelation),
    }))
  );
  syncRuntimeChannelExecutionInvalidationPois(
    state.symbol,
    [...trackedExecutionPois.values()]
  );
}

export function applyChannelBarClose(
  prevState: ChannelRuntimeState,
  bar: Bar,
  trackedExecutionPois: Map<string, ChannelPoi> = new Map(),
  options: {
    publishRuntime?: boolean;
    evaluateReactionPhaseC?: boolean;
  } = {}
): { nextState: ChannelRuntimeState; events: string[] } {
  const state: ChannelRuntimeState = {
    ...prevState,
    d1: {
      context: {
        bars: [...prevState.d1.context.bars],
        highs: [...prevState.d1.context.highs],
        lows: [...prevState.d1.context.lows],
        structureState: prevState.d1.context.structureState,
      },
      model: prevState.d1.model ? { ...prevState.d1.model } : null,
      lastPoi: prevState.d1.lastPoi ? { ...prevState.d1.lastPoi } : null,
    },
    h4: {
      context: {
        bars: [...prevState.h4.context.bars],
        highs: [...prevState.h4.context.highs],
        lows: [...prevState.h4.context.lows],
        structureState: prevState.h4.context.structureState,
      },
      model: prevState.h4.model ? { ...prevState.h4.model } : null,
      lastPoi: prevState.h4.lastPoi ? { ...prevState.h4.lastPoi } : null,
    },
    h1: {
      context: {
        bars: [...prevState.h1.context.bars],
        highs: [...prevState.h1.context.highs],
        lows: [...prevState.h1.context.lows],
        structureState: prevState.h1.context.structureState,
      },
      model: prevState.h1.model ? { ...prevState.h1.model } : null,
      lastPoi: prevState.h1.lastPoi ? { ...prevState.h1.lastPoi } : null,
    },
    m30: {
      context: {
        bars: [...prevState.m30.context.bars],
        highs: [...prevState.m30.context.highs],
        lows: [...prevState.m30.context.lows],
        structureState: prevState.m30.context.structureState,
      },
      model: prevState.m30.model ? { ...prevState.m30.model } : null,
      lastPoi: prevState.m30.lastPoi ? { ...prevState.m30.lastPoi } : null,
    },
    m15: {
      context: {
        bars: [...prevState.m15.context.bars],
        highs: [...prevState.m15.context.highs],
        lows: [...prevState.m15.context.lows],
        structureState: prevState.m15.context.structureState,
      },
      emissionStates: new Map(prevState.m15.emissionStates),
      lastStructureEval: prevState.m15.lastStructureEval
        ? { ...prevState.m15.lastStructureEval }
        : null,
    },
    m5: {
      context: {
        bars: [...prevState.m5.context.bars],
        highs: [...prevState.m5.context.highs],
        lows: [...prevState.m5.context.lows],
        structureState: prevState.m5.context.structureState,
      },
      emissionStates: new Map(prevState.m5.emissionStates),
      lastStructureEval: prevState.m5.lastStructureEval
        ? { ...prevState.m5.lastStructureEval }
        : null,
    },
    poiCapCounts: new Map(prevState.poiCapCounts),
  };

  if (!isChannelDetectTf(bar.tf) && !isChannelReactionTf(bar.tf)) {
    if (options.publishRuntime !== false) {
      refreshRuntimeChannels(state, trackedExecutionPois);
    }
    return { nextState: state, events: [] };
  }

  const events = isChannelDetectTf(bar.tf)
    ? processDetectTfBarClose(state, bar.tf, bar as ChannelBar, trackedExecutionPois)
    : evaluateReactionTfBarClose(
        state,
        bar.tf as ChannelReactionTf,
        bar as ChannelBar,
        options.evaluateReactionPhaseC !== true,
        options.evaluateReactionPhaseC === true || options.evaluateReactionPhaseC == null
      );
  if (options.publishRuntime !== false) {
    refreshRuntimeChannels(state, trackedExecutionPois);
  }

  return {
    nextState: state,
    events,
  };
}

export function applyChannelCrossSourcePhase(
  prevState: ChannelRuntimeState,
  bar: Bar,
  trackedExecutionPois: Map<string, ChannelPoi> = new Map()
): { nextState: ChannelRuntimeState; events: string[] } {
  if (!isChannelReactionTf(bar.tf)) {
    return {
      nextState: prevState,
      events: [],
    };
  }

  return applyChannelBarClose(prevState, bar, trackedExecutionPois, {
    publishRuntime: false,
    evaluateReactionPhaseC: true,
  });
}

export function createChannelIndicatorEngine(
  symbol: string = "UNKNOWN"
): ChannelIndicatorEngine {
  let state = createEmptyChannelRuntimeState(symbol);
  const trackedExecutionPois = new Map<string, ChannelPoi>();

  return {
    onBarClose(bar: Bar): string[] {
      const result = applyChannelBarClose(state, bar, trackedExecutionPois);
      state = result.nextState;
      return result.events;
    },
    onBarClosePhaseA(bar: Bar): string[] {
      const result = applyChannelBarClose(state, bar, trackedExecutionPois, {
        publishRuntime: false,
        evaluateReactionPhaseC: false,
      });
      state = result.nextState;
      return result.events;
    },
    onBarClosePhaseC(bar: Bar): string[] {
      const result = applyChannelCrossSourcePhase(
        state,
        bar,
        trackedExecutionPois
      );
      state = result.nextState;
      return result.events;
    },
    publishRuntimeSnapshot(): void {
      refreshRuntimeChannels(state, trackedExecutionPois);
    },
  };
}

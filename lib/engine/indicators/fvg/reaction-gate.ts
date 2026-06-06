import {
  COOLDOWN_AFTER_15M_REACTION_MIN,
  COOLDOWN_AFTER_5M_ENTRY_MIN,
} from "./constants";
import type {
  Dir,
  ReactionGate,
  ReactionGateEvalResult,
} from "./types";

const MINUTE_MS = 60 * 1000;

export function buildReactionGateKey(
  symbol: string,
  poiId: string,
  dir: Dir
): string {
  return `${symbol.toUpperCase()}:${poiId}:${dir}`;
}

export function createReactionGate(
  symbol: string,
  poiId: string,
  dir: Dir
): ReactionGate {
  return {
    key: buildReactionGateKey(symbol, poiId, dir),
  };
}

export function getBlock5mUntilFrom15mReaction(
  reactionTime: number
): number {
  return reactionTime + COOLDOWN_AFTER_15M_REACTION_MIN * MINUTE_MS;
}

export function getBlockAllUntilFrom5mEntry(
  entryTime: number
): number {
  return entryTime + COOLDOWN_AFTER_5M_ENTRY_MIN * MINUTE_MS;
}

export function apply15mReactionToGate(
  gate: ReactionGate,
  reactionTime: number
): ReactionGate {
  const nextBlock = getBlock5mUntilFrom15mReaction(reactionTime);

  return {
    ...gate,
    last15mReactionAt: reactionTime,
    block5mUntil: Math.max(gate.block5mUntil ?? 0, nextBlock),
  };
}

export function apply5mEntryToGate(
  gate: ReactionGate,
  entryTime: number
): ReactionGate {
  const nextBlock = getBlockAllUntilFrom5mEntry(entryTime);

  return {
    ...gate,
    last5mEntryAt: entryTime,
    blockAllUntil: Math.max(gate.blockAllUntil ?? 0, nextBlock),
  };
}

export function evaluateReactionGate(
  gate: ReactionGate,
  tf: "M15" | "M5",
  currentCloseTime: number
): ReactionGateEvalResult {
  const blockedAll =
    Number.isFinite(gate.blockAllUntil) &&
    currentCloseTime < (gate.blockAllUntil as number);

  const blockedBy5mCooldown =
    tf === "M5" &&
    Number.isFinite(gate.block5mUntil) &&
    currentCloseTime < (gate.block5mUntil as number);

  const blocked = blockedAll || blockedBy5mCooldown;

  return {
    tf,
    currentCloseTime,
    blockedAll,
    blockedBy5mCooldown,
    reactionBlocked: blocked,
    entryBlocked: blocked,
  };
}

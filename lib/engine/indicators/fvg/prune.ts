import { getPrunedIdsByOldest } from "../../pruning";
import {
  MAX_ACTIVE_D1,
  MAX_ACTIVE_H1_SETUP,
  MAX_ACTIVE_H4_POOL,
  MAX_ACTIVE_M30_SETUP,
} from "./constants";
import type { AnyFvgBox } from "./types";

export type FvgPruneBucket =
  | "D1_ACTIVE"
  | "H4_POOL"
  | "SETUP_H1_ACTIVE"
  | "SETUP_M30_ACTIVE";

export function getFvgPruneBucket(box: AnyFvgBox): FvgPruneBucket | null {
  if (box.type === "D1_POI_FVG") {
    return box.state === "ACTIVE" ? "D1_ACTIVE" : null;
  }

  if (box.type === "H4_CORE_FVG") {
    return box.state === "CANDIDATE" || box.state === "A_ACTIVE"
      ? "H4_POOL"
      : null;
  }

  if (box.type === "SETUP_FVG") {
    if (box.state !== "ACTIVE") return null;
    if (box.tf === "H1") return "SETUP_H1_ACTIVE";
    if (box.tf === "M30") return "SETUP_M30_ACTIVE";
    return null;
  }

  return null;
}

export function getFvgPruneLimit(bucket: FvgPruneBucket): number {
  if (bucket === "D1_ACTIVE") return MAX_ACTIVE_D1;
  if (bucket === "H4_POOL") return MAX_ACTIVE_H4_POOL;
  if (bucket === "SETUP_H1_ACTIVE") return MAX_ACTIVE_H1_SETUP;
  return MAX_ACTIVE_M30_SETUP;
}

export function buildFvgPruneIdSet(
  boxes: readonly AnyFvgBox[]
): Set<string> {
  const buckets = new Map<FvgPruneBucket, AnyFvgBox[]>();

  for (const box of boxes) {
    const bucket = getFvgPruneBucket(box);
    if (!bucket) continue;

    const arr = buckets.get(bucket) ?? [];
    arr.push(box);
    buckets.set(bucket, arr);
  }

  const prunedIds = new Set<string>();

  for (const [bucket, items] of buckets.entries()) {
    const ids = getPrunedIdsByOldest(items, getFvgPruneLimit(bucket));
    for (const id of ids) {
      prunedIds.add(id);
    }
  }

  return prunedIds;
}

export function applyFvgPrune(
  boxes: readonly AnyFvgBox[],
  currentCloseTime: number
): AnyFvgBox[] {
  const prunedIds = buildFvgPruneIdSet(boxes);

  return boxes.map((box) => {
    if (!prunedIds.has(box.id)) {
      return box;
    }

    if (box.type === "STACK_ZONE") {
      return box;
    }

    return {
      ...box,
      state: "INACTIVE",
      invalidReason: "pruned_by_limit",
      endTime: currentCloseTime,
    } as AnyFvgBox;
  });
}

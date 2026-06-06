import { getPrunedIdsByOldest } from "../../pruning";
import {
  MAX_ACTIVE_D1_POI_OB,
  MAX_ACTIVE_H1_SETUP_OB,
  MAX_ACTIVE_H4_OB_POOL,
  MAX_ACTIVE_M30_SETUP_OB,
} from "./constants";
import type { AnyObBox } from "./types";

export type ObPruneBucket =
  | "D1_ACTIVE"
  | "H4_POOL"
  | "SETUP_H1_ACTIVE"
  | "SETUP_M30_ACTIVE";

type ObPrunableBox = AnyObBox & { confTime: number };

export function getObPruneBucket(box: AnyObBox): ObPruneBucket | null {
  if (box.type === "D1_POI_OB") {
    return box.state === "ACTIVE" ? "D1_ACTIVE" : null;
  }

  if (box.type === "H4_CORE_OB") {
    return box.state === "CANDIDATE" || box.state === "POI_ACTIVE"
      ? "H4_POOL"
      : null;
  }

  if (box.type === "SETUP_OB") {
    if (box.state !== "ACTIVE") {
      return null;
    }

    return box.tf === "H1" ? "SETUP_H1_ACTIVE" : "SETUP_M30_ACTIVE";
  }

  return null;
}

export function getObPruneLimit(bucket: ObPruneBucket): number {
  if (bucket === "D1_ACTIVE") {
    return MAX_ACTIVE_D1_POI_OB;
  }

  if (bucket === "H4_POOL") {
    return MAX_ACTIVE_H4_OB_POOL;
  }

  if (bucket === "SETUP_H1_ACTIVE") {
    return MAX_ACTIVE_H1_SETUP_OB;
  }

  return MAX_ACTIVE_M30_SETUP_OB;
}

function toPrunableBox(box: AnyObBox): ObPrunableBox {
  return {
    ...box,
    confTime: box.confirmDueTime ?? box.triggerTime,
  };
}

export function buildObPruneIdSet(boxes: readonly AnyObBox[]): Set<string> {
  const buckets = new Map<ObPruneBucket, ObPrunableBox[]>();

  for (const box of boxes) {
    const bucket = getObPruneBucket(box);
    if (!bucket) {
      continue;
    }

    const current = buckets.get(bucket) ?? [];
    current.push(toPrunableBox(box));
    buckets.set(bucket, current);
  }

  const prunedIds = new Set<string>();

  for (const [bucket, items] of buckets.entries()) {
    for (const id of getPrunedIdsByOldest(items, getObPruneLimit(bucket))) {
      prunedIds.add(id);
    }
  }

  return prunedIds;
}

export function applyObPrune(
  boxes: readonly AnyObBox[],
  currentCloseTime: number
): AnyObBox[] {
  const prunedIds = buildObPruneIdSet(boxes);

  return boxes.map((box) => {
    if (!prunedIds.has(box.id)) {
      return box;
    }

    return {
      ...box,
      state: "INACTIVE",
      invalidReason: "pruned_by_limit",
      endTime: currentCloseTime,
    } as AnyObBox;
  });
}

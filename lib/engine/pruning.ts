import { compareLexicographic } from "./tags";

export type PrunableActiveItem = {
  id: string;
  confTime: number;
};

export function countPruneOverflow(
  activeCount: number,
  limit: number
): number {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`invalid prune limit: ${limit}`);
  }

  return Math.max(0, activeCount - limit);
}

export function compareByOldestConfTime(
  a: PrunableActiveItem,
  b: PrunableActiveItem
): number {
  if (a.confTime !== b.confTime) {
    return a.confTime - b.confTime;
  }

  return compareLexicographic(a.id, b.id);
}

export function getPrunedIdsByOldest<T extends PrunableActiveItem>(
  activeItems: readonly T[],
  limit: number
): string[] {
  const overflow = countPruneOverflow(activeItems.length, limit);
  if (overflow === 0) return [];

  return [...activeItems]
    .sort(compareByOldestConfTime)
    .slice(0, overflow)
    .map((item) => item.id);
}

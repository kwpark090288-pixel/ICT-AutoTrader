import type { Trendline } from "./types";

function getTrendlineMaxActivePerType(tf: Trendline["tf"]): number {
  return tf === "H1" || tf === "M30" ? 2 : 1;
}

export function applyTrendlinePruneByType(args: {
  lines: readonly Trendline[];
  currentCloseTime: number;
}): {
  active: Trendline[];
  pruned: Trendline[];
} {
  const { lines, currentCloseTime } = args;
  const byType = new Map<Trendline["type"], Trendline[]>();

  for (const line of lines) {
    const bucket = byType.get(line.type) ?? [];
    bucket.push(line);
    byType.set(line.type, bucket);
  }

  const active: Trendline[] = [];
  const pruned: Trendline[] = [];

  for (const bucket of byType.values()) {
    const limit = getTrendlineMaxActivePerType(bucket[0].tf);
    const sorted = [...bucket].sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }

      return a.id.localeCompare(b.id);
    });

    const overflow = Math.max(0, sorted.length - limit);

    for (let i = 0; i < sorted.length; i += 1) {
      const line = sorted[i];

      if (i < overflow) {
        pruned.push({
          ...line,
          state: "INACTIVE",
          invalidReason: "pruned_by_limit",
          endTime: currentCloseTime,
        });
      } else {
        active.push(line);
      }
    }
  }

  return { active, pruned };
}

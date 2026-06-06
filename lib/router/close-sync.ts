import type { Bar, TF } from "../engine/types";

const ROUTER_CLOSE_SYNC_TF_ORDER: Record<TF, number> = {
  D1: 0,
  H4: 1,
  H1: 2,
  M30: 3,
  M15: 4,
  M5: 5,
};

export interface RouterCandidateEvaluationItem {
  symbol: string;
  bar: Bar;
  rawEvents: readonly string[];
}

type PendingRouterCloseSyncBatch = Map<TF, RouterCandidateEvaluationItem>;

const pendingRouterCloseSyncBatches = new Map<string, PendingRouterCloseSyncBatch>();

export function buildRouterCloseSyncKey(symbol: string, closeTime: number): string {
  return `${symbol.toUpperCase()}|${closeTime}`;
}

export function compareRouterCandidateEvaluationItems(
  a: RouterCandidateEvaluationItem,
  b: RouterCandidateEvaluationItem
): number {
  if (a.symbol !== b.symbol) {
    return a.symbol.localeCompare(b.symbol);
  }

  if (a.bar.closeTime !== b.bar.closeTime) {
    return a.bar.closeTime - b.bar.closeTime;
  }

  return ROUTER_CLOSE_SYNC_TF_ORDER[a.bar.tf] - ROUTER_CLOSE_SYNC_TF_ORDER[b.bar.tf];
}

function getOrCreatePendingBatch(
  symbol: string,
  closeTime: number
): PendingRouterCloseSyncBatch {
  const key = buildRouterCloseSyncKey(symbol, closeTime);
  const existing = pendingRouterCloseSyncBatches.get(key);
  if (existing) {
    return existing;
  }

  const created = new Map<TF, RouterCandidateEvaluationItem>();
  pendingRouterCloseSyncBatches.set(key, created);
  return created;
}

function popPendingBatch(
  symbol: string,
  closeTime: number
): PendingRouterCloseSyncBatch | null {
  const key = buildRouterCloseSyncKey(symbol, closeTime);
  const existing = pendingRouterCloseSyncBatches.get(key) ?? null;
  if (existing) {
    pendingRouterCloseSyncBatches.delete(key);
  }
  return existing;
}

export function clearRouterCloseSyncBatches(symbol?: string): void {
  if (!symbol) {
    pendingRouterCloseSyncBatches.clear();
    return;
  }

  const normalized = symbol.toUpperCase();
  for (const key of [...pendingRouterCloseSyncBatches.keys()]) {
    if (key.startsWith(`${normalized}|`)) {
      pendingRouterCloseSyncBatches.delete(key);
    }
  }
}

export function listPendingRouterCandidateEvaluationItems(
  symbol?: string,
  closeTime?: number
): RouterCandidateEvaluationItem[] {
  const normalizedSymbol = symbol?.toUpperCase();
  const out: RouterCandidateEvaluationItem[] = [];

  for (const [key, batch] of pendingRouterCloseSyncBatches.entries()) {
    const [batchSymbol, batchCloseTimeRaw] = key.split("|");
    const batchCloseTime = Number(batchCloseTimeRaw);

    if (normalizedSymbol && batchSymbol !== normalizedSymbol) {
      continue;
    }

    if (Number.isFinite(closeTime) && batchCloseTime !== closeTime) {
      continue;
    }

    out.push(...batch.values());
  }

  return out.sort(compareRouterCandidateEvaluationItems);
}

export function bufferOrReleaseRouterCandidateEvaluationItem(
  item: RouterCandidateEvaluationItem,
  hasSameCloseTimeM5: boolean
): RouterCandidateEvaluationItem[] {
  if (item.bar.tf === "M5") {
    return releaseRouterCandidateEvaluationBatchForM5(item.symbol, item.bar, item.rawEvents);
  }

  if (!hasSameCloseTimeM5) {
    const pendingBatch = getOrCreatePendingBatch(item.symbol, item.bar.closeTime);
    pendingBatch.set(item.bar.tf, item);
    return [];
  }

  const pendingBatch = popPendingBatch(item.symbol, item.bar.closeTime);
  const released = [...(pendingBatch?.values() ?? []), item];
  return released.sort(compareRouterCandidateEvaluationItems);
}

export function releaseRouterCandidateEvaluationBatchForM5(
  symbol: string,
  m5Bar: Bar,
  m5RawEvents: readonly string[]
): RouterCandidateEvaluationItem[] {
  if (m5Bar.tf !== "M5") {
    throw new Error("releaseRouterCandidateEvaluationBatchForM5 requires an M5 bar");
  }

  const pendingBatch = popPendingBatch(symbol, m5Bar.closeTime);
  const released = [...(pendingBatch?.values() ?? [])];

  if (m5RawEvents.length > 0) {
    released.push({
      symbol: symbol.toUpperCase(),
      bar: m5Bar,
      rawEvents: m5RawEvents,
    });
  }

  return released.sort(compareRouterCandidateEvaluationItems);
}

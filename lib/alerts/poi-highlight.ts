import type {
  StoredSignalEvent,
  StoredSignalPoiHighlight,
} from "./types";

const poiHighlightRegistry = new Map<string, StoredSignalPoiHighlight>();

export function replaceAlertPoiHighlightRegistry(
  events: readonly StoredSignalEvent[]
): void {
  poiHighlightRegistry.clear();

  for (const event of events) {
    if (
      typeof event.poiRef !== "string" ||
      event.poiRef.length === 0 ||
      !event.poiHighlight
    ) {
      continue;
    }

    poiHighlightRegistry.set(event.poiRef, event.poiHighlight);
  }
}

export function getAlertPoiHighlight(
  poiRef: string
): StoredSignalPoiHighlight | null {
  return poiHighlightRegistry.get(poiRef) ?? null;
}

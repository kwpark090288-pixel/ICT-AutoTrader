import type { StoredSignalEvent } from "../alerts/types";

type AppendSignalEventsArgs = {
  symbol: string;
  tf: string;
  eventTexts: string[];
};

type ListStoredSignalEventsFromDbArgs = {
  symbol?: string;
  excludeSymbol?: string;
  planId?: string;
  take?: number;
};

const STRUCTURED_SIGNAL_EVENT_PREFIX = "[STORED_SIGNAL_EVENT] ";
let prismaUnavailable = false;
let prismaUnavailableLogged = false;

async function getPrisma() {
  if (prismaUnavailable) {
    return null;
  }

  try {
    const mod = await import("../db/prisma");
    return mod.prisma;
  } catch (error) {
    prismaUnavailable = true;

    if (!prismaUnavailableLogged) {
      prismaUnavailableLogged = true;
      console.error("[SIGNAL_SINK_PRISMA_UNAVAILABLE]", error);
    }

    return null;
  }
}

export async function appendSignalEvents(
  args: AppendSignalEventsArgs
): Promise<void> {
  const { symbol, tf, eventTexts } = args;

  if (!eventTexts.length) return;

  try {
    const prisma = await getPrisma();
    if (!prisma) {
      return;
    }
    await prisma.signalEvent.createMany({
      data: eventTexts.map((eventText) => ({
        symbol: symbol.toUpperCase(),
        tf,
        eventText,
      })),
    });
  } catch (error) {
    console.error("[SIGNAL_SINK_ERROR]", error);
  }
}

export function serializeStoredSignalEvent(
  event: StoredSignalEvent
): string {
  return `${STRUCTURED_SIGNAL_EVENT_PREFIX}${JSON.stringify(event)}`;
}

export function parseStoredSignalEvent(
  eventText: string
): StoredSignalEvent | null {
  if (!eventText.startsWith(STRUCTURED_SIGNAL_EVENT_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      eventText.slice(STRUCTURED_SIGNAL_EVENT_PREFIX.length)
    ) as StoredSignalEvent;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.id !== "string" ||
      typeof parsed.symbol !== "string" ||
      typeof parsed.tf !== "string" ||
      typeof parsed.time !== "string" ||
      (parsed.type !== "SEND_OPEN" && parsed.type !== "SEND_CLOSE")
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function appendStoredSignalEventToDb(
  event: StoredSignalEvent
): Promise<void> {
  try {
    const prisma = await getPrisma();
    if (!prisma) {
      return;
    }
    await prisma.signalEvent.create({
      data: {
        symbol: event.symbol.toUpperCase(),
        tf: event.tf,
        eventText: serializeStoredSignalEvent(event),
      },
    });
  } catch (error) {
    console.error("[STRUCTURED_SIGNAL_SINK_ERROR]", error);
  }
}

export async function listStoredSignalEventsFromDb(
  args: ListStoredSignalEventsFromDbArgs = {}
): Promise<StoredSignalEvent[]> {
  const { symbol, excludeSymbol, planId, take = 200 } = args;
  const normalizedSymbol = symbol?.toUpperCase();
  const normalizedExcludeSymbol = excludeSymbol?.toUpperCase();

  try {
    const prisma = await getPrisma();
    if (!prisma) {
      return [];
    }
    const rows = await prisma.signalEvent.findMany({
      where: {
        ...(normalizedSymbol
          ? { symbol: normalizedSymbol }
          : normalizedExcludeSymbol
            ? { symbol: { not: normalizedExcludeSymbol } }
            : {}),
        ...(planId
          ? { eventText: { contains: `"planId":"${planId}"` } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return rows
      .map((row) => parseStoredSignalEvent(row.eventText))
      .filter((event): event is StoredSignalEvent => {
        if (event === null) {
          return false;
        }

        if (planId && event.planId !== planId) {
          return false;
        }

        return true;
      });
  } catch (error) {
    console.error("[STRUCTURED_SIGNAL_LIST_ERROR]", error);
    return [];
  }
}

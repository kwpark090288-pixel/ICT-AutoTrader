import { prisma } from "../db/prisma";

type AppendSignalEventsArgs = {
  symbol: string;
  tf: string;
  eventTexts: string[];
};

export async function appendSignalEvents(
  args: AppendSignalEventsArgs
): Promise<void> {
  const { symbol, tf, eventTexts } = args;

  if (!eventTexts.length) return;

  try {
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

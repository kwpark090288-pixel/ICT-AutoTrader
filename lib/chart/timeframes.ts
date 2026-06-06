export const CHART_TIMEFRAMES = [
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1D",
] as const;

export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];

export function isChartTimeframe(value: string): value is ChartTimeframe {
  return (CHART_TIMEFRAMES as readonly string[]).includes(value);
}

export function normalizeChartTimeframe(
  value: string | null | undefined,
  fallback: ChartTimeframe = "15m"
): ChartTimeframe {
  if (!value) {
    return fallback;
  }

  if (value === "1d") {
    return "1D";
  }

  return isChartTimeframe(value) ? value : fallback;
}

export function toBinanceInterval(tf: ChartTimeframe): string {
  switch (tf) {
    case "3m":
      return "3m";
    case "5m":
      return "5m";
    case "15m":
      return "15m";
    case "30m":
      return "30m";
    case "1h":
      return "1h";
    case "2h":
      return "2h";
    case "4h":
      return "4h";
    case "1D":
      return "1d";
  }
}

export function fromBinanceInterval(interval: string): ChartTimeframe | null {
  switch (interval) {
    case "3m":
      return "3m";
    case "5m":
      return "5m";
    case "15m":
      return "15m";
    case "30m":
      return "30m";
    case "1h":
      return "1h";
    case "2h":
      return "2h";
    case "4h":
      return "4h";
    case "1d":
      return "1D";
    default:
      return null;
  }
}

export function tfToSeconds(tf: ChartTimeframe): number {
  switch (tf) {
    case "3m":
      return 3 * 60;
    case "5m":
      return 5 * 60;
    case "15m":
      return 15 * 60;
    case "30m":
      return 30 * 60;
    case "1h":
      return 60 * 60;
    case "2h":
      return 2 * 60 * 60;
    case "4h":
      return 4 * 60 * 60;
    case "1D":
      return 24 * 60 * 60;
  }
}

export type TF = "D1" | "H4" | "H1" | "M30" | "M15" | "M5";
export type DIR = "BULL" | "BEAR";
export type BoxType = "D1_POI_FVG" | "H4_CORE_FVG" | "SETUP_FVG" | "STACK_ZONE";

export function buildBoxId(args: {
  symbol: string;
  type: BoxType;
  tf: TF;
  confTime: number;
  dir: DIR;
  bottomTick: number;
  topTick: number;
}): string {
  const { symbol, type, tf, confTime, dir, bottomTick, topTick } = args;
  return `${symbol}:${type}:${tf}:${confTime}:${dir}:${bottomTick}:${topTick}`;
}

export function buildStackId(args: { symbol: string; aId: string; bId: string }): string {
  const { symbol, aId, bId } = args;
  return `${symbol}:STACK:${aId}:${bId}`;
}


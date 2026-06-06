import type { TF, DIR, BoxType } from "./types";

type IdBoxType =
  | BoxType
  | "D1_POI_OB"
  | "H4_CORE_OB"
  | "SETUP_OB"
  | "OB_COLLAB_TAG";

export function buildBoxId(args: {
  symbol: string;
  type: IdBoxType;
  tf: TF;
  confTime: number; // ms epoch
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

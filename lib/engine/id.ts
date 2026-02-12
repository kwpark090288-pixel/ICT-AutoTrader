import type { TF, DIR, BoxType } from "./types";

export function buildBoxId(args: {
  symbol: string;
  type: BoxType;
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

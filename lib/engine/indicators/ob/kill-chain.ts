import type { SetupOb, StructureState } from "./types";

export function getObSetupInvalidatedDirFromH4OppositeChoch(
  breakType: "BOS" | "CHOCH" | null,
  nextState: StructureState
): "BULL" | "BEAR" | null {
  if (breakType !== "CHOCH") {
    return null;
  }

  if (nextState === "DOWN") {
    return "BULL";
  }

  if (nextState === "UP") {
    return "BEAR";
  }

  return null;
}

type ApplySetupObH4OppositeChochKillChainArgs = {
  setup: SetupOb;
  invalidatedDir: "BULL" | "BEAR" | null;
  currentCloseTime: number;
};

export function applySetupObH4OppositeChochKillChain(
  args: ApplySetupObH4OppositeChochKillChainArgs
): SetupOb {
  const { setup, invalidatedDir, currentCloseTime } = args;

  if (setup.state !== "ACTIVE") {
    return setup;
  }

  if (!invalidatedDir || setup.dir !== invalidatedDir) {
    return setup;
  }

  return {
    ...setup,
    state: "INACTIVE",
    invalidReason: "opposite_choch",
    endTime: currentCloseTime,
  };
}

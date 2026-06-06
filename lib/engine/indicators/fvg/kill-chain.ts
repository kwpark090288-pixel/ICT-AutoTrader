import { computeInsideOverlapRatio } from "./setup";
import type { H4CoreFvg, SetupFvg } from "./types";

function isKilledH4CoreFvgAtCloseTime(
  h4: H4CoreFvg,
  currentCloseTime: number
): boolean {
  return Boolean(
    h4.invalidReason === "opposite_choch" &&
      h4.endTime === currentCloseTime &&
      (h4.state === "INACTIVE" || h4.state === "DELETED")
  );
}

export function listKilledH4CoreFvgsAtCloseTime(
  h4CoreFvgs: readonly H4CoreFvg[],
  currentCloseTime: number
): H4CoreFvg[] {
  return h4CoreFvgs.filter((h4) =>
    isKilledH4CoreFvgAtCloseTime(h4, currentCloseTime)
  );
}

export function shouldKillSetupFvgByKilledH4(
  setup: SetupFvg,
  killedH4CoreFvgs: readonly H4CoreFvg[]
): boolean {
  if (setup.state !== "ACTIVE") {
    return false;
  }

  if (setup.parentPoiType === "H4_CORE_FVG") {
    return killedH4CoreFvgs.some((h4) => h4.id === setup.parentPoiId);
  }

  return killedH4CoreFvgs.some(
    (h4) =>
      h4.dir === setup.dir &&
      computeInsideOverlapRatio(setup.zone, h4.zone) >= 0.2
  );
}

type ApplySetupFvgOppositeChochKillChainArgs = {
  setup: SetupFvg;
  killedH4CoreFvgs: readonly H4CoreFvg[];
  currentCloseTime: number;
};

export function applySetupFvgOppositeChochKillChain(
  args: ApplySetupFvgOppositeChochKillChainArgs
): SetupFvg {
  const { setup, killedH4CoreFvgs, currentCloseTime } = args;

  if (!shouldKillSetupFvgByKilledH4(setup, killedH4CoreFvgs)) {
    return setup;
  }

  return {
    ...setup,
    state: "INACTIVE",
    invalidReason: "opposite_choch",
    endTime: currentCloseTime,
  };
}

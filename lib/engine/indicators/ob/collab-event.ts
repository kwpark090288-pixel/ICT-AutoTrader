import type { AnyObBox, ObCollabBestMatch } from "./types";

type ObFvgCollabComparable = {
  targetId: string;
  ratioText: string;
  displayTag: "INSIDE_0.20" | "OVERLAP_0.30";
};

function formatIsoUtcSecond(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function formatRatio2(value: number): string {
  return value.toFixed(2);
}

export function getObFvgCollabDisplayTag(
  tag: string
): "INSIDE_0.20" | "OVERLAP_0.30" | null {
  if (tag === "COLLAB_FVG_INSIDE_0.20") {
    return "INSIDE_0.20";
  }

  if (tag === "COLLAB_FVG_OVERLAP_0.30") {
    return "OVERLAP_0.30";
  }

  return null;
}

function getComparableObFvgCollab(
  bestCollab?: ObCollabBestMatch
): ObFvgCollabComparable | null {
  if (!bestCollab) {
    return null;
  }

  if (bestCollab.kind !== "OB∩FVG") {
    return null;
  }

  const displayTag = getObFvgCollabDisplayTag(bestCollab.tag);
  if (!displayTag) {
    return null;
  }

  return {
    targetId: bestCollab.targetId,
    ratioText: formatRatio2(bestCollab.ratioOrDist),
    displayTag,
  };
}

export function formatObFvgCollabEvent(
  time: number,
  ob: AnyObBox,
  bestCollab?: ObCollabBestMatch
): string | null {
  const comparable = getComparableObFvgCollab(bestCollab);
  if (!comparable) {
    return null;
  }

  return `[COLLAB][OB∩FVG] time=${formatIsoUtcSecond(time)} ob=${ob.id} fvg=${comparable.targetId} ratio=${comparable.ratioText} tag=${comparable.displayTag}`;
}

export function shouldEmitObFvgCollabEvent(
  prevBestCollab?: ObCollabBestMatch,
  nextBestCollab?: ObCollabBestMatch
): boolean {
  const prevComparable = getComparableObFvgCollab(prevBestCollab);
  const nextComparable = getComparableObFvgCollab(nextBestCollab);

  if (!nextComparable) {
    return false;
  }

  if (!prevComparable) {
    return true;
  }

  return !(
    prevComparable.targetId === nextComparable.targetId &&
    prevComparable.ratioText === nextComparable.ratioText &&
    prevComparable.displayTag === nextComparable.displayTag
  );
}

export function resolveObFvgCollabEvent(
  time: number,
  ob: AnyObBox,
  prevBestCollab?: ObCollabBestMatch,
  nextBestCollab?: ObCollabBestMatch
): string | null {
  if (!shouldEmitObFvgCollabEvent(prevBestCollab, nextBestCollab)) {
    return null;
  }

  return formatObFvgCollabEvent(time, ob, nextBestCollab);
}

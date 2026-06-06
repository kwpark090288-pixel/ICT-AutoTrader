import { isH1M30ChannelTf } from "./h1m30";
import type { ChannelModel } from "./types";

function formatIsoUtcSecond(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

export function formatChannelModeEvent(
  time: number,
  model: ChannelModel
): string | null {
  if (!isH1M30ChannelTf(model.tf)) {
    return null;
  }

  if (model.state !== "ACTIVE") {
    return null;
  }

  return `[CHANNEL][MODE][${model.tf}] time=${formatIsoUtcSecond(time)} mode=${model.mode}`;
}

export function shouldEmitChannelModeEvent(
  prevModel?: ChannelModel | null,
  nextModel?: ChannelModel | null
): boolean {
  if (!prevModel || !nextModel) {
    return false;
  }

  if (!isH1M30ChannelTf(nextModel.tf)) {
    return false;
  }

  if (nextModel.state !== "ACTIVE") {
    return false;
  }

  if (prevModel.tf !== nextModel.tf) {
    return false;
  }

  return prevModel.mode !== nextModel.mode;
}

export function resolveChannelModeEvent(
  time: number,
  prevModel?: ChannelModel | null,
  nextModel?: ChannelModel | null
): string | null {
  if (!shouldEmitChannelModeEvent(prevModel, nextModel)) {
    return null;
  }

  return formatChannelModeEvent(time, nextModel as ChannelModel);
}

import { ALERT_BACKEND_STATES } from "./constants";
import type {
  AlertBackendState,
  OtherInboxStatusView,
  SelectedFeedStatusView,
  WatchlistStatusItem,
} from "./types";

function getLastUpdateLabel(lastUpdateTime?: string | null): string {
  return typeof lastUpdateTime === "string" && lastUpdateTime.length > 0
    ? lastUpdateTime
    : "알 수 없음";
}

export function isAlertBackendState(
  value: string
): value is AlertBackendState {
  return (ALERT_BACKEND_STATES as readonly string[]).includes(value);
}

export function formatWatchlistStatusToken(
  item: WatchlistStatusItem
): string {
  if (item.state === "LIVE") {
    return `${item.symbol} ✅`;
  }

  if (item.state === "SYNCING") {
    return `${item.symbol} ⏳(SYNCING)`;
  }

  return `${item.symbol} ❌(ERROR)`;
}

export function buildWatchlistStatusLine(
  items: readonly WatchlistStatusItem[]
): string {
  if (items.length === 0) {
    return "Watch: -";
  }

  return `Watch: ${items.map(formatWatchlistStatusToken).join(" ")}`;
}

export function buildSelectedFeedStatusView(args: {
  selectedSymbol: string;
  eventCount: number;
  backendState: AlertBackendState;
  lastUpdateTime?: string | null;
}): SelectedFeedStatusView {
  const { selectedSymbol, eventCount, backendState, lastUpdateTime } = args;

  if (backendState === "ERROR") {
    return {
      state: "ERROR",
      message: `서버 연결 실패. 마지막 업데이트: ${getLastUpdateLabel(lastUpdateTime)}`,
      showRetry: true,
      lastUpdateTime: lastUpdateTime ?? null,
    };
  }

  if (backendState === "SYNCING") {
    return {
      state: "SYNCING",
      message: "동기화 중… 알림 생성이 일시 중지됩니다.",
      showRetry: false,
      lastUpdateTime: lastUpdateTime ?? null,
    };
  }

  if (eventCount === 0) {
    return {
      state: "EMPTY",
      message: `아직 알림이 없습니다. (선택한 심볼: ${selectedSymbol})`,
      showRetry: false,
      lastUpdateTime: lastUpdateTime ?? null,
    };
  }

  return {
    state: "READY",
    message: null,
    showRetry: false,
    lastUpdateTime: lastUpdateTime ?? null,
  };
}

export function buildOtherInboxStatusView(args: {
  selectedSymbol: string;
  eventCount: number;
  backendState: AlertBackendState;
  lastUpdateTime?: string | null;
  watchlist: WatchlistStatusItem[];
}): OtherInboxStatusView {
  const {
    selectedSymbol,
    eventCount,
    backendState,
    lastUpdateTime,
    watchlist,
  } = args;

  const watchlistLine = buildWatchlistStatusLine(watchlist);

  if (backendState === "ERROR") {
    return {
      state: "ERROR",
      message: `서버 연결 실패. 마지막 업데이트: ${getLastUpdateLabel(lastUpdateTime)}`,
      showRetry: true,
      lastUpdateTime: lastUpdateTime ?? null,
      watchlistLine,
    };
  }

  if (eventCount === 0) {
    return {
      state: "EMPTY",
      message: `현재 ${selectedSymbol} 외 다른 심볼 알림이 없습니다.`,
      showRetry: false,
      lastUpdateTime: lastUpdateTime ?? null,
      watchlistLine,
    };
  }

  return {
    state: "READY",
    message: null,
    showRetry: false,
    lastUpdateTime: lastUpdateTime ?? null,
    watchlistLine,
  };
}

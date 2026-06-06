"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildSelectedFeedCard } from "@/lib/alerts/cards";
import { shouldPlayHighOtherSymbolSound } from "@/lib/alerts/sound";
import {
  buildAlertCardNavigationPlan,
  buildOpenLinkPlan,
} from "@/lib/alerts/navigation";
import { replaceAlertPoiHighlightRegistry } from "@/lib/alerts/poi-highlight";
import { whenChartControllerReady } from "@/lib/alerts/chart-controller";
import {
  buildOtherInboxStatusView,
  buildSelectedFeedStatusView,
} from "@/lib/alerts/status";
import type {
  AlertEventTypeFilter,
  AlertSeenTab,
  AlertSeverityFilter,
  MuteQueryResult,
  SelectedFeedCard,
  SignalFeedItem,
  SignalsQueryResult,
  StoredSignalEventWithSeen,
} from "@/lib/alerts/types";
import {
  CHART_TIMEFRAMES,
  normalizeChartTimeframe,
  type ChartTimeframe,
} from "@/lib/chart/timeframes";
import CandleChart from "./components/CandleChart";
import WhyNoOpenPanel from "./components/WhyNoOpenPanel";

type ReviewNoteApiResponse = {
  planId: string;
  reviewNoteText: string;
  reviewNoteUpdatedAtUtc: string | null;
};

type SoundPreferenceResponse = {
  profileId: string;
  enabled: boolean;
  updatedAtUtc: string | null;
};

type SoundPlayedResponse = {
  profileId: string;
  eventId: string;
  played: boolean;
  playedAtUtc: string | null;
};

const WATCHLIST_SYMBOLS = String(
  process.env.NEXT_PUBLIC_WATCHLIST ?? "BTCUSDT,ETHUSDT,SOLUSDT"
)
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const SELECTED_FEED_LIMIT = 10;
const OTHER_INBOX_LIMIT = 20;
const REFRESH_INTERVAL_MS = 5000;

async function playHighOtherSymbolTone(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("AudioContext unavailable");
  }

  const audioContext = new AudioContextCtor();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const now = audioContext.currentTime;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  gain.connect(audioContext.destination);

  const osc1 = audioContext.createOscillator();
  osc1.type = "triangle";
  osc1.frequency.setValueAtTime(880, now);
  osc1.connect(gain);
  osc1.start(now);
  osc1.stop(now + 0.12);

  const osc2 = audioContext.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(1320, now + 0.14);
  osc2.connect(gain);
  osc2.start(now + 0.14);
  osc2.stop(now + 0.28);

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 320);
  });

  window.setTimeout(() => {
    void audioContext.close();
  }, 0);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function formatChartTimeframeLabel(tf: ChartTimeframe): string {
  switch (tf) {
    case "1h":
      return "1H";
    case "2h":
      return "2H";
    case "4h":
      return "4H";
    case "1D":
      return "1D";
    default:
      return tf;
  }
}

function formatIsoLabel(value?: string | null): string {
  if (!value) {
    return "-";
  }

  return value.replace("T", " ").replace("Z", " UTC");
}

function formatPrice(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(4);
}

function formatR(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(2)}R`;
}

function formatSignedNumber(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function renderSelectedFeedCardBody(card: SelectedFeedCard) {
  if (card.kind === "OPEN") {
    return (
      <>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-200">
            {card.direction}
          </span>
          <span className="rounded bg-zinc-800 px-2 py-1 text-zinc-200">
            {card.trafficLight}
          </span>
          {card.policyState ? (
            <span className="rounded bg-zinc-800 px-2 py-1 text-zinc-300">
              {card.policyState}
            </span>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
          <div>Entry: {formatPrice(card.entryRefPrice)}</div>
          <div>Stop: {formatPrice(card.stopPrice)}</div>
          <div>TP: {formatPrice(card.tpPrice)}</div>
          <div>RR: {card.rrChosen.toFixed(2)}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-200">
          {card.outcome}
        </span>
        {typeof card.bothHit === "boolean" ? (
          <span className="rounded bg-zinc-800 px-2 py-1 text-zinc-300">
            bothHit {String(card.bothHit)}
          </span>
        ) : null}
        {card.hasReviewNoteBadge ? (
          <span className="rounded bg-sky-500/10 px-2 py-1 text-sky-200">
            메모 있음
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
        <div>Exit: {formatPrice(card.exitPrice)}</div>
        <div>R: {formatSignedNumber(card.rGross)}</div>
        <div>MFE: {formatR(card.mfeR)}</div>
        <div>MAE: {formatR(card.maeR)}</div>
      </div>

      {(card.weaknessPreview.length > 0 || card.weaknessMoreCount > 0) && (
        <div className="mt-3 text-xs text-zinc-400">
          Weakness: {card.weaknessPreview.length > 0 ? card.weaknessPreview.join(", ") : "-"}
          {card.weaknessMoreCount > 0 ? ` +${card.weaknessMoreCount} more` : ""}
        </div>
      )}

      {card.replayNote ? (
        <div className="mt-2 text-sm text-zinc-300">{card.replayNote}</div>
      ) : null}
    </>
  );
}

export default function Page() {
  const [selectedTf, setSelectedTf] = useState<ChartTimeframe>("4h");
  const [symbol, setSymbol] = useState(WATCHLIST_SYMBOLS[0] ?? "BTCUSDT");
  const [selectedEventType, setSelectedEventType] = useState<AlertEventTypeFilter>("ALL");
  const [otherTab, setOtherTab] = useState<AlertSeenTab>("Unread");
  const [otherEventType, setOtherEventType] = useState<AlertEventTypeFilter>("ALL");
  const [otherSeverity, setOtherSeverity] = useState<AlertSeverityFilter>("ALL");
  const [autoTfSwitch, setAutoTfSwitch] = useState(true);
  const [selectedResult, setSelectedResult] = useState<SignalsQueryResult | null>(null);
  const [otherResult, setOtherResult] = useState<SignalsQueryResult | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(true);
  const [otherLoading, setOtherLoading] = useState(true);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [otherError, setOtherError] = useState<string | null>(null);
  const [reviewNotesByPlanId, setReviewNotesByPlanId] = useState<Record<string, string>>({});
  const [muteResult, setMuteResult] = useState<MuteQueryResult>({ items: [] });
  const [soundPreference, setSoundPreference] = useState<SoundPreferenceResponse | null>(null);
  const [soundFeedEvents, setSoundFeedEvents] = useState<StoredSignalEventWithSeen[]>([]);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [pinnedSelectedEvent, setPinnedSelectedEvent] =
    useState<StoredSignalEventWithSeen | null>(null);
  const [pendingOpenLinkTarget, setPendingOpenLinkTarget] = useState<{
    eventId: string;
    durationMs: number;
  } | null>(null);
  useEffect(() => {
    if (WATCHLIST_SYMBOLS.length === 0) {
      return;
    }

    if (!WATCHLIST_SYMBOLS.includes(symbol)) {
      setSymbol(WATCHLIST_SYMBOLS[0]);
    }
  }, [symbol]);

  const splitWrapRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const [leftW, setLeftW] = useState(920);
  const soundEvalInFlightRef = useRef(false);

  const refreshSelectedFeed = useCallback(async () => {
    const params = new URLSearchParams({ symbol, limit: String(SELECTED_FEED_LIMIT), eventType: selectedEventType });
    const data = await fetchJson<SignalsQueryResult>(`/api/signals?${params}`);
    setSelectedResult(data);
    setSelectedError(null);
  }, [selectedEventType, symbol]);

  const refreshOtherInbox = useCallback(async () => {
    const params = new URLSearchParams({ excludeSymbol: symbol, limit: String(OTHER_INBOX_LIMIT), tab: otherTab, eventType: otherEventType, severity: otherSeverity, group: "true" });
    const data = await fetchJson<SignalsQueryResult>(`/api/signals?${params}`);
    setOtherResult(data);
    setOtherError(null);
  }, [otherEventType, otherSeverity, otherTab, symbol]);

  const refreshSoundFeed = useCallback(async () => {
    const params = new URLSearchParams({
      excludeSymbol: symbol,
      limit: String(OTHER_INBOX_LIMIT),
      tab: "All",
      eventType: "ALL",
      severity: "ALL",
    });
    const data = await fetchJson<SignalsQueryResult>(`/api/signals?${params}`);
    setSoundFeedEvents(data.events);
  }, [symbol]);

  const refreshMuteStates = useCallback(async () => {
    const data = await fetchJson<MuteQueryResult>("/api/mute");
    setMuteResult(data);
  }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const wrap = splitWrapRef.current;
      if (!wrap) return;
      const dx = e.clientX - startXRef.current;
      const wrapW = wrap.getBoundingClientRect().width;
      const minLeft = 520;
      const rightMin = 360;
      const handleW = 12;
      const gap = 16;
      const maxLeft = Math.max(minLeft, wrapW - rightMin - handleW - 2 * gap);
      setLeftW(clamp(startWRef.current + dx, minLeft, maxLeft));
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSelectedLoading(true);
    setOtherLoading(true);

    const load = async () => {
      try {
        const [selectedData, otherData] = await Promise.all([
          fetchJson<SignalsQueryResult>(`/api/signals?${new URLSearchParams({ symbol, limit: String(SELECTED_FEED_LIMIT), eventType: selectedEventType })}`),
          fetchJson<SignalsQueryResult>(`/api/signals?${new URLSearchParams({ excludeSymbol: symbol, limit: String(OTHER_INBOX_LIMIT), tab: otherTab, eventType: otherEventType, severity: otherSeverity, group: "true" })}`),
        ]);
        if (cancelled) return;
        setSelectedResult(selectedData);
        setOtherResult(otherData);
        setSelectedError(null);
        setOtherError(null);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setSelectedError(message);
          setOtherError(message);
        }
      } finally {
        if (!cancelled) {
          setSelectedLoading(false);
          setOtherLoading(false);
        }
      }
    };

    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [otherEventType, otherSeverity, otherTab, selectedEventType, symbol]);

  useEffect(() => {
    let cancelled = false;
    const loadMeta = async () => {
      try {
        const [muteData, soundData, soundFeedData] = await Promise.all([
          fetchJson<MuteQueryResult>("/api/mute"),
          fetchJson<SoundPreferenceResponse>("/api/sound"),
          fetchJson<SignalsQueryResult>(`/api/signals?${new URLSearchParams({
            excludeSymbol: symbol,
            limit: String(OTHER_INBOX_LIMIT),
            tab: "All",
            eventType: "ALL",
            severity: "ALL",
          })}`),
        ]);
        if (!cancelled) {
          setMuteResult(muteData);
          setSoundPreference(soundData);
          setSoundFeedEvents(soundFeedData.events);
        }
      } catch {
        if (!cancelled) {
          setMuteResult({ items: [] });
          setSoundPreference({ profileId: "default", enabled: false, updatedAtUtc: null });
          setSoundFeedEvents([]);
        }
      }
    };

    void loadMeta();
    const intervalId = window.setInterval(() => {
      void loadMeta();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    const closePlanIds = Array.from(new Set((selectedResult?.events ?? []).filter((event) => event.type === "SEND_CLOSE" && typeof event.planId === "string").map((event) => event.planId as string)));

    if (closePlanIds.length === 0) {
      setReviewNotesByPlanId({});
      return;
    }

    const loadReviewNotes = async () => {
      const pairs = await Promise.all(closePlanIds.map(async (planId) => {
        const data = await fetchJson<ReviewNoteApiResponse>(`/api/reviewNote?${new URLSearchParams({ planId })}`);
        return [planId, data.reviewNoteText] as const;
      }));

      if (!cancelled) {
        setReviewNotesByPlanId(Object.fromEntries(pairs));
      }
    };

    void loadReviewNotes();
    return () => { cancelled = true; };
  }, [selectedResult]);

  const selectedFeedEvents = useMemo(() => {
    const baseEvents = selectedResult?.events ?? [];

    if (!pinnedSelectedEvent || pinnedSelectedEvent.symbol !== symbol) {
      return baseEvents;
    }

    if (baseEvents.some((event) => event.id === pinnedSelectedEvent.id)) {
      return baseEvents;
    }

    return [pinnedSelectedEvent, ...baseEvents].sort((a, b) => {
      return Date.parse(b.time) - Date.parse(a.time);
    });
  }, [pinnedSelectedEvent, selectedResult, symbol]);

  const selectedEventById = useMemo(() => {
    return new Map(selectedFeedEvents.map((event) => [event.id, event] as const));
  }, [selectedFeedEvents]);

  const selectedCards = useMemo(() => {
    return selectedFeedEvents
      .map((event) =>
        buildSelectedFeedCard(
          event,
          event.planId ? reviewNotesByPlanId[event.planId] : ""
        )
      )
      .filter((card): card is SelectedFeedCard => card !== null);
  }, [reviewNotesByPlanId, selectedFeedEvents]);

  const otherItems = useMemo<SignalFeedItem[]>(() => {
    if (otherResult?.items) return otherResult.items;
    return (otherResult?.events ?? []).map((event) => ({ kind: "event" as const, event }));
  }, [otherResult]);

  useEffect(() => {
    replaceAlertPoiHighlightRegistry([
      ...selectedFeedEvents,
      ...(otherResult?.events ?? []),
    ]);
  }, [otherResult, selectedFeedEvents]);

  const selectedStatus = useMemo(() => buildSelectedFeedStatusView({ selectedSymbol: symbol, eventCount: selectedCards.length, backendState: selectedError ? "ERROR" : selectedLoading ? "SYNCING" : "LIVE", lastUpdateTime: selectedResult?.events[0]?.time ?? null }), [selectedCards.length, selectedError, selectedLoading, selectedResult, symbol]);

  const otherWatchlist = useMemo(() => {
    const currentState: "LIVE" | "SYNCING" | "ERROR" = otherError
      ? "ERROR"
      : selectedLoading || otherLoading
        ? "SYNCING"
        : "LIVE";
    return WATCHLIST_SYMBOLS.map((watchSymbol) => ({ symbol: watchSymbol.replace("USDT", ""), state: watchSymbol === symbol ? currentState : ("LIVE" as const), lastBarCloseTimeUtc: watchSymbol === symbol ? otherResult?.events[0]?.time : undefined }));
  }, [otherError, otherLoading, otherResult, selectedLoading, symbol]);

  const otherStatus = useMemo(() => buildOtherInboxStatusView({ selectedSymbol: symbol, eventCount: otherItems.length, backendState: otherError ? "ERROR" : "LIVE", lastUpdateTime: otherResult?.events[0]?.time ?? null, watchlist: otherWatchlist }), [otherError, otherItems.length, otherResult, otherWatchlist, symbol]);
  const mutedKeySet = useMemo(() => {
    return new Set(muteResult.items.map((item) => `${item.symbol}|${item.tf}`));
  }, [muteResult]);

  useEffect(() => {
    if (!pinnedSelectedEvent) {
      return;
    }

    if (pinnedSelectedEvent.symbol !== symbol) {
      setPinnedSelectedEvent(null);
      return;
    }

    if ((selectedResult?.events ?? []).some((event) => event.id === pinnedSelectedEvent.id)) {
      setPinnedSelectedEvent(null);
    }
  }, [pinnedSelectedEvent, selectedResult, symbol]);

  useEffect(() => {
    if (!pendingOpenLinkTarget) {
      return;
    }

    const element = document.getElementById(
      `selected-feed-${pendingOpenLinkTarget.eventId}`
    );

    if (!element) {
      return;
    }

    element.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightedEventId(pendingOpenLinkTarget.eventId);

    const timeoutId = window.setTimeout(() => {
      setHighlightedEventId((current) =>
        current === pendingOpenLinkTarget.eventId ? null : current
      );
    }, pendingOpenLinkTarget.durationMs);

    setPendingOpenLinkTarget(null);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pendingOpenLinkTarget, selectedFeedEvents]);

  const onDown = (e: React.MouseEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWRef.current = leftW;
    document.body.style.userSelect = "none";
    e.preventDefault();
  };

  const markSeen = useCallback(async (eventId: string) => {
    await fetchJson("/api/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId }) });
    await Promise.all([refreshSelectedFeed(), refreshOtherInbox()]);
  }, [refreshOtherInbox, refreshSelectedFeed]);

  const handleMute = useCallback(async (targetSymbol: string, tf: string) => {
    await fetchJson("/api/mute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: targetSymbol, tf }) });
    await Promise.all([refreshMuteStates(), refreshOtherInbox(), refreshSoundFeed()]);
  }, [refreshMuteStates, refreshOtherInbox, refreshSoundFeed]);

  const handleUnmute = useCallback(async (targetSymbol: string, tf: string) => {
    const params = new URLSearchParams({ symbol: targetSymbol, tf });
    await fetchJson(`/api/mute?${params}`, { method: "DELETE" });
    await Promise.all([refreshMuteStates(), refreshOtherInbox(), refreshSoundFeed()]);
  }, [refreshMuteStates, refreshOtherInbox, refreshSoundFeed]);

  const handleSoundToggle = useCallback(async () => {
    const nextEnabled = !soundPreference?.enabled;
    const data = await fetchJson<SoundPreferenceResponse>("/api/sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: nextEnabled }) });
    setSoundPreference(data);
  }, [soundPreference]);

  const executeAlertNavigation = useCallback(async (event: StoredSignalEventWithSeen, source: "SELECTED_SYMBOL_FEED" | "OTHER_SYMBOLS_INBOX") => {
    try {
      const plan = buildAlertCardNavigationPlan({ event, source, currentSymbol: symbol, currentTf: selectedTf, autoTfSwitch });
      let chartController: Awaited<ReturnType<typeof whenChartControllerReady>> | null = null;

      for (const step of plan.steps) {
        if (step.type === "setSelectedSymbol") setSymbol(step.symbol);
        if (step.type === "setSelectedTf") setSelectedTf(normalizeChartTimeframe(step.tf));
        if (step.type === "whenReady") {
          chartController = await whenChartControllerReady({
            symbol: step.symbol,
            tf: step.tf,
          });
        }
        if (step.type === "goToTime") {
          chartController?.goToTime(step.centerTime, step.barsAround);
        }
        if (step.type === "highlightPOI") {
          chartController?.highlightPOI(step.poiRef, step.durationMs);
        }
        if (step.type === "showTradePlanLines") {
          chartController?.showTradePlanLines({
            entryRefPrice: step.entryRefPrice,
            stopPrice: step.stopPrice,
            tpPrice: step.tpPrice,
            durationMs: step.durationMs,
          });
        }
        if (step.type === "markSeen") await markSeen(step.eventId);
      }
      if (source === "OTHER_SYMBOLS_INBOX") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      console.error("[ALERT_NAVIGATION_FAILED]", error);
    }
  }, [autoTfSwitch, markSeen, selectedTf, symbol]);

  const queueOpenLinkPlan = useCallback((planId: string, events: readonly StoredSignalEventWithSeen[]) => {
    const plan = buildOpenLinkPlan(events, planId);
    if (!plan) {
      return false;
    }

    const scrollStep = plan.steps.find((step) => step.type === "scrollToEvent");
    const highlightStep = plan.steps.find(
      (step) => step.type === "highlightEvent"
    );

    if (!scrollStep || !highlightStep) {
      return false;
    }

    setPendingOpenLinkTarget({
      eventId: scrollStep.eventId,
      durationMs: highlightStep.durationMs,
    });
    return true;
  }, []);

  const handleOpenLink = useCallback(async (planId: string) => {
    if (queueOpenLinkPlan(planId, selectedFeedEvents)) {
      return;
    }

    try {
      if (selectedEventType === "CLOSE_ONLY") {
        setSelectedEventType("ALL");
      }

      const data = await fetchJson<SignalsQueryResult>(
        `/api/signals?${new URLSearchParams({
          planId,
          eventType: "OPEN_ONLY",
          limit: "1",
        })}`
      );

      const openEvent = data.events[0] ?? null;
      if (!openEvent) {
        return;
      }

      setPinnedSelectedEvent(openEvent);
      queueOpenLinkPlan(planId, [openEvent]);
    } catch (error) {
      console.error("[OPEN_LINK_FAILED]", error);
    }
  }, [queueOpenLinkPlan, selectedEventType, selectedFeedEvents]);

  useEffect(() => {
    if (
      !soundPreference ||
      soundPreference.enabled !== true ||
      soundFeedEvents.length === 0 ||
      soundEvalInFlightRef.current
    ) {
      return;
    }

    let cancelled = false;

    const evaluateAndPlay = async () => {
      soundEvalInFlightRef.current = true;

      try {
        for (const event of soundFeedEvents) {
          const playedStatus = await fetchJson<SoundPlayedResponse>(
            `/api/soundPlayed?${new URLSearchParams({ eventId: event.id })}`
          );

          const verdict = shouldPlayHighOtherSymbolSound({
            selectedSymbol: symbol,
            event,
            mutedKeys: mutedKeySet,
            soundEnabled: soundPreference.enabled,
            alreadyPlayed: playedStatus.played,
          });

          if (!verdict.shouldPlay) {
            continue;
          }

          await playHighOtherSymbolTone();

          if (cancelled) {
            return;
          }

          await fetchJson("/api/soundPlayed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventId: event.id }),
          });

          break;
        }
      } catch (error) {
        console.error("[ALERT_SOUND_PLAY_FAILED]", error);
      } finally {
        soundEvalInFlightRef.current = false;
      }
    };

    void evaluateAndPlay();

    return () => {
      cancelled = true;
    };
  }, [mutedKeySet, soundFeedEvents, soundPreference, symbol]);
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-zinc-800" />
            <div className="text-lg font-semibold">Trading Dashboard</div>
          </div>

          <div className="flex items-center gap-2">
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
              {WATCHLIST_SYMBOLS.map((watchSymbol) => (
                <option key={watchSymbol} value={watchSymbol}>{watchSymbol}</option>
              ))}
            </select>

            <select value={selectedTf} onChange={(e) => setSelectedTf(normalizeChartTimeframe(e.target.value))} className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
              {CHART_TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>{formatChartTimeframeLabel(tf)}</option>
              ))}
            </select>

            <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
              <input type="checkbox" checked={autoTfSwitch} onChange={(e) => setAutoTfSwitch(e.target.checked)} />
              Auto TF
            </label>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-4">
        <div ref={splitWrapRef} className="flex flex-col gap-4 lg:flex-row">
          <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-3" style={{ flexBasis: leftW, flexShrink: 0 }}>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{symbol} · {formatChartTimeframeLabel(selectedTf)}</div>
                <div className="text-xs text-zinc-400">Chart</div>
              </div>
              <div className="text-xs text-zinc-500">Structured alerts + Telegram runtime active</div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950">
              <CandleChart symbol={symbol} tf={selectedTf} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {CHART_TIMEFRAMES.map((tf) => (
                <button key={tf} type="button" onClick={() => setSelectedTf(tf)} className={`rounded-md border px-3 py-2 text-sm ${selectedTf === tf ? "border-emerald-500 bg-emerald-500/10 text-emerald-200" : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"}`}>
                  {formatChartTimeframeLabel(tf)}
                </button>
              ))}
            </div>

            <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Selected Feed</div>
                  <div className="text-xs text-zinc-400">Recent {SELECTED_FEED_LIMIT} alerts for {symbol}</div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {(["ALL", "OPEN_ONLY", "CLOSE_ONLY"] as const).map((value) => (
                    <button key={value} type="button" onClick={() => setSelectedEventType(value)} className={`rounded px-2 py-1 ${selectedEventType === value ? "bg-emerald-500/10 text-emerald-200" : "bg-zinc-900 text-zinc-400"}`}>
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">{selectedStatus.message ?? "Signals loaded"}</div>

              <div className="mt-3 space-y-3">
                {selectedCards.map((card) => {
                  const originalEvent = selectedEventById.get(card.id);
                  const isClickable = Boolean(originalEvent);

                  return (
                    <article
                      key={card.id}
                      id={`selected-feed-${card.id}`}
                      role={isClickable ? "button" : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onClick={
                        originalEvent
                          ? () =>
                              void executeAlertNavigation(
                                originalEvent,
                                "SELECTED_SYMBOL_FEED"
                              )
                          : undefined
                      }
                      onKeyDown={
                        originalEvent
                          ? (event) => {
                              if (event.key !== "Enter" && event.key !== " ") {
                                return;
                              }

                              event.preventDefault();
                              void executeAlertNavigation(
                                originalEvent,
                                "SELECTED_SYMBOL_FEED"
                              );
                            }
                          : undefined
                      }
                      className={`rounded-lg border p-3 transition ${
                        highlightedEventId === card.id
                          ? "border-sky-400 bg-sky-500/10"
                          : "border-zinc-800 bg-zinc-950"
                      } ${
                        isClickable
                          ? "cursor-pointer hover:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
                          : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-zinc-400">{card.symbol} · {card.tf} · {formatIsoLabel(card.time)}</div>
                          <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                            <span>{card.kind}</span>
                            {card.severity ? <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{card.severity}</span> : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {originalEvent && !originalEvent.seen ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void markSeen(originalEvent.id);
                              }}
                              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
                            >
                              읽음
                            </button>
                          ) : null}
                          {card.kind === "CLOSE" && card.openLinkPlanId ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleOpenLink(card.openLinkPlanId as string);
                              }}
                              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
                            >
                              ↩ OPEN 보기
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {renderSelectedFeedCardBody(card)}
                    </article>
                  );
                })}

                {selectedCards.length === 0 ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">{selectedStatus.message ?? "No alerts"}</div>
                ) : null}
              </div>
            </section>

            <WhyNoOpenPanel symbol={symbol} />
          </section>

          <div onMouseDown={onDown} className="w-3 cursor-col-resize rounded bg-zinc-800/20 hover:bg-zinc-700/50 active:bg-zinc-600/50" title="Drag to resize" />

          <section className="min-w-[360px] min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Other Inbox</div>
                <div className="text-xs text-zinc-400">Unread high badge: {otherResult?.unseenHighCountOther ?? 0}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" onClick={() => void handleSoundToggle()} className={`rounded px-2 py-1 ${soundPreference?.enabled ? "bg-emerald-500/10 text-emerald-200" : "bg-zinc-900 text-zinc-400"}`}>HIGH sound {soundPreference?.enabled ? "ON" : "OFF"}</button>
                <button type="button" onClick={() => setOtherTab("Unread")} className={`rounded px-2 py-1 ${otherTab === "Unread" ? "bg-emerald-500/10 text-emerald-200" : "bg-zinc-900 text-zinc-400"}`}>Unread</button>
                <button type="button" onClick={() => setOtherTab("All")} className={`rounded px-2 py-1 ${otherTab === "All" ? "bg-emerald-500/10 text-emerald-200" : "bg-zinc-900 text-zinc-400"}`}>All</button>
              </div>
            </div>

            <div className="mt-3 text-xs text-zinc-400">{otherStatus.watchlistLine}</div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {(["ALL", "OPEN_ONLY", "CLOSE_ONLY"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setOtherEventType(value)} className={`rounded px-2 py-1 ${otherEventType === value ? "bg-emerald-500/10 text-emerald-200" : "bg-zinc-900 text-zinc-400"}`}>{value}</button>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {(["ALL", "HIGH", "MID", "LOW"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setOtherSeverity(value)} className={`rounded px-2 py-1 ${otherSeverity === value ? "bg-emerald-500/10 text-emerald-200" : "bg-zinc-900 text-zinc-400"}`}>{value}</button>
              ))}
            </div>

            <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">{otherStatus.message ?? "Other-symbol alerts loaded"}</div>

            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-2 text-xs text-zinc-400">Muted</div>
              {muteResult.items.length === 0 ? (
                <div className="text-sm text-zinc-500">No active mutes</div>
              ) : (
                <div className="space-y-2">
                  {muteResult.items.map((item) => (
                    <div key={`${item.symbol}|${item.tf}`} className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
                      <div>
                        {item.symbol} · {item.tf}
                        <div className="text-xs text-zinc-500">until {formatIsoLabel(item.muteUntilUtc)}</div>
                      </div>
                      <button type="button" onClick={() => void handleUnmute(item.symbol, item.tf)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">해제</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 space-y-3">
              {otherItems.map((item, index) => {
                if (item.kind === "group") {
                  return (
                    <article key={`${item.group.groupKey}:${item.group.latestTime}:${index}`} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-zinc-400">{item.group.symbol} · {item.group.tf} · {formatIsoLabel(item.group.latestTime)}</div>
                          <div className="mt-1 text-sm font-semibold">GROUP {item.group.eventType} · {item.group.direction}</div>
                          <div className="mt-2 text-sm text-zinc-300">{item.group.count} events · severity {item.group.severity} · unseen {item.group.unseenCount}</div>
                        </div>
                        <button type="button" onClick={() => void handleMute(item.group.symbol, item.group.tf)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">Mute 60m</button>
                      </div>
                    </article>
                  );
                }

                const card = buildSelectedFeedCard(item.event, "");
                return (
                  <article key={item.event.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-zinc-400">{item.event.symbol} · {item.event.tf} · {formatIsoLabel(item.event.time)}</div>
                        <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                          <span>{item.event.type}</span>
                          {!item.event.seen ? <span className="rounded bg-sky-500/10 px-2 py-0.5 text-xs text-sky-200">unread</span> : null}
                          {item.event.severity ? <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{item.event.severity}</span> : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => void executeAlertNavigation(item.event, "OTHER_SYMBOLS_INBOX")} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">열기</button>
                        <button type="button" onClick={() => void handleMute(item.event.symbol, item.event.tf)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">Mute 60m</button>
                      </div>
                    </div>
                    {card ? (
                      <div className="mt-3 text-sm text-zinc-300">
                        {card.kind === "OPEN" ? (
                          <>
                            <div>Entry {formatPrice(card.entryRefPrice)} · Stop {formatPrice(card.stopPrice)} · TP {formatPrice(card.tpPrice)}</div>
                            <div className="mt-1 text-xs text-zinc-500">RR {card.rrChosen.toFixed(2)} · {card.trafficLight}</div>
                          </>
                        ) : (
                          <>
                            <div>Exit {formatPrice(card.exitPrice)} · R {formatSignedNumber(card.rGross)}</div>
                            <div className="mt-1 text-xs text-zinc-500">{card.outcome}{card.replayNote ? ` · ${card.replayNote}` : ""}</div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </article>
                );
              })}

              {otherItems.length === 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">{otherStatus.message ?? "No other-symbol alerts"}</div>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}


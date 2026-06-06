"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  WhyNoOpenResponse,
  WhyNoOpenSourceSnapshot,
} from "@/lib/diagnostics/why-no-open";

const REFRESH_INTERVAL_MS = 5000;

function formatIsoLabel(value?: string | null): string {
  if (!value) {
    return "-";
  }

  return value.replace("T", " ").replace("Z", " UTC");
}

function compactText(value?: string | null, limit = 120): string {
  if (!value) {
    return "-";
  }

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}...`;
}

function renderStatusBadge(snapshot: WhyNoOpenSourceSnapshot) {
  if (snapshot.latestPolicyDecision === "ALLOW") {
    return (
      <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
        POLICY ALLOW
      </span>
    );
  }

  if (snapshot.latestPolicyDecision === "BLOCK") {
    return (
      <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
        POLICY BLOCK
      </span>
    );
  }

  if (snapshot.latestExecutionType) {
    return (
      <span className="rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
        RAW ONLY
      </span>
    );
  }

  if (snapshot.latestLifecycleText) {
    return (
      <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
        NO EXEC RAW
      </span>
    );
  }

  return (
    <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-500">
      NO RECENT DATA
    </span>
  );
}

export default function WhyNoOpenPanel({
  symbol,
  windowHours = 72,
}: {
  symbol: string;
  windowHours?: number;
}) {
  const [result, setResult] = useState<WhyNoOpenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/why-no-open?${new URLSearchParams({
            symbol,
            windowHours: String(windowHours),
          })}`,
          { cache: "no-store" }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = (await response.json()) as WhyNoOpenResponse;
        if (cancelled) {
          return;
        }

        setResult(json);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError)
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    void load();

    const intervalId = window.setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [symbol, windowHours]);

  const sourceSnapshots = useMemo(() => result?.sources ?? [], [result]);

  return (
    <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Why No Open</div>
          <div className="text-xs text-zinc-400">
            Observability only. Uses recent signals + policy logs for {symbol}.
          </div>
        </div>
        <div className="text-xs text-zinc-500">
          Window {windowHours}h · updated {formatIsoLabel(result?.generatedAtUtc)}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
        {error
          ? `Why No Open load failed: ${error}`
          : loading && !result
          ? "Why No Open syncing..."
          : "Recent source-level execution and policy outcomes"}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {sourceSnapshots.map((snapshot) => (
          <article
            key={snapshot.source}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{snapshot.source}</div>
                <div className="mt-1 text-xs text-zinc-400">
                  {snapshot.explanation}
                </div>
              </div>
              {renderStatusBadge(snapshot)}
            </div>

            <div className="mt-3 space-y-2 text-sm text-zinc-300">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Latest Lifecycle
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {formatIsoLabel(snapshot.latestLifecycleAtUtc)}
                </div>
                <div className="mt-1 break-all text-sm text-zinc-300">
                  {compactText(snapshot.latestLifecycleText, 160)}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Latest Execution Raw
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {formatIsoLabel(snapshot.latestExecutionAtUtc)}
                </div>
                <div className="mt-1 break-all text-sm text-zinc-300">
                  {compactText(snapshot.latestExecutionText, 160)}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Latest Policy
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {formatIsoLabel(snapshot.latestPolicyAtUtc)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-zinc-800 px-2 py-1 text-zinc-200">
                    {snapshot.latestPolicyDecision ?? "none"}
                  </span>
                  {snapshot.latestPolicyReasons.map((reason) => (
                    <span
                      key={`${snapshot.source}:reason:${reason}`}
                      className="rounded bg-amber-500/10 px-2 py-1 text-amber-200"
                    >
                      {reason}
                    </span>
                  ))}
                  {snapshot.latestPolicyTags.map((tag) => (
                    <span
                      key={`${snapshot.source}:tag:${tag}`}
                      className="rounded bg-zinc-800 px-2 py-1 text-zinc-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}

        {sourceSnapshots.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">
            No source diagnostics available.
          </div>
        ) : null}
      </div>
    </section>
  );
}

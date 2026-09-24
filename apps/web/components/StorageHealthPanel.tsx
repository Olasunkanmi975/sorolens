"use client";

import { useEffect, useState, useMemo } from "react";
import type { StorageEntry } from "@/lib/types";
import { getExpiringStorage } from "@/lib/api";

interface StorageHealthPanelProps {
  contractId: string;
  currentLedger?: number;
  initialEntries?: StorageEntry[];
}

export type ExpiryStatus = "OK" | "Warning" | "Critical";

// Soroban ledger time is approximately 5 seconds per ledger.
// < 1 day: < 17,280 ledgers (86,400s / 5s)
// 1 - 7 days: 17,280 - 120,960 ledgers (604,800s / 5s)
// > 7 days: > 120,960 ledgers
export function getExpiryStatus(ledgersRemaining: number | null): ExpiryStatus {
  if (ledgersRemaining == null) return "OK";
  if (ledgersRemaining < 17280) return "Critical";
  if (ledgersRemaining <= 120960) return "Warning";
  return "OK";
}

export function formatEstimatedExpiry(ledgersRemaining: number | null): string {
  if (ledgersRemaining == null) return "Unknown";
  if (ledgersRemaining <= 0) return "Expired";

  const totalSeconds = ledgersRemaining * 5;
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = totalSeconds / 60;
  if (minutes < 60) {
    return `~${Math.round(minutes)} min`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `~${hours.toFixed(1)} hours`;
  }
  const days = hours / 24;
  return `~${days.toFixed(1)} days`;
}

function truncateValue(entry: StorageEntry): string {
  if (entry.value_decoded != null) {
    const s =
      typeof entry.value_decoded === "object"
        ? JSON.stringify(entry.value_decoded)
        : String(entry.value_decoded);
    return s.length > 32 ? s.slice(0, 32) + "…" : s;
  }
  if (entry.value_xdr) {
    return entry.value_xdr.length > 24
      ? entry.value_xdr.slice(0, 24) + "…"
      : entry.value_xdr;
  }
  return "-";
}

export function StorageHealthPanel({
  contractId,
  currentLedger = 0,
  initialEntries = [],
}: StorageHealthPanelProps) {
  const [entries, setEntries] = useState<StorageEntry[]>(initialEntries);
  const [ledger, setLedger] = useState<number>(currentLedger);
  const [loading, setLoading] = useState(false);
  const [timeframeSeconds, setTimeframeSeconds] = useState<number>(604800); // default 7 days
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadExpiring() {
      setLoading(true);
      try {
        const data = await getExpiringStorage(contractId, timeframeSeconds);
        if (!cancelled) {
          setEntries(data.entries ?? data.storage ?? []);
          if (data.current_ledger) {
            setLedger(data.current_ledger);
          }
        }
      } catch {
        // non-critical error fallback
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadExpiring();
    return () => {
      cancelled = true;
    };
  }, [contractId, timeframeSeconds]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const aRem =
        a.ledgers_until_expiry ??
        (a.live_until_ledger && ledger ? a.live_until_ledger - ledger : 999999);
      const bRem =
        b.ledgers_until_expiry ??
        (b.live_until_ledger && ledger ? b.live_until_ledger - ledger : 999999);
      return sortAsc ? aRem - bRem : bRem - aRem;
    });
  }, [entries, ledger, sortAsc]);

  const counts = useMemo(() => {
    let ok = 0;
    let warning = 0;
    let critical = 0;
    for (const e of entries) {
      const rem =
        e.ledgers_until_expiry ??
        (e.live_until_ledger && ledger ? e.live_until_ledger - ledger : null);
      const s = getExpiryStatus(rem);
      if (s === "Critical") critical++;
      else if (s === "Warning") warning++;
      else ok++;
    }
    return { ok, warning, critical };
  }, [entries, ledger]);

  return (
    <div className="rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]">
      {/* Header controls & summary counts */}
      <div className="flex flex-col gap-4 border-b border-[var(--color-border)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">TTL Expiry Warnings</span>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-red-900/40 px-2 py-0.5 font-medium text-red-400 border border-red-800/40">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              {counts.critical} Critical (&lt;1d)
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-900/40 px-2 py-0.5 font-medium text-yellow-400 border border-yellow-800/40">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
              {counts.warning} Warning (1-7d)
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-900/40 px-2 py-0.5 font-medium text-green-400 border border-green-800/40">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              {counts.ok} OK (&gt;7d)
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe selector */}
          <div className="flex rounded-md border border-[var(--color-border)] bg-black/20 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTimeframeSeconds(86400)}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                timeframeSeconds === 86400
                  ? "bg-[var(--color-accent)] text-[var(--color-bg-page)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              &lt; 24h
            </button>
            <button
              type="button"
              onClick={() => setTimeframeSeconds(604800)}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                timeframeSeconds === 604800
                  ? "bg-[var(--color-accent)] text-[var(--color-bg-page)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              &lt; 7 days
            </button>
            <button
              type="button"
              onClick={() => setTimeframeSeconds(2592000)}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                timeframeSeconds === 2592000
                  ? "bg-[var(--color-accent)] text-[var(--color-bg-page)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              &lt; 30 days
            </button>
          </div>

          {/* Sort direction toggle */}
          <button
            type="button"
            onClick={() => setSortAsc(!sortAsc)}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            title="Toggle soonest / furthest sorting"
          >
            {sortAsc ? "Sort: Soonest First ↑" : "Sort: Furthest First ↓"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs font-medium text-[var(--color-text-secondary)]">
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3">TTL (Ledgers Remaining)</th>
              <th className="px-4 py-3">Estimated Expiry</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {loading && entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                  Loading storage TTL health data...
                </td>
              </tr>
            ) : sortedEntries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                  No storage entries expiring within selected timeframe.
                </td>
              </tr>
            ) : (
              sortedEntries.map((entry, idx) => {
                const rem =
                  entry.ledgers_until_expiry ??
                  (entry.live_until_ledger && ledger
                    ? entry.live_until_ledger - ledger
                    : null);
                const status = getExpiryStatus(rem);
                const estimatedExpiry = formatEstimatedExpiry(rem);

                return (
                  <tr
                    key={`${entry.key_xdr}-${idx}`}
                    className="transition-colors hover:bg-white/5"
                  >
                    <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-[var(--color-text-primary)]">
                      {entry.key_decoded || entry.key_xdr}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">
                      {truncateValue(entry)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {rem != null ? rem.toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                      {estimatedExpiry}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                          status === "Critical"
                            ? "bg-red-900/40 text-red-400 border-red-800/40"
                            : status === "Warning"
                              ? "bg-yellow-900/40 text-yellow-400 border-yellow-800/40"
                              : "bg-green-900/40 text-green-400 border-green-800/40"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            status === "Critical"
                              ? "bg-red-400 animate-pulse"
                              : status === "Warning"
                                ? "bg-yellow-400"
                                : "bg-green-400"
                          }`}
                        />
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

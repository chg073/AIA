"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Compass,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import type { Discovery } from "@/types";

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const pct = n * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function pctColor(n: number | null | undefined): string {
  if (n === null || n === undefined) return "text-muted-foreground";
  if (n >= 0.5) return "text-green-400";
  if (n >= 0) return "text-green-500/80";
  return "text-red-400";
}

function fmtMarketCap(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

export default function DiscoverPage() {
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchDiscoveries = useCallback(async () => {
    try {
      const res = await fetch("/api/discoveries", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load discoveries");
      setDiscoveries(data.discoveries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiscoveries();
  }, [fetchDiscoveries]);

  const runDiscovery = async () => {
    setRefreshing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/discoveries", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Discovery failed");
      const picks = data.results?.[0]?.picks ?? 0;
      setSuccess(
        picks > 0
          ? `Found ${picks} new long-term ideas`
          : "Scan complete. No new ideas this round."
      );
      await fetchDiscoveries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setRefreshing(false);
    }
  };

  const act = async (id: string, action: "add" | "dismiss") => {
    setActingId(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/discoveries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      setDiscoveries((prev) => prev.filter((d) => d.id !== id));
      setSuccess(action === "add" ? "Added to watchlist" : "Dismissed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Compass className="h-7 w-7 text-primary" /> Discover
          </h1>
          <p className="text-muted-foreground mt-1">
            AI-curated long-term opportunities outside your watchlist
          </p>
        </div>
        <button
          onClick={runDiscovery}
          disabled={refreshing}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-accent-foreground px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {refreshing ? "Scanning…" : "Scan for ideas"}
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-success/10 border border-success/20 text-success rounded-lg p-3 text-sm">
          {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : discoveries.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No new ideas yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click <span className="font-semibold">Scan for ideas</span> to surface
            long-term opportunities you&apos;re not already tracking.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {discoveries.map((d) => (
            <div
              key={d.id}
              className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-2xl font-bold">{d.symbol}</span>
                    {d.ai_recommended && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                        AI Pick
                      </span>
                    )}
                    <span className="text-xs font-medium bg-accent/10 text-accent px-2 py-0.5 rounded-full">
                      Score {d.momentum_score ?? "—"}/100
                    </span>
                  </div>
                  {d.company_name && (
                    <div className="text-sm text-muted-foreground">{d.company_name}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">
                    {d.current_price !== null
                      ? `$${d.current_price.toFixed(2)}`
                      : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtMarketCap(d.market_cap)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
                {[
                  { label: "1M", v: d.return_1m },
                  { label: "3M", v: d.return_3m },
                  { label: "6M", v: d.return_6m },
                  { label: "YTD", v: d.return_ytd },
                  { label: "1Y", v: d.return_1y },
                  { label: "3Y", v: d.return_3y },
                ].map(({ label, v }) => (
                  <div
                    key={label}
                    className="bg-secondary/40 rounded-lg p-2 text-center"
                  >
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
                      {label}
                    </div>
                    <div className={`font-semibold ${pctColor(v)}`}>{fmtPct(v)}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="bg-secondary/60 px-2 py-1 rounded-md">
                  Weekly RSI {d.rsi_weekly !== null ? d.rsi_weekly.toFixed(0) : "—"}
                </span>
                <span className="bg-secondary/60 px-2 py-1 rounded-md">
                  {d.distance_from_52w_high !== null
                    ? `${fmtPct(d.distance_from_52w_high)} from 52w high`
                    : "—"}
                </span>
                <span className="bg-secondary/60 px-2 py-1 rounded-md flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Vol{" "}
                  {d.volume_surge_ratio !== null
                    ? d.volume_surge_ratio.toFixed(2) + "x"
                    : "—"}
                </span>
                {d.ai_horizon && (
                  <span className="bg-secondary/60 px-2 py-1 rounded-md">
                    Horizon: {d.ai_horizon}
                  </span>
                )}
              </div>

              {d.ai_thesis && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                    AI Thesis
                  </div>
                  <p className="text-sm text-foreground/90">{d.ai_thesis}</p>
                </div>
              )}
              {d.ai_risk && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                    Key Risk
                  </div>
                  <p className="text-sm text-muted-foreground">{d.ai_risk}</p>
                </div>
              )}

              <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border/50">
                <button
                  onClick={() => act(d.id, "add")}
                  disabled={actingId === d.id}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {actingId === d.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add to Watchlist
                </button>
                <button
                  onClick={() => act(d.id, "dismiss")}
                  disabled={actingId === d.id}
                  className="flex items-center gap-1.5 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <X className="h-4 w-4" /> Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

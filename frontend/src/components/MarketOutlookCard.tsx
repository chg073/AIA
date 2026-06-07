"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { MarketOutlook, OverallStance } from "@/types";

const STANCE_META: Record<
  OverallStance,
  { label: string; color: string; bg: string; emoji: string }
> = {
  deploy_capital: {
    label: "Deploy Capital",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/30",
    emoji: "🟢",
  },
  cautious_buy: {
    label: "Cautious Buy",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    emoji: "🟢",
  },
  hold: {
    label: "Hold",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    emoji: "🟡",
  },
  defensive: {
    label: "Defensive",
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/30",
    emoji: "🟠",
  },
  reduce_exposure: {
    label: "Reduce Exposure",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    emoji: "🔴",
  },
};

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const pct = n * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export default function MarketOutlookCard() {
  const [outlook, setOutlook] = useState<MarketOutlook | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market-outlook", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load outlook");
      setOutlook(data.outlook);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/market-outlook", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Refresh failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!outlook) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Market & Portfolio Outlook</h2>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-accent-foreground px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Generate
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          No outlook yet. Click <span className="font-semibold">Generate</span> for
          an AI take on whether to be buying right now.
        </p>
        {error && (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        )}
      </div>
    );
  }

  const stance = (outlook.overall_stance ?? "hold") as OverallStance;
  const meta = STANCE_META[stance] ?? STANCE_META.hold;
  const created = new Date(outlook.created_at);
  const ageHours = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60));
  const ageLabel =
    ageHours < 1
      ? "just now"
      : ageHours < 24
      ? `${ageHours}h ago`
      : `${Math.floor(ageHours / 24)}d ago`;

  return (
    <div className={`border rounded-xl p-6 ${meta.bg}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Market & Portfolio Outlook</h2>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-card/50 hover:bg-card border border-border px-2.5 py-1 rounded-md transition-colors disabled:opacity-50"
          title="Refresh outlook"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {ageLabel}
        </button>
      </div>

      <div className="flex flex-wrap items-baseline gap-3 mb-3">
        <span className={`text-2xl font-bold ${meta.color}`}>{meta.label}</span>
        {outlook.market_regime && (
          <span className="text-xs uppercase tracking-wider text-muted-foreground bg-secondary/60 px-2 py-1 rounded">
            Market: {outlook.market_regime}
          </span>
        )}
      </div>

      {outlook.headline && (
        <p className="text-base font-medium text-foreground mb-3">
          {outlook.headline}
        </p>
      )}

      {outlook.reasoning && (
        <p className="text-sm text-foreground/90 mb-4">{outlook.reasoning}</p>
      )}

      {outlook.cash_recommendation && (
        <p className="text-xs text-muted-foreground mb-4 italic">
          💰 {outlook.cash_recommendation}
        </p>
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat
          label="SPY"
          value={outlook.spy_price ? formatCurrency(outlook.spy_price) : "—"}
          subtle={`YTD ${fmtPct(outlook.spy_return_ytd)}`}
        />
        <Stat
          label="SPY 1y"
          value={fmtPct(outlook.spy_return_1y)}
          subtle={
            outlook.spy_above_sma200 === null
              ? ""
              : outlook.spy_above_sma200
              ? "Above SMA200"
              : "Below SMA200"
          }
          color={
            (outlook.spy_return_1y ?? 0) > 0 ? "text-green-400" : "text-red-400"
          }
          icon={
            (outlook.spy_return_1y ?? 0) > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )
          }
        />
        <Stat
          label="Your signals"
          value={`${outlook.buy_signals}B / ${outlook.hold_signals}H / ${outlook.sell_signals}S`}
          subtle={`${outlook.watchlist_size} watched`}
        />
        <Stat
          label="Avg exit score"
          value={
            outlook.avg_exit_score !== null
              ? `${outlook.avg_exit_score.toFixed(0)}/100`
              : "—"
          }
          subtle={
            outlook.avg_exit_score !== null && outlook.avg_exit_score > 50
              ? "Trim candidates"
              : "Healthy"
          }
          color={
            outlook.avg_exit_score !== null && outlook.avg_exit_score > 60
              ? "text-orange-400"
              : "text-foreground"
          }
        />
      </div>

      {outlook.top_priorities && outlook.top_priorities.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Top Priorities
          </div>
          <div className="space-y-2">
            {outlook.top_priorities.map((p, i) => (
              <div
                key={`${p.symbol}-${i}`}
                className="flex items-start gap-3 bg-card/50 border border-border rounded-lg p-2.5"
              >
                <span className="font-bold text-sm w-14 shrink-0">
                  {p.symbol}
                </span>
                <span
                  className={`text-xs font-medium uppercase shrink-0 w-12 ${actionColor(p.action)}`}
                >
                  {p.action}
                </span>
                <span className="text-sm text-foreground/90 flex-1">
                  {p.why}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  subtle,
  color = "text-foreground",
  icon,
}: {
  label: string;
  value: string;
  subtle?: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-card/50 border border-border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-base font-semibold flex items-center gap-1 ${color}`}>
        {icon}
        {value}
      </div>
      {subtle && (
        <div className="text-[11px] text-muted-foreground">{subtle}</div>
      )}
    </div>
  );
}

function actionColor(action: string): string {
  switch (action.toLowerCase()) {
    case "buy":
      return "text-green-400";
    case "sell":
    case "trim":
      return "text-red-400";
    case "hold":
      return "text-yellow-400";
    default:
      return "text-muted-foreground";
  }
}

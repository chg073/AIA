"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Lightbulb,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  formatCurrency,
  formatDate,
  getSignalColor,
  getSignalBgColor,
  getActionColor,
} from "@/lib/utils";
import type { Suggestion } from "@/types";

export default function SuggestionsPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const supabase = createClient();

  const fetchSuggestions = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("suggestions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (data) {
      setSuggestions(data);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const filtered = suggestions.filter((s) => {
    if (filter === "all") return true;
    if (filter === "active") return s.is_active;
    return s.signal_level === filter;
  });

  const getActionIcon = (action: string) => {
    switch (action) {
      case "buy":
        return <TrendingUp className="h-4 w-4" />;
      case "sell":
        return <TrendingDown className="h-4 w-4" />;
      case "hold":
        return <Minus className="h-4 w-4" />;
      case "watch":
        return <Eye className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold">Suggestions</h1>
        <p className="text-muted-foreground mt-1">
          AI-generated investment recommendations
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          "all",
          "active",
          "very_strong",
          "strong",
          "medium",
          "weak",
        ].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "very_strong"
              ? "Very Strong"
              : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Suggestions List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No suggestions found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Run analysis on your watchlist stocks to generate suggestions
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((suggestion) => (
            <div
              key={suggestion.id}
              className={`bg-card border rounded-xl overflow-hidden transition-colors ${
                suggestion.is_active
                  ? "border-border hover:border-primary/30"
                  : "border-border/50 opacity-60"
              }`}
            >
              {/* Header */}
              <button
                onClick={() =>
                  setExpandedId(
                    expandedId === suggestion.id ? null : suggestion.id
                  )
                }
                className="w-full px-6 py-4 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${getSignalBgColor(suggestion.signal_level)} ${getSignalColor(suggestion.signal_level)}`}
                  >
                    {suggestion.signal_level.replace("_", " ").toUpperCase()}
                  </div>
                  <span className="font-bold text-xl">
                    {suggestion.symbol}
                  </span>
                  <div
                    className={`flex items-center gap-1 ${getActionColor(suggestion.action)}`}
                  >
                    {getActionIcon(suggestion.action)}
                    <span className="font-medium uppercase text-sm">
                      {suggestion.action}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {suggestion.current_price && (
                    <span className="text-muted-foreground">
                      {formatCurrency(suggestion.current_price)}
                    </span>
                  )}
                  {suggestion.confidence && (
                    <span className="text-sm text-muted-foreground">
                      {Math.round(suggestion.confidence * 100)}% confidence
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(suggestion.created_at)}
                  </span>
                  {expandedId === suggestion.id ? (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Expanded Details */}
              {expandedId === suggestion.id && (
                <div className="px-6 pb-6 border-t border-border pt-4 space-y-4">
                  {/* Reasoning */}
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-1">
                      Analysis
                    </h3>
                    <p className="text-foreground">{suggestion.reasoning}</p>
                  </div>

                  {/* Price Targets */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {suggestion.suggested_buy_price && (
                      <PriceBox
                        label="Buy Price"
                        value={formatCurrency(suggestion.suggested_buy_price)}
                        color="text-green-400"
                      />
                    )}
                    {suggestion.suggested_sell_price && (
                      <PriceBox
                        label="Sell Price"
                        value={formatCurrency(suggestion.suggested_sell_price)}
                        color="text-blue-400"
                      />
                    )}
                    {suggestion.stop_loss_price && (
                      <PriceBox
                        label="Stop Loss"
                        value={formatCurrency(suggestion.stop_loss_price)}
                        color="text-red-400"
                      />
                    )}
                    {suggestion.risk_estimation && (
                      <PriceBox
                        label="Risk"
                        value={suggestion.risk_estimation.toUpperCase()}
                        color="text-yellow-400"
                      />
                    )}
                  </div>

                  {/* Technical Summary */}
                  {suggestion.technical_summary && (
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">
                        Technical Indicators
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {suggestion.technical_summary.trend && (
                          <IndicatorBox
                            label="Trend"
                            value={suggestion.technical_summary.trend}
                          />
                        )}
                        {suggestion.technical_summary.rsi !== undefined && (
                          <IndicatorBox
                            label="RSI"
                            value={suggestion.technical_summary.rsi.toFixed(2)}
                          />
                        )}
                        {suggestion.technical_summary.sma_20 !== undefined && (
                          <IndicatorBox
                            label="SMA 20"
                            value={formatCurrency(
                              suggestion.technical_summary.sma_20
                            )}
                          />
                        )}
                        {suggestion.technical_summary.bb_upper !== undefined && (
                          <IndicatorBox
                            label="BB Upper"
                            value={formatCurrency(
                              suggestion.technical_summary.bb_upper
                            )}
                          />
                        )}
                        {suggestion.technical_summary.bb_lower !== undefined && (
                          <IndicatorBox
                            label="BB Lower"
                            value={formatCurrency(
                              suggestion.technical_summary.bb_lower
                            )}
                          />
                        )}
                        {suggestion.technical_summary.macd !== undefined && (
                          <IndicatorBox
                            label="MACD"
                            value={suggestion.technical_summary.macd.toFixed(4)}
                          />
                        )}
                      </div>
                      {suggestion.technical_summary.key_indicators && (
                        <p className="text-sm text-muted-foreground mt-2">
                          {suggestion.technical_summary.key_indicators}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Time Horizon */}
                  {suggestion.time_horizon && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">Time horizon:</span>{" "}
                      {suggestion.time_horizon}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-secondary/50 rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function IndicatorBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-secondary/50 rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-sm">{value}</p>
    </div>
  );
}

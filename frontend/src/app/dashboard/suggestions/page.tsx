"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  Send,
  MessageSquare,
  Shield,
  History,
  Target,
} from "lucide-react";
import {
  formatCurrency,
  formatDate,
  getSignalColor,
  getSignalBgColor,
  getActionColor,
} from "@/lib/utils";
import { getExitScoreLabel, getExitScoreBgColor } from "@/lib/exit-score";
import type { Suggestion, SuggestionMessage, Transaction } from "@/types";

interface CompanyGroup {
  symbol: string;
  active: Suggestion;
  history: Suggestion[];
  messages: SuggestionMessage[];
  positions: Transaction[];
}

export default function SuggestionsPage() {
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [chatInputs, setChatInputs] = useState<Record<string, string>>({});
  const [sendingChat, setSendingChat] = useState<string | null>(null);
  const supabase = createClient();

  const fetchData = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [suggestionsRes, messagesRes, transactionsRes] = await Promise.all([
      supabase
        .from("suggestions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("suggestion_messages")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active"),
    ]);

    const suggestions = (suggestionsRes.data || []) as Suggestion[];
    const messages = (messagesRes.data || []) as SuggestionMessage[];
    const transactions = (transactionsRes.data || []) as Transaction[];

    // Group by symbol — one card per company with latest active suggestion
    const symbolMap = new Map<string, CompanyGroup>();

    for (const s of suggestions) {
      if (!symbolMap.has(s.symbol)) {
        symbolMap.set(s.symbol, {
          symbol: s.symbol,
          active: s,
          history: [],
          messages: [],
          positions: transactions.filter((t) => t.symbol === s.symbol),
        });
      } else {
        symbolMap.get(s.symbol)!.history.push(s);
      }
    }

    // Attach messages to the active suggestion for each company
    for (const group of symbolMap.values()) {
      group.messages = messages.filter(
        (m) => m.suggestion_id === group.active.id
      );
    }

    setGroups(Array.from(symbolMap.values()));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = groups.filter((g) => {
    if (filter === "all") return true;
    if (filter === "active") return g.active.is_active;
    return g.active.signal_level === filter;
  });

  const sendMessage = async (suggestionId: string, symbol: string) => {
    const message = chatInputs[symbol]?.trim();
    if (!message) return;

    setSendingChat(symbol);
    try {
      const res = await fetch(`/api/suggestions/${suggestionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Optimistically add messages
      setGroups((prev) =>
        prev.map((g) => {
          if (g.symbol !== symbol) return g;
          return {
            ...g,
            messages: [
              ...g.messages,
              {
                id: crypto.randomUUID(),
                suggestion_id: suggestionId,
                user_id: "",
                role: "user" as const,
                content: message,
                created_at: new Date().toISOString(),
              },
              {
                id: crypto.randomUUID(),
                suggestion_id: suggestionId,
                user_id: "",
                role: "assistant" as const,
                content: data.response,
                created_at: new Date().toISOString(),
              },
            ],
          };
        })
      );
      setChatInputs((prev) => ({ ...prev, [symbol]: "" }));
    } catch {
      // Error is visible via failed state
    } finally {
      setSendingChat(null);
    }
  };

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
          AI-generated recommendations per company
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {["all", "active", "very_strong", "strong", "medium", "weak"].map(
          (f) => (
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
          )
        )}
      </div>

      {/* Company Cards */}
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
        <div className="space-y-6">
          {filtered.map((group) => (
            <CompanyCard
              key={group.symbol}
              group={group}
              getActionIcon={getActionIcon}
              expandedChat={expandedChat}
              setExpandedChat={setExpandedChat}
              expandedHistory={expandedHistory}
              setExpandedHistory={setExpandedHistory}
              chatInput={chatInputs[group.symbol] || ""}
              setChatInput={(val) =>
                setChatInputs((prev) => ({
                  ...prev,
                  [group.symbol]: val,
                }))
              }
              sendMessage={sendMessage}
              sendingChat={sendingChat === group.symbol}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyCard({
  group,
  getActionIcon,
  expandedChat,
  setExpandedChat,
  expandedHistory,
  setExpandedHistory,
  chatInput,
  setChatInput,
  sendMessage,
  sendingChat,
}: {
  group: CompanyGroup;
  getActionIcon: (action: string) => React.ReactNode;
  expandedChat: string | null;
  setExpandedChat: (v: string | null) => void;
  expandedHistory: string | null;
  setExpandedHistory: (v: string | null) => void;
  chatInput: string;
  setChatInput: (v: string) => void;
  sendMessage: (suggestionId: string, symbol: string) => void;
  sendingChat: boolean;
}) {
  const { active: s, positions, messages, history, symbol } = group;
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isChatOpen = expandedChat === symbol;
  const isHistoryOpen = expandedHistory === symbol;

  useEffect(() => {
    if (isChatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, isChatOpen]);

  const exitLabel = getExitScoreLabel(s.exit_score ?? 0);
  const exitBg = getExitScoreBgColor(s.exit_score ?? 0);

  // Aggregate stock positions
  const stockPos = positions.filter((t) => t.instrument_type === "stock");
  const netShares = stockPos.reduce(
    (n, t) => n + (t.type === "buy" ? t.quantity : -t.quantity),
    0
  );
  const avgCost =
    netShares > 0
      ? stockPos
          .filter((t) => t.type === "buy")
          .reduce((s, t) => s + t.total_amount, 0) / netShares
      : 0;
  const optionPos = positions.filter(
    (t) =>
      t.instrument_type === "call_option" ||
      t.instrument_type === "put_option"
  );

  return (
    <div
      className={`bg-card border rounded-xl overflow-hidden transition-colors ${
        s.is_active
          ? "border-border hover:border-primary/30"
          : "border-border/50 opacity-60"
      }`}
    >
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <span className="font-bold text-2xl">{symbol}</span>
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${getSignalBgColor(s.signal_level)} ${getSignalColor(s.signal_level)}`}
          >
            {s.signal_level.replace("_", " ").toUpperCase()}
          </div>
          <div
            className={`flex items-center gap-1 ${getActionColor(s.action)}`}
          >
            {getActionIcon(s.action)}
            <span className="font-medium uppercase text-sm">{s.action}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {s.current_price && (
            <span className="text-muted-foreground">
              {formatCurrency(s.current_price)}
            </span>
          )}
          {s.confidence && (
            <span className="text-muted-foreground">
              {Math.round(s.confidence * 100)}% conf
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatDate(s.created_at)}
          </span>
        </div>
      </div>

      {/* Exit Score Bar */}
      {(s.exit_score ?? 0) > 0 && (
        <div className="px-6 pb-3">
          <div className="flex items-center gap-3">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Exit Score:</span>
            <div className="flex-1 bg-secondary rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${exitBg}`}
                style={{ width: `${s.exit_score ?? 0}%` }}
              />
            </div>
            <span className={`text-sm font-medium ${exitLabel.color}`}>
              {s.exit_score}/100 — {exitLabel.label}
            </span>
          </div>
        </div>
      )}

      {/* Analysis */}
      <div className="px-6 pb-4 space-y-4">
        <p className="text-foreground">{s.reasoning}</p>

        {/* Price Targets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {s.suggested_buy_price && (
            <PriceBox
              label="Buy Price"
              value={formatCurrency(s.suggested_buy_price)}
              color="text-green-400"
            />
          )}
          {s.suggested_sell_price && (
            <PriceBox
              label="Sell Price"
              value={formatCurrency(s.suggested_sell_price)}
              color="text-blue-400"
            />
          )}
          {s.stop_loss_price && (
            <PriceBox
              label="Stop Loss"
              value={formatCurrency(s.stop_loss_price)}
              color="text-red-400"
            />
          )}
          {s.risk_estimation && (
            <PriceBox
              label="Risk"
              value={s.risk_estimation.toUpperCase()}
              color="text-yellow-400"
            />
          )}
        </div>

        {/* Options Strategy */}
        {s.options_strategy && s.options_strategy.recommendation && (
          <div className="bg-secondary/50 rounded-lg p-4 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium">Options Strategy</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                {s.options_strategy.strategy_type.replace("_", " ").toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-foreground">
              {s.options_strategy.recommendation}
            </p>
            {s.options_strategy.details && (
              <p className="text-xs text-muted-foreground mt-1">
                {s.options_strategy.details}
              </p>
            )}
          </div>
        )}

        {/* Your Position */}
        {(netShares > 0 || optionPos.length > 0) && (
          <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Your Position
            </h3>
            {netShares > 0 && (
              <p className="text-sm">
                Holding{" "}
                <span className="font-medium text-foreground">
                  {netShares} shares
                </span>{" "}
                @ avg {formatCurrency(avgCost)}
              </p>
            )}
            {optionPos.map((opt) => (
              <p key={opt.id} className="text-sm mt-1">
                <span
                  className={
                    opt.instrument_type === "call_option"
                      ? "text-blue-400"
                      : "text-purple-400"
                  }
                >
                  {opt.instrument_type === "call_option" ? "CALL" : "PUT"}
                </span>{" "}
                {opt.contracts} contract{(opt.contracts ?? 0) > 1 ? "s" : ""} ·
                Strike {formatCurrency(opt.strike_price ?? 0)} · Expires{" "}
                {opt.expiration_date}
              </p>
            ))}
          </div>
        )}

        {/* Technical Indicators (compact) */}
        {s.technical_summary && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {s.technical_summary.trend && (
              <MiniIndicator label="Trend" value={s.technical_summary.trend} />
            )}
            {s.technical_summary.rsi !== undefined && (
              <MiniIndicator
                label="RSI"
                value={s.technical_summary.rsi.toFixed(1)}
              />
            )}
            {s.technical_summary.sma_20 !== undefined && (
              <MiniIndicator
                label="SMA 20"
                value={formatCurrency(s.technical_summary.sma_20)}
              />
            )}
            {s.technical_summary.macd !== undefined && (
              <MiniIndicator
                label="MACD"
                value={s.technical_summary.macd.toFixed(3)}
              />
            )}
            {s.time_horizon && (
              <MiniIndicator label="Horizon" value={s.time_horizon} />
            )}
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="px-6 py-3 border-t border-border flex items-center gap-3">
        <button
          onClick={() => setExpandedChat(isChatOpen ? null : symbol)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            isChatOpen
              ? "bg-primary/20 text-primary"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Chat ({messages.length / 2})
        </button>
        {history.length > 0 && (
          <button
            onClick={() =>
              setExpandedHistory(isHistoryOpen ? null : symbol)
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              isHistoryOpen
                ? "bg-primary/20 text-primary"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Past Analyses ({history.length})
          </button>
        )}
      </div>

      {/* Chat Thread */}
      {isChatOpen && (
        <div className="border-t border-border">
          <div className="max-h-80 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Ask a question about this analysis...
              </p>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p
                    className={`text-xs mt-1 ${
                      msg.role === "user"
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground"
                    }`}
                  >
                    {formatDate(msg.created_at)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-4 border-t border-border flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(s.id, symbol);
                }
              }}
              placeholder="Ask about this stock..."
              disabled={sendingChat}
              className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors text-sm disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(s.id, symbol)}
              disabled={sendingChat || !chatInput.trim()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {sendingChat ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {isHistoryOpen && history.length > 0 && (
        <div className="border-t border-border p-4 space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Past Analyses
          </h3>
          {history.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between py-2 px-3 bg-secondary/30 rounded-lg text-sm"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`font-medium uppercase ${getActionColor(h.action)}`}
                >
                  {h.action}
                </span>
                <span
                  className={`text-xs ${getSignalColor(h.signal_level)}`}
                >
                  {h.signal_level.replace("_", " ")}
                </span>
                {h.current_price && (
                  <span className="text-muted-foreground">
                    {formatCurrency(h.current_price)}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDate(h.created_at)}
              </span>
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

function MiniIndicator({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-secondary/50 rounded-lg p-2 text-center">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className="font-medium text-xs truncate">{value}</p>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Plus, Loader2, TrendingUp, TrendingDown, ArrowLeftRight, X,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Transaction, WatchlistItem, InstrumentType } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INSTRUMENT_LABELS: Record<InstrumentType, string> = {
  stock:       "Stock",
  call_option: "Call Option",
  put_option:  "Put Option",
};

const INSTRUMENT_DESCRIPTIONS: Record<InstrumentType, string> = {
  stock:       "Ordinary share; quantity = number of shares",
  call_option: "Right to BUY 100 shares per contract at the strike price",
  put_option:  "Right to SELL 100 shares per contract at the strike price",
};

function instrumentBadge(instrument: InstrumentType) {
  const base = "text-xs font-medium px-2 py-0.5 rounded-full";
  switch (instrument) {
    case "call_option":
      return <span className={`${base} bg-blue-500/20 text-blue-400`}>CALL</span>;
    case "put_option":
      return <span className={`${base} bg-purple-500/20 text-purple-400`}>PUT</span>;
    default:
      return null;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [watchlist, setWatchlist]       = useState<WatchlistItem[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showForm, setShowForm]         = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [formSymbol,     setFormSymbol]     = useState("");
  const [formInstrument, setFormInstrument] = useState<InstrumentType>("stock");
  const [formType,       setFormType]       = useState<"buy" | "sell">("buy");
  const [formQuantity,   setFormQuantity]   = useState("");   // shares for stock
  const [formContracts,  setFormContracts]  = useState("");   // contracts for options
  const [formPrice,      setFormPrice]      = useState("");   // premium / share price
  const [formStrike,     setFormStrike]     = useState("");
  const [formExpiry,     setFormExpiry]     = useState("");
  const [formNotes,      setFormNotes]      = useState("");
  const [formStatus,     setFormStatus]     = useState<"active" | "closed" | "pending">("active");

  const supabase = createClient();

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [txRes, wlRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("user_id", user.id).order("executed_at", { ascending: false }),
      supabase.from("watchlist").select("*").eq("user_id", user.id).eq("is_active", true),
    ]);

    if (txRes.data) setTransactions(txRes.data);
    if (wlRes.data) setWatchlist(wlRes.data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Net shares held for a symbol (stocks only, for short warning) ───────────
  const getNetShares = (symbol: string): number =>
    transactions
      .filter((t) => t.symbol === symbol && t.instrument_type === "stock")
      .reduce((net, t) => net + (t.type === "buy" ? t.quantity : -t.quantity), 0);

  const selectedSymbol  = formSymbol === "__custom" ? "" : formSymbol;
  const netSharesHeld   = selectedSymbol ? getNetShares(selectedSymbol) : 0;
  const isOption        = formInstrument !== "stock";
  const contractQty     = parseInt(formContracts) || 0;
  const shareQty        = parseFloat(formQuantity) || 0;
  const priceVal        = parseFloat(formPrice)    || 0;
  const totalPreview    = isOption
    ? contractQty * 100 * priceVal       // 1 contract = 100 shares
    : shareQty * priceVal;
  const wouldGoShort    = !isOption && formType === "sell" && shareQty > netSharesHeld;

  // ── Submit ──────────────────────────────────────────────────────────────────
  const addTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const effectiveSymbol = formSymbol === "__custom" ? "" : formSymbol;

    const payload: Record<string, unknown> = {
      user_id:         user.id,
      symbol:          effectiveSymbol.toUpperCase().trim(),
      instrument_type: formInstrument,
      type:            formType,
      status:          formStatus,
      price:           priceVal,
      notes:           formNotes.trim() || null,
    };

    if (isOption) {
      payload.contracts        = contractQty;
      payload.quantity         = contractQty * 100; // share-equivalent for AI context
      payload.strike_price     = parseFloat(formStrike);
      payload.expiration_date  = formExpiry;
    } else {
      payload.quantity         = shareQty;
      payload.strike_price     = null;
      payload.expiration_date  = null;
      payload.contracts        = null;
    }

    const { error } = await supabase.from("transactions").insert(payload);

    if (error) {
      setError(error.message);
    } else {
      setSuccess("Transaction added successfully");
      setShowForm(false);
      resetForm();
      fetchData();
    }
    setSaving(false);
  };

  const updateStatus = async (id: string, status: "active" | "closed" | "pending") => {
    const { error } = await supabase.from("transactions").update({ status }).eq("id", id);
    if (!error) setTransactions(transactions.map((t) => (t.id === id ? { ...t, status } : t)));
  };

  const resetForm = () => {
    setFormSymbol(""); setFormInstrument("stock"); setFormType("buy");
    setFormQuantity(""); setFormContracts(""); setFormPrice("");
    setFormStrike(""); setFormExpiry(""); setFormNotes(""); setFormStatus("active");
  };

  // ── Summary stats ───────────────────────────────────────────────────────────
  const totalBuys  = transactions.filter((t) => t.type === "buy").reduce((s, t) => s + t.total_amount, 0);
  const totalSells = transactions.filter((t) => t.type === "sell").reduce((s, t) => s + t.total_amount, 0);
  const netPnL     = totalSells - totalBuys;

  // ── Position summary (stocks only, net qty) ─────────────────────────────────
  const stockPositions = new Map<string, { bought: number; sold: number; qty: number; avgBuyPrice: number }>();
  transactions
    .filter((t) => t.instrument_type === "stock")
    .forEach((t) => {
      const pos = stockPositions.get(t.symbol) || { bought: 0, sold: 0, qty: 0, avgBuyPrice: 0 };
      if (t.type === "buy") {
        const prevCost = pos.avgBuyPrice * Math.max(pos.qty, 0);
        pos.bought += t.total_amount;
        pos.qty    += t.quantity;
        pos.avgBuyPrice = pos.qty > 0 ? (prevCost + t.total_amount) / pos.qty : t.price;
      } else {
        pos.sold += t.total_amount;
        pos.qty  -= t.quantity;
      }
      stockPositions.set(t.symbol, pos);
    });

  // ── Options positions ───────────────────────────────────────────────────────
  const optionPositions = transactions.filter(
    (t) => t.instrument_type === "call_option" || t.instrument_type === "put_option"
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-muted-foreground mt-1">Track stocks and options positions</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg transition-colors"
        >
          {showForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> Add Transaction</>}
        </button>
      </div>

      {/* Feedback */}
      {error   && <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 text-sm">{error}</div>}
      {success && <div className="bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg p-3 text-sm">{success}</div>}

      {/* Summary Stats */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground">Total Invested</p>
            <p className="text-2xl font-bold text-red-400">{formatCurrency(totalBuys)}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground">Total Returned</p>
            <p className="text-2xl font-bold text-green-400">{formatCurrency(totalSells)}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground">Net P&amp;L</p>
            <p className={`text-2xl font-bold ${netPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
              {netPnL >= 0 ? "+" : ""}{formatCurrency(netPnL)}
            </p>
          </div>
        </div>
      )}

      {/* ── Add Transaction Form ─────────────────────────────────────────────── */}
      {showForm && (
        <form onSubmit={addTransaction} className="bg-card border border-border rounded-xl p-6 space-y-5">
          <h2 className="text-lg font-semibold">New Transaction</h2>

          {/* Instrument type selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Instrument Type</label>
            <div className="grid grid-cols-3 gap-3">
              {(["stock", "call_option", "put_option"] as InstrumentType[]).map((inst) => (
                <button
                  key={inst}
                  type="button"
                  onClick={() => { setFormInstrument(inst); setFormQuantity(""); setFormContracts(""); }}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    formInstrument === inst
                      ? inst === "call_option"
                        ? "border-blue-500/50 bg-blue-500/10 text-foreground"
                        : inst === "put_option"
                          ? "border-purple-500/50 bg-purple-500/10 text-foreground"
                          : "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  <p className="font-medium text-sm">{INSTRUMENT_LABELS[inst]}</p>
                  <p className="text-xs mt-0.5 opacity-70 leading-tight">{INSTRUMENT_DESCRIPTIONS[inst]}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Symbol */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Symbol</label>
              <select
                value={formSymbol}
                onChange={(e) => setFormSymbol(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                required
              >
                <option value="">Select stock...</option>
                {watchlist.map((w) => (
                  <option key={w.id} value={w.symbol}>
                    {w.symbol}{w.company_name ? ` - ${w.company_name}` : ""}
                  </option>
                ))}
                <option value="__custom">Other (type manually)</option>
              </select>
              {formSymbol === "__custom" && (
                <input
                  type="text"
                  onChange={(e) => setFormSymbol(e.target.value)}
                  placeholder="e.g. AAPL"
                  className="w-full mt-2 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors uppercase"
                  required
                />
              )}
            </div>

            {/* Buy / Sell */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Action</label>
              <div className="flex gap-2">
                {(["buy", "sell"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFormType(t)}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-colors capitalize ${
                      formType === t
                        ? t === "buy"
                          ? "bg-green-500/20 text-green-400 border border-green-500/30"
                          : "bg-red-500/20 text-red-400 border border-red-500/30"
                        : "bg-secondary text-muted-foreground border border-border"
                    }`}
                  >
                    {isOption ? (t === "buy" ? "Buy to Open" : "Sell to Close") : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              {/* Show available shares for stock sells */}
              {!isOption && formType === "sell" && selectedSymbol && (
                <p className="text-xs mt-1.5 text-muted-foreground">
                  Holding:{" "}
                  <span className={netSharesHeld > 0 ? "text-green-400 font-medium" : "text-yellow-400 font-medium"}>
                    {netSharesHeld > 0 ? `${netSharesHeld} shares` : netSharesHeld === 0 ? "none" : `${Math.abs(netSharesHeld)} short`}
                  </span>
                </p>
              )}
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Status</label>
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as "active" | "closed" | "pending")}
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
              >
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            {/* Quantity — shares for stock, contracts for options */}
            {isOption ? (
              <div>
                <label className="block text-sm font-medium mb-1.5">Contracts</label>
                <input
                  type="number" step="1" min="1"
                  value={formContracts}
                  onChange={(e) => setFormContracts(e.target.value)}
                  placeholder="e.g. 5"
                  className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">1 contract = 100 shares</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1.5">Shares</label>
                <input
                  type="number" step="0.01" min="0"
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                  required
                />
              </div>
            )}

            {/* Price — per share for stock, premium per share for options */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {isOption ? "Premium (per share)" : "Price per Share"}
              </label>
              <input
                type="number" step="0.01" min="0"
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
                placeholder="0.00"
                className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                required
              />
              {isOption && <p className="text-xs text-muted-foreground mt-1">Premium × 100 × contracts = total cost</p>}
            </div>

            {/* Total preview */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Total Cost</label>
              <div className="bg-input border border-border rounded-lg px-4 py-2.5 text-muted-foreground">
                {totalPreview > 0 ? formatCurrency(totalPreview) : "$0.00"}
              </div>
            </div>

            {/* Options-only: Strike price */}
            {isOption && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Strike Price</label>
                <input
                  type="number" step="0.50" min="0"
                  value={formStrike}
                  onChange={(e) => setFormStrike(e.target.value)}
                  placeholder="e.g. 200.00"
                  className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                  required
                />
              </div>
            )}

            {/* Options-only: Expiry date */}
            {isOption && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Expiration Date</label>
                <input
                  type="date"
                  value={formExpiry}
                  onChange={(e) => setFormExpiry(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                  required
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Notes (optional)</label>
            <input
              type="text" value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder={isOption ? "e.g. Bought calls as hedge against short position" : "Any notes about this transaction"}
              className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
            />
          </div>

          {/* Short selling warning */}
          {wouldGoShort && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-lg p-3 text-sm">
              <strong>Short position notice:</strong> You hold <strong>{netSharesHeld} shares</strong> of{" "}
              {selectedSymbol} but are selling <strong>{shareQty}</strong>. This creates a{" "}
              <strong>short position of {shareQty - netSharesHeld} shares</strong>. Only proceed if intentional.
            </div>
          )}

          <button
            type="submit" disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Transaction
          </button>
        </form>
      )}

      {/* ── Transaction Table ──────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12">
            <ArrowLeftRight className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No transactions yet</p>
            <p className="text-sm text-muted-foreground mt-1">Add a stock or option trade above</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-sm text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Symbol</th>
                  <th className="px-5 py-3 font-medium">Details</th>
                  <th className="px-5 py-3 font-medium">Price</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isOpt = tx.instrument_type !== "stock";
                  return (
                    <tr key={tx.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          {tx.type === "buy"
                            ? <TrendingUp className="h-4 w-4 text-green-400" />
                            : <TrendingDown className="h-4 w-4 text-red-400" />}
                          <span className={`font-medium uppercase text-sm ${tx.type === "buy" ? "text-green-400" : "text-red-400"}`}>
                            {isOpt ? (tx.type === "buy" ? "Buy to Open" : "Sell to Close") : tx.type}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{tx.symbol}</span>
                          {instrumentBadge(tx.instrument_type)}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-muted-foreground">
                        {isOpt ? (
                          <div>
                            <p>{tx.contracts} contract{tx.contracts !== 1 ? "s" : ""} · Strike {formatCurrency(tx.strike_price ?? 0)}</p>
                            <p className="text-xs">Expires {tx.expiration_date}</p>
                          </div>
                        ) : (
                          <span>{tx.quantity} shares</span>
                        )}
                      </td>
                      <td className="px-5 py-4">{formatCurrency(tx.price)}{isOpt ? <span className="text-xs text-muted-foreground"> /sh</span> : ""}</td>
                      <td className="px-5 py-4 font-medium">{formatCurrency(tx.total_amount)}</td>
                      <td className="px-5 py-4">
                        <select
                          value={tx.status}
                          onChange={(e) => updateStatus(tx.id, e.target.value as "active" | "closed" | "pending")}
                          className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${
                            tx.status === "active"   ? "bg-green-500/20 text-green-400" :
                            tx.status === "closed"   ? "bg-gray-500/20 text-gray-400"  :
                                                       "bg-yellow-500/20 text-yellow-400"
                          }`}
                        >
                          <option value="active">Active</option>
                          <option value="closed">Closed</option>
                          <option value="pending">Pending</option>
                        </select>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground text-sm">{formatDate(tx.executed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Stock Positions Summary ───────────────────────────────────────────── */}
      {stockPositions.size > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Stock Positions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from(stockPositions.entries()).map(([sym, pos]) => {
              const pnl     = pos.sold - pos.bought;
              const isShort = pos.qty < 0;
              const isFlat  = pos.qty === 0;
              return (
                <div key={sym} className={`bg-secondary/50 border rounded-lg p-4 ${isShort ? "border-yellow-500/40" : "border-border"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{sym}</span>
                      {isShort && <span className="text-xs font-medium bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">SHORT</span>}
                      {isFlat  && <span className="text-xs font-medium bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded-full">FLAT</span>}
                    </div>
                    <span className={`text-sm font-medium ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Invested: {formatCurrency(pos.bought)} · Returned: {formatCurrency(pos.sold)}</p>
                    {isShort ? (
                      <p className="text-yellow-400">Short: {Math.abs(pos.qty)} shares owed{pos.avgBuyPrice > 0 ? ` · Avg buy: ${formatCurrency(pos.avgBuyPrice)}` : ""}</p>
                    ) : isFlat ? (
                      <p>Position closed</p>
                    ) : (
                      <p>Holding: {pos.qty} shares{pos.avgBuyPrice > 0 ? ` · Avg cost: ${formatCurrency(pos.avgBuyPrice)}` : ""}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Options Positions Summary ─────────────────────────────────────────── */}
      {optionPositions.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Options Positions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {optionPositions.map((tx) => {
              const isCall   = tx.instrument_type === "call_option";
              const daysLeft = tx.expiration_date
                ? Math.ceil((new Date(tx.expiration_date).getTime() - Date.now()) / 86400000)
                : null;
              return (
                <div key={tx.id} className={`bg-secondary/50 border rounded-lg p-4 ${
                  tx.status === "closed" ? "opacity-60 border-border" :
                  isCall ? "border-blue-500/30" : "border-purple-500/30"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{tx.symbol}</span>
                      {instrumentBadge(tx.instrument_type)}
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      tx.status === "active"  ? "bg-green-500/20 text-green-400" :
                      tx.status === "closed"  ? "bg-gray-500/20 text-gray-400"  :
                                                "bg-yellow-500/20 text-yellow-400"
                    }`}>{tx.status}</span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Strike: <span className="text-foreground font-medium">{formatCurrency(tx.strike_price ?? 0)}</span></p>
                    <p>Contracts: <span className="text-foreground">{tx.contracts}</span> ({(tx.contracts ?? 0) * 100} shares exposure)</p>
                    <p>Premium paid: <span className="text-foreground">{formatCurrency(tx.total_amount)}</span></p>
                    {daysLeft !== null && (
                      <p className={daysLeft <= 7 ? "text-red-400 font-medium" : daysLeft <= 30 ? "text-yellow-400" : ""}>
                        Expires: {tx.expiration_date} {daysLeft > 0 ? `(${daysLeft}d)` : <span className="text-red-400">EXPIRED</span>}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

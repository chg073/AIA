"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Plus,
  Trash2,
  Search,
  Loader2,
  Brain,
  Eye,
  RefreshCw,
} from "lucide-react";
import type { WatchlistItem } from "@/types";

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [adding, setAdding] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const supabase = createClient();

  const fetchWatchlist = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("watchlist")
      .select("*")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false });

    if (!error && data) {
      setWatchlist(data);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  const addStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim()) return;

    setAdding(true);
    setError(null);
    setSuccess(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("watchlist").insert({
      user_id: user.id,
      symbol: symbol.toUpperCase().trim(),
      company_name: companyName.trim() || null,
    });

    if (error) {
      if (error.code === "23505") {
        setError(`${symbol.toUpperCase()} is already in your watchlist`);
      } else {
        setError(error.message);
      }
    } else {
      setSuccess(`${symbol.toUpperCase()} added to watchlist`);
      setSymbol("");
      setCompanyName("");
      fetchWatchlist();
    }
    setAdding(false);
  };

  const removeStock = async (id: string, sym: string) => {
    const { error } = await supabase.from("watchlist").delete().eq("id", id);

    if (!error) {
      setWatchlist(watchlist.filter((w) => w.id !== id));
      setSuccess(`${sym} removed from watchlist`);
    }
  };

  const analyzeStock = async (sym: string) => {
    setAnalyzing(sym);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setSuccess(
        `Analysis complete for ${sym}: ${data.action.toUpperCase()} - ${data.signal_level.replace("_", " ").toUpperCase()}`
      );
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Analysis failed";
      setError(errorMessage);
    } finally {
      setAnalyzing(null);
    }
  };

  const analyzeAll = async () => {
    setError(null);
    setSuccess(null);

    for (const item of watchlist) {
      if (item.is_active) {
        await analyzeStock(item.symbol);
      }
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Watchlist</h1>
          <p className="text-muted-foreground mt-1">
            Manage stocks you want to monitor
          </p>
        </div>
        {watchlist.length > 0 && (
          <button
            onClick={analyzeAll}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-accent-foreground px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Analyze All
          </button>
        )}
      </div>

      {/* Feedback messages */}
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

      {/* Add Stock Form */}
      <form
        onSubmit={addStock}
        className="bg-card border border-border rounded-xl p-6"
      >
        <h2 className="text-lg font-semibold mb-4">Add Stock</h2>
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="Symbol (e.g. AAPL)"
              className="w-full bg-input border border-border rounded-lg pl-10 pr-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors uppercase"
              required
            />
          </div>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Company name (optional)"
            className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
          />
          <button
            type="submit"
            disabled={adding}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </button>
        </div>
      </form>

      {/* Watchlist */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : watchlist.length === 0 ? (
          <div className="text-center py-12">
            <Eye className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Your watchlist is empty</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add stock symbols above to start monitoring
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-sm text-muted-foreground">
                <th className="px-6 py-3 font-medium">Symbol</th>
                <th className="px-6 py-3 font-medium">Company</th>
                <th className="px-6 py-3 font-medium">Added</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                >
                  <td className="px-6 py-4">
                    <span className="font-bold text-lg">{item.symbol}</span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {item.company_name || "—"}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground text-sm">
                    {new Date(item.added_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full ${
                        item.is_active
                          ? "bg-green-500/20 text-green-400"
                          : "bg-gray-500/20 text-gray-400"
                      }`}
                    >
                      {item.is_active ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => analyzeStock(item.symbol)}
                        disabled={analyzing === item.symbol}
                        className="flex items-center gap-1.5 bg-accent/20 hover:bg-accent/30 text-accent px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
                        title="Run AI analysis"
                      >
                        {analyzing === item.symbol ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Brain className="h-3.5 w-3.5" />
                        )}
                        Analyze
                      </button>
                      <button
                        onClick={() => removeStock(item.id, item.symbol)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1.5"
                        title="Remove from watchlist"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

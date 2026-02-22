import { createClient } from "@/lib/supabase/server";
import {
  TrendingUp,
  TrendingDown,
  Eye,
  Lightbulb,
  ArrowLeftRight,
  DollarSign,
} from "lucide-react";
import { formatCurrency, getSignalColor, getActionColor } from "@/lib/utils";
import Link from "next/link";
import type { Suggestion, Transaction, WatchlistItem } from "@/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch all data in parallel
  const [watchlistRes, suggestionsRes, transactionsRes] = await Promise.all([
    supabase
      .from("watchlist")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true),
    supabase
      .from("suggestions")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("executed_at", { ascending: false })
      .limit(10),
  ]);

  const watchlist: WatchlistItem[] = watchlistRes.data || [];
  const suggestions: Suggestion[] = suggestionsRes.data || [];
  const transactions: Transaction[] = transactionsRes.data || [];

  // Calculate P&L from transactions
  const { totalInvested, totalReturns } = calculatePnL(transactions);
  const netPnL = totalReturns - totalInvested;
  const pnlPercent =
    totalInvested > 0 ? ((netPnL / totalInvested) * 100).toFixed(2) : "0.00";

  const strongSignals = suggestions.filter(
    (s) => s.signal_level === "very_strong" || s.signal_level === "strong"
  );

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Your investment overview at a glance
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={<Eye className="h-5 w-5" />}
          label="Watching"
          value={watchlist.length.toString()}
          subtitle="stocks monitored"
          color="text-blue-400"
        />
        <StatCard
          icon={<Lightbulb className="h-5 w-5" />}
          label="Active Signals"
          value={suggestions.length.toString()}
          subtitle={`${strongSignals.length} strong`}
          color="text-yellow-400"
        />
        <StatCard
          icon={<ArrowLeftRight className="h-5 w-5" />}
          label="Transactions"
          value={transactions.length.toString()}
          subtitle="total trades"
          color="text-purple-400"
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Net P&L"
          value={formatCurrency(netPnL)}
          subtitle={`${Number(pnlPercent) >= 0 ? "+" : ""}${pnlPercent}%`}
          color={netPnL >= 0 ? "text-green-400" : "text-red-400"}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Suggestions */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Latest Suggestions</h2>
            <Link
              href="/dashboard/suggestions"
              className="text-sm text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          {suggestions.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No suggestions yet. Add stocks to your watchlist and run analysis.
            </p>
          ) : (
            <div className="space-y-3">
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex items-center justify-between py-3 border-b border-border last:border-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{suggestion.symbol}</span>
                      <span
                        className={`text-xs font-medium uppercase ${getActionColor(suggestion.action)}`}
                      >
                        {suggestion.action}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate max-w-[280px]">
                      {suggestion.reasoning}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-sm font-medium ${getSignalColor(suggestion.signal_level)}`}
                    >
                      {suggestion.signal_level.replace("_", " ").toUpperCase()}
                    </span>
                    {suggestion.current_price && (
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(suggestion.current_price)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Transactions */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent Transactions</h2>
            <Link
              href="/dashboard/transactions"
              className="text-sm text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          {transactions.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No transactions yet. Start tracking your trades.
            </p>
          ) : (
            <div className="space-y-3">
              {transactions.slice(0, 5).map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-3 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-3">
                    {tx.type === "buy" ? (
                      <TrendingUp className="h-4 w-4 text-green-400" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-400" />
                    )}
                    <div>
                      <span className="font-medium">{tx.symbol}</span>
                      <p className="text-sm text-muted-foreground">
                        {tx.quantity} shares @ {formatCurrency(tx.price)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-medium ${tx.type === "buy" ? "text-green-400" : "text-red-400"}`}
                    >
                      {tx.type === "buy" ? "-" : "+"}
                      {formatCurrency(tx.total_amount)}
                    </span>
                    <p className="text-xs text-muted-foreground capitalize">
                      {tx.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Watchlist Preview */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Watchlist</h2>
          <Link
            href="/dashboard/watchlist"
            className="text-sm text-primary hover:underline"
          >
            Manage
          </Link>
        </div>
        {watchlist.length === 0 ? (
          <div className="text-center py-8">
            <Eye className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              No stocks in your watchlist yet.
            </p>
            <Link
              href="/dashboard/watchlist"
              className="text-primary hover:underline text-sm mt-2 inline-block"
            >
              Add your first stock
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {watchlist.map((item) => (
              <div
                key={item.id}
                className="bg-secondary/50 border border-border rounded-lg p-3 text-center hover:border-primary/30 transition-colors"
              >
                <p className="font-bold text-lg">{item.symbol}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.company_name || item.symbol}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtitle,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 text-muted-foreground mb-3">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function calculatePnL(transactions: Transaction[]) {
  let totalInvested = 0;
  let totalReturns = 0;

  transactions.forEach((tx) => {
    if (tx.type === "buy") {
      totalInvested += tx.total_amount;
    } else {
      totalReturns += tx.total_amount;
    }
  });

  return { totalInvested, totalReturns };
}

"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import type { LiveQuote as LiveQuoteData } from "@/types";

interface Props {
  symbol: string;
  /** Price the AI used when generating the suggestion. */
  analyzedPrice?: number | null;
  /** Layout variant — compact for table rows, full for cards. */
  variant?: "compact" | "full";
  className?: string;
}

// Module-level in-flight de-dup so 8 sibling cards don't all fire 8 requests.
const inflight = new Map<string, Promise<LiveQuoteData | null>>();
const cache = new Map<string, { quote: LiveQuoteData; ts: number }>();
const CACHE_MS = 60_000;

async function getQuote(symbol: string): Promise<LiveQuoteData | null> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.quote;
  if (inflight.has(key)) return inflight.get(key)!;
  const p = (async () => {
    try {
      const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = await res.json();
      const q: LiveQuoteData | undefined = data?.quotes?.[key];
      if (q) {
        cache.set(key, { quote: q, ts: Date.now() });
        return q;
      }
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export default function LiveQuote({
  symbol,
  analyzedPrice,
  variant = "compact",
  className = "",
}: Props) {
  const [quote, setQuote] = useState<LiveQuoteData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getQuote(symbol).then((q) => {
      if (!cancelled) {
        setQuote(q);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) {
    return (
      <span className={`text-xs text-muted-foreground ${className}`}>…</span>
    );
  }

  if (!quote) {
    if (analyzedPrice) {
      return (
        <span className={`text-sm text-muted-foreground ${className}`}>
          {formatCurrency(analyzedPrice)}
        </span>
      );
    }
    return null;
  }

  const dayUp = quote.change >= 0;
  const drift =
    analyzedPrice && analyzedPrice > 0
      ? ((quote.price - analyzedPrice) / analyzedPrice) * 100
      : null;

  if (variant === "compact") {
    return (
      <span className={`text-sm ${className}`}>
        <span className="font-medium text-foreground">
          {formatCurrency(quote.price)}
        </span>
        <span
          className={`ml-1.5 text-xs ${dayUp ? "text-green-400" : "text-red-400"}`}
        >
          {dayUp ? "+" : ""}
          {quote.changePercent.toFixed(2)}%
        </span>
      </span>
    );
  }

  // Full variant — used on suggestion cards
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-foreground">
          {formatCurrency(quote.price)}
        </span>
        <span
          className={`text-xs font-medium ${dayUp ? "text-green-400" : "text-red-400"}`}
        >
          {dayUp ? "+" : ""}
          {quote.changePercent.toFixed(2)}% today
        </span>
        <span className="text-[10px] uppercase tracking-wider text-success/80 bg-success/10 px-1.5 py-0.5 rounded">
          LIVE
        </span>
      </div>
      {analyzedPrice && (
        <div className="text-[11px] text-muted-foreground">
          Analyzed at {formatCurrency(analyzedPrice)}
          {drift !== null && Math.abs(drift) >= 0.5 && (
            <span className={drift >= 0 ? "text-green-400/80" : "text-red-400/80"}>
              {" "}
              ({drift >= 0 ? "+" : ""}
              {drift.toFixed(1)}% since)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

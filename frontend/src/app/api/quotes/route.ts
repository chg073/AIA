import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/quotes?symbols=AAPL,MSFT,NVDA
 *   Returns live Yahoo Finance quotes for the given symbols, capped at 25
 *   per request. Used by the dashboard to show *real* current prices next
 *   to the AI's stored analyzed price.
 *
 * Response: { quotes: { AAPL: { price, change, changePercent, previousClose } } }
 */

const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

interface LiveQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
}

async function fetchQuote(symbol: string): Promise<LiveQuote | null> {
  try {
    const res = await fetch(
      `${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        // Cache for 60s at the edge; live enough, cheap on Yahoo
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? 0;
    const prev = meta.previousClose ?? meta.chartPreviousClose ?? price;
    const change = price - prev;
    return {
      symbol: meta.symbol ?? symbol,
      price,
      change,
      changePercent: prev > 0 ? (change / prev) * 100 : 0,
      previousClose: prev,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  // Require an authenticated user so this isn't an open proxy
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const raw = url.searchParams.get("symbols");
  if (!raw) return NextResponse.json({ quotes: {} });

  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)),
    ),
  ).slice(0, 25);

  if (symbols.length === 0) return NextResponse.json({ quotes: {} });

  const results = await Promise.all(symbols.map(fetchQuote));
  const quotes: Record<string, LiveQuote> = {};
  for (const q of results) {
    if (q) quotes[q.symbol.toUpperCase()] = q;
  }

  return NextResponse.json({ quotes });
}

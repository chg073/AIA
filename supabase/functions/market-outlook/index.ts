/**
 * Supabase Edge Function: market-outlook
 *
 * Once per day (after analyze-stocks finishes) — or on-demand — produces a
 * top-level "Should I be buying or not?" view per user. Combines:
 *   - SPY market regime (price vs SMA200, weekly RSI, YTD/1y returns)
 *   - Per-user portfolio aggregation (count of buy/hold/sell/watch signals,
 *     avg exit score across active suggestions)
 * Sends both to the AI for a single-paragraph synthesis with top priorities.
 *
 * Writes one row per user per run into `market_outlooks` (history is kept;
 * the dashboard reads the most recent row).
 *
 * Trigger:
 *   {} (no body) — runs for ALL users with at least one watchlist item
 *   { "user_id": "<uuid>", "force": true } — runs for a single user
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockDailyData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SpyRegime {
  price: number;
  return_ytd: number | null;
  return_1y: number | null;
  above_sma200: boolean;
  rsi_weekly: number | null;
  regime: "bull" | "bear" | "transitional";
}

interface AggregatedSignals {
  buy: number;
  hold: number;
  sell: number;
  watch: number;
  avg_exit_score: number | null;
  watchlist_size: number;
  top_buy_candidates: Array<{ symbol: string; signal_level: string; exit_score: number | null }>;
  highest_exit_score: Array<{ symbol: string; exit_score: number; action: string }>;
}

interface AIOutlook {
  overall_stance: string;
  headline: string;
  reasoning: string;
  cash_recommendation: string;
  top_priorities: Array<{ symbol: string; action: string; why: string }>;
}

// ─── Yahoo Finance helpers ───────────────────────────────────────────────────

const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

async function fetchDailyHistory(symbol: string): Promise<{ price: number; daily: StockDailyData[] } | null> {
  try {
    const res = await fetch(`${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5y`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result || !result.timestamp) return null;
    const price = result.meta?.regularMarketPrice ?? 0;
    const { timestamp, indicators } = result;
    const q = indicators.quote[0];
    const daily: StockDailyData[] = [];
    for (let i = 0; i < timestamp.length; i++) {
      const close = q.close[i] ?? 0;
      if (close > 0) {
        daily.push({
          date: new Date(timestamp[i] * 1000).toISOString().split("T")[0],
          open: q.open[i] ?? 0,
          high: q.high[i] ?? 0,
          low: q.low[i] ?? 0,
          close,
          volume: q.volume[i] ?? 0,
        });
      }
    }
    daily.sort((a, b) => a.date.localeCompare(b.date));
    return { price, daily };
  } catch {
    return null;
  }
}

// ─── Indicators ──────────────────────────────────────────────────────────────

function calcSMA(data: StockDailyData[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((s, d) => s + d.close, 0) / period;
}

function calcRSI(data: StockDailyData[], period = 14): number | null {
  if (data.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = data.length - period; i < data.length; i++) {
    const delta = data[i].close - data[i - 1].close;
    if (delta > 0) gains += delta; else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function resampleToWeekly(data: StockDailyData[]): StockDailyData[] {
  if (data.length === 0) return [];
  const buckets = new Map<string, StockDailyData[]>();
  for (const d of data) {
    const date = new Date(d.date + "T00:00:00Z");
    const day = date.getUTCDay();
    const offsetToFri = (5 - day + 7) % 7;
    const friday = new Date(date);
    friday.setUTCDate(date.getUTCDate() + offsetToFri);
    const key = friday.toISOString().split("T")[0];
    const arr = buckets.get(key) ?? [];
    arr.push(d);
    buckets.set(key, arr);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bars]) => ({
      date,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    }));
}

function returnOverDays(data: StockDailyData[], days: number): number | null {
  if (data.length < days + 1) return null;
  const now = data[data.length - 1].close;
  const past = data[data.length - 1 - days].close;
  if (past <= 0) return null;
  return (now - past) / past;
}

function buildSpyRegime(price: number, daily: StockDailyData[]): SpyRegime {
  const sma200 = calcSMA(daily, 200);
  const weekly = resampleToWeekly(daily);
  const rsiW = calcRSI(weekly, 14);
  const above = sma200 !== null ? price > sma200 : false;
  const r1y = returnOverDays(daily, 252);

  const year = daily.length > 0 ? new Date(daily[daily.length - 1].date).getUTCFullYear() : null;
  let ytd: number | null = null;
  if (year !== null) {
    const first = daily.find((d) => new Date(d.date).getUTCFullYear() === year);
    if (first && first.close > 0) ytd = (price - first.close) / first.close;
  }

  // Regime: bull = above SMA200 + positive 1y. Bear = below + negative 1y. Else transitional.
  let regime: "bull" | "bear" | "transitional" = "transitional";
  if (above && (r1y ?? 0) > 0.05) regime = "bull";
  else if (!above && (r1y ?? 0) < -0.05) regime = "bear";

  return {
    price,
    return_ytd: ytd,
    return_1y: r1y,
    above_sma200: above,
    rsi_weekly: rsiW,
    regime,
  };
}

// ─── Portfolio aggregation ──────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function aggregateSignals(suggestions: any[], watchlistSize: number): AggregatedSignals {
  const counts = { buy: 0, hold: 0, sell: 0, watch: 0 };
  let exitSum = 0;
  let exitCount = 0;
  for (const s of suggestions) {
    if (s.action in counts) counts[s.action as keyof typeof counts]++;
    if (typeof s.exit_score === "number") {
      exitSum += s.exit_score;
      exitCount++;
    }
  }
  const topBuy = suggestions
    .filter((s) => s.action === "buy")
    .sort((a, b) => {
      const order = { very_strong: 4, strong: 3, medium: 2, weak: 1 } as Record<string, number>;
      return (order[b.signal_level] ?? 0) - (order[a.signal_level] ?? 0);
    })
    .slice(0, 5)
    .map((s) => ({
      symbol: s.symbol,
      signal_level: s.signal_level,
      exit_score: s.exit_score,
    }));
  const highExit = suggestions
    .filter((s) => (s.exit_score ?? 0) >= 60)
    .sort((a, b) => (b.exit_score ?? 0) - (a.exit_score ?? 0))
    .slice(0, 5)
    .map((s) => ({
      symbol: s.symbol,
      exit_score: s.exit_score,
      action: s.action,
    }));
  return {
    ...counts,
    avg_exit_score: exitCount > 0 ? exitSum / exitCount : null,
    watchlist_size: watchlistSize,
    top_buy_candidates: topBuy,
    highest_exit_score: highExit,
  };
}

// ─── AI synthesis ────────────────────────────────────────────────────────────

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}

function buildOutlookPrompt(
  prefs: { risk_level: string; investment_style: string },
  spy: SpyRegime,
  agg: AggregatedSignals,
): string {
  return `You are a long-term portfolio strategist. Given the market context and the user's current portfolio rollup, write a SINGLE actionable outlook.

## User Profile
- Risk: ${prefs.risk_level}
- Style: ${prefs.investment_style}

## Market Regime (from SPY)
- Current SPY: $${spy.price.toFixed(2)}
- YTD return: ${fmtPct(spy.return_ytd)} | 1-year return: ${fmtPct(spy.return_1y)}
- Price above SMA200: ${spy.above_sma200 ? "YES" : "NO"}
- Weekly RSI: ${spy.rsi_weekly !== null ? spy.rsi_weekly.toFixed(1) : "N/A"}
- Regime classification: **${spy.regime.toUpperCase()}**

## User's Portfolio (signals across ${agg.watchlist_size} watched stocks)
- BUY: ${agg.buy} · HOLD: ${agg.hold} · SELL: ${agg.sell} · WATCH: ${agg.watch}
- Average exit score: ${agg.avg_exit_score !== null ? agg.avg_exit_score.toFixed(1) + "/100" : "N/A"}
- Top BUY candidates: ${agg.top_buy_candidates.length > 0 ? agg.top_buy_candidates.map((c) => `${c.symbol} (${c.signal_level})`).join(", ") : "none"}
- Names with high exit score (consider trimming): ${agg.highest_exit_score.length > 0 ? agg.highest_exit_score.map((c) => `${c.symbol} (${c.exit_score})`).join(", ") : "none"}

## Mandate
- Long-term horizon (months to years). Don't chase intraday moves.
- "overall_stance" must be one of: deploy_capital, cautious_buy, hold, defensive, reduce_exposure
- Be concrete. Reference SPY regime + specific symbols from the portfolio rollup.
- Empty watchlist (${agg.watchlist_size === 0 ? "TRUE" : "FALSE"}): if true, focus on market regime and the "go to Discover" suggestion.

## Output
Respond ONLY with a valid JSON object — no markdown, no code fences:
{
  "overall_stance": "deploy_capital|cautious_buy|hold|defensive|reduce_exposure",
  "headline": "<single-sentence takeaway, e.g. 'Bull market intact — deploy capital incrementally into your strongest names'>",
  "reasoning": "<2-4 sentences citing both SPY regime and the user's signal mix>",
  "cash_recommendation": "<1 sentence on cash level, e.g. 'Hold 10-15% cash for pullbacks given elevated RSI'>",
  "top_priorities": [
    { "symbol": "<ticker>", "action": "buy|sell|hold|trim|watch", "why": "<1 sentence>" }
  ]
}`;
}

async function callGroq(prompt: string): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY not set");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Groq error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("No response from Groq");
  return text;
}

async function callGemini(prompt: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const BASE = "https://generativelanguage.googleapis.com";

  const pinned = Deno.env.get("GEMINI_MODEL")?.trim();
  let candidates: string[];
  if (pinned) {
    candidates = [pinned];
  } else {
    const modelsRes = await fetch(`${BASE}/v1beta/models?key=${key}`);
    if (!modelsRes.ok) throw new Error(`Gemini model discovery failed (${modelsRes.status})`);
    const modelsData = await modelsRes.json();
    const EXCLUDE = ["tts", "imagen", "veo", "embedding", "aqa", "bisheng"];
    candidates = (modelsData.models ?? [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
        m.supportedGenerationMethods?.includes("generateContent") &&
        !EXCLUDE.some((p) => m.name.toLowerCase().includes(p))
      )
      .map((m: { name: string }) => m.name.replace("models/", ""))
      .sort((a: string, b: string) => {
        const score = (m: string) => {
          const lm = m.toLowerCase();
          let s = 0;
          if (lm.includes("latest")) s += 10000;
          const v = lm.match(/gemini-(\d+(?:\.\d+)?)/);
          if (v) s += parseFloat(v[1]) * 1000;
          if (lm.includes("flash")) s += 100;
          if (!lm.includes("preview") && !lm.includes("exp")) s += 50;
          else if (lm.includes("preview")) s += 20;
          return s;
        };
        return score(b) - score(a);
      });
  }
  for (const model of candidates) {
    for (const version of ["v1beta", "v1"]) {
      const url = `${BASE}/${version}/models/${model}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log(`[market-outlook] Gemini model used: ${model} (${version})`);
          return text;
        }
        break;
      }
      if (res.status === 429) throw new Error("Gemini rate limit hit");
      if (res.status === 404) continue;
      break;
    }
  }
  throw new Error("All Gemini models failed");
}

function parseJson(text: string): Partial<AIOutlook> {
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error(
      `[market-outlook] JSON parse failed: ${err}. Raw (first 1000): ${text.slice(0, 1000)}`,
    );
    return {};
  }
}

function sanitizeOutlook(raw: Partial<AIOutlook>): AIOutlook {
  const VALID_STANCES = [
    "deploy_capital",
    "cautious_buy",
    "hold",
    "defensive",
    "reduce_exposure",
  ] as const;
  return {
    overall_stance: VALID_STANCES.includes(raw.overall_stance as typeof VALID_STANCES[number])
      ? raw.overall_stance!
      : "hold",
    headline: raw.headline?.trim() || "No clear directional read at this time.",
    reasoning: raw.reasoning?.trim() || "AI did not return reasoning.",
    cash_recommendation:
      raw.cash_recommendation?.trim() || "Maintain your typical cash allocation.",
    top_priorities: Array.isArray(raw.top_priorities)
      ? raw.top_priorities.slice(0, 6).map((p) => ({
          symbol: (p.symbol ?? "").toUpperCase().trim(),
          action: p.action ?? "watch",
          why: p.why ?? "",
        }))
      : [],
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const provider = Deno.env.get("AI_PROVIDER") ?? "groq";

    let body: { user_id?: string; force?: boolean } = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const singleUserId = body.user_id;

    // 1. Fetch SPY once (shared across all users)
    const spyData = await fetchDailyHistory("SPY");
    if (!spyData) {
      throw new Error("Could not fetch SPY market data");
    }
    const spy = buildSpyRegime(spyData.price, spyData.daily);
    console.log(`[market-outlook] SPY regime: ${spy.regime} @ $${spy.price.toFixed(2)}`);

    // 2. Load target users
    let usersQuery = supabase
      .from("profiles")
      .select("id, risk_level, investment_style");
    if (singleUserId) usersQuery = usersQuery.eq("id", singleUserId);
    const { data: users, error: uErr } = await usersQuery;
    if (uErr) throw new Error(`Failed to load profiles: ${uErr.message}`);
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ message: "No users" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const results: Array<{ user_id: string; stance?: string; error?: string }> = [];

    for (const user of users) {
      try {
        const [sugRes, watchRes] = await Promise.all([
          supabase
            .from("suggestions")
            .select("symbol, action, signal_level, exit_score")
            .eq("user_id", user.id)
            .eq("is_active", true),
          supabase
            .from("watchlist")
            .select("symbol")
            .eq("user_id", user.id)
            .eq("is_active", true),
        ]);

        const suggestions = sugRes.data ?? [];
        const watchlistSize = (watchRes.data ?? []).length;

        // Skip users with no portfolio activity
        if (suggestions.length === 0 && watchlistSize === 0) {
          results.push({ user_id: user.id, stance: "skipped_empty" });
          continue;
        }

        const agg = aggregateSignals(suggestions, watchlistSize);
        const prompt = buildOutlookPrompt(user, spy, agg);
        const rawText = provider === "gemini" ? await callGemini(prompt) : await callGroq(prompt);
        const parsed = parseJson(rawText);
        const outlook = sanitizeOutlook(parsed);

        const { error: insErr } = await supabase.from("market_outlooks").insert({
          user_id: user.id,
          market_regime: spy.regime,
          spy_price: spy.price,
          spy_return_ytd: spy.return_ytd,
          spy_return_1y: spy.return_1y,
          spy_above_sma200: spy.above_sma200,
          spy_rsi_weekly: spy.rsi_weekly,
          buy_signals: agg.buy,
          hold_signals: agg.hold,
          sell_signals: agg.sell,
          watch_signals: agg.watch,
          avg_exit_score: agg.avg_exit_score,
          watchlist_size: agg.watchlist_size,
          overall_stance: outlook.overall_stance,
          headline: outlook.headline,
          reasoning: outlook.reasoning,
          cash_recommendation: outlook.cash_recommendation,
          top_priorities: outlook.top_priorities,
        });
        if (insErr) throw new Error(insErr.message);

        results.push({ user_id: user.id, stance: outlook.overall_stance });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[market-outlook] user ${user.id}: ${msg}`);
        results.push({ user_id: user.id, error: msg });
      }
    }

    return new Response(
      JSON.stringify({
        market_regime: spy.regime,
        users: users.length,
        results,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[market-outlook] Fatal: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

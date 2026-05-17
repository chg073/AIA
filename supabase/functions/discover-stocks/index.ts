/**
 * Supabase Edge Function: discover-stocks
 *
 * Pulls public Yahoo Finance screeners to surface stocks the user is NOT already
 * watching, scores them on long-term momentum (1y return, golden cross, distance
 * from 52w high, etc.), then sends the top candidates to the AI for per-user
 * curation based on each user's risk profile.
 *
 * Output: rows in the `discoveries` table. The frontend `Discover` page lets
 * the user accept (add to watchlist) or dismiss each idea.
 *
 * Schedule (see migration): once weekly, Saturday 13:00 UTC.
 * Can also be invoked manually with `{ "force": true, "user_id": "<uuid>" }` to
 * run for a single user (used by the dashboard "Refresh" button).
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

interface ScreenerCandidate {
  symbol: string;
  company_name: string | null;
  market_cap: number | null;
  source: string;
}

interface LongTermMetrics {
  return_1m: number | null;
  return_3m: number | null;
  return_6m: number | null;
  return_1y: number | null;
  return_3y: number | null;
  return_ytd: number | null;
  rsi_weekly: number | null;
  sma_50: number | null;
  sma_200: number | null;
  golden_cross: boolean;
  high_52w: number | null;
  low_52w: number | null;
  distance_from_52w_high: number | null;
  volume_surge_ratio: number | null;
}

interface ScoredCandidate extends ScreenerCandidate {
  current_price: number;
  metrics: LongTermMetrics;
  momentum_score: number;
}

interface AICuratedCandidate {
  symbol: string;
  thesis?: string;
  risk?: string;
  horizon?: string;
  recommended?: boolean;
}

// ─── Yahoo Finance helpers ───────────────────────────────────────────────────

const YF_HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };

const SCREENERS = [
  "day_gainers",
  "most_actives",
  "growth_technology_stocks",
  "undervalued_growth_stocks",
  "undervalued_large_caps",
  "small_cap_gainers",
];

async function fetchScreener(scrId: string, count = 50): Promise<ScreenerCandidate[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}`;
  try {
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) return [];
    const json = await res.json();
    const quotes = json.finance?.result?.[0]?.quotes ?? [];
    return quotes
      .map((q: { symbol?: string; shortName?: string; longName?: string; marketCap?: number }) => ({
        symbol: q.symbol ?? "",
        company_name: q.longName ?? q.shortName ?? null,
        market_cap: q.marketCap ?? null,
        source: scrId,
      }))
      .filter((c: ScreenerCandidate) => !!c.symbol);
  } catch (err) {
    console.error(`[discover-stocks] screener ${scrId} failed: ${err}`);
    return [];
  }
}

async function fetchDailyHistory(symbol: string): Promise<{ price: number; daily: StockDailyData[] } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5y`;
  try {
    const res = await fetch(url, { headers: YF_HEADERS });
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

function buildLongTermMetrics(data: StockDailyData[]): LongTermMetrics {
  const weekly = resampleToWeekly(data);
  const sma50 = calcSMA(data, 50);
  const sma200 = calcSMA(data, 200);

  const last252 = data.slice(-252);
  const high52 = last252.length > 0 ? Math.max(...last252.map((d) => d.high)) : null;
  const low52 = last252.length > 0 ? Math.min(...last252.map((d) => d.low)) : null;
  const lastClose = data.length > 0 ? data[data.length - 1].close : null;
  const distFromHigh =
    high52 !== null && lastClose !== null && high52 > 0
      ? (lastClose - high52) / high52
      : null;

  const avg = (slice: StockDailyData[]) =>
    slice.length === 0 ? 0 : slice.reduce((s, d) => s + d.volume, 0) / slice.length;
  const recentAvgVol = avg(data.slice(-30));
  const yearAvgVol = avg(data.slice(-252));
  const volumeSurge = yearAvgVol > 0 ? recentAvgVol / yearAvgVol : null;

  const year = data.length > 0 ? new Date(data[data.length - 1].date).getUTCFullYear() : null;
  let ytdReturn: number | null = null;
  if (year !== null) {
    const firstOfYear = data.find((d) => new Date(d.date).getUTCFullYear() === year);
    if (firstOfYear && lastClose !== null && firstOfYear.close > 0) {
      ytdReturn = (lastClose - firstOfYear.close) / firstOfYear.close;
    }
  }

  return {
    return_1m: returnOverDays(data, 21),
    return_3m: returnOverDays(data, 63),
    return_6m: returnOverDays(data, 126),
    return_1y: returnOverDays(data, 252),
    return_3y: returnOverDays(data, 756),
    return_ytd: ytdReturn,
    rsi_weekly: calcRSI(weekly, 14),
    sma_50: sma50,
    sma_200: sma200,
    golden_cross: sma50 !== null && sma200 !== null ? sma50 > sma200 : false,
    high_52w: high52,
    low_52w: low52,
    distance_from_52w_high: distFromHigh,
    volume_surge_ratio: volumeSurge,
  };
}

function momentumScore(m: LongTermMetrics): number {
  let score = 0;
  if (m.return_1y !== null) score += Math.max(0, Math.min(35, m.return_1y * 35));
  if (m.return_6m !== null) score += Math.max(0, Math.min(15, m.return_6m * 25));
  if (m.return_3m !== null) score += Math.max(0, Math.min(10, m.return_3m * 25));
  if (m.golden_cross) score += 15;
  if (m.distance_from_52w_high !== null) {
    if (m.distance_from_52w_high > -0.05) score += 10;
    else if (m.distance_from_52w_high > -0.15) score += 6;
  }
  if (m.volume_surge_ratio !== null && m.volume_surge_ratio > 1) {
    score += Math.min(10, (m.volume_surge_ratio - 1) * 10);
  }
  if (m.rsi_weekly !== null && m.rsi_weekly > 75) {
    score -= (m.rsi_weekly - 75) * 0.8;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── AI curation ─────────────────────────────────────────────────────────────

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}

function buildCurationPrompt(
  candidates: ScoredCandidate[],
  prefs: { risk_level: string; investment_style: string },
): string {
  const rows = candidates.slice(0, 30).map((c, i) => {
    const m = c.metrics;
    return `${i + 1}. ${c.symbol} (${c.company_name ?? "—"})
   Price $${c.current_price.toFixed(2)} · MCap ${c.market_cap ? "$" + (c.market_cap / 1e9).toFixed(1) + "B" : "N/A"} · Source ${c.source}
   Returns: 1m ${fmtPct(m.return_1m)} · 6m ${fmtPct(m.return_6m)} · 1y ${fmtPct(m.return_1y)} · 3y ${fmtPct(m.return_3y)}
   Weekly RSI ${m.rsi_weekly !== null ? m.rsi_weekly.toFixed(1) : "N/A"} · ${m.golden_cross ? "GOLDEN CROSS" : "DEATH CROSS"} · Dist from 52w high ${fmtPct(m.distance_from_52w_high)}
   Volume surge ${m.volume_surge_ratio !== null ? m.volume_surge_ratio.toFixed(2) + "x" : "N/A"} · Momentum score ${c.momentum_score}/100`;
  }).join("\n\n");

  return `You are a long-term investment scout (Buffett/Lynch school). From the candidate list below, pick AT LEAST 5 stocks (up to 8) worth surfacing as long-term opportunities for a ${prefs.risk_level} risk investor.

## Rules
- Prefer stocks with a confirmed long-term uptrend (golden cross) and strong 1-year returns.
- Acknowledge overbought stocks (weekly RSI > 80) but you may still pick them as "watch and wait for pullback" with recommended=false.
- Be candid about risks (concentration, valuation, sector rotation).
- Horizon must be expressed in months or years.
- The "symbol" field MUST be an exact ticker copied from the candidate list (no extra text, no spaces, all uppercase).
- If you cannot find 5 strong picks, return your best 5 anyway and mark weaker ones recommended=false.

## Candidates (pre-scored on long-term momentum)
${rows}

## Output
Respond ONLY with a valid JSON object — no markdown, no code fences:
{
  "picks": [
    {
      "symbol": "<EXACT ticker from the list above>",
      "thesis": "<2–3 sentences: why this is a long-term opportunity, citing the metrics>",
      "risk": "<1 sentence on the main risk>",
      "horizon": "<e.g. '12–36 months'>",
      "recommended": <true if you'd actively encourage adding to watchlist, false if it's just an FYI>
    }
  ]
}`;
}

async function callGroq(prompt: string): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY not set in Edge Function secrets");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 4096,
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
  if (!key) throw new Error("GEMINI_API_KEY not set in Edge Function secrets");
  const BASE = "https://generativelanguage.googleapis.com";

  // Pin a specific model via GEMINI_MODEL env var; otherwise auto-discover & rank.
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
          console.log(`[discover-stocks] Gemini model used: ${model} (${version})`);
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

function parseJson(text: string): { picks?: AICuratedCandidate[] } {
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  try {
    const obj = JSON.parse(cleaned);
    return obj;
  } catch (err) {
    // Don't swallow — surface so we can diagnose
    console.error(
      `[discover-stocks] JSON parse failed: ${err}. Raw (first 1000 chars): ${text.slice(0, 1000)}`,
    );
    return { picks: [] };
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const provider = Deno.env.get("AI_PROVIDER") ?? "groq";

    let body: { force?: boolean; user_id?: string } = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const singleUserId = body.user_id;

    // 1. Pull candidates from all screeners and dedupe
    const allCandidates = (await Promise.all(SCREENERS.map((s) => fetchScreener(s, 30)))).flat();
    const seen = new Set<string>();
    const dedup: ScreenerCandidate[] = [];
    for (const c of allCandidates) {
      if (seen.has(c.symbol)) continue;
      seen.add(c.symbol);
      dedup.push(c);
    }
    console.log(`[discover-stocks] ${dedup.length} unique candidates from ${SCREENERS.length} screeners`);

    // Filter out obvious noise: market cap < $300M, no name, weird symbols
    const filtered = dedup.filter((c) =>
      c.market_cap !== null &&
      c.market_cap > 300_000_000 &&
      /^[A-Z][A-Z0-9.\-]{0,9}$/.test(c.symbol)
    );

    // 2. Fetch 5y history + compute momentum score for each (cap at 60 to limit API calls)
    const limited = filtered.slice(0, 60);
    const scoredResults = await Promise.all(
      limited.map(async (c): Promise<ScoredCandidate | null> => {
        const hist = await fetchDailyHistory(c.symbol);
        if (!hist || hist.daily.length < 252) return null;
        const metrics = buildLongTermMetrics(hist.daily);
        const score = momentumScore(metrics);
        return {
          ...c,
          current_price: hist.price,
          metrics,
          momentum_score: score,
        };
      })
    );
    const scored = scoredResults
      .filter((c): c is ScoredCandidate => c !== null && c.momentum_score >= 30)
      .sort((a, b) => b.momentum_score - a.momentum_score);

    console.log(`[discover-stocks] ${scored.length} candidates passed scoring threshold`);

    if (scored.length === 0) {
      return new Response(JSON.stringify({ message: "No candidates passed momentum filter" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Load profiles + watchlists for the target users
    let usersQuery = supabase
      .from("profiles")
      .select("id, risk_level, investment_style");
    if (singleUserId) usersQuery = usersQuery.eq("id", singleUserId);
    const { data: users, error: uErr } = await usersQuery;
    if (uErr) throw new Error(`Failed to load profiles: ${uErr.message}`);
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ message: "No users to discover for" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. For each user: call AI to curate, then upsert into discoveries
    const results: Array<{ user_id: string; picks: number; error?: string }> = [];

    for (const user of users) {
      try {
        const { data: watchlist } = await supabase
          .from("watchlist")
          .select("symbol")
          .eq("user_id", user.id);
        const watching = (watchlist ?? []).map((w: { symbol: string }) => w.symbol);

        // Exclude already-watching symbols and previously dismissed
        const { data: dismissed } = await supabase
          .from("discoveries")
          .select("symbol")
          .eq("user_id", user.id)
          .eq("status", "dismissed");
        const dismissedSet = new Set((dismissed ?? []).map((d: { symbol: string }) => d.symbol));

        const eligible = scored.filter(
          (c) => !watching.includes(c.symbol) && !dismissedSet.has(c.symbol)
        );

        if (eligible.length === 0) {
          results.push({ user_id: user.id, picks: 0 });
          continue;
        }

        const prompt = buildCurationPrompt(eligible, user);
        console.log(
          `[discover-stocks] user ${user.id}: ${eligible.length} eligible candidates, calling ${provider}`,
        );
        const rawText = provider === "gemini" ? await callGemini(prompt) : await callGroq(prompt);
        console.log(
          `[discover-stocks] user ${user.id}: AI raw response (${rawText.length} chars): ${rawText.slice(0, 400).replace(/\s+/g, " ")}`,
        );
        const parsed = parseJson(rawText);
        const picks = parsed.picks ?? [];
        console.log(
          `[discover-stocks] user ${user.id}: parsed ${picks.length} picks from AI`,
        );

        // Normalize symbols for forgiving lookup (AI sometimes adds spaces or casing)
        const candidateMap = new Map(
          eligible.map((c) => [c.symbol.toUpperCase().trim(), c]),
        );
        const skipped: string[] = [];

        const rows = picks
          .map((p) => {
            const key = (p.symbol ?? "").toUpperCase().trim();
            const c = candidateMap.get(key);
            if (!c) {
              skipped.push(p.symbol ?? "(empty)");
              return null;
            }
            return {
              user_id: user.id,
              symbol: c.symbol,
              company_name: c.company_name,
              current_price: c.current_price,
              market_cap: c.market_cap,
              return_1m: c.metrics.return_1m,
              return_3m: c.metrics.return_3m,
              return_6m: c.metrics.return_6m,
              return_1y: c.metrics.return_1y,
              return_3y: c.metrics.return_3y,
              return_ytd: c.metrics.return_ytd,
              rsi_weekly: c.metrics.rsi_weekly,
              distance_from_52w_high: c.metrics.distance_from_52w_high,
              volume_surge_ratio: c.metrics.volume_surge_ratio,
              momentum_score: c.momentum_score,
              ai_thesis: p.thesis ?? null,
              ai_risk: p.risk ?? null,
              ai_recommended: !!p.recommended,
              ai_horizon: p.horizon ?? null,
              source: c.source,
              status: "new",
              updated_at: new Date().toISOString(),
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (skipped.length > 0) {
          console.warn(
            `[discover-stocks] user ${user.id}: ${skipped.length} AI picks not found in candidate pool: ${skipped.join(", ")}`,
          );
        }

        if (rows.length > 0) {
          const { error: upErr } = await supabase
            .from("discoveries")
            .upsert(rows, { onConflict: "user_id,symbol" });
          if (upErr) throw new Error(upErr.message);
        }
        results.push({ user_id: user.id, picks: rows.length });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[discover-stocks] user ${user.id}: ${msg}`);
        results.push({ user_id: user.id, picks: 0, error: msg });
      }
    }

    return new Response(
      JSON.stringify({
        scanned: scored.length,
        users: users.length,
        results,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[discover-stocks] Fatal: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

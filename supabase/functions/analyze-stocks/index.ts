/**
 * Supabase Edge Function: analyze-stocks
 *
 * Runs on a pg_cron schedule during US market hours (Mon–Fri, 9:30–16:00 ET).
 * For every user's active watchlist item, fetches Yahoo Finance data,
 * calculates technical indicators, calls the AI, and saves suggestions.
 *
 * Environment variables needed (set in Supabase Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL            – auto-injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY – auto-injected by Supabase
 *   AI_PROVIDER             – "gemini" | "groq"  (default: groq)
 *   GEMINI_API_KEY          – required when AI_PROVIDER=gemini
 *   GROQ_API_KEY            – required when AI_PROVIDER=groq
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

interface StockQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  previousClose: number;
  change: number;
  changePercent: number;
  latestTradingDay: string;
}

interface AnalysisResponse {
  symbol: string;
  signal_level: "weak" | "medium" | "strong" | "very_strong";
  action: "buy" | "sell" | "hold" | "watch";
  suggested_buy_price: number | null;
  suggested_sell_price: number | null;
  stop_loss_price: number | null;
  risk_estimation: "low" | "moderate" | "high" | "very_high";
  reasoning: string;
  technical_summary: {
    trend: "bullish" | "bearish" | "neutral" | "sideways";
    support_levels: number[];
    resistance_levels: number[];
    key_indicators: string;
    [key: string]: unknown;
  };
  confidence: number;
  time_horizon: string;
  options_strategy?: {
    recommendation: string | null;
    strategy_type: string;
    details: string | null;
  } | null;
}

interface UserPreferences {
  risk_level: string;
  investment_style: string;
}

interface TransactionRecord {
  type: string;
  instrument_type: string;
  quantity: number;
  price: number;
  contracts: number | null;
  strike_price: number | null;
  expiration_date: string | null;
  status: string;
}

interface ExitScoreDetails {
  rsi_component: number;
  resistance_component: number;
  sell_target_component: number;
  stop_loss_component: number;
  trend_component: number;
  volume_component: number;
}

// ─── Yahoo Finance ────────────────────────────────────────────────────────────

async function fetchStockData(symbol: string): Promise<{ quote: StockQuote; daily: StockDailyData[] }> {
  const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
  const headers = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };

  const [quoteRes, historyRes] = await Promise.all([
    fetch(`${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`, { headers }),
    fetch(`${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=3mo`, { headers }),
  ]);

  if (!quoteRes.ok || !historyRes.ok) {
    throw new Error(`Failed to fetch Yahoo Finance data for ${symbol}`);
  }

  const [quoteData, histData] = await Promise.all([quoteRes.json(), historyRes.json()]);

  const result = quoteData.chart.result?.[0];
  if (!result) throw new Error(`No data found for symbol: ${symbol}`);

  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose;
  const change = price - prevClose;

  const quote: StockQuote = {
    symbol: meta.symbol,
    price,
    open: meta.regularMarketOpen ?? price,
    high: meta.regularMarketDayHigh ?? price,
    low: meta.regularMarketDayLow ?? price,
    volume: meta.regularMarketVolume ?? 0,
    previousClose: prevClose,
    change,
    changePercent: prevClose > 0 ? (change / prevClose) * 100 : 0,
    latestTradingDay: new Date().toISOString().split("T")[0],
  };

  const histResult = histData.chart.result?.[0];
  const daily: StockDailyData[] = [];

  if (histResult?.timestamp) {
    const { timestamp, indicators } = histResult;
    const q = indicators.quote[0];
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
  }

  return { quote, daily };
}

// ─── Technical Indicators ─────────────────────────────────────────────────────

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

function calcBB(data: StockDailyData[], period = 20, stdMult = 2) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  const middle = slice.reduce((s, d) => s + d.close, 0) / period;
  const variance = slice.reduce((s, d) => s + Math.pow(d.close - middle, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: middle + stdMult * sd, middle, lower: middle - stdMult * sd };
}

function calcEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const mult = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) ema = (values[i] - ema) * mult + ema;
  return ema;
}

function calcMACD(data: StockDailyData[]) {
  if (data.length < 26) return null;
  const closes = data.map((d) => d.close);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (ema12 === null || ema26 === null) return null;
  const macd = ema12 - ema26;
  const signal = macd * 0.85;
  return { macd, signal, histogram: macd - signal };
}

// ─── AI Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(symbol: string, quote: StockQuote, daily: StockDailyData[], prefs: UserPreferences, positions: TransactionRecord[] = []): string {
  const sma20 = calcSMA(daily, 20);
  const sma50 = calcSMA(daily, 50);
  const sma200 = calcSMA(daily, 200);
  const rsi = calcRSI(daily, 14);
  const bb = calcBB(daily, 20, 2);
  const macd = calcMACD(daily);
  const recent = daily.slice(-30);

  const fmt = (n: number | null, prefix = "$") => n !== null ? `${prefix}${n.toFixed(2)}` : "N/A";

  return `You are an expert financial analyst. Analyze ${symbol} for a ${prefs.risk_level} risk / ${prefs.investment_style} investor.

## Current Quote
- Price: ${fmt(quote.price)} | Change: ${fmt(quote.change)} (${quote.changePercent.toFixed(2)}%)
- Open: ${fmt(quote.open)} | High: ${fmt(quote.high)} | Low: ${fmt(quote.low)}
- Prev Close: ${fmt(quote.previousClose)} | Volume: ${quote.volume.toLocaleString()}

## Technical Indicators
- SMA 20: ${fmt(sma20)} | SMA 50: ${fmt(sma50)} | SMA 200: ${fmt(sma200)}
- RSI (14): ${rsi !== null ? rsi.toFixed(2) : "N/A"}
- Bollinger Bands: Upper=${fmt(bb?.upper ?? null)}, Mid=${fmt(bb?.middle ?? null)}, Lower=${fmt(bb?.lower ?? null)}
- MACD: ${macd ? macd.macd.toFixed(4) : "N/A"} | Signal: ${macd ? macd.signal.toFixed(4) : "N/A"}

## Last 30 Days
${recent.map((d) => `${d.date}: $${d.close.toFixed(2)} vol=${d.volume.toLocaleString()}`).join("\n")}

## Existing Positions
${positions.length > 0
    ? positions.map((t) => {
        if (t.instrument_type === "call_option" || t.instrument_type === "put_option") {
          const kind = t.instrument_type === "call_option" ? "CALL" : "PUT";
          return `- ${t.type.toUpperCase()} ${t.contracts} ${kind} contract(s) · Strike $${(t.strike_price ?? 0).toFixed(2)} · Expires ${t.expiration_date} · Premium $${t.price.toFixed(2)}/sh (${t.status})`;
        }
        return `- ${t.type.toUpperCase()} ${t.quantity} shares @ $${t.price.toFixed(2)} (${t.status})`;
      }).join("\n")
    : "None"}

## Options Strategy Rules
- If the user holds shares, suggest relevant options strategies (protective puts, covered calls, collars).
- If the user holds options, factor in their expiry and strike when recommending actions.
- Set options_strategy to null if no options play is relevant.

## Output
Respond ONLY with a valid JSON object — no markdown, no code fences, no extra text:
{
  "symbol": "${symbol}",
  "signal_level": "weak|medium|strong|very_strong",
  "action": "buy|sell|hold|watch",
  "suggested_buy_price": <number or null>,
  "suggested_sell_price": <number or null>,
  "stop_loss_price": <number or null>,
  "risk_estimation": "low|moderate|high|very_high",
  "reasoning": "<2-3 sentences>",
  "technical_summary": {
    "trend": "bullish|bearish|neutral|sideways",
    "support_levels": [<number>, <number>],
    "resistance_levels": [<number>, <number>],
    "key_indicators": "<brief summary>"
  },
  "confidence": <0.0 to 1.0>,
  "time_horizon": "<e.g. 1-5 days>",
  "options_strategy": {
    "recommendation": "<1-2 sentence options recommendation, or null>",
    "strategy_type": "protective_put|covered_call|collar|spread|none",
    "details": "<specific strike/expiry suggestion, or null>"
  }
}`;
}

// ─── JSON parsing ─────────────────────────────────────────────────────────────

function parseJson(text: string): Partial<AnalysisResponse> {
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned);
  } catch {
    const opens = (cleaned.match(/{/g) || []).length;
    const closes = (cleaned.match(/}/g) || []).length;
    let repaired = cleaned.replace(/,\s*$/, "").replace(/,\s*"[^"]*$/, "");
    const quotes = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quotes % 2 !== 0) repaired += '"';
    for (let i = 0; i < opens - closes; i++) repaired += "}";
    return JSON.parse(repaired);
  }
}

function sanitize(raw: Partial<AnalysisResponse>, symbol: string, price: number): AnalysisResponse {
  const SIGNALS = ["weak", "medium", "strong", "very_strong"] as const;
  const ACTIONS = ["buy", "sell", "hold", "watch"] as const;
  const RISKS   = ["low", "moderate", "high", "very_high"] as const;
  const TRENDS  = ["bullish", "bearish", "neutral", "sideways"] as const;

  return {
    symbol: raw.symbol ?? symbol,
    signal_level: SIGNALS.includes(raw.signal_level as typeof SIGNALS[number]) ? raw.signal_level! : "weak",
    action: ACTIONS.includes(raw.action as typeof ACTIONS[number]) ? raw.action! : "watch",
    suggested_buy_price: raw.suggested_buy_price ?? null,
    suggested_sell_price: raw.suggested_sell_price ?? null,
    stop_loss_price: raw.stop_loss_price ?? null,
    risk_estimation: RISKS.includes(raw.risk_estimation as typeof RISKS[number]) ? raw.risk_estimation! : "moderate",
    reasoning: raw.reasoning?.trim() || `Scheduled analysis for ${symbol} at $${price.toFixed(2)}. Signal: ${raw.signal_level ?? "weak"}.`,
    technical_summary: {
      trend: TRENDS.includes(raw.technical_summary?.trend as typeof TRENDS[number]) ? raw.technical_summary!.trend : "neutral",
      support_levels: Array.isArray(raw.technical_summary?.support_levels) ? raw.technical_summary!.support_levels : [],
      resistance_levels: Array.isArray(raw.technical_summary?.resistance_levels) ? raw.technical_summary!.resistance_levels : [],
      key_indicators: raw.technical_summary?.key_indicators ?? "",
      ...raw.technical_summary,
    },
    confidence: typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.5,
    time_horizon: raw.time_horizon?.trim() || "N/A",
    options_strategy: raw.options_strategy
      ? {
          recommendation: raw.options_strategy.recommendation ?? null,
          strategy_type: raw.options_strategy.strategy_type ?? "none",
          details: raw.options_strategy.details ?? null,
        }
      : null,
  };
}

// ─── Groq ─────────────────────────────────────────────────────────────────────

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
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("No response from Groq");
  return text;
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not set in Edge Function secrets");

  const GEMINI_BASE = "https://generativelanguage.googleapis.com";

  // Discover available models
  const modelsRes = await fetch(`${GEMINI_BASE}/v1beta/models?key=${key}`);
  if (!modelsRes.ok) throw new Error(`Gemini model discovery failed (${modelsRes.status})`);
  const modelsData = await modelsRes.json();

  const EXCLUDE = ["tts", "imagen", "veo", "embedding", "aqa", "bisheng"];
  const candidates = (modelsData.models ?? [])
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

  for (const model of candidates) {
    for (const version of ["v1beta", "v1"]) {
      const url = `${GEMINI_BASE}/${version}/models/${model}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
        break;
      }
      if (res.status === 429) throw new Error("Gemini rate limit hit");
      if (res.status === 404) continue;
      break;
    }
  }

  throw new Error("All Gemini models failed or returned no text");
}

// ─── Exit Score ───────────────────────────────────────────────────────────────

function computeExitScore(
  rsi: number | null,
  currentPrice: number,
  analysis: AnalysisResponse,
  previousTrend: string | null,
  daily: StockDailyData[]
): { score: number; details: ExitScoreDetails } {
  const details: ExitScoreDetails = {
    rsi_component: 0,
    resistance_component: 0,
    sell_target_component: 0,
    stop_loss_component: 0,
    trend_component: 0,
    volume_component: 0,
  };

  if (rsi !== null && rsi > 70) {
    details.rsi_component = Math.min(30, Math.round(((rsi - 70) / 20) * 30));
  }

  const resistance = analysis.technical_summary.resistance_levels ?? [];
  if (resistance.length > 0) {
    const nearest = resistance
      .map((r: number) => Math.abs(currentPrice - r) / r)
      .sort((a: number, b: number) => a - b)[0];
    if (nearest <= 0.02) {
      details.resistance_component = Math.round((1 - nearest / 0.02) * 25);
    }
    if (currentPrice > Math.max(...resistance)) {
      details.resistance_component = 25;
    }
  }

  if (analysis.suggested_sell_price !== null && currentPrice >= analysis.suggested_sell_price) {
    details.sell_target_component = 25;
  }

  if (analysis.stop_loss_price !== null && currentPrice <= analysis.stop_loss_price) {
    details.stop_loss_component = 20;
  }

  if (
    previousTrend !== null &&
    (previousTrend === "bullish" || previousTrend === "neutral") &&
    analysis.technical_summary.trend === "bearish"
  ) {
    details.trend_component = 15;
  }

  if (daily.length >= 15) {
    const avg = (arr: StockDailyData[]) =>
      arr.length > 0 ? arr.reduce((s, d) => s + d.volume, 0) / arr.length : 0;
    const w1 = avg(daily.slice(-15, -10));
    const w2 = avg(daily.slice(-10, -5));
    const w3 = avg(daily.slice(-5));
    if (w3 < w2 && w2 < w1) {
      details.volume_component = 10;
    }
  }

  const score = Math.min(
    100,
    details.rsi_component + details.resistance_component +
    details.sell_target_component + details.stop_loss_component +
    details.trend_component + details.volume_component
  );

  return { score, details };
}

// ─── Alert Generation ─────────────────────────────────────────────────────────

interface AlertRecord {
  user_id: string;
  symbol: string;
  alert_type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}

function generateAlerts(
  userId: string,
  symbol: string,
  currentPrice: number,
  analysis: AnalysisResponse,
  exitScore: number,
  exitScoreDetails: ExitScoreDetails,
  previousAction: string | null,
  alertPrefs: { exit_score_threshold: number }
): AlertRecord[] {
  const alerts: AlertRecord[] = [];

  if (analysis.suggested_sell_price !== null && currentPrice >= analysis.suggested_sell_price) {
    alerts.push({
      user_id: userId,
      symbol,
      alert_type: "price_target_hit",
      title: `${symbol} hit sell target`,
      message: `${symbol} is at $${currentPrice.toFixed(2)}, which has reached the suggested sell price of $${analysis.suggested_sell_price.toFixed(2)}.`,
      metadata: { current_price: currentPrice, sell_target: analysis.suggested_sell_price },
    });
  }

  if (analysis.stop_loss_price !== null && currentPrice <= analysis.stop_loss_price) {
    alerts.push({
      user_id: userId,
      symbol,
      alert_type: "stop_loss_hit",
      title: `${symbol} hit stop-loss`,
      message: `${symbol} dropped to $${currentPrice.toFixed(2)}, breaching the stop-loss at $${analysis.stop_loss_price.toFixed(2)}.`,
      metadata: { current_price: currentPrice, stop_loss: analysis.stop_loss_price },
    });
  }

  if (exitScore >= alertPrefs.exit_score_threshold) {
    alerts.push({
      user_id: userId,
      symbol,
      alert_type: "exit_score_high",
      title: `${symbol} exit score: ${exitScore}/100`,
      message: `${symbol} has an exit score of ${exitScore}/100, suggesting you should consider selling. Key factors: ${Object.entries(exitScoreDetails).filter(([, v]) => v > 0).map(([k, v]) => `${k.replace("_component", "")}: +${v}`).join(", ")}.`,
      metadata: { exit_score: exitScore, details: exitScoreDetails },
    });
  }

  if (previousAction !== null && previousAction !== analysis.action) {
    alerts.push({
      user_id: userId,
      symbol,
      alert_type: "action_changed",
      title: `${symbol}: ${previousAction.toUpperCase()} → ${analysis.action.toUpperCase()}`,
      message: `AI recommendation for ${symbol} changed from ${previousAction.toUpperCase()} to ${analysis.action.toUpperCase()}. ${analysis.reasoning}`,
      metadata: { previous_action: previousAction, new_action: analysis.action },
    });
  }

  return alerts;
}

// deno-lint-ignore no-explicit-any
async function checkOptionsExpiryAlerts(supabase: any, userId: string, expiryDays: number): Promise<AlertRecord[]> {
  const alerts: AlertRecord[] = [];
  const { data: options } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("instrument_type", ["call_option", "put_option"]);

  if (!options) return alerts;

  for (const opt of options) {
    if (!opt.expiration_date) continue;
    const daysLeft = Math.ceil(
      (new Date(opt.expiration_date).getTime() - Date.now()) / 86400000
    );
    if (daysLeft <= 0) {
      alerts.push({
        user_id: userId,
        symbol: opt.symbol,
        alert_type: "options_expiry_warning",
        title: `${opt.symbol} option EXPIRED`,
        message: `Your ${opt.instrument_type === "call_option" ? "CALL" : "PUT"} option on ${opt.symbol} (Strike $${opt.strike_price}) has expired.`,
        metadata: { transaction_id: opt.id, days_left: 0 },
      });
    } else if (daysLeft <= expiryDays) {
      alerts.push({
        user_id: userId,
        symbol: opt.symbol,
        alert_type: "options_expiry_warning",
        title: `${opt.symbol} option expires in ${daysLeft}d`,
        message: `Your ${opt.instrument_type === "call_option" ? "CALL" : "PUT"} option on ${opt.symbol} (Strike $${opt.strike_price}) expires on ${opt.expiration_date} (${daysLeft} day${daysLeft > 1 ? "s" : ""}).`,
        metadata: { transaction_id: opt.id, days_left: daysLeft },
      });
    }
  }

  return alerts;
}

// ─── Email Sending via Resend ─────────────────────────────────────────────────

const ALERT_TYPE_LABELS: Record<string, string> = {
  price_target_hit: "Price Target Hit",
  stop_loss_hit: "Stop-Loss Triggered",
  exit_score_high: "High Exit Score",
  action_changed: "Recommendation Changed",
  options_expiry_warning: "Options Expiry Warning",
};

function buildAlertEmailHtml(
  userName: string,
  alerts: Array<{ alert_type: string; symbol: string; title: string; message: string }>
): string {
  const rows = alerts.map((a) => `
    <tr>
      <td style="padding: 16px; border-bottom: 1px solid #1e293b;">
        <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
          ${ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}
        </div>
        <div style="font-size: 16px; font-weight: 600; color: #f1f5f9; margin-bottom: 4px;">
          ${a.symbol} &mdash; ${a.title}
        </div>
        <div style="font-size: 14px; color: #cbd5e1;">${a.message}</div>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background-color:#0f172a;">
    <tr><td style="padding:32px 24px;text-align:center;border-bottom:1px solid #1e293b;">
      <div style="font-size:24px;font-weight:700;color:#3b82f6;">AIA</div>
      <div style="font-size:14px;color:#94a3b8;margin-top:4px;">Investment Alert</div>
    </td></tr>
    <tr><td style="padding:24px;">
      <div style="font-size:16px;color:#e2e8f0;margin-bottom:16px;">Hi ${userName},</div>
      <div style="font-size:14px;color:#94a3b8;margin-bottom:24px;">You have ${alerts.length} new alert${alerts.length > 1 ? "s" : ""}:</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:12px;overflow:hidden;">${rows}</table>
    </td></tr>
    <tr><td style="padding:24px;text-align:center;border-top:1px solid #1e293b;">
      <div style="font-size:12px;color:#64748b;">You received this because you have email alerts enabled in AIA settings.</div>
    </td></tr>
  </table>
</body></html>`;
}

// deno-lint-ignore no-explicit-any
async function sendAlertEmails(supabase: any): Promise<number> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.log("[analyze-stocks] RESEND_API_KEY not set, skipping email alerts");
    return 0;
  }

  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "AIA <alerts@resend.dev>";

  const { data: pendingAlerts, error: fetchErr } = await supabase
    .from("alerts")
    .select("id, user_id, alert_type, symbol, title, message")
    .eq("email_sent", false);

  if (fetchErr || !pendingAlerts || pendingAlerts.length === 0) {
    return 0;
  }

  // Get distinct user IDs
  const userIds = [...new Set(pendingAlerts.map((a: { user_id: string }) => a.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, email, notifications_enabled")
    .in("id", userIds)
    .eq("notifications_enabled", true);

  if (!profiles || profiles.length === 0) return 0;

  const profileMap = new Map(
    profiles.map((p: { id: string; name: string; email: string }) => [p.id, p])
  );

  // Group alerts by user
  const byUser = new Map<string, { email: string; name: string; ids: string[]; alerts: typeof pendingAlerts }>();
  for (const alert of pendingAlerts) {
    const profile = profileMap.get(alert.user_id) as { email: string; name: string } | undefined;
    if (!profile) continue;

    if (!byUser.has(alert.user_id)) {
      byUser.set(alert.user_id, { email: profile.email, name: profile.name || "Investor", ids: [], alerts: [] });
    }
    const group = byUser.get(alert.user_id)!;
    group.ids.push(alert.id);
    group.alerts.push(alert);
  }

  let sent = 0;
  for (const [, group] of byUser) {
    try {
      const html = buildAlertEmailHtml(group.name, group.alerts);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: fromEmail,
          to: [group.email],
          subject: `AIA Alert: ${group.alerts.length} new notification${group.alerts.length > 1 ? "s" : ""}`,
          html,
        }),
      });

      if (res.ok) {
        await supabase.from("alerts").update({ email_sent: true }).in("id", group.ids);
        sent++;
      } else {
        const errText = await res.text();
        console.error(`[analyze-stocks] Resend error for ${group.email}: ${res.status} ${errText}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[analyze-stocks] Email send failed for ${group.email}: ${msg}`);
    }
  }

  return sent;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const provider = Deno.env.get("AI_PROVIDER") ?? "groq";

    // Parse body for optional force flag
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch { /* no body or non-JSON body is fine */ }

    // Skip on weekends unless forced
    const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 6=Sat
    if (!force && (dayOfWeek === 0 || dayOfWeek === 6)) {
      return new Response(
        JSON.stringify({ message: "Weekend - skipping analysis. Send { \"force\": true } to override." }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Get all active watchlist items grouped by user
    const { data: watchlist, error: wErr } = await supabase
      .from("watchlist")
      .select("user_id, symbol, profiles(risk_level, investment_style, alert_preferences)")
      .eq("is_active", true);

    if (wErr) throw new Error(`Failed to load watchlist: ${wErr.message}`);
    if (!watchlist || watchlist.length === 0) {
      return new Response(JSON.stringify({ message: "No watchlist items to analyze" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const results: Array<{ symbol: string; user_id: string; status: string; error?: string }> = [];
    const allAlerts: AlertRecord[] = [];
    const processedUsers = new Set<string>();

    for (const item of watchlist) {
      const { user_id, symbol } = item;
      const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
      // deno-lint-ignore no-explicit-any
      const profileObj = profile as Record<string, any> | null;
      const prefs: UserPreferences = {
        risk_level: profileObj?.risk_level ?? "moderate",
        investment_style: profileObj?.investment_style ?? "swing",
      };
      const alertPrefs = {
        exit_score_threshold: profileObj?.alert_preferences?.exit_score_threshold ?? 61,
        options_expiry_days: profileObj?.alert_preferences?.options_expiry_days ?? 7,
      };

      try {
        // Fetch stock data and active positions in parallel
        const [stockResult, positionsRes, prevSuggestionRes] = await Promise.all([
          fetchStockData(symbol),
          supabase
            .from("transactions")
            .select("type, instrument_type, quantity, price, contracts, strike_price, expiration_date, status")
            .eq("user_id", user_id)
            .eq("symbol", symbol)
            .eq("status", "active"),
          supabase
            .from("suggestions")
            .select("action, technical_summary")
            .eq("user_id", user_id)
            .eq("symbol", symbol)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .single(),
        ]);

        const { quote, daily } = stockResult;
        const positions: TransactionRecord[] = positionsRes.data ?? [];
        const prevAction = prevSuggestionRes.data?.action ?? null;
        const prevTrend = prevSuggestionRes.data?.technical_summary?.trend ?? null;

        // Build prompt with positions and call AI
        const prompt = buildPrompt(symbol, quote, daily, prefs, positions);
        const rawText = provider === "gemini"
          ? await callGemini(prompt)
          : await callGroq(prompt);

        const rawJson = parseJson(rawText);
        const analysis = sanitize(rawJson, symbol, quote.price);

        // Compute exit score
        const rsi = calcRSI(daily, 14);
        const { score: exitScore, details: exitScoreDetails } = computeExitScore(
          rsi, quote.price, analysis, prevTrend, daily
        );

        // Deactivate previous suggestions for this user/symbol
        await supabase
          .from("suggestions")
          .update({ is_active: false })
          .eq("user_id", user_id)
          .eq("symbol", symbol)
          .eq("is_active", true);

        // Save new suggestion
        const { error: insertErr } = await supabase.from("suggestions").insert({
          user_id,
          symbol,
          signal_level: analysis.signal_level,
          action: analysis.action,
          suggested_buy_price: analysis.suggested_buy_price,
          suggested_sell_price: analysis.suggested_sell_price,
          stop_loss_price: analysis.stop_loss_price,
          current_price: quote.price,
          risk_estimation: analysis.risk_estimation,
          reasoning: analysis.reasoning,
          technical_summary: analysis.technical_summary,
          confidence: analysis.confidence,
          time_horizon: analysis.time_horizon,
          options_strategy: analysis.options_strategy ?? null,
          exit_score: exitScore,
          exit_score_details: exitScoreDetails,
          is_active: true,
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        });

        if (insertErr) throw new Error(insertErr.message);

        // Generate alerts
        const newAlerts = generateAlerts(
          user_id, symbol, quote.price, analysis,
          exitScore, exitScoreDetails, prevAction, alertPrefs
        );
        allAlerts.push(...newAlerts);

        // Check options expiry (once per user)
        if (!processedUsers.has(user_id)) {
          processedUsers.add(user_id);
          const expiryAlerts = await checkOptionsExpiryAlerts(
            supabase, user_id, alertPrefs.options_expiry_days
          );
          allAlerts.push(...expiryAlerts);
        }

        results.push({ symbol, user_id, status: "ok" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[analyze-stocks] ${symbol} (${user_id}): ${msg}`);
        results.push({ symbol, user_id, status: "error", error: msg });
      }
    }

    // Save all alerts
    let emailsSent = 0;
    if (allAlerts.length > 0) {
      const { error: alertErr } = await supabase.from("alerts").insert(allAlerts);
      if (alertErr) {
        console.error(`[analyze-stocks] Failed to save alerts: ${alertErr.message}`);
      } else {
        console.log(`[analyze-stocks] Generated ${allAlerts.length} alerts`);
        emailsSent = await sendAlertEmails(supabase);
        console.log(`[analyze-stocks] Sent ${emailsSent} alert email(s)`);
      }
    }

    const ok = results.filter((r) => r.status === "ok").length;
    const failed = results.filter((r) => r.status === "error").length;

    console.log(`[analyze-stocks] Done — ${ok} succeeded, ${failed} failed`);
    return new Response(
      JSON.stringify({ analyzed: ok, failed, results, alerts_generated: allAlerts.length, emails_sent: emailsSent }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[analyze-stocks] Fatal error: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

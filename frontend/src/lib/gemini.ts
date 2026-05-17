/**
 * AI analysis module — supports Groq (recommended, free) and Google Gemini.
 *
 * Set AI_PROVIDER=groq  (default) → uses GROQ_API_KEY
 * Set AI_PROVIDER=gemini          → uses GEMINI_API_KEY
 *
 * Groq free tier: 14,400 calls/day, no billing required, works globally.
 * Get a free Groq key at: https://console.groq.com
 *
 * Gemini free tier: region-restricted; requires billing enabled on the Cloud project.
 * Get a Gemini key at: https://aistudio.google.com/apikey
 */
import type {
  AnalysisRequest,
  AnalysisResponse,
  StockDailyData,
} from "@/types";
import {
  buildLongTermMetrics,
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  type LongTermMetrics,
} from "./alpha-vantage";

export interface PriorSuggestion {
  action: string;
  signal_level: string;
  reasoning: string;
  suggested_buy_price: number | null;
  suggested_sell_price: number | null;
  stop_loss_price: number | null;
  created_at: string;
}

export interface LongTermAnalysisRequest extends AnalysisRequest {
  priorSuggestion?: PriorSuggestion | null;
}

// ─── Provider detection ───────────────────────────────────────────────────────

type Provider = "groq" | "gemini";

function getProvider(): Provider {
  return (process.env.AI_PROVIDER as Provider) || "groq";
}

function getGroqKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key || key === "your_groq_api_key_here") {
    throw new Error(
      "Groq API key not configured. Get a free key at https://console.groq.com"
    );
  }
  return key;
}

function getGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your_gemini_api_key_here") {
    throw new Error(
      "Gemini API key not configured. Get one at https://aistudio.google.com/apikey"
    );
  }
  return key;
}

// ─── Technical indicators ────────────────────────────────────────────────────

export function buildTechnicalIndicators(data: StockDailyData[]) {
  return {
    sma_20: calculateSMA(data, 20),
    sma_50: calculateSMA(data, 50),
    sma_200: calculateSMA(data, 200),
    rsi: calculateRSI(data, 14),
    bb: calculateBollingerBands(data, 20, 2),
    macd: calculateMACD(data),
  };
}

function riskStopLossRule(risk: string): string {
  switch (risk) {
    case "conservative":
      return `Set stop_loss_price 8–12% below current price (trailing stop). Prefer "hold" or "watch" over "sell" unless the long-term thesis is clearly broken.`;
    case "aggressive":
      return `Stop_loss_price 15–25% below current price. Tolerate large drawdowns as long as the multi-year thesis is intact.`;
    default:
      return `Stop_loss_price 10–18% below current price. Sell only if the long-term thesis breaks (death cross + lower lows on the weekly chart).`;
  }
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}

function buildLongTermBlock(m: LongTermMetrics): string {
  return `## Long-term Metrics (use these as the PRIMARY drivers)
- Returns: 1m ${fmtPct(m.return_1m)} · 3m ${fmtPct(m.return_3m)} · 6m ${fmtPct(m.return_6m)} · YTD ${fmtPct(m.return_ytd)} · 1y ${fmtPct(m.return_1y)} · 3y ${fmtPct(m.return_3y)}
- Weekly RSI(14): ${m.rsi_weekly !== null ? m.rsi_weekly.toFixed(1) : "N/A"}
- SMA 50: ${m.sma_50 !== null ? `$${m.sma_50.toFixed(2)}` : "N/A"} | SMA 200: ${m.sma_200 !== null ? `$${m.sma_200.toFixed(2)}` : "N/A"}
- Trend regime: ${m.golden_cross ? "GOLDEN CROSS (long-term uptrend)" : "DEATH CROSS (long-term downtrend)"}${m.days_since_cross !== null ? ` — ${m.days_since_cross} days since last cross` : ""}
- 52-week High: ${m.high_52w !== null ? `$${m.high_52w.toFixed(2)}` : "N/A"} | 52-week Low: ${m.low_52w !== null ? `$${m.low_52w.toFixed(2)}` : "N/A"}
- Distance from 52w high: ${fmtPct(m.distance_from_52w_high)}
- Volume surge (30d avg / 1y avg): ${m.volume_surge_ratio !== null ? m.volume_surge_ratio.toFixed(2) + "x" : "N/A"}`;
}

function buildPriorBlock(prior: PriorSuggestion | null | undefined): string {
  if (!prior) return "## Prior Suggestion\n(none — first analysis)";
  const date = new Date(prior.created_at).toISOString().split("T")[0];
  return `## Your Prior Suggestion (${date})
- Action: ${prior.action.toUpperCase()} | Signal: ${prior.signal_level}
- Buy: ${prior.suggested_buy_price !== null ? `$${prior.suggested_buy_price.toFixed(2)}` : "N/A"} | Sell: ${prior.suggested_sell_price !== null ? `$${prior.suggested_sell_price.toFixed(2)}` : "N/A"} | Stop: ${prior.stop_loss_price !== null ? `$${prior.stop_loss_price.toFixed(2)}` : "N/A"}
- Reasoning: ${prior.reasoning}

### Consistency rule (IMPORTANT)
- This is a LONG-TERM advisor. Do NOT flip your action ("buy" ↔ "sell") unless one of these is true:
  1. The trend regime changed (golden ↔ death cross), OR
  2. Weekly RSI crossed into extreme territory (>80 or <25), OR
  3. Price is now beyond suggested_sell_price (take profit) or below stop_loss_price (thesis broken), OR
  4. The 1-year return has materially deteriorated since the last call.
- If none of the above, KEEP the same action and explain why the thesis still holds.
- It is OK and expected to repeat "hold" or "watch" for weeks at a time.`;
}

function buildPrompt(request: LongTermAnalysisRequest): string {
  const ind = buildTechnicalIndicators(request.stockData);
  const lt = buildLongTermMetrics(request.stockData);
  // Sample weekly closes (every 5 trading days) over the last ~6 months for context
  const sampled = request.stockData
    .slice(-126)
    .filter((_, i) => i % 5 === 0);
  const { risk_level } = request.userPreferences;

  return `You are an expert long-term investment advisor (Buffett/Lynch school). Produce a LONG-TERM recommendation for ${request.symbol} aimed at a multi-month to multi-year holding period.

## Mandate (these rules govern your output)
- Time horizon is months to years. Daily/intraday noise does NOT change the call.
- The long-term metrics block below is the PRIMARY input. The short-term indicators are CONTEXT only.
- ${riskStopLossRule(risk_level)}
- time_horizon must always be expressed in months or years (e.g. "6–18 months", "1–3 years"). Never "days" or "weeks".
- Use "buy" only if the long-term trend is intact (golden cross OR clear basing pattern) AND the stock isn't extremely overbought on weekly RSI.
- Use "hold" for existing positions where the long-term thesis is intact, even if there are short-term drawdowns.
- Use "sell" only when the long-term thesis is broken (death cross + lower lows + deteriorating returns).
- Use "watch" for stocks you'd like to own at a better price; specify the target buy price.

---

## Stock: ${request.symbol}

## Current Quote
- Price: $${request.quote.price.toFixed(2)} (Day change ${request.quote.changePercent.toFixed(2)}%)
- Prev Close: $${request.quote.previousClose.toFixed(2)} | Volume: ${request.quote.volume.toLocaleString()}

${buildLongTermBlock(lt)}

## Short-term Context (do NOT let these dominate)
- SMA 20: ${ind.sma_20 ? `$${ind.sma_20.toFixed(2)}` : "N/A"}
- Daily RSI (14): ${ind.rsi ? ind.rsi.toFixed(2) : "N/A"}
- Bollinger Bands: Upper=${ind.bb ? `$${ind.bb.upper.toFixed(2)}` : "N/A"}, Lower=${ind.bb ? `$${ind.bb.lower.toFixed(2)}` : "N/A"}
- MACD: ${ind.macd ? ind.macd.macd.toFixed(4) : "N/A"}

## Sampled Closes (~weekly, last 6 months)
${sampled.map((d) => `${d.date}: $${d.close.toFixed(2)}`).join("\n")}

${buildPriorBlock(request.priorSuggestion)}

## Existing Positions
${request.existingPositions.length > 0
    ? request.existingPositions.map((t) => {
        if (t.instrument_type === "call_option" || t.instrument_type === "put_option") {
          const kind = t.instrument_type === "call_option" ? "CALL" : "PUT";
          return `- ${t.type.toUpperCase()} ${t.contracts} ${kind} contract${(t.contracts ?? 0) > 1 ? "s" : ""} · Strike $${(t.strike_price ?? 0).toFixed(2)} · Expires ${t.expiration_date} · Premium $${t.price.toFixed(2)}/sh (${t.status})`;
        }
        return `- ${t.type.toUpperCase()} ${t.quantity} shares @ $${t.price.toFixed(2)} (${t.status})`;
      }).join("\n")
    : "None"}

## Options Strategy Rules
- If the user holds shares long-term, prefer covered calls (income) or protective puts (downside hedge) over directional options.
- Avoid recommending short-dated options as the primary play; this is a long-term portfolio.
- Set options_strategy to null when no clear long-term-friendly options play applies.

## Output
Respond ONLY with a valid JSON object — no markdown, no code fences, no extra text:

{
  "symbol": "${request.symbol}",
  "signal_level": "weak|medium|strong|very_strong",
  "action": "buy|sell|hold|watch",
  "suggested_buy_price": <number or null — a price you'd be a long-term buyer at>,
  "suggested_sell_price": <number or null — long-term take-profit target, typically 25–80% above current>,
  "stop_loss_price": <number or null — per the stop-loss rule above>,
  "risk_estimation": "low|moderate|high|very_high",
  "reasoning": "<2-3 sentences citing the long-term metrics. If you are keeping the prior action, explicitly say why the thesis still holds.>",
  "technical_summary": {
    "trend": "bullish|bearish|neutral|sideways",
    "support_levels": [<number>, <number>],
    "resistance_levels": [<number>, <number>],
    "key_indicators": "<brief summary of which long-term indicators drove this recommendation>"
  },
  "confidence": <0.0 to 1.0>,
  "time_horizon": "<months or years, e.g. '6–18 months' or '1–3 years'>",
  "options_strategy": {
    "recommendation": "<1-2 sentence long-term-friendly options recommendation, or null>",
    "strategy_type": "protective_put|covered_call|collar|spread|none",
    "details": "<specific strike & expiry (prefer 60+ DTE), or null>"
  }
}`;
}

/**
 * Ensure the AI response has all required fields with sensible fallbacks.
 * Prevents NOT NULL constraint violations when the model omits fields.
 */
export function sanitizeAnalysis(
  raw: Partial<AnalysisResponse>,
  symbol: string,
  currentPrice: number
): AnalysisResponse {
  const VALID_SIGNALS = ["weak", "medium", "strong", "very_strong"] as const;
  const VALID_ACTIONS = ["buy", "sell", "hold", "watch"] as const;
  const VALID_RISKS   = ["low", "moderate", "high", "very_high"] as const;
  const VALID_TRENDS  = ["bullish", "bearish", "neutral", "sideways"] as const;

  return {
    symbol: raw.symbol ?? symbol,

    signal_level: VALID_SIGNALS.includes(raw.signal_level as typeof VALID_SIGNALS[number])
      ? raw.signal_level!
      : "weak",

    action: VALID_ACTIONS.includes(raw.action as typeof VALID_ACTIONS[number])
      ? raw.action!
      : "watch",

    suggested_buy_price:  raw.suggested_buy_price  ?? null,
    suggested_sell_price: raw.suggested_sell_price ?? null,
    stop_loss_price:      raw.stop_loss_price      ?? null,

    risk_estimation: VALID_RISKS.includes(raw.risk_estimation as typeof VALID_RISKS[number])
      ? raw.risk_estimation!
      : "moderate",

    // NOT NULL in DB — always supply a non-empty string
    reasoning: raw.reasoning?.trim() ||
      `Analysis for ${symbol} at $${currentPrice.toFixed(2)}. ` +
      `Signal: ${raw.signal_level ?? "weak"}. ` +
      `No detailed reasoning was returned by the AI model.`,

    technical_summary: {
      trend: VALID_TRENDS.includes(raw.technical_summary?.trend as typeof VALID_TRENDS[number])
        ? raw.technical_summary!.trend
        : "neutral",
      support_levels:    Array.isArray(raw.technical_summary?.support_levels)
        ? raw.technical_summary!.support_levels
        : [],
      resistance_levels: Array.isArray(raw.technical_summary?.resistance_levels)
        ? raw.technical_summary!.resistance_levels
        : [],
      key_indicators: raw.technical_summary?.key_indicators ?? "",
      ...raw.technical_summary,
    },

    confidence:   typeof raw.confidence   === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.5,
    time_horizon: raw.time_horizon?.trim() || "N/A",

    options_strategy: raw.options_strategy
      ? {
          recommendation: raw.options_strategy.recommendation ?? null,
          strategy_type: (["protective_put", "covered_call", "collar", "spread", "none"] as const)
            .includes(raw.options_strategy.strategy_type as "protective_put" | "covered_call" | "collar" | "spread" | "none")
            ? raw.options_strategy.strategy_type
            : "none",
          details: raw.options_strategy.details ?? null,
        }
      : null,
  };
}

function enrichWithIndicators(
  analysis: AnalysisResponse,
  data: StockDailyData[]
): AnalysisResponse {
  const ind = buildTechnicalIndicators(data);
  return {
    ...analysis,
    technical_summary: {
      ...analysis.technical_summary,
      bb_upper: ind.bb?.upper,
      bb_lower: ind.bb?.lower,
      bb_middle: ind.bb?.middle,
      sma_20: ind.sma_20 ?? undefined,
      sma_50: ind.sma_50 ?? undefined,
      sma_200: ind.sma_200 ?? undefined,
      rsi: ind.rsi ?? undefined,
      macd: ind.macd?.macd,
    },
  };
}

function parseJsonResponse(text: string): AnalysisResponse {
  // Strip markdown code fences
  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Extract the JSON object if there's surrounding text
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // If JSON is truncated, try to repair common issues:
    // 1. Missing closing braces — count opens vs closes and append
    const opens = (cleaned.match(/{/g) || []).length;
    const closes = (cleaned.match(/}/g) || []).length;
    let repaired = cleaned;

    // Remove trailing comma or partial key/value
    repaired = repaired.replace(/,\s*$/, "");
    repaired = repaired.replace(/,\s*"[^"]*$/, "");
    repaired = repaired.replace(/:\s*$/, ': null');

    // Close any unclosed strings
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) repaired += '"';

    // Add missing closing braces
    for (let i = 0; i < opens - closes; i++) repaired += "}";

    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error(
        `Failed to parse AI response as JSON. ` +
        `Raw response (first 500 chars): ${text.slice(0, 500)}`
      );
    }
  }
}

// ─── Groq provider ────────────────────────────────────────────────────────────

async function analyzeWithGroq(request: LongTermAnalysisRequest): Promise<AnalysisResponse> {
  const apiKey = getGroqKey();
  const prompt = buildPrompt(request);

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 429) {
      throw new Error("Groq rate limit reached. Wait a moment and try again.");
    }
    throw new Error(`Groq API error (${response.status}): ${err}`);
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("No response from Groq");

  const raw = parseJsonResponse(text);
  const analysis = sanitizeAnalysis(raw, request.symbol, request.quote.price);
  return enrichWithIndicators(analysis, request.stockData);
}

// ─── Gemini provider ──────────────────────────────────────────────────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com";


interface GeminiModel {
  name: string;           // e.g. "models/gemini-2.0-flash-001"
  displayName: string;
  supportedGenerationMethods: string[];
}

/**
 * Discovers all models available for the given API key.
 * This is the authoritative way to know what works — no more guessing.
 */
async function listAvailableModels(apiKey: string): Promise<GeminiModel[]> {
  // Try both v1 and v1beta to maximize discovery
  for (const version of ["v1beta", "v1"]) {
    const res = await fetch(`${GEMINI_BASE}/${version}/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      return (data.models ?? []) as GeminiModel[];
    }
    // 400 = invalid key format, 403 = key invalid / API not enabled
    if (res.status === 400 || res.status === 403) {
      const body = await res.text();
      throw new Error(
        `Gemini API key rejected (HTTP ${res.status}). ` +
        `Make sure: 1) the key is correct, 2) "Generative Language API" is enabled ` +
        `at https://console.cloud.google.com/apis/library — Details: ${body}`
      );
    }
  }
  throw new Error("Could not reach Gemini API to list models. Check your network connection.");
}

async function analyzeWithGemini(request: LongTermAnalysisRequest): Promise<AnalysisResponse> {
  const apiKey = getGeminiKey();
  const prompt = buildPrompt(request);

  // Step 1: Discover available models
  const available = await listAvailableModels(apiKey);

  // Build ranked candidate list: preferred order first, then any remaining
  const candidates = rankModels(available);

  if (candidates.length === 0) {
    const allNames = available.map((m) => m.name.replace("models/", "")).join(", ");
    throw new Error(
      `No Gemini model supports text generateContent for your API key. ` +
      `Available models: [${allNames || "none"}]. ` +
      `Make sure billing is enabled and the Generative Language API is active. ` +
      `Or set AI_PROVIDER=groq in .env.local as a free alternative.`
    );
  }

  // Step 2: Try each candidate until one works
  const errors: string[] = [];

  for (const model of candidates) {
    for (const version of ["v1beta", "v1"]) {
      const url = `${GEMINI_BASE}/${version}/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      });

      if (res.ok) {
        const result = await res.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          errors.push(`${model}/${version}: empty response`);
          break; // try next model
        }
        console.log(`[Gemini] Success with model: ${model} via ${version}`);
        const raw = parseJsonResponse(text);
        const analysis = sanitizeAnalysis(raw, request.symbol, request.quote.price);
        return enrichWithIndicators(analysis, request.stockData);
      }

      const body = await res.text();

      // 429 = quota / rate limit — don't retry other models, it's account-wide
      if (res.status === 429) {
        if (body.includes("limit: 0")) {
          throw new Error(
            "Gemini quota is 0 for your project. Enable billing at " +
            "https://console.cloud.google.com/billing"
          );
        }
        throw new Error("Gemini rate limit hit. Wait a moment and try again.");
      }

      // 404 on this version → try the other API version
      if (res.status === 404) continue;

      // 400 / other error → model is deprecated or incompatible, try next model
      errors.push(`${model}/${version}: HTTP ${res.status}`);
      break;
    }
  }

  throw new Error(
    `All Gemini models failed. Tried: ${candidates.join(", ")}. ` +
    `Errors: ${errors.join("; ")}. ` +
    `Set AI_PROVIDER=groq in .env.local as a free alternative.`
  );
}

/**
 * Auto-rank discovered models. No hardcoded model list needed.
 *
 * Ranking logic (higher = tried first):
 *   1. "latest" aliases (auto-updating, always current)
 *   2. Higher version number (3.x > 2.5 > 2.0 > 1.5)
 *   3. "flash" over "pro" (faster, cheaper, good enough for analysis)
 *   4. Stable over "preview" (more reliable)
 *
 * Excludes non-text models (TTS, imagen, veo, embedding, etc.).
 */
function rankModels(available: GeminiModel[]): string[] {
  const EXCLUDE_PATTERNS = ["tts", "imagen", "veo", "embedding", "aqa", "bisheng"];

  const textModels = available
    .filter((m) => {
      if (!m.supportedGenerationMethods?.includes("generateContent")) return false;
      const id = m.name.toLowerCase();
      return !EXCLUDE_PATTERNS.some((p) => id.includes(p));
    })
    .map((m) => m.name.replace("models/", ""));

  if (textModels.length === 0) return [];

  function score(model: string): number {
    const m = model.toLowerCase();
    let s = 0;

    // "latest" aliases are always the best pick (auto-updating)
    if (m.includes("latest")) s += 10000;

    // Extract version number: "gemini-2.5-flash" → 2.5, "gemini-3-flash" → 3.0
    const vMatch = m.match(/gemini-(\d+(?:\.\d+)?)/);
    const version = vMatch ? parseFloat(vMatch[1]) : 0;
    s += version * 1000; // e.g. 3.0 → 3000, 2.5 → 2500

    // Prefer flash (fast & cheap) over pro for this use case
    if (m.includes("flash")) s += 100;

    // Stable > preview > experimental
    if (!m.includes("preview") && !m.includes("exp")) s += 50;
    else if (m.includes("preview")) s += 20;
    // experimental gets 0

    return s;
  }

  return textModels.sort((a, b) => score(b) - score(a));
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function analyzeStock(request: LongTermAnalysisRequest): Promise<AnalysisResponse> {
  const provider = getProvider();
  if (provider === "gemini") {
    return analyzeWithGemini(request);
  }
  return analyzeWithGroq(request);
}

// ─── Conversation follow-up ──────────────────────────────────────────────────

export interface ChatContext {
  suggestion: {
    symbol: string;
    action: string;
    signal_level: string;
    reasoning: string;
    suggested_buy_price: number | null;
    suggested_sell_price: number | null;
    stop_loss_price: number | null;
    risk_estimation: string | null;
    current_price: number | null;
    technical_summary: Record<string, unknown>;
    options_strategy: Record<string, unknown> | null;
    time_horizon: string | null;
  };
  positions: Array<{
    type: string;
    instrument_type: string;
    quantity: number;
    price: number;
    contracts?: number | null;
    strike_price?: number | null;
    expiration_date?: string | null;
    status: string;
  }>;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  userPreferences: { risk_level: string; investment_style: string };
}

function buildChatPrompt(ctx: ChatContext, userMessage: string): string {
  const s = ctx.suggestion;
  const positionsText = ctx.positions.length > 0
    ? ctx.positions.map((t) => {
        if (t.instrument_type === "call_option" || t.instrument_type === "put_option") {
          const kind = t.instrument_type === "call_option" ? "CALL" : "PUT";
          return `- ${t.type.toUpperCase()} ${t.contracts} ${kind} contract(s) · Strike $${(t.strike_price ?? 0).toFixed(2)} · Expires ${t.expiration_date} · Premium $${t.price.toFixed(2)}/sh (${t.status})`;
        }
        return `- ${t.type.toUpperCase()} ${t.quantity} shares @ $${t.price.toFixed(2)} (${t.status})`;
      }).join("\n")
    : "None";

  const historyText = ctx.conversationHistory
    .map((m) => `${m.role === "user" ? "User" : "Advisor"}: ${m.content}`)
    .join("\n\n");

  return `You are an expert financial advisor having a conversation about ${s.symbol}. Answer the user's question using the context below. Be concise but thorough. You may suggest options strategies when relevant.

## User Profile
- Risk Level: ${ctx.userPreferences.risk_level}
- Investment Style: ${ctx.userPreferences.investment_style}

## Latest AI Analysis for ${s.symbol}
- Action: ${s.action} | Signal: ${s.signal_level} | Confidence: N/A
- Current Price: ${s.current_price ? `$${s.current_price.toFixed(2)}` : "N/A"}
- Buy Target: ${s.suggested_buy_price ? `$${s.suggested_buy_price.toFixed(2)}` : "N/A"}
- Sell Target: ${s.suggested_sell_price ? `$${s.suggested_sell_price.toFixed(2)}` : "N/A"}
- Stop Loss: ${s.stop_loss_price ? `$${s.stop_loss_price.toFixed(2)}` : "N/A"}
- Risk: ${s.risk_estimation ?? "N/A"} | Time Horizon: ${s.time_horizon ?? "N/A"}
- Reasoning: ${s.reasoning}
${s.options_strategy ? `- Options Strategy: ${JSON.stringify(s.options_strategy)}` : ""}

## User's Positions in ${s.symbol}
${positionsText}

## Conversation History
${historyText || "(This is the start of the conversation)"}

## User's Question
${userMessage}

Respond in plain text (not JSON). Be specific with numbers and actionable advice.`;
}

async function callAIChat(prompt: string): Promise<string> {
  const provider = getProvider();

  if (provider === "gemini") {
    const apiKey = getGeminiKey();
    const available = await listAvailableModels(apiKey);
    const candidates = rankModels(available);

    for (const model of candidates) {
      for (const version of ["v1beta", "v1"]) {
        const url = `${GEMINI_BASE}/${version}/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
          }),
        });
        if (res.ok) {
          const result = await res.json();
          const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
          break;
        }
        if (res.status === 429) throw new Error("Gemini rate limit hit");
        if (res.status === 404) continue;
        break;
      }
    }
    throw new Error("All Gemini models failed for chat");
  }

  // Groq
  const apiKey = getGroqKey();
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error (${response.status}): ${err}`);
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("No response from Groq");
  return text;
}

export async function chatWithSuggestion(ctx: ChatContext, userMessage: string): Promise<string> {
  const prompt = buildChatPrompt(ctx, userMessage);
  return callAIChat(prompt);
}

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
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateSMA,
} from "./alpha-vantage";

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

function buildTechnicalIndicators(data: StockDailyData[]) {
  return {
    sma_20: calculateSMA(data, 20),
    sma_50: calculateSMA(data, 50),
    sma_200: calculateSMA(data, 200),
    rsi: calculateRSI(data, 14),
    bb: calculateBollingerBands(data, 20, 2),
    macd: calculateMACD(data),
  };
}

function riskInstructions(risk: string): string {
  switch (risk) {
    case "conservative":
      return `- Only recommend "buy" when RSI < 35 AND price is near/below the lower Bollinger Band AND SMA trend is stable.
- Set stop_loss_price tightly (1–2% below buy price).
- Prefer "watch" or "hold" over "buy" when signals are ambiguous.
- Set risk_estimation to "low" or "moderate" only; avoid "very_strong" signal levels.
- Confidence threshold: only output confidence > 0.7 if multiple indicators align clearly.`;
    case "aggressive":
      return `- Accept higher volatility; recommend "buy" on strong momentum even if RSI is elevated.
- Stop losses can be wider (4–8% below entry) to avoid premature exits on volatile stocks.
- Actively suggest entries on breakouts above resistance with volume confirmation.
- Can return "very_strong" signal levels when 2+ indicators align.
- Higher confidence acceptable (0.6+) even with partial confirmation.`;
    default: // moderate
      return `- Balance risk and reward; recommend "buy" when RSI is between 40–60 and trend is confirmed by SMA.
- Set stop_loss_price at 3–4% below buy price.
- Use "strong" signal only when at least 2 indicators confirm the direction.
- Confidence range: 0.5–0.8 based on signal clarity.`;
  }
}

function styleInstructions(style: string): string {
  switch (style) {
    case "day_trading":
      return `- Focus on intraday momentum: MACD crossovers, RSI extremes (>70 or <30), and Bollinger Band squeezes.
- time_horizon must be "intraday" or "1–2 days".
- suggested_buy_price and suggested_sell_price should be precise (within 0.5% of current price).
- Ignore SMA 200 (irrelevant for intraday); weight MACD and volume heavily.
- Flag very high volume spikes as entry signals.`;
    case "long_term":
      return `- Focus on macro trend: price vs SMA 200 position is the primary signal.
- time_horizon must be "1–6 months" or longer.
- Minor RSI fluctuations and short-term Bollinger Band touches are noise — ignore them.
- Only recommend "buy" if price is above SMA 200 (or within 5% below it in a clear uptrend).
- suggested_sell_price should target 15–30% gains; stop_loss_price should be 8–12% below entry.`;
    default: // swing
      return `- Focus on multi-day patterns: Bollinger Band bounces, RSI reversals from extremes, MACD crossovers.
- time_horizon must be "3 days–4 weeks".
- Weight SMA 20 and SMA 50 crossovers as key signals.
- suggested_sell_price should target 5–15% gains from entry.
- stop_loss_price should be 3–6% below entry.`;
  }
}

function buildPrompt(request: AnalysisRequest): string {
  const ind = buildTechnicalIndicators(request.stockData);
  const recentData = request.stockData.slice(-30);
  const { risk_level, investment_style } = request.userPreferences;

  return `You are an expert financial analyst. Analyze the stock data below and produce a recommendation STRICTLY tailored to this user's profile.

## User Profile (these rules MUST govern your output)
- Risk Level: ${risk_level}
- Investment Style: ${investment_style}

### Risk rules (${risk_level}):
${riskInstructions(risk_level)}

### Style rules (${investment_style}):
${styleInstructions(investment_style)}

---

## Stock: ${request.symbol}

## Current Quote
- Price: $${request.quote.price.toFixed(2)}
- Day Change: $${request.quote.change.toFixed(2)} (${request.quote.changePercent.toFixed(2)}%)
- Open: $${request.quote.open.toFixed(2)} | High: $${request.quote.high.toFixed(2)} | Low: $${request.quote.low.toFixed(2)}
- Prev Close: $${request.quote.previousClose.toFixed(2)} | Volume: ${request.quote.volume.toLocaleString()}

## Technical Indicators
- SMA 20: ${ind.sma_20 ? `$${ind.sma_20.toFixed(2)}` : "N/A"}
- SMA 50: ${ind.sma_50 ? `$${ind.sma_50.toFixed(2)}` : "N/A"}
- SMA 200: ${ind.sma_200 ? `$${ind.sma_200.toFixed(2)}` : "N/A"}
- RSI (14): ${ind.rsi ? ind.rsi.toFixed(2) : "N/A"}
- Bollinger Bands: Upper=${ind.bb ? `$${ind.bb.upper.toFixed(2)}` : "N/A"}, Mid=${ind.bb ? `$${ind.bb.middle.toFixed(2)}` : "N/A"}, Lower=${ind.bb ? `$${ind.bb.lower.toFixed(2)}` : "N/A"}
- MACD: ${ind.macd ? ind.macd.macd.toFixed(4) : "N/A"} | Signal: ${ind.macd ? ind.macd.signal.toFixed(4) : "N/A"}

## Last 30 Days (Date, Close, Volume)
${recentData.map((d) => `${d.date}: $${d.close.toFixed(2)} | ${d.volume.toLocaleString()}`).join("\n")}

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

## Output
Respond ONLY with a valid JSON object — no markdown, no code fences, no extra text:

{
  "symbol": "${request.symbol}",
  "signal_level": "weak|medium|strong|very_strong",
  "action": "buy|sell|hold|watch",
  "suggested_buy_price": <number or null>,
  "suggested_sell_price": <number or null>,
  "stop_loss_price": <number or null>,
  "risk_estimation": "low|moderate|high|very_high",
  "reasoning": "<2-3 sentences referencing both the technicals AND this user's ${risk_level} risk / ${investment_style} style>",
  "technical_summary": {
    "trend": "bullish|bearish|neutral|sideways",
    "support_levels": [<number>, <number>],
    "resistance_levels": [<number>, <number>],
    "key_indicators": "<brief summary of which indicators drove this recommendation>"
  },
  "confidence": <0.0 to 1.0>,
  "time_horizon": "<must match the ${investment_style} style rules above>"
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

async function analyzeWithGroq(request: AnalysisRequest): Promise<AnalysisResponse> {
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

async function analyzeWithGemini(request: AnalysisRequest): Promise<AnalysisResponse> {
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

export async function analyzeStock(request: AnalysisRequest): Promise<AnalysisResponse> {
  const provider = getProvider();
  if (provider === "gemini") {
    return analyzeWithGemini(request);
  }
  return analyzeWithGroq(request);
}

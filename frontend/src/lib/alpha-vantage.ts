/**
 * Stock data via Yahoo Finance (no API key required, free & unlimited).
 * Alpha Vantage free tier is only 25 calls/day which runs out fast.
 */
import type { StockQuote, StockDailyData } from "@/types";

const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

interface YFResponse {
  chart: {
    result: Array<{
      meta: {
        symbol: string;
        regularMarketPrice: number;
        previousClose: number;
        regularMarketOpen: number;
        regularMarketDayHigh: number;
        regularMarketDayLow: number;
        regularMarketVolume: number;
        chartPreviousClose: number;
      };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

export async function getStockQuote(symbol: string): Promise<StockQuote> {
  const url = `${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch data for "${symbol}" (HTTP ${response.status}). Check the ticker symbol is correct.`);
  }

  const data: YFResponse = await response.json();

  if (data.chart.error) {
    throw new Error(`Symbol not found: "${symbol}". ${data.chart.error.description}`);
  }

  const result = data.chart.result?.[0];
  if (!result) {
    throw new Error(`No data found for "${symbol}". Check the ticker symbol is correct (e.g. GOOGL, AAPL, TSLA).`);
  }

  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose;
  const change = price - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    symbol: meta.symbol,
    open: meta.regularMarketOpen ?? price,
    high: meta.regularMarketDayHigh ?? price,
    low: meta.regularMarketDayLow ?? price,
    price,
    volume: meta.regularMarketVolume ?? 0,
    latestTradingDay: new Date().toISOString().split("T")[0],
    previousClose: prevClose,
    change,
    changePercent,
  };
}

export type DailyRange = "compact" | "full" | "longterm";

export async function getDailyData(
  symbol: string,
  outputSize: DailyRange = "longterm"
): Promise<StockDailyData[]> {
  // compact = ~3 months, full = ~1 year, longterm = 5 years (default for long-horizon analysis)
  const range =
    outputSize === "compact" ? "3mo" : outputSize === "full" ? "1y" : "5y";
  const url = `${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch history for "${symbol}" (HTTP ${response.status}).`);
  }

  const data: YFResponse = await response.json();

  if (data.chart.error) {
    throw new Error(`Symbol not found: "${symbol}". ${data.chart.error.description}`);
  }

  const result = data.chart.result?.[0];
  if (!result || !result.timestamp) {
    throw new Error(`No historical data found for "${symbol}".`);
  }

  const { timestamp, indicators } = result;
  const quote = indicators.quote[0];

  return timestamp
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split("T")[0],
      open: quote.open[i] ?? 0,
      high: quote.high[i] ?? 0,
      low: quote.low[i] ?? 0,
      close: quote.close[i] ?? 0,
      volume: quote.volume[i] ?? 0,
    }))
    .filter((d) => d.close > 0) // remove days with no data
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ─── Technical indicator calculations ────────────────────────────────────────

export function calculateSMA(data: StockDailyData[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((sum, d) => sum + d.close, 0) / period;
}

export function calculateRSI(data: StockDailyData[], period: number = 14): number | null {
  if (data.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = data.length - period; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateBollingerBands(
  data: StockDailyData[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number } | null {
  if (data.length < period) return null;

  const slice = data.slice(-period);
  const middle = slice.reduce((sum, d) => sum + d.close, 0) / period;
  const variance = slice.reduce((sum, d) => sum + Math.pow(d.close - middle, 2), 0) / period;
  const sd = Math.sqrt(variance);

  return {
    upper: middle + stdDev * sd,
    middle,
    lower: middle - stdDev * sd,
  };
}

export function calculateMACD(
  data: StockDailyData[]
): { macd: number; signal: number; histogram: number } | null {
  if (data.length < 26) return null;

  const ema12 = calculateEMA(data.map((d) => d.close), 12);
  const ema26 = calculateEMA(data.map((d) => d.close), 26);

  if (ema12 === null || ema26 === null) return null;

  const macd = ema12 - ema26;
  const signal = macd * 0.85; // simplified approximation
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

function calculateEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

// ─── Long-term indicators ────────────────────────────────────────────────────

/**
 * Resample daily bars to weekly bars (Friday close).
 * Used so RSI/SMA on weekly data captures multi-month structure, not just noise.
 */
export function resampleToWeekly(data: StockDailyData[]): StockDailyData[] {
  if (data.length === 0) return [];
  const buckets = new Map<string, StockDailyData[]>();
  for (const d of data) {
    const date = new Date(d.date + "T00:00:00Z");
    const day = date.getUTCDay();
    // Move to the Friday of that ISO week
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

/** % return between two dates' closes; null if not enough history. */
function returnOverDays(data: StockDailyData[], days: number): number | null {
  if (data.length < days + 1) return null;
  const now = data[data.length - 1].close;
  const past = data[data.length - 1 - days].close;
  if (past <= 0) return null;
  return (now - past) / past;
}

export interface LongTermMetrics {
  return_1m: number | null;   // ~21 trading days
  return_3m: number | null;   // ~63
  return_6m: number | null;   // ~126
  return_1y: number | null;   // ~252
  return_3y: number | null;   // ~756
  return_ytd: number | null;
  rsi_weekly: number | null;
  sma_50: number | null;
  sma_200: number | null;
  golden_cross: boolean;       // SMA50 > SMA200
  days_since_cross: number | null; // approx — days since the last SMA50/SMA200 cross
  high_52w: number | null;
  low_52w: number | null;
  distance_from_52w_high: number | null; // negative number e.g. -0.05 = 5% below high
  volume_surge_ratio: number | null;     // 30d avg vol / 1y avg vol
}

export function buildLongTermMetrics(data: StockDailyData[]): LongTermMetrics {
  const weekly = resampleToWeekly(data);
  const sma50 = calculateSMA(data, 50);
  const sma200 = calculateSMA(data, 200);

  // Days since SMA50/SMA200 last crossed
  let daysSinceCross: number | null = null;
  if (data.length > 200) {
    // Walk backwards computing rolling SMA50 and SMA200; flip == cross.
    const currentlyGolden = (sma50 ?? 0) > (sma200 ?? 0);
    for (let i = data.length - 1; i >= 200; i--) {
      const slice = data.slice(0, i + 1);
      const s50 = calculateSMA(slice, 50);
      const s200 = calculateSMA(slice, 200);
      if (s50 === null || s200 === null) break;
      const golden = s50 > s200;
      if (golden !== currentlyGolden) {
        daysSinceCross = data.length - 1 - i;
        break;
      }
    }
  }

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

  // YTD return
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
    rsi_weekly: calculateRSI(weekly, 14),
    sma_50: sma50,
    sma_200: sma200,
    golden_cross: sma50 !== null && sma200 !== null ? sma50 > sma200 : false,
    days_since_cross: daysSinceCross,
    high_52w: high52,
    low_52w: low52,
    distance_from_52w_high: distFromHigh,
    volume_surge_ratio: volumeSurge,
  };
}

/**
 * Composite 0–100 momentum score for ranking discovery candidates.
 * Higher = stronger long-term uptrend with room left.
 */
export function momentumScore(m: LongTermMetrics): number {
  let score = 0;

  // 1y return — heaviest weight (up to 35 pts)
  if (m.return_1y !== null) {
    score += Math.max(0, Math.min(35, m.return_1y * 35));
  }
  // 6m return (up to 15 pts)
  if (m.return_6m !== null) {
    score += Math.max(0, Math.min(15, m.return_6m * 25));
  }
  // 3m return (up to 10 pts)
  if (m.return_3m !== null) {
    score += Math.max(0, Math.min(10, m.return_3m * 25));
  }
  // Golden cross active (up to 15 pts), with bonus if recent
  if (m.golden_cross) {
    score += 10;
    if (m.days_since_cross !== null && m.days_since_cross < 90) score += 5;
  }
  // Distance from 52w high — closer = stronger (but not overbought)
  if (m.distance_from_52w_high !== null) {
    const d = m.distance_from_52w_high; // negative or zero
    if (d > -0.05) score += 10;        // within 5% of high
    else if (d > -0.15) score += 6;    // within 15%
  }
  // Volume surge (up to 10 pts)
  if (m.volume_surge_ratio !== null && m.volume_surge_ratio > 1) {
    score += Math.min(10, (m.volume_surge_ratio - 1) * 10);
  }
  // Penalty for already-overbought weekly RSI
  if (m.rsi_weekly !== null && m.rsi_weekly > 75) {
    score -= (m.rsi_weekly - 75) * 0.8;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

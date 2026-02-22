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

export async function getDailyData(
  symbol: string,
  outputSize: "compact" | "full" = "compact"
): Promise<StockDailyData[]> {
  // compact = ~3 months, full = ~1 year
  const range = outputSize === "compact" ? "3mo" : "1y";
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

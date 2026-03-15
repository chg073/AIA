import type { ExitScoreDetails, StockDailyData } from "@/types";

interface ExitScoreInput {
  rsi: number | null;
  currentPrice: number;
  suggestedSellPrice: number | null;
  stopLossPrice: number | null;
  resistanceLevels: number[];
  currentTrend: string;
  previousTrend: string | null;
  dailyData: StockDailyData[];
}

export function computeExitScore(input: ExitScoreInput): {
  score: number;
  details: ExitScoreDetails;
} {
  const details: ExitScoreDetails = {
    rsi_component: 0,
    resistance_component: 0,
    sell_target_component: 0,
    stop_loss_component: 0,
    trend_component: 0,
    volume_component: 0,
  };

  // RSI overbought: +30 points scaled linearly from RSI 70-90
  if (input.rsi !== null && input.rsi > 70) {
    details.rsi_component = Math.min(30, Math.round(((input.rsi - 70) / 20) * 30));
  }

  // Price near/above resistance: +25 points if within 2% of nearest resistance
  if (input.resistanceLevels.length > 0) {
    const nearest = input.resistanceLevels
      .map((r) => Math.abs(input.currentPrice - r) / r)
      .sort((a, b) => a - b)[0];
    if (nearest <= 0.02) {
      details.resistance_component = Math.round((1 - nearest / 0.02) * 25);
    }
    // Full 25 if price is above all resistance levels
    if (input.currentPrice > Math.max(...input.resistanceLevels)) {
      details.resistance_component = 25;
    }
  }

  // Price above suggested sell price: +25 points
  if (
    input.suggestedSellPrice !== null &&
    input.currentPrice >= input.suggestedSellPrice
  ) {
    details.sell_target_component = 25;
  }

  // Stop-loss breach: +20 points
  if (
    input.stopLossPrice !== null &&
    input.currentPrice <= input.stopLossPrice
  ) {
    details.stop_loss_component = 20;
  }

  // Bearish trend reversal: +15 points
  if (
    input.previousTrend !== null &&
    (input.previousTrend === "bullish" || input.previousTrend === "neutral") &&
    input.currentTrend === "bearish"
  ) {
    details.trend_component = 15;
  }

  // Volume decline (3-week declining avg): +10 points
  if (input.dailyData.length >= 15) {
    const week1Avg = avgVolume(input.dailyData.slice(-15, -10));
    const week2Avg = avgVolume(input.dailyData.slice(-10, -5));
    const week3Avg = avgVolume(input.dailyData.slice(-5));
    if (week3Avg < week2Avg && week2Avg < week1Avg) {
      details.volume_component = 10;
    }
  }

  const score = Math.min(
    100,
    details.rsi_component +
      details.resistance_component +
      details.sell_target_component +
      details.stop_loss_component +
      details.trend_component +
      details.volume_component
  );

  return { score, details };
}

function avgVolume(data: StockDailyData[]): number {
  if (data.length === 0) return 0;
  return data.reduce((s, d) => s + d.volume, 0) / data.length;
}

export function getExitScoreLabel(score: number): {
  label: string;
  color: string;
} {
  if (score >= 81) return { label: "Strong Sell Signal", color: "text-red-400" };
  if (score >= 61) return { label: "Consider Selling", color: "text-orange-400" };
  if (score >= 31) return { label: "Monitor", color: "text-yellow-400" };
  return { label: "Hold", color: "text-green-400" };
}

export function getExitScoreBgColor(score: number): string {
  if (score >= 81) return "bg-red-500";
  if (score >= 61) return "bg-orange-500";
  if (score >= 31) return "bg-yellow-500";
  return "bg-green-500";
}

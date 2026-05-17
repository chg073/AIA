import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStockQuote, getDailyData, calculateRSI } from "@/lib/alpha-vantage";
import { analyzeStock, type PriorSuggestion } from "@/lib/gemini";
import { computeExitScore } from "@/lib/exit-score";
import type { Transaction, Profile, Suggestion, StockDailyData } from "@/types";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { symbol } = await request.json();
    if (!symbol) {
      return NextResponse.json(
        { error: "Symbol is required" },
        { status: 400 }
      );
    }

    // Get user profile for preferences
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    // Get existing active transactions for this stock
    const { data: transactions } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .eq("symbol", symbol.toUpperCase())
      .eq("status", "active");

    // Long-term cache window: quote 2h, daily history 24h (5y of data rarely changes)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: cachedQuote } = await supabase
      .from("stock_data_cache")
      .select("*")
      .eq("symbol", symbol.toUpperCase())
      .eq("data_type", "quote")
      .gte("fetched_at", twoHoursAgo)
      .single();

    const { data: cachedDaily } = await supabase
      .from("stock_data_cache")
      .select("*")
      .eq("symbol", symbol.toUpperCase())
      .eq("data_type", "daily")
      .gte("fetched_at", oneDayAgo)
      .single();

    let quote, dailyData;

    if (cachedQuote && cachedDaily) {
      quote = cachedQuote.data;
      dailyData = cachedDaily.data;
    } else {
      // Fetch fresh data — long-term lens needs 5y of history for SMA200, weekly RSI, 1y/3y returns
      [quote, dailyData] = await Promise.all([
        getStockQuote(symbol.toUpperCase()),
        getDailyData(symbol.toUpperCase(), "longterm"),
      ]);

      await Promise.all([
        supabase.from("stock_data_cache").upsert(
          {
            symbol: symbol.toUpperCase(),
            data_type: "quote",
            data: quote as unknown as Record<string, unknown>,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "symbol,data_type" }
        ),
        supabase.from("stock_data_cache").upsert(
          {
            symbol: symbol.toUpperCase(),
            data_type: "daily",
            data: dailyData as unknown as Record<string, unknown>,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "symbol,data_type" }
        ),
      ]);
    }

    // Fetch prior active suggestion so the AI can stay consistent with its long-term call
    const { data: priorSuggestion } = await supabase
      .from("suggestions")
      .select("action, signal_level, reasoning, suggested_buy_price, suggested_sell_price, stop_loss_price, created_at, technical_summary")
      .eq("user_id", user.id)
      .eq("symbol", symbol.toUpperCase())
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const priorForPrompt: PriorSuggestion | null = priorSuggestion
      ? {
          action: priorSuggestion.action,
          signal_level: priorSuggestion.signal_level,
          reasoning: priorSuggestion.reasoning,
          suggested_buy_price: priorSuggestion.suggested_buy_price,
          suggested_sell_price: priorSuggestion.suggested_sell_price,
          stop_loss_price: priorSuggestion.stop_loss_price,
          created_at: priorSuggestion.created_at,
        }
      : null;

    // Run AI analysis (long-term lens, anchored to prior suggestion)
    const analysis = await analyzeStock({
      symbol: symbol.toUpperCase(),
      stockData: dailyData as ReturnType<typeof getDailyData> extends Promise<infer T> ? T : never,
      quote: quote as ReturnType<typeof getStockQuote> extends Promise<infer T> ? T : never,
      userPreferences: {
        risk_level: (profile as Profile).risk_level,
        investment_style: (profile as Profile).investment_style,
      },
      existingPositions: (transactions || []) as Transaction[],
      priorSuggestion: priorForPrompt,
    });

    const currentPrice = (quote as { price: number }).price;
    const dailyArr = dailyData as StockDailyData[];
    const rsi = calculateRSI(dailyArr, 14);

    const { score: exitScore, details: exitScoreDetails } = computeExitScore({
      rsi,
      currentPrice,
      suggestedSellPrice: analysis.suggested_sell_price,
      stopLossPrice: analysis.stop_loss_price,
      resistanceLevels: analysis.technical_summary.resistance_levels ?? [],
      currentTrend: analysis.technical_summary.trend ?? "neutral",
      previousTrend:
        (priorSuggestion?.technical_summary as Suggestion["technical_summary"])
          ?.trend ?? null,
      dailyData: dailyArr,
    });

    // Deactivate previous suggestions for this stock
    await supabase
      .from("suggestions")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("symbol", symbol.toUpperCase())
      .eq("is_active", true);

    // Save the new suggestion
    const { data: suggestion, error: insertError } = await supabase
      .from("suggestions")
      .insert({
        user_id: user.id,
        symbol: symbol.toUpperCase(),
        signal_level: analysis.signal_level,
        action: analysis.action,
        suggested_buy_price: analysis.suggested_buy_price,
        suggested_sell_price: analysis.suggested_sell_price,
        stop_loss_price: analysis.stop_loss_price,
        current_price: currentPrice,
        risk_estimation: analysis.risk_estimation,
        reasoning: analysis.reasoning,
        technical_summary: analysis.technical_summary,
        confidence: analysis.confidence,
        time_horizon: analysis.time_horizon,
        options_strategy: analysis.options_strategy,
        exit_score: exitScore,
        exit_score_details: exitScoreDetails,
        is_active: true,
        // Long-term suggestions: valid for 7 days (until the next weekly refresh)
        expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(suggestion);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

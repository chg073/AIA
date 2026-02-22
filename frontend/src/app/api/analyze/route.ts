import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStockQuote, getDailyData } from "@/lib/alpha-vantage";
import { analyzeStock } from "@/lib/gemini";
import type { Transaction, Profile } from "@/types";

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

    // Check cache first (cache for 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
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
      .gte("fetched_at", twoHoursAgo)
      .single();

    let quote, dailyData;

    if (cachedQuote && cachedDaily) {
      // Use cached data
      quote = cachedQuote.data;
      dailyData = cachedDaily.data;
    } else {
      // Fetch fresh data
      [quote, dailyData] = await Promise.all([
        getStockQuote(symbol.toUpperCase()),
        getDailyData(symbol.toUpperCase()),
      ]);

      // Cache the data (upsert)
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

    // Run Gemini analysis
    const analysis = await analyzeStock({
      symbol: symbol.toUpperCase(),
      stockData: dailyData as ReturnType<typeof getDailyData> extends Promise<infer T> ? T : never,
      quote: quote as ReturnType<typeof getStockQuote> extends Promise<infer T> ? T : never,
      userPreferences: {
        risk_level: (profile as Profile).risk_level,
        investment_style: (profile as Profile).investment_style,
      },
      existingPositions: (transactions || []) as Transaction[],
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
        current_price: (quote as { price: number }).price,
        risk_estimation: analysis.risk_estimation,
        reasoning: analysis.reasoning,
        technical_summary: analysis.technical_summary,
        confidence: analysis.confidence,
        time_horizon: analysis.time_horizon,
        is_active: true,
        expires_at: new Date(
          Date.now() + 24 * 60 * 60 * 1000
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

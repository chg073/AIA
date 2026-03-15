import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatWithSuggestion } from "@/lib/gemini";
import type { ChatContext } from "@/lib/gemini";
import type { Profile, Suggestion, Transaction, SuggestionMessage } from "@/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: suggestionId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message } = await request.json();
    if (!message?.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const [suggestionRes, profileRes, historyRes] = await Promise.all([
      supabase
        .from("suggestions")
        .select("*")
        .eq("id", suggestionId)
        .eq("user_id", user.id)
        .single(),
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("suggestion_messages")
        .select("*")
        .eq("suggestion_id", suggestionId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
    ]);

    if (!suggestionRes.data) {
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 }
      );
    }

    const suggestion = suggestionRes.data as Suggestion;
    const profile = profileRes.data as Profile | null;
    const history = (historyRes.data || []) as SuggestionMessage[];

    const { data: transactions } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .eq("symbol", suggestion.symbol)
      .eq("status", "active");

    const ctx: ChatContext = {
      suggestion: {
        symbol: suggestion.symbol,
        action: suggestion.action,
        signal_level: suggestion.signal_level,
        reasoning: suggestion.reasoning,
        suggested_buy_price: suggestion.suggested_buy_price,
        suggested_sell_price: suggestion.suggested_sell_price,
        stop_loss_price: suggestion.stop_loss_price,
        risk_estimation: suggestion.risk_estimation,
        current_price: suggestion.current_price,
        technical_summary: suggestion.technical_summary as unknown as Record<string, unknown>,
        options_strategy: suggestion.options_strategy as unknown as Record<string, unknown> | null,
        time_horizon: suggestion.time_horizon,
      },
      positions: ((transactions || []) as Transaction[]).map((t) => ({
        type: t.type,
        instrument_type: t.instrument_type,
        quantity: t.quantity,
        price: t.price,
        contracts: t.contracts,
        strike_price: t.strike_price,
        expiration_date: t.expiration_date,
        status: t.status,
      })),
      conversationHistory: history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      userPreferences: {
        risk_level: profile?.risk_level ?? "moderate",
        investment_style: profile?.investment_style ?? "swing",
      },
    };

    const aiResponse = await chatWithSuggestion(ctx, message.trim());

    // Save both messages
    await supabase.from("suggestion_messages").insert([
      {
        suggestion_id: suggestionId,
        user_id: user.id,
        role: "user",
        content: message.trim(),
      },
      {
        suggestion_id: suggestionId,
        user_id: user.id,
        role: "assistant",
        content: aiResponse,
      },
    ]);

    return NextResponse.json({
      response: aiResponse,
      suggestion_id: suggestionId,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET  /api/market-outlook
 *   Returns the most recent market_outlooks row for the current user.
 *
 * POST /api/market-outlook
 *   Manually triggers the market-outlook edge function for the current
 *   user (used by the dashboard "Refresh" button).
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("market_outlooks")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outlook: data ?? null });
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "Supabase env vars missing" },
      { status: 500 },
    );
  }

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? anonKey;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/market-outlook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ user_id: user.id, force: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error ?? "Outlook refresh failed" },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Outlook refresh failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

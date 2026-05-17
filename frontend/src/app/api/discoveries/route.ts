import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/discoveries
 *   Returns the current user's discovery cards (status='new' by default;
 *   pass ?status=all to include dismissed/added).
 *
 * POST /api/discoveries
 *   Manually triggers the discover-stocks edge function for the current user.
 *   Returns the edge function response.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  let query = supabase
    .from("discoveries")
    .select("*")
    .eq("user_id", user.id);

  if (status !== "all") {
    query = query.eq("status", "new");
  }

  const { data, error } = await query
    .order("ai_recommended", { ascending: false })
    .order("momentum_score", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ discoveries: data ?? [] });
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
      { status: 500 }
    );
  }

  // Forward the user's session to authenticate against the edge function
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? anonKey;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/discover-stocks`, {
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
        { error: data.error ?? "Discover failed" },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Discover failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

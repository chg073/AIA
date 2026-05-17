import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/discoveries/[id]
 *   Body: { action: "add" | "dismiss" }
 *   - "add": adds the symbol to the watchlist and marks discovery as 'added'
 *   - "dismiss": marks discovery as 'dismissed' so future scans skip it
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.action !== "add" && body.action !== "dismiss") {
    return NextResponse.json({ error: "action must be 'add' or 'dismiss'" }, { status: 400 });
  }

  // Load the discovery row (RLS will scope to current user)
  const { data: discovery, error: fetchErr } = await supabase
    .from("discoveries")
    .select("symbol, company_name")
    .eq("id", id)
    .single();

  if (fetchErr || !discovery) {
    return NextResponse.json({ error: "Discovery not found" }, { status: 404 });
  }

  if (body.action === "add") {
    // Best-effort: insert into watchlist; ignore duplicate-key errors so the
    // discovery still gets marked as added.
    const { error: wlErr } = await supabase.from("watchlist").insert({
      user_id: user.id,
      symbol: discovery.symbol,
      company_name: discovery.company_name,
    });
    if (wlErr && wlErr.code !== "23505") {
      return NextResponse.json({ error: wlErr.message }, { status: 500 });
    }
  }

  const newStatus = body.action === "add" ? "added" : "dismissed";
  const { error: updErr } = await supabase
    .from("discoveries")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: newStatus });
}

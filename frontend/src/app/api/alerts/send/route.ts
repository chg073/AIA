import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALERT_TYPE_LABELS: Record<string, string> = {
  price_target_hit: "Price Target Hit",
  stop_loss_hit: "Stop-Loss Triggered",
  exit_score_high: "High Exit Score",
  action_changed: "Recommendation Changed",
  options_expiry_warning: "Options Expiry Warning",
};

const ALERT_TYPE_EMOJI: Record<string, string> = {
  price_target_hit: "&#127919;",
  stop_loss_hit: "&#128680;",
  exit_score_high: "&#9888;&#65039;",
  action_changed: "&#128260;",
  options_expiry_warning: "&#9200;",
};

function buildEmailHtml(
  userName: string,
  alerts: Array<{
    alert_type: string;
    symbol: string;
    title: string;
    message: string;
  }>
): string {
  const alertRows = alerts
    .map(
      (a) => `
    <tr>
      <td style="padding: 16px; border-bottom: 1px solid #1e293b;">
        <div style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
          ${ALERT_TYPE_EMOJI[a.alert_type] || ""} ${ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}
        </div>
        <div style="font-size: 16px; font-weight: 600; color: #f1f5f9; margin-bottom: 4px;">
          ${a.symbol} &mdash; ${a.title}
        </div>
        <div style="font-size: 14px; color: #cbd5e1;">
          ${a.message}
        </div>
      </td>
    </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #0f172a;">
    <tr>
      <td style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #1e293b;">
        <div style="font-size: 24px; font-weight: 700; color: #3b82f6;">AIA</div>
        <div style="font-size: 14px; color: #94a3b8; margin-top: 4px;">Investment Alert</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px;">
        <div style="font-size: 16px; color: #e2e8f0; margin-bottom: 16px;">
          Hi ${userName},
        </div>
        <div style="font-size: 14px; color: #94a3b8; margin-bottom: 24px;">
          You have ${alerts.length} new alert${alerts.length > 1 ? "s" : ""}:
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e293b; border-radius: 12px; overflow: hidden;">
          ${alertRows}
        </table>
        <div style="margin-top: 24px; text-align: center;">
          <a href="${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/dashboard/suggestions"
             style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
            View in Dashboard
          </a>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px; text-align: center; border-top: 1px solid #1e293b;">
        <div style="font-size: 12px; color: #64748b;">
          You received this because you have email alerts enabled in AIA settings.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST() {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json(
        { error: "RESEND_API_KEY not configured" },
        { status: 500 }
      );
    }

    const supabase = await createClient();

    // Get unsent alerts grouped by user
    const { data: pendingAlerts, error: fetchErr } = await supabase
      .from("alerts")
      .select("*, profiles!inner(name, email, notifications_enabled)")
      .eq("email_sent", false)
      .order("created_at", { ascending: true });

    if (fetchErr) {
      return NextResponse.json(
        { error: fetchErr.message },
        { status: 500 }
      );
    }

    if (!pendingAlerts || pendingAlerts.length === 0) {
      return NextResponse.json({ sent: 0, message: "No pending alerts" });
    }

    // Group by user
    const byUser = new Map<
      string,
      {
        email: string;
        name: string;
        alertIds: string[];
        alerts: Array<{
          alert_type: string;
          symbol: string;
          title: string;
          message: string;
        }>;
      }
    >();

    for (const alert of pendingAlerts) {
      const profile = Array.isArray(alert.profiles)
        ? alert.profiles[0]
        : alert.profiles;
      if (!profile?.notifications_enabled) continue;

      const userId = alert.user_id;
      if (!byUser.has(userId)) {
        byUser.set(userId, {
          email: profile.email,
          name: profile.name || "Investor",
          alertIds: [],
          alerts: [],
        });
      }

      const group = byUser.get(userId)!;
      group.alertIds.push(alert.id);
      group.alerts.push({
        alert_type: alert.alert_type,
        symbol: alert.symbol,
        title: alert.title,
        message: alert.message,
      });
    }

    let totalSent = 0;
    const errors: string[] = [];

    for (const [userId, group] of byUser.entries()) {
      try {
        const html = buildEmailHtml(group.name, group.alerts);

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || "AIA <alerts@resend.dev>",
            to: [group.email],
            subject: `AIA Alert: ${group.alerts.length} new notification${group.alerts.length > 1 ? "s" : ""} for your portfolio`,
            html,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          errors.push(`User ${userId}: Resend error ${res.status} - ${errText}`);
          continue;
        }

        // Mark as sent
        await supabase
          .from("alerts")
          .update({ email_sent: true })
          .in("id", group.alertIds);

        totalSent++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`User ${userId}: ${msg}`);
      }
    }

    return NextResponse.json({
      sent: totalSent,
      total_alerts: pendingAlerts.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to send alerts";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

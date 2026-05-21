// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_API_KEY = Deno.env.get("ADMIN_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const FROM_EMAIL = "3Ball Academy <noreply@3ballacademy.com>";
const APP_URL = "https://app.3ballacademy.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bodyHtml(parentFirst: string, adminFirst: string, message: string): string {
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const safeAdminFirst = escapeHtml(adminFirst || "your coach");
  const safeParentFirst = escapeHtml(parentFirst || "there");
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
  </head>
  <body style="margin:0;padding:0;background:#F4F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif;color:#1A2E1A;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;padding:40px 20px;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr><td style="background:#085041;padding:32px 20px;text-align:center;">
            <img src="${APP_URL}/logo-email.png" alt="3Ball Academy" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;border:0;outline:none;" />
          </td></tr>
          <tr><td style="padding:40px 32px;">
            <h1 style="margin:0 0 16px 0;font-size:20px;color:#1A2E1A;">Hi ${safeParentFirst},</h1>
            <div style="font-size:15px;line-height:1.6;color:#1A2E1A;">${safeMessage}</div>
            <p style="margin:32px 0 0 0;font-size:14px;line-height:1.6;color:#5F5E5A;">— 3Ball Academy</p>
            <p style="margin:8px 0 0 0;font-size:12px;color:#888780;font-style:italic;">Reply to this email to reach ${safeAdminFirst} directly.</p>
          </td></tr>
          <tr><td style="padding:20px 32px;background:#F4F6F2;text-align:center;font-size:12px;color:#888780;">
            <a href="${APP_URL}" style="color:#888780;">${APP_URL}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function bodyText(parentFirst: string, adminFirst: string, message: string): string {
  return `Hi ${parentFirst || "there"},

${message}

— 3Ball Academy

(Reply to this email to reach ${adminFirst || "your coach"} directly.)`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  if (!RESEND_API_KEY || !ADMIN_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse(500, { error: "Server config missing" });
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse(401, { error: "Missing Authorization header" });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes || !userRes.user) {
    return jsonResponse(401, { error: "Invalid or expired token" });
  }
  const callerId = userRes.user.id;

  const adminClient = createClient(SUPABASE_URL, ADMIN_API_KEY);

  const { data: callerCoach, error: callerErr } = await adminClient
    .from("coaches")
    .select("id, first, last, email, is_admin")
    .eq("id", callerId)
    .maybeSingle();
  if (callerErr) {
    console.error("caller lookup failed:", callerErr);
    return jsonResponse(500, { error: "Caller lookup failed" });
  }
  if (!callerCoach || !callerCoach.is_admin) {
    return jsonResponse(403, { error: "Forbidden — admin only" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const playerIds: string[] = Array.isArray(body.player_ids) ? body.player_ids : [];
  const subject: string = typeof body.subject === "string" ? body.subject.trim() : "";
  const message: string = typeof body.message === "string" ? body.message : "";
  const replyTo: string = typeof body.reply_to === "string" ? body.reply_to.trim() : "";

  if (playerIds.length === 0) return jsonResponse(400, { error: "Missing player_ids" });
  if (!subject) return jsonResponse(400, { error: "Subject is required" });
  if (!message.trim()) return jsonResponse(400, { error: "Message is required" });
  if (!replyTo) return jsonResponse(400, { error: "Reply-to is required" });

  // Resolve players → linked parents via parent_players, with players.parent_id fallback.
  const { data: players, error: plErr } = await adminClient
    .from("players")
    .select("id, parent_id")
    .in("id", playerIds);
  if (plErr) {
    console.error("players lookup failed:", plErr);
    return jsonResponse(500, { error: "Players lookup failed" });
  }
  const playerRowIds = (players || []).map((p: any) => p.id);

  const { data: links, error: linkErr } = await adminClient
    .from("parent_players")
    .select("player_id, parent_id")
    .in("player_id", playerRowIds);
  if (linkErr) console.error("parent_players lookup failed:", linkErr);

  const playerToParentIds = new Map<string, string[]>();
  (links || []).forEach((l: any) => {
    if (!playerToParentIds.has(l.player_id)) playerToParentIds.set(l.player_id, []);
    playerToParentIds.get(l.player_id)!.push(l.parent_id);
  });
  for (const player of (players || [])) {
    if (!playerToParentIds.has(player.id) && player.parent_id) {
      console.warn(`parent_players empty for player ${player.id}; falling back to players.parent_id`);
      playerToParentIds.set(player.id, [player.parent_id]);
    }
  }
  const parentIds = [...new Set(Array.from(playerToParentIds.values()).flat())];
  if (parentIds.length === 0) {
    return jsonResponse(200, { ok: true, sent: 0, recipients: 0, note: "No linked parents" });
  }

  const { data: parents, error: parErr } = await adminClient
    .from("parents")
    .select("id, first, email, status")
    .in("id", parentIds);
  if (parErr) {
    console.error("parents lookup failed:", parErr);
    return jsonResponse(500, { error: "Parents lookup failed" });
  }
  const recipients = (parents || []).filter((p: any) => p && p.email);

  const adminFirst = callerCoach.first || "";

  let sent = 0;
  const failures: any[] = [];
  for (const recipient of recipients) {
    const html = bodyHtml(recipient.first || "", adminFirst, message);
    const text = bodyText(recipient.first || "", adminFirst, message);
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [recipient.email],
          reply_to: replyTo,
          subject,
          html,
          text,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error(`Resend failed to=${recipient.email}:`, data);
        failures.push({ parent_id: recipient.id, to: recipient.email, error: data });
      } else {
        sent++;
      }
    } catch (e) {
      console.error(`Send threw to=${recipient.email}:`, e);
      failures.push({ parent_id: recipient.id, to: recipient.email, error: String(e) });
    }
  }

  return jsonResponse(200, {
    ok: true,
    sent,
    recipients: recipients.length,
    failures,
  });
});

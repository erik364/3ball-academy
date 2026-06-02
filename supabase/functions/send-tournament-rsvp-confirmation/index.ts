// Fired when an admin sets a player's tournament RSVP to 'yes' on the parent's
// behalf (from the RSVP Responses section of the tournament detail page).
// Sends a "RSVP confirmed" email to every linked parent of that player.
//
// Recipients: Phase 3 fan-out via parent_players (ALL household-linked parents
// get the email). Falls back to players.parent_id only when a player has no
// parent_players rows at all (logged with a warning). Same convention as
// send-roster-confirmation, send-tournament-availability-request, etc.
//
// Auth: verify_jwt = true at platform level (config.toml). Client gates the
// call to admins (UI + state.currentUser.isAdmin); not re-verified here
// because the function performs no sensitive writes — just a templated email.
//
// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_API_KEY = Deno.env.get("ADMIN_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const FROM_EMAIL = "3Ball Academy <noreply@3ballacademy.com>";
const REPLY_TO = "wozzy20@aol.com";
const APP_URL = "https://app.3ballacademy.com";
const LOGO_URL = "https://app.3ballacademy.com/logo-email.png";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(s: string): string {
  return String(s || "").replace(/[<>&"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;"
  }[c] as string));
}

function fmtFullDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC"
  });
}

function fmtDateRange(start: string, end: string): string {
  if (!start) return "";
  if (!end || start === end) return fmtFullDate(start);
  return `${fmtFullDate(start)} – ${fmtFullDate(end)}`;
}

function buildHtml(args: {
  parentFirst: string;
  playerFirst: string;
  tournamentName: string;
  startDate: string;
  endDate: string;
}): string {
  const dateLabel = fmtDateRange(args.startDate, args.endDate);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>RSVP confirmed — ${escapeHtml(args.tournamentName)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F4F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A2E1A;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;padding:40px 20px;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#085041;padding:32px 20px;text-align:center;">
              <img src="${LOGO_URL}" alt="3Ball Academy" width="220" style="display:block;margin:0 auto;max-width:220px;height:auto;border:0;outline:none;" />
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 24px 32px;">
              <h1 style="margin:0 0 16px 0;font-size:22px;color:#1A2E1A;">Hi ${escapeHtml(args.parentFirst)},</h1>
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                This confirms <strong>${escapeHtml(args.playerFirst)}</strong> is available for <strong>${escapeHtml(args.tournamentName)}</strong>${dateLabel ? ` (${escapeHtml(dateLabel)})` : ""}.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                Roster and schedule details will follow. You can review and update RSVPs anytime in the 3Ball app.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background:#E8621A;border-radius:8px;">
                    <a href="${APP_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Open 3Ball</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                Thanks,<br>
                Mike Wozniak<br>
                3Ball Academy
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#F4F6F2;text-align:center;font-size:12px;color:#888780;">
              <a href="${APP_URL}" style="color:#888780;">${APP_URL}</a>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildText(args: {
  parentFirst: string;
  playerFirst: string;
  tournamentName: string;
  startDate: string;
  endDate: string;
}): string {
  const dateLabel = fmtDateRange(args.startDate, args.endDate);
  return `Hi ${args.parentFirst},

This confirms ${args.playerFirst} is available for ${args.tournamentName}${dateLabel ? ` (${dateLabel})` : ""}.

Roster and schedule details will follow. You can review and update RSVPs anytime in the 3Ball app.

Open 3Ball: ${APP_URL}

Thanks,
Mike Wozniak
3Ball Academy
`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY || !ADMIN_API_KEY || !SUPABASE_URL) {
    return new Response(JSON.stringify({ error: "Server config missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tournament_id: string | undefined = body.tournament_id;
  const player_id: string | undefined = body.player_id;
  if (!tournament_id || !player_id) {
    return new Response(JSON.stringify({ error: "Missing tournament_id or player_id" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);

  const { data: tournament, error: tErr } = await sb
    .from("tournaments")
    .select("id, name, start_date, end_date")
    .eq("id", tournament_id)
    .single();
  if (tErr || !tournament) {
    console.error("Tournament lookup failed:", tErr);
    return new Response(JSON.stringify({ error: "Tournament not found", details: tErr }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: player, error: plErr } = await sb
    .from("players")
    .select("id, first, last, parent_id")
    .eq("id", player_id)
    .single();
  if (plErr || !player) {
    console.error("Player lookup failed:", plErr);
    return new Response(JSON.stringify({ error: "Player not found", details: plErr }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Phase 3 fan-out via parent_players, with per-player fallback to
  // players.parent_id if no link rows exist (logged warning).
  const { data: links, error: linkErr } = await sb
    .from("parent_players")
    .select("parent_id")
    .eq("player_id", player_id);
  if (linkErr) {
    console.error("parent_players lookup failed:", linkErr);
  }
  let parentIds: string[] = [...new Set((links || []).map((l: any) => l.parent_id))];
  if (parentIds.length === 0 && player.parent_id) {
    console.warn(`parent_players empty for player ${player_id}; falling back to players.parent_id`);
    parentIds = [player.parent_id];
  }
  if (parentIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, note: "No linked parents" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: parents, error: parErr } = await sb
    .from("parents")
    .select("id, first, email, status")
    .in("id", parentIds)
    .eq("status", "approved");
  if (parErr) {
    console.error("Parents lookup failed:", parErr);
    return new Response(JSON.stringify({ error: "Parents lookup failed", details: parErr }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const recipients = (parents || []).filter((p: any) => p && p.email);
  if (recipients.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, note: "No approved parents with email on file" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const subject = `RSVP confirmed for ${tournament.name} — ${player.first}`;
  let sent = 0;
  const results: any[] = [];

  for (const recipient of recipients) {
    const emailArgs = {
      parentFirst: recipient.first || "there",
      playerFirst: player.first || "your player",
      tournamentName: tournament.name || "the tournament",
      startDate: tournament.start_date,
      endDate: tournament.end_date,
    };
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
          reply_to: REPLY_TO,
          subject,
          html: buildHtml(emailArgs),
          text: buildText(emailArgs),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error(`Resend failed for ${recipient.email}:`, data);
        results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: data });
      } else {
        sent++;
        results.push({ parent_id: recipient.id, to: recipient.email, ok: true, id: data.id });
      }
    } catch (e) {
      console.error(`Send threw for ${recipient.email}:`, e);
      results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, recipients: recipients.length, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

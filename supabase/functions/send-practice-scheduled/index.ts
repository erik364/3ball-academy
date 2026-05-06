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

function fmtShortDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC"
  });
}

function fmtTime(t: string): string {
  if (!t) return "";
  const [hh, mm] = t.split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function buildHtml(args: {
  parentFirst: string;
  playerFirst: string;
  teamName: string;
  dateLong: string;
  timeRange: string;
  location: string;
}): string {
  const { parentFirst, playerFirst, teamName, dateLong, timeRange, location } = args;
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Practice scheduled for ${escapeHtml(playerFirst)}</title>
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
              <h1 style="margin:0 0 16px 0;font-size:22px;color:#1A2E1A;">Hi ${escapeHtml(parentFirst)},</h1>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                A new practice has been scheduled for <strong>${escapeHtml(playerFirst)}</strong> on <strong>${escapeHtml(teamName)}</strong>.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;border-radius:8px;padding:16px;margin:0 0 24px 0;">
                <tr><td style="padding:6px 0;"><strong>Date:</strong> ${escapeHtml(dateLong)}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Time:</strong> ${escapeHtml(timeRange)}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Location:</strong> ${escapeHtml(location || "TBD")}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Team:</strong> ${escapeHtml(teamName)}</td></tr>
              </table>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background:#E8621A;border-radius:8px;">
                    <a href="${APP_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">RSVP Now</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                See you on the court,<br>
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
  parentFirst: string; playerFirst: string; teamName: string;
  dateLong: string; timeRange: string; location: string;
}): string {
  return `Hi ${args.parentFirst},

A new practice has been scheduled for ${args.playerFirst} on ${args.teamName}.

Date: ${args.dateLong}
Time: ${args.timeRange}
Location: ${args.location || "TBD"}
Team: ${args.teamName}

RSVP Now: ${APP_URL}

See you on the court,
Mike Wozniak
3Ball Academy`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { practice_id } = await req.json();

    if (!practice_id) {
      return new Response(
        JSON.stringify({ error: "Missing practice_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!RESEND_API_KEY || !ADMIN_API_KEY || !SUPABASE_URL) {
      return new Response(
        JSON.stringify({ error: "Server config missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);

    const { data: practice, error: pErr } = await sb
      .from("practices")
      .select("id, date, start_time, end_time, location, groups")
      .eq("id", practice_id)
      .single();

    if (pErr || !practice) {
      console.error("Practice lookup failed:", pErr);
      return new Response(
        JSON.stringify({ error: "Practice not found", details: pErr }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const groups: string[] = Array.isArray(practice.groups) ? practice.groups : [];
    if (groups.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "Practice has no teams; no audience." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: players, error: plErr } = await sb
      .from("players")
      .select("id, first, last, team, parent_id")
      .in("team", groups)
      .not("active", "is", false);

    if (plErr) {
      console.error("Players lookup failed:", plErr);
      return new Response(
        JSON.stringify({ error: "Players lookup failed", details: plErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!players || players.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "No active players on these teams." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parentIds = [...new Set(players.map((p: any) => p.parent_id).filter(Boolean))];
    const { data: parents, error: parErr } = await sb
      .from("parents")
      .select("id, first, email, status")
      .in("id", parentIds)
      .eq("status", "approved");

    if (parErr) {
      console.error("Parents lookup failed:", parErr);
      return new Response(
        JSON.stringify({ error: "Parents lookup failed", details: parErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parentMap = new Map<string, any>();
    (parents || []).forEach((p: any) => parentMap.set(p.id, p));

    const startHHMM = practice.start_time ? String(practice.start_time).slice(0, 5) : "";
    const endHHMM = practice.end_time ? String(practice.end_time).slice(0, 5) : "";
    const dateLong = fmtFullDate(practice.date);
    const dateShort = fmtShortDate(practice.date);
    const timeStart = fmtTime(startHHMM);
    const timeEnd = fmtTime(endHHMM);
    const timeRange = timeEnd ? `${timeStart} – ${timeEnd}` : timeStart;

    let sent = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const player of players) {
      const parent = parentMap.get(player.parent_id);
      if (!parent || !parent.email) {
        skipped++;
        continue;
      }

      const emailArgs = {
        parentFirst: parent.first || "there",
        playerFirst: player.first || "your player",
        teamName: player.team || "",
        dateLong,
        timeRange,
        location: practice.location || "",
      };

      const subject = `Practice scheduled for ${player.first} — ${dateShort} at ${timeStart}`;

      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [parent.email],
            reply_to: REPLY_TO,
            subject,
            html: buildHtml(emailArgs),
            text: buildText(emailArgs),
          }),
        });

        const data = await resp.json();
        if (!resp.ok) {
          console.error(`Resend failed for ${parent.email}:`, data);
          results.push({ to: parent.email, ok: false, error: data });
        } else {
          sent++;
          results.push({ to: parent.email, ok: true, id: data.id });
        }
      } catch (e) {
        console.error(`Send threw for ${parent.email}:`, e);
        results.push({ to: parent.email, ok: false, error: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, skipped, total: players.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-practice-scheduled threw:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

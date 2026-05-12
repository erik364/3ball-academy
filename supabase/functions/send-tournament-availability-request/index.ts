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

function buildHtml(args: {
  parentFirst: string;
  playerFirst: string;
  teamName: string;
  tournamentName: string;
  startDate: string;
  endDate: string;
  notes: string;
}): string {
  const sameDay = args.startDate === args.endDate;
  const dateLabel = sameDay
    ? fmtFullDate(args.startDate)
    : `${fmtFullDate(args.startDate)} – ${fmtFullDate(args.endDate)}`;
  const noteBlock = args.notes
    ? `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;color:#5F5E5A;font-style:italic;">${escapeHtml(args.notes)}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(args.tournamentName)} — RSVP needed</title>
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
                We're entering <strong>${escapeHtml(args.teamName)}</strong> in <strong>${escapeHtml(args.tournamentName)}</strong>. We need to know if <strong>${escapeHtml(args.playerFirst)}</strong> is available.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;border-radius:8px;padding:16px;margin:0 0 24px 0;">
                <tr><td style="padding:6px 0;"><strong>Tournament:</strong> ${escapeHtml(args.tournamentName)}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Date${sameDay ? "" : "s"}:</strong> ${escapeHtml(dateLabel)}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Team:</strong> ${escapeHtml(args.teamName)}</td></tr>
              </table>

              ${noteBlock}

              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                Game times will be announced once we have the schedule. Please RSVP whether ${escapeHtml(args.playerFirst)} is available so we can plan rosters.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background:#E8621A;border-radius:8px;">
                    <a href="${APP_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">RSVP Now</a>
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
  parentFirst: string; playerFirst: string; teamName: string;
  tournamentName: string; startDate: string; endDate: string; notes: string;
}): string {
  const sameDay = args.startDate === args.endDate;
  const dateLabel = sameDay
    ? fmtFullDate(args.startDate)
    : `${fmtFullDate(args.startDate)} - ${fmtFullDate(args.endDate)}`;

  return `Hi ${args.parentFirst},

We're entering ${args.teamName} in ${args.tournamentName}. We need to know if ${args.playerFirst} is available.

Tournament: ${args.tournamentName}
Date${sameDay ? "" : "s"}: ${dateLabel}
Team: ${args.teamName}

${args.notes ? args.notes + "\n\n" : ""}Game times will be announced once we have the schedule. Please RSVP whether ${args.playerFirst} is available so we can plan rosters.

RSVP Now: ${APP_URL}

Thanks,
Mike Wozniak
3Ball Academy`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tournament_id } = await req.json();

    if (!tournament_id) {
      return new Response(
        JSON.stringify({ error: "Missing tournament_id" }),
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

    const { data: tournament, error: tErr } = await sb
      .from("tournaments")
      .select("id, name, start_date, end_date, notes, teams")
      .eq("id", tournament_id)
      .single();

    if (tErr || !tournament) {
      console.error("Tournament lookup failed:", tErr);
      return new Response(
        JSON.stringify({ error: "Tournament not found", details: tErr }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const teams: string[] = Array.isArray(tournament.teams) ? tournament.teams : [];
    if (teams.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "No teams selected on this tournament" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: players, error: plErr } = await sb
      .from("players")
      .select("id, first, last, team, parent_id")
      .in("team", teams)
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
        JSON.stringify({ ok: true, sent: 0, note: "No active players on these teams" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Phase 3 fan-out via parent_players, falling back per-player to
    // players.parent_id if no link rows exist.
    const playerIdsAll = players.map((p: any) => p.id);
    const { data: links, error: linkErr } = await sb
      .from("parent_players")
      .select("player_id, parent_id")
      .in("player_id", playerIdsAll);
    if (linkErr) {
      console.error("parent_players lookup failed:", linkErr);
    }
    const playerToParentIds = new Map<string, string[]>();
    (links || []).forEach((l: any) => {
      if (!playerToParentIds.has(l.player_id)) playerToParentIds.set(l.player_id, []);
      playerToParentIds.get(l.player_id)!.push(l.parent_id);
    });
    for (const p of players) {
      if (!playerToParentIds.has(p.id) && p.parent_id) {
        console.warn(`parent_players empty for player ${p.id}; falling back to players.parent_id`);
        playerToParentIds.set(p.id, [p.parent_id]);
      }
    }
    const parentIds = [...new Set(Array.from(playerToParentIds.values()).flat())];
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

    let sent = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const player of players) {
      const linkedParentIds = playerToParentIds.get(player.id) || [];
      if (linkedParentIds.length === 0) { skipped++; continue; }
      for (const pid of linkedParentIds) {
      const parent = parentMap.get(pid);
      if (!parent || !parent.email) {
        skipped++;
        continue;
      }

      const emailArgs = {
        parentFirst: parent.first || "there",
        playerFirst: player.first || "your player",
        teamName: player.team || "",
        tournamentName: tournament.name || "the tournament",
        startDate: tournament.start_date,
        endDate: tournament.end_date,
        notes: tournament.notes || "",
      };

      const subject = `Tournament: ${tournament.name} — RSVP needed for ${player.first}`;

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
          results.push({ player_id: player.id, parent_id: pid, to: parent.email, ok: false, error: data });
        } else {
          sent++;
          results.push({ player_id: player.id, parent_id: pid, to: parent.email, ok: true, id: data.id });
        }
      } catch (e) {
        console.error(`Send threw for ${parent.email}:`, e);
        results.push({ player_id: player.id, parent_id: pid, to: parent.email, ok: false, error: String(e) });
      }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, skipped, total: players.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-tournament-availability-request threw:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

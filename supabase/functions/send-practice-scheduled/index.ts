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

function buildOneOffHtml(args: {
  parentFirst: string; teamName: string;
  dateLong: string; timeRange: string; location: string;
}): string {
  const { parentFirst, teamName, dateLong, timeRange, location } = args;
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Practice scheduled — ${escapeHtml(teamName)}</title>
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
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                A new <strong>${escapeHtml(teamName)}</strong> practice is on the schedule:
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;border-radius:8px;padding:16px;margin:0 0 24px 0;">
                <tr><td style="padding:6px 0;"><strong>${escapeHtml(dateLong)}</strong></td></tr>
                <tr><td style="padding:6px 0;">${escapeHtml(timeRange)}</td></tr>
                <tr><td style="padding:6px 0;">${escapeHtml(location || "TBD")}</td></tr>
              </table>

              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                You can see all your child's practices in the 3Ball app under the Calendar tab.
              </p>

              <p style="margin:0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                — 3Ball Academy
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

function buildOneOffText(args: {
  parentFirst: string; teamName: string;
  dateLong: string; timeRange: string; location: string;
}): string {
  return `Hi ${args.parentFirst},

A new ${args.teamName} practice is on the schedule:
${args.dateLong}
${args.timeRange}
${args.location || "TBD"}

You can see all your child's practices in the 3Ball app under the Calendar tab.

— 3Ball Academy`;
}

function buildSeriesCreateText(parentFirst: string, sc: any): string {
  return `Hi ${parentFirst},

${sc.team_name} now has weekly practices scheduled:
${sc.day_of_week}s, ${sc.time}
${sc.location}
From ${fmtFullDate(sc.start_date)} through ${fmtFullDate(sc.end_date)} (${sc.occurrence_count} practices total)

Check the Calendar tab in the 3Ball app for the full schedule.

— 3Ball Academy`;
}

function buildSeriesEditText(parentFirst: string, se: any): string {
  return `Hi ${parentFirst},

Heads up — the ${se.team_name} practice schedule has been updated. Starting ${fmtFullDate(se.effective_date)}:

${se.changes_summary}

Check the Calendar tab in the 3Ball app for the latest details.

— 3Ball Academy`;
}

async function loadAudience(sb: any, teamCodes: string[]) {
  const { data: players, error: plErr } = await sb
    .from("players")
    .select("id, first, last, team, parent_id")
    .in("team", teamCodes)
    .not("active", "is", false);
  if (plErr) throw plErr;

  // Phase 3 fan-out: resolve via parent_players. Falls back to
  // players.parent_id per player when no link rows exist.
  const playerIds = (players || []).map((p: any) => p.id);
  const playerToParentIds = new Map<string, string[]>();
  if (playerIds.length > 0) {
    const { data: links, error: linkErr } = await sb
      .from("parent_players")
      .select("player_id, parent_id")
      .in("player_id", playerIds);
    if (linkErr) {
      console.error("parent_players lookup failed:", linkErr);
    } else {
      (links || []).forEach((l: any) => {
        if (!playerToParentIds.has(l.player_id)) playerToParentIds.set(l.player_id, []);
        playerToParentIds.get(l.player_id)!.push(l.parent_id);
      });
    }
    for (const p of (players || [])) {
      if (!playerToParentIds.has(p.id) && p.parent_id) {
        console.warn(`parent_players empty for player ${p.id}; falling back to players.parent_id`);
        playerToParentIds.set(p.id, [p.parent_id]);
      }
    }
  }

  const parentIds = [...new Set(Array.from(playerToParentIds.values()).flat())];
  if (parentIds.length === 0) {
    return { players: players || [], parentMap: new Map<string, any>(), playerToParentIds };
  }

  const { data: parents, error: parErr } = await sb
    .from("parents")
    .select("id, first, email, status")
    .in("id", parentIds)
    .eq("status", "approved");
  if (parErr) throw parErr;

  const parentMap = new Map<string, any>();
  (parents || []).forEach((p: any) => parentMap.set(p.id, p));
  return { players: players || [], parentMap, playerToParentIds };
}

async function sendResend(payload: any) {
  return await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const mode: string = body.mode || "one_off";
    const practice_id: string | undefined = body.practice_id;

    if (!practice_id && mode === "one_off") {
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

    // -------- SERIES_CREATE --------
    if (mode === "series_create") {
      const sc = body.series_create || {};
      if (!sc.team_name) {
        return new Response(
          JSON.stringify({ error: "Missing series_create.team_name" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { players, parentMap } = await loadAudience(sb, [sc.team_name]);
      if (!players.length || parentMap.size === 0) {
        return new Response(
          JSON.stringify({ ok: true, sent: 0, note: "No approved parents on this team." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const subject = `Weekly ${sc.team_name} practices scheduled — ${sc.day_of_week}s`;
      let sent = 0;
      const results: any[] = [];
      for (const parent of parentMap.values()) {
        if (!parent.email) continue;
        const text = buildSeriesCreateText(parent.first || "there", sc);
        try {
          const resp = await sendResend({
            from: FROM_EMAIL,
            to: [parent.email],
            reply_to: REPLY_TO,
            subject,
            text,
          });
          const data = await resp.json();
          if (!resp.ok) {
            console.error(`series_create resend failed for ${parent.email}:`, data);
            results.push({ to: parent.email, ok: false, error: data });
          } else {
            sent++;
            results.push({ to: parent.email, ok: true, id: data.id });
          }
        } catch (e) {
          console.error(`series_create send threw for ${parent.email}:`, e);
          results.push({ to: parent.email, ok: false, error: String(e) });
        }
      }
      return new Response(
        JSON.stringify({ ok: true, sent, total: parentMap.size, results }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // -------- SERIES_EDIT --------
    if (mode === "series_edit") {
      const se = body.series_edit || {};
      if (!se.team_name) {
        return new Response(
          JSON.stringify({ error: "Missing series_edit.team_name" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { players, parentMap } = await loadAudience(sb, [se.team_name]);
      if (!players.length || parentMap.size === 0) {
        return new Response(
          JSON.stringify({ ok: true, sent: 0, note: "No approved parents on this team." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const subject = `Practice schedule updated for ${se.team_name}`;
      let sent = 0;
      const results: any[] = [];
      for (const parent of parentMap.values()) {
        if (!parent.email) continue;
        const text = buildSeriesEditText(parent.first || "there", se);
        try {
          const resp = await sendResend({
            from: FROM_EMAIL,
            to: [parent.email],
            reply_to: REPLY_TO,
            subject,
            text,
          });
          const data = await resp.json();
          if (!resp.ok) {
            console.error(`series_edit resend failed for ${parent.email}:`, data);
            results.push({ to: parent.email, ok: false, error: data });
          } else {
            sent++;
            results.push({ to: parent.email, ok: true, id: data.id });
          }
        } catch (e) {
          console.error(`series_edit send threw for ${parent.email}:`, e);
          results.push({ to: parent.email, ok: false, error: String(e) });
        }
      }
      return new Response(
        JSON.stringify({ ok: true, sent, total: parentMap.size, results }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // -------- ONE_OFF (default) --------
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

    const { players, parentMap, playerToParentIds } = await loadAudience(sb, groups);
    if (!players.length) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "No active players on these teams." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    // Practice body is team-level (no kid name) now that RSVP is gone, so
    // dedupe to one email per unique parent across all kids on the practice
    // team(s). Skip players with no linked parents.
    const teamLabel = (groups || []).join(", ");
    const uniqueParentIds = new Set<string>();
    for (const player of players) {
      const linked = (playerToParentIds && playerToParentIds.get(player.id)) || [];
      if (linked.length === 0) { skipped++; continue; }
      linked.forEach(pid => uniqueParentIds.add(pid));
    }
    for (const pid of uniqueParentIds) {
      const parent = parentMap.get(pid);
      if (!parent || !parent.email) { skipped++; continue; }
      const emailArgs = {
        parentFirst: parent.first || "there",
        teamName: teamLabel,
        dateLong,
        timeRange,
        location: practice.location || "",
      };
      const subject = `Practice scheduled — ${teamLabel} on ${dateShort}`;
      try {
        const resp = await sendResend({
          from: FROM_EMAIL,
          to: [parent.email],
          reply_to: REPLY_TO,
          subject,
          html: buildOneOffHtml(emailArgs),
          text: buildOneOffText(emailArgs),
        });
        const data = await resp.json();
        if (!resp.ok) {
          console.error(`one_off resend failed for ${parent.email}:`, data);
          results.push({ parent_id: pid, to: parent.email, ok: false, error: data });
        } else {
          sent++;
          results.push({ parent_id: pid, to: parent.email, ok: true, id: data.id });
        }
      } catch (e) {
        console.error(`one_off send threw for ${parent.email}:`, e);
        results.push({ parent_id: pid, to: parent.email, ok: false, error: String(e) });
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

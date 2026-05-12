// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_API_KEY = Deno.env.get("ADMIN_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const FROM_EMAIL = "3Ball Academy <noreply@3ballacademy.com>";
const REPLY_TO = "wozzy20@aol.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tournament_id, tournament_team_id, added_player_ids } = await req.json();

    if (!tournament_id || !tournament_team_id || !Array.isArray(added_player_ids)) {
      return new Response(
        JSON.stringify({ error: "Missing tournament_id, tournament_team_id, or added_player_ids" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (added_player_ids.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "No players added" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
      .select("id, name, start_date, end_date")
      .eq("id", tournament_id)
      .single();
    if (tErr || !tournament) {
      console.error("Tournament lookup failed:", tErr);
      return new Response(
        JSON.stringify({ error: "Tournament not found", details: tErr }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: team, error: tmErr } = await sb
      .from("tournament_teams")
      .select("id, name, coach_ids, player_ids")
      .eq("id", tournament_team_id)
      .single();
    if (tmErr || !team) {
      console.error("Team lookup failed:", tmErr);
      return new Response(
        JSON.stringify({ error: "Team not found", details: tmErr }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Only the players who said "yes" get a confirmation
    const { data: rsvps, error: rErr } = await sb
      .from("tournament_rsvps")
      .select("player_id")
      .eq("tournament_id", tournament_id)
      .eq("answer", "yes")
      .in("player_id", added_player_ids);
    if (rErr) {
      console.error("RSVP lookup failed:", rErr);
      return new Response(
        JSON.stringify({ error: "RSVP lookup failed", details: rErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const yesPlayerIds = (rsvps || []).map((r: any) => r.player_id);
    if (yesPlayerIds.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "No added players had answer=yes" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: players, error: plErr } = await sb
      .from("players")
      .select("id, first, last, parent_id")
      .in("id", yesPlayerIds);
    if (plErr) {
      console.error("Players lookup failed:", plErr);
      return new Response(
        JSON.stringify({ error: "Players lookup failed", details: plErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fan out: look up all linked parents per player via parent_players.
    // Falls back to players.parent_id if a player has no parent_players rows
    // (defensive — registration writes both since Phase 2).
    const yesPlayerIdsForLookup = (players || []).map((p: any) => p.id);
    const { data: links, error: linkErr } = await sb
      .from("parent_players")
      .select("player_id, parent_id")
      .in("player_id", yesPlayerIdsForLookup);
    if (linkErr) {
      console.error("parent_players lookup failed:", linkErr);
    }
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
    const { data: parents, error: parErr } = await sb
      .from("parents")
      .select("id, first, email")
      .in("id", parentIds);
    if (parErr) {
      console.error("Parents lookup failed:", parErr);
      return new Response(
        JSON.stringify({ error: "Parents lookup failed", details: parErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const parentMap = new Map<string, any>();
    (parents || []).forEach((p: any) => parentMap.set(p.id, p));

    const coachIds: string[] = Array.isArray(team.coach_ids) ? team.coach_ids : [];
    let coachEmails: string[] = [];
    if (coachIds.length > 0) {
      const { data: coaches, error: cErr } = await sb
        .from("coaches")
        .select("email")
        .in("id", coachIds);
      if (cErr) {
        console.error("Coaches lookup failed:", cErr);
      } else {
        coachEmails = (coaches || []).map((c: any) => c.email).filter((e: string) => !!e);
      }
    }

    const dateRange = fmtDateRange(tournament.start_date, tournament.end_date);

    // Snapshot the team roster once. Same content for every recipient.
    const rosterPlayerIds: string[] = Array.isArray(team.player_ids) ? team.player_ids : [];
    let rosterBlock = "";
    if (rosterPlayerIds.length > 0) {
      const { data: rosterPlayers, error: rosErr } = await sb
        .from("players")
        .select("id, first, last")
        .in("id", rosterPlayerIds)
        .not("active", "is", false);
      if (rosErr) {
        console.error("Roster lookup failed (omitting roster section):", rosErr);
      } else if (rosterPlayers && rosterPlayers.length > 0) {
        const sorted = rosterPlayers.slice().sort((a: any, b: any) => {
          const la = (a.last || "").toLowerCase();
          const lb = (b.last || "").toLowerCase();
          if (la !== lb) return la < lb ? -1 : 1;
          const fa = (a.first || "").toLowerCase();
          const fb = (b.first || "").toLowerCase();
          return fa < fb ? -1 : fa > fb ? 1 : 0;
        });
        rosterBlock = "\n\nRoster:\n" +
          sorted.map((p: any) => `• ${p.first || ""} ${p.last || ""}`.trim()).join("\n");
      }
    }

    let sent = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const player of (players || [])) {
      const linkedParentIds = playerToParentIds.get(player.id) || [];
      if (linkedParentIds.length === 0) {
        console.warn(`Skipping player ${player.id}: no linked parents`);
        skipped++;
        results.push({ player_id: player.id, ok: false, reason: "no linked parents" });
        continue;
      }
      for (const pid of linkedParentIds) {
        const parent = parentMap.get(pid);
        if (!parent || !parent.email) {
          console.warn(`Skipping player ${player.id} parent ${pid}: no email on file`);
          skipped++;
          results.push({ player_id: player.id, parent_id: pid, ok: false, reason: "no parent email" });
          continue;
        }

        const subject = `${player.first} is rostered for ${tournament.name}`;
        const text = `Hi ${parent.first || "there"},

${player.first} ${player.last} has been added to the ${team.name} roster for ${tournament.name} (${dateRange}).${rosterBlock}

Game schedule and details will be available in the 3Ball app under the Tourneys tab.

${coachEmails.length ? "Coaches on this team are cc'd.\n\n" : ""}— 3Ball Academy`;

        const payload: any = {
          from: FROM_EMAIL,
          to: [parent.email],
          reply_to: REPLY_TO,
          subject,
          text,
        };
        if (coachEmails.length > 0) payload.cc = coachEmails;

        try {
          const resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          const data = await resp.json();
          if (!resp.ok) {
            console.error(`Resend failed: tournament_id=${tournament_id} player_id=${player.id} parent_id=${pid} to=${parent.email} err=`, data);
            results.push({ player_id: player.id, parent_id: pid, to: parent.email, ok: false, error: data });
          } else {
            sent++;
            results.push({ player_id: player.id, parent_id: pid, to: parent.email, ok: true, id: data.id });
          }
        } catch (e) {
          console.error(`Send threw: tournament_id=${tournament_id} player_id=${player.id} parent_id=${pid} to=${parent.email} err=`, e);
          results.push({ player_id: player.id, parent_id: pid, to: parent.email, ok: false, error: String(e) });
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, skipped, total: (players || []).length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-roster-confirmation threw:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

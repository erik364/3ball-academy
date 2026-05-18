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
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
}

function fmtTime(t: string): string {
  if (!t) return "";
  const [hh, mm] = String(t).slice(0, 5).split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { game_id, tournament_team_id } = await req.json();
    if (!game_id || !tournament_team_id) {
      return new Response(
        JSON.stringify({ error: "Missing game_id or tournament_team_id" }),
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

    const { data: game, error: gErr } = await sb
      .from("tournament_games")
      .select("id, date, start_time, end_time, location_text, opponent")
      .eq("id", game_id).single();
    if (gErr || !game) {
      console.error("game lookup failed:", gErr);
      return new Response(JSON.stringify({ error: "Game not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: team, error: tmErr } = await sb
      .from("tournament_teams")
      .select("id, name, player_ids, tournament_id")
      .eq("id", tournament_team_id).single();
    if (tmErr || !team) {
      console.error("team lookup failed:", tmErr);
      return new Response(JSON.stringify({ error: "Team not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rosterIds: string[] = Array.isArray(team.player_ids) ? team.player_ids : [];
    if (rosterIds.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "Team has no rostered players" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: tournament, error: tErr } = await sb
      .from("tournaments")
      .select("id, name, start_date, end_date")
      .eq("id", team.tournament_id).single();
    if (tErr || !tournament) {
      console.error("tournament lookup failed:", tErr);
      return new Response(JSON.stringify({ error: "Tournament not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Phase 3 fan-out: parent_players → parents, with players.parent_id fallback
    const { data: links } = await sb
      .from("parent_players")
      .select("player_id, parent_id")
      .in("player_id", rosterIds);
    const playerToParentIds = new Map<string, string[]>();
    (links || []).forEach((l: any) => {
      if (!playerToParentIds.has(l.player_id)) playerToParentIds.set(l.player_id, []);
      playerToParentIds.get(l.player_id)!.push(l.parent_id);
    });
    // Fallback for any rostered kid missing from parent_players
    if (playerToParentIds.size < rosterIds.length) {
      const missing = rosterIds.filter(id => !playerToParentIds.has(id));
      if (missing.length > 0) {
        const { data: fallback } = await sb.from("players").select("id, parent_id").in("id", missing);
        (fallback || []).forEach((p: any) => {
          if (p.parent_id) {
            console.warn(`parent_players empty for player ${p.id}; falling back to players.parent_id`);
            playerToParentIds.set(p.id, [p.parent_id]);
          }
        });
      }
    }

    const uniqueParentIds = [...new Set(Array.from(playerToParentIds.values()).flat())];
    if (uniqueParentIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: "No linked parents" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: parents, error: parErr } = await sb
      .from("parents")
      .select("id, first, email, status")
      .in("id", uniqueParentIds)
      .eq("status", "approved");
    if (parErr) {
      console.error("parents lookup failed:", parErr);
      return new Response(JSON.stringify({ error: "Parents lookup failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const recipients = (parents || []).filter((p: any) => p && p.email);

    const opponentLabel = game.opponent && game.opponent.trim() ? game.opponent.trim() : "TBD";
    const dateLong = fmtFullDate(game.date);
    const startStr = fmtTime(game.start_time);
    const subject = `New game added: ${tournament.name} — ${team.name} vs ${opponentLabel}`;

    let sent = 0;
    const results: any[] = [];
    for (const recipient of recipients) {
      const text = `Hi ${recipient.first || "there"},

A new game has been added to ${tournament.name} for ${team.name}:

vs ${opponentLabel}
${dateLong}${startStr ? " at " + startStr : ""}${game.location_text ? "\n" + game.location_text : ""}

See the full tournament schedule in the 3Ball app under the Calendar or Tourneys tab.

— 3Ball Academy`;

      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [recipient.email],
            reply_to: REPLY_TO,
            subject,
            text,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          console.error(`Resend failed game_id=${game_id} to=${recipient.email}:`, data);
          results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: data });
        } else {
          sent++;
          results.push({ parent_id: recipient.id, to: recipient.email, ok: true, id: data.id });
        }
      } catch (e) {
        console.error(`Send threw game_id=${game_id} to=${recipient.email}:`, e);
        results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, attempted: recipients.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-game-added threw:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

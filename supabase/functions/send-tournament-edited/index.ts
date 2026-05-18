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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tournament_id, changes_summary } = await req.json();
    if (!tournament_id || !changes_summary || !String(changes_summary).trim()) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "Missing tournament_id or no changes to report" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!RESEND_API_KEY || !ADMIN_API_KEY || !SUPABASE_URL) {
      return new Response(JSON.stringify({ error: "Server config missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);

    const { data: tournament, error: tErr } = await sb
      .from("tournaments")
      .select("id, name")
      .eq("id", tournament_id).single();
    if (tErr || !tournament) {
      console.error("tournament lookup failed:", tErr);
      return new Response(JSON.stringify({ error: "Tournament not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: teams } = await sb
      .from("tournament_teams")
      .select("player_ids")
      .eq("tournament_id", tournament_id);
    const rosterIds = [...new Set((teams || []).flatMap((t: any) => Array.isArray(t.player_ids) ? t.player_ids : []))];
    if (rosterIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: "Tournament has no rostered players" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: links } = await sb
      .from("parent_players")
      .select("player_id, parent_id")
      .in("player_id", rosterIds);
    const playerToParentIds = new Map<string, string[]>();
    (links || []).forEach((l: any) => {
      if (!playerToParentIds.has(l.player_id)) playerToParentIds.set(l.player_id, []);
      playerToParentIds.get(l.player_id)!.push(l.parent_id);
    });
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

    const subject = `Update to ${tournament.name}`;

    let sent = 0;
    const results: any[] = [];
    for (const recipient of recipients) {
      const text = `Hi ${recipient.first || "there"},

Heads up — there's an update to ${tournament.name}:

${changes_summary}

See the latest details in the 3Ball app under Tourneys or Calendar.

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
          console.error(`Resend failed tournament_edited to=${recipient.email}:`, data);
          results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: data });
        } else {
          sent++;
          results.push({ parent_id: recipient.id, to: recipient.email, ok: true, id: data.id });
        }
      } catch (e) {
        console.error(`Send threw tournament_edited to=${recipient.email}:`, e);
        results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, attempted: recipients.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-tournament-edited threw:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

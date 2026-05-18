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
    const body = await req.json();
    // Snapshot fields captured by the client BEFORE deletion. The function
    // never queries the (now-deleted) practice row.
    const mode: string = body.mode || "one_off"; // 'one_off' or 'series_remaining'
    const groups: string[] = Array.isArray(body.groups) ? body.groups : [];
    const date: string = body.date || "";
    const startTime: string = body.start_time || "";

    if (groups.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: "No groups on snapshot; no audience" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!RESEND_API_KEY || !ADMIN_API_KEY || !SUPABASE_URL) {
      return new Response(JSON.stringify({ error: "Server config missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);

    const { data: players, error: plErr } = await sb
      .from("players")
      .select("id, parent_id")
      .in("team", groups)
      .not("active", "is", false);
    if (plErr) {
      console.error("players lookup failed:", plErr);
      return new Response(JSON.stringify({ error: "Players lookup failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!players || players.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: "No active players on these groups" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const playerIds = players.map((p: any) => p.id);
    const { data: links } = await sb
      .from("parent_players")
      .select("player_id, parent_id")
      .in("player_id", playerIds);
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

    const teamLabel = groups.join(", ");
    const dateLong = fmtFullDate(date);
    const startStr = fmtTime(startTime);

    let subject: string;
    let bodyTemplate: (parentFirst: string) => string;
    if (mode === "series_remaining") {
      subject = `${teamLabel} weekly practices cancelled — starting ${dateLong}`;
      bodyTemplate = (parentFirst: string) => `Hi ${parentFirst},

Heads up — the rest of the ${teamLabel} weekly practice series has been cancelled, starting ${dateLong}.

Check the 3Ball app for upcoming practices and any updates.

— 3Ball Academy`;
    } else {
      subject = `Practice cancelled: ${teamLabel} — ${dateLong}`;
      bodyTemplate = (parentFirst: string) => `Hi ${parentFirst},

Heads up — the ${teamLabel} practice scheduled for ${dateLong}${startStr ? " at " + startStr : ""} has been cancelled.

Check the 3Ball app for upcoming practices and any updates.

— 3Ball Academy`;
    }

    let sent = 0;
    const results: any[] = [];
    for (const recipient of recipients) {
      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [recipient.email],
            reply_to: REPLY_TO,
            subject,
            text: bodyTemplate(recipient.first || "there"),
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          console.error(`Resend failed practice cancel to=${recipient.email}:`, data);
          results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: data });
        } else {
          sent++;
          results.push({ parent_id: recipient.id, to: recipient.email, ok: true, id: data.id });
        }
      } catch (e) {
        console.error(`Send threw practice cancel to=${recipient.email}:`, e);
        results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, attempted: recipients.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-practice-cancelled threw:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

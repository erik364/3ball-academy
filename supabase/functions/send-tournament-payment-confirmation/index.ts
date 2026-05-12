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
    const { tournament_id, player_id } = await req.json();

    if (!tournament_id || !player_id) {
      return new Response(
        JSON.stringify({ error: "Missing tournament_id or player_id" }),
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

    // 1. Idempotence gate: only send the first time per (tournament, player).
    const { data: paymentRow, error: payErr } = await sb
      .from("tournament_payments")
      .select("id, confirmation_sent_at")
      .eq("tournament_id", tournament_id)
      .eq("player_id", player_id)
      .maybeSingle();
    if (payErr) {
      console.error("payment lookup failed:", payErr);
      return new Response(
        JSON.stringify({ error: "Payment lookup failed", details: payErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!paymentRow) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "No payment row to confirm" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (paymentRow.confirmation_sent_at) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "Confirmation already sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Look up everything needed for the email.
    const { data: tournament, error: tErr } = await sb
      .from("tournaments")
      .select("id, name, start_date, end_date")
      .eq("id", tournament_id)
      .single();
    if (tErr || !tournament) {
      console.error("tournament lookup failed:", tErr);
      return new Response(
        JSON.stringify({ error: "Tournament not found", details: tErr }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: player, error: plErr } = await sb
      .from("players")
      .select("id, first, last, parent_id")
      .eq("id", player_id)
      .single();
    if (plErr || !player) {
      console.error("player lookup failed:", plErr);
      return new Response(
        JSON.stringify({ error: "Player not found", details: plErr }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // Fan out: collect all linked parent_ids via parent_players. Fall back
    // to players.parent_id if no rows exist (defensive — registration writes
    // both since Phase 2).
    const { data: links, error: linkErr } = await sb
      .from("parent_players")
      .select("parent_id")
      .eq("player_id", player.id);
    if (linkErr) {
      console.error("parent_players lookup failed:", linkErr);
    }
    let parentIds = (links || []).map((l: any) => l.parent_id).filter(Boolean);
    if (parentIds.length === 0 && player.parent_id) {
      console.warn(`parent_players empty for player ${player.id}; falling back to players.parent_id`);
      parentIds = [player.parent_id];
    }
    if (parentIds.length === 0) {
      console.warn(`player ${player.id} has no linked parents; cannot email`);
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "Player has no linked parents" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: parents, error: parErr } = await sb
      .from("parents")
      .select("id, first, email")
      .in("id", parentIds);
    if (parErr) {
      console.error("parents lookup failed:", parErr);
      return new Response(
        JSON.stringify({ error: "Parents lookup failed", details: parErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const recipients = (parents || []).filter((p: any) => p && p.email);
    if (recipients.length === 0) {
      console.warn(`No linked parents with email on file for player ${player.id}`);
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "No linked parents have an email on file" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const dateRange = fmtDateRange(tournament.start_date, tournament.end_date);
    const subject = `Payment received for ${player.first} — ${tournament.name}`;

    // 3. Fan-out send. Separate sends per parent — no TO+CC.
    let sent = 0;
    const results: any[] = [];
    for (const recipient of recipients) {
      const text = `Hi ${recipient.first || "there"},

We've received the tournament fee for ${player.first} ${player.last} for ${tournament.name} (${dateRange}).

${player.first} is all set for the tournament.

— 3Ball Academy`;
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
            text,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          console.error(`Resend failed: tournament_id=${tournament_id} player_id=${player_id} to=${recipient.email} err=`, data);
          results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: data });
        } else {
          sent++;
          results.push({ parent_id: recipient.id, to: recipient.email, ok: true, id: data.id });
        }
      } catch (e) {
        console.error(`Send threw: tournament_id=${tournament_id} player_id=${player_id} to=${recipient.email} err=`, e);
        results.push({ parent_id: recipient.id, to: recipient.email, ok: false, error: String(e) });
      }
    }

    if (sent === 0) {
      // No one received the email — don't stamp confirmation_sent_at so a
      // retry next time the admin marks paid still has a chance.
      return new Response(
        JSON.stringify({ ok: false, sent: 0, attempted: recipients.length, results }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. At least one recipient succeeded — stamp confirmation_sent_at so
    //    subsequent toggles don't re-fire the email.
    const { error: updErr } = await sb
      .from("tournament_payments")
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq("id", paymentRow.id);
    if (updErr) {
      console.error("Failed to stamp confirmation_sent_at:", updErr);
      return new Response(
        JSON.stringify({ ok: true, sent, attempted: recipients.length, results, warning: "email sent but confirmation_sent_at stamp failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, sent, attempted: recipients.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-tournament-payment-confirmation threw:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

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
    if (!player.parent_id) {
      console.warn(`player ${player.id} has no parent_id; cannot email`);
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "Player has no parent on file" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: parent, error: parErr } = await sb
      .from("parents")
      .select("id, first, email")
      .eq("id", player.parent_id)
      .single();
    if (parErr || !parent || !parent.email) {
      console.warn(`parent for player ${player.id} has no email or row`);
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "Parent has no email on file" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const dateRange = fmtDateRange(tournament.start_date, tournament.end_date);

    const subject = `Payment received for ${player.first} — ${tournament.name}`;
    const text = `Hi ${parent.first || "there"},

We've received the tournament fee for ${player.first} ${player.last} for ${tournament.name} (${dateRange}).

${player.first} is all set for the tournament.

— 3Ball Academy`;

    // 3. Send.
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
        text,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error(`Resend failed: tournament_id=${tournament_id} player_id=${player_id} to=${parent.email} err=`, data);
      return new Response(
        JSON.stringify({ error: "Resend API failed", details: data }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Stamp confirmation_sent_at so we never re-fire.
    const { error: updErr } = await sb
      .from("tournament_payments")
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq("id", paymentRow.id);
    if (updErr) {
      console.error("Failed to stamp confirmation_sent_at:", updErr);
      // Don't fail the response — email already sent. Return success with a warning note.
      return new Response(
        JSON.stringify({ ok: true, sent: 1, id: data.id, warning: "email sent but confirmation_sent_at stamp failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, sent: 1, id: data.id, to: parent.email }),
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

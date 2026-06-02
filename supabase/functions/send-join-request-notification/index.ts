// Notifies the household's primary contact that a new parent has requested to
// join their household. The in-app pending-requests panel is the source of
// truth for the approval decision; this email is a heads-up that nudges the
// primary to sign in and review.
//
// Privacy: the email contains NO information about the requester (no name,
// email, or contact). Per the cross-household guardrail design, the primary
// approves access to their household as a whole, not to a specific
// individual's identity; the in-app review is the consent surface.
//
// Auth: relies on platform-level verify_jwt = true in config.toml. The
// function body uses the ADMIN_API_KEY to look up the primary's email and
// (optionally) the matched player's first name for context. The caller's JWT
// is not re-inspected because it was already validated by the platform and
// the function performs no sensitive writes — just a templated email.
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

function buildHtml(args: { primaryFirst: string; kidFirst: string }): string {
  const contextLine = args.kidFirst
    ? `They matched <strong>${escapeHtml(args.kidFirst)}</strong>'s registration.`
    : `They matched a player in your household.`;
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Someone wants to join your 3Ball household</title>
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
              <h1 style="margin:0 0 16px 0;font-size:22px;color:#1A2E1A;">Hi ${escapeHtml(args.primaryFirst || "there")},</h1>
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                Someone is requesting to join your 3Ball household.
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                ${contextLine}
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                Approving will let them see <strong>all players</strong> in your household, including any added later. Sign in to review and Approve or Deny.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td style="background:#E8621A;border-radius:8px;">
                    <a href="${APP_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Review Request</a>
                  </td>
                </tr>
              </table>

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

function buildText(args: { primaryFirst: string; kidFirst: string }): string {
  const contextLine = args.kidFirst
    ? `They matched ${args.kidFirst}'s registration.`
    : `They matched a player in your household.`;
  return `Hi ${args.primaryFirst || "there"},

Someone is requesting to join your 3Ball household.

${contextLine}

Approving will let them see all players in your household, including any added later. Sign in to review and Approve or Deny.

Review the request: ${APP_URL}

— 3Ball Academy
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

  const household_id: string | undefined = body.household_id;
  const matched_player_id: string | null = body.matched_player_id || null;
  if (!household_id) {
    return new Response(JSON.stringify({ error: "Missing household_id" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);

  // Resolve the household primary's identity for the email.
  const { data: household, error: hErr } = await sb
    .from("households")
    .select("id, primary_parent_id")
    .eq("id", household_id)
    .maybeSingle();
  if (hErr || !household || !household.primary_parent_id) {
    console.error("household lookup failed:", hErr);
    return new Response(JSON.stringify({ error: "Household not found or has no primary" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: primary, error: pErr } = await sb
    .from("parents")
    .select("id, first, email")
    .eq("id", household.primary_parent_id)
    .maybeSingle();
  if (pErr || !primary || !primary.email) {
    console.error("primary parent lookup failed:", pErr);
    return new Response(JSON.stringify({ error: "Primary parent has no email on file" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Optional: matched kid's first name for the context line. Pulled from the
  // primary's own household, so this isn't a privacy leak (it's their kid).
  let kidFirst = "";
  if (matched_player_id) {
    const { data: kid, error: kErr } = await sb
      .from("players")
      .select("id, first")
      .eq("id", matched_player_id)
      .maybeSingle();
    if (kErr) console.warn("matched player lookup failed (continuing without name):", kErr);
    else if (kid && kid.first) kidFirst = kid.first;
  }

  const emailArgs = { primaryFirst: primary.first || "", kidFirst };
  const subject = "Someone wants to join your 3Ball household";

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [primary.email],
        reply_to: REPLY_TO,
        subject,
        html: buildHtml(emailArgs),
        text: buildText(emailArgs),
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error("Resend failed:", data);
      return new Response(JSON.stringify({ ok: false, error: data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send threw:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

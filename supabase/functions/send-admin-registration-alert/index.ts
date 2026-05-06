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

function buildHtml(parent: any, players: any[]): string {
  const parentFull = escapeHtml(`${parent.first || ""} ${parent.last || ""}`.trim());
  const parentEmail = escapeHtml(parent.email || "");
  const parentPhone = escapeHtml(parent.phone || "(not provided)");

  const playersRows = (players || []).length === 0
    ? `<tr><td style="padding:6px 0;color:#5F5E5A;">No players listed</td></tr>`
    : players.map((p) => `
        <tr>
          <td style="padding:6px 0;border-bottom:1px solid #E5E5E0;">
            <strong>${escapeHtml(p.first || "")} ${escapeHtml(p.last || "")}</strong>
            ${p.grad_year ? `<span style="color:#5F5E5A;"> — Class of ${escapeHtml(String(p.grad_year))}</span>` : ""}
          </td>
        </tr>
      `).join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>New parent registered</title>
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
              <h1 style="margin:0 0 8px 0;font-size:20px;color:#1A2E1A;">New parent registered</h1>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                ${parentFull} just signed up and is awaiting your approval.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">
                <tr><td style="padding:6px 0;"><strong>Name:</strong> ${parentFull}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Email:</strong> ${parentEmail}</td></tr>
                <tr><td style="padding:6px 0;"><strong>Phone:</strong> ${parentPhone}</td></tr>
              </table>

              <h2 style="margin:24px 0 8px 0;font-size:15px;color:#1A2E1A;">Players</h2>
              <table width="100%" cellpadding="0" cellspacing="0">${playersRows}</table>

              <table cellpadding="0" cellspacing="0" style="margin:32px auto 0 auto;">
                <tr>
                  <td style="background:#E8621A;border-radius:8px;">
                    <a href="${APP_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Open Dashboard</a>
                  </td>
                </tr>
              </table>
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

function buildText(parent: any, players: any[]): string {
  const playerLines = (players || []).length === 0
    ? "  (none listed)"
    : players.map((p) => `  • ${p.first || ""} ${p.last || ""}${p.grad_year ? ` (Class of ${p.grad_year})` : ""}`).join("\n");

  return `New parent registered

${parent.first || ""} ${parent.last || ""} just signed up and is awaiting your approval.

Name: ${parent.first || ""} ${parent.last || ""}
Email: ${parent.email || ""}
Phone: ${parent.phone || "(not provided)"}

Players:
${playerLines}

Open Dashboard: ${APP_URL}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { parent, players } = await req.json();

    if (!parent || !parent.email) {
      return new Response(
        JSON.stringify({ error: "Missing parent or parent.email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!RESEND_API_KEY || !ADMIN_API_KEY || !SUPABASE_URL) {
      console.error("Missing env", {
        hasResend: !!RESEND_API_KEY,
        hasAdmin: !!ADMIN_API_KEY,
        hasUrl: !!SUPABASE_URL
      });
      return new Response(
        JSON.stringify({ error: "Server config missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);
    const { data: admins, error: adminErr } = await sb
      .from("coaches")
      .select("email")
      .eq("is_admin", true);

    if (adminErr) {
      console.error("Admin lookup failed:", adminErr);
      return new Response(
        JSON.stringify({ error: "Admin lookup failed", details: adminErr }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminEmails = (admins || [])
      .map((a: any) => a.email)
      .filter((e: string) => !!e);

    if (adminEmails.length === 0) {
      console.warn("No admins found with is_admin=true and email set");
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "No admins to notify" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const subject = `New parent registered: ${parent.first || ""} ${parent.last || ""}`.trim();
    const html = buildHtml(parent, players || []);
    const text = buildText(parent, players || []);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: adminEmails,
        reply_to: REPLY_TO,
        subject,
        html,
        text,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("Resend API error:", data);
      return new Response(
        JSON.stringify({ error: "Resend API failed", details: data }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, sent: adminEmails.length, id: data.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-admin-registration-alert threw:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

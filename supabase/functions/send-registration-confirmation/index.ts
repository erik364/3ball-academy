// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = "3Ball Academy <noreply@3ballacademy.com>";
const REPLY_TO = "wozzy20@aol.com";
const APP_URL = "https://app.3ballacademy.com";
const LOGO_URL = "https://app.3ballacademy.com/logo-email.png";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function buildHtml(first: string): string {
  const safeFirst = (first || "there").replace(/[<>&"]/g, "");
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Registration received — 3Ball Academy</title>
  </head>
  <body style="margin:0;padding:0;background:#F4F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif;color:#1A2E1A;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;padding:40px 20px;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#085041;padding:32px 20px;text-align:center;">
                <img src="${LOGO_URL}"
                     alt="3Ball Academy"
                     width="220"
                     style="display:block;margin:0 auto;max-width:220px;height:auto;border:0;outline:none;" />
              </td>
            </tr>
            <tr>
              <td style="padding:40px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;color:#1A2E1A;">Hi ${safeFirst},</h1>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                  Thanks for registering with 3Ball Academy! Your account is being reviewed and you'll typically hear back within 24 hours.
                </p>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                  Once approved, you'll get a follow-up email with a link to sign in and access your kid's schedule, RSVP for practices and tournaments, and stay connected with the team.
                </p>
                <p style="margin:0 0 32px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                  If you have any questions in the meantime, just reply to this email.
                </p>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                  Talk soon,<br>
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
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText(first: string): string {
  const safeFirst = first || "there";
  return `Hi ${safeFirst},

Thanks for registering with 3Ball Academy! Your account is being reviewed and you'll typically hear back within 24 hours.

Once approved, you'll get a follow-up email with a link to sign in and access your kid's schedule, RSVP for practices and tournaments, and stay connected with the team.

If you have any questions in the meantime, just reply to this email.

Talk soon,
Mike Wozniak
3Ball Academy`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, first } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Missing email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        reply_to: REPLY_TO,
        subject: "Registration received — 3Ball Academy",
        html: buildHtml(first),
        text: buildText(first),
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
      JSON.stringify({ ok: true, id: data.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-registration-confirmation threw:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

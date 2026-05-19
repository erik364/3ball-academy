// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_API_KEY = Deno.env.get("ADMIN_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const FROM_EMAIL = "3Ball Academy <noreply@3ballacademy.com>";
const APP_URL = "https://app.3ballacademy.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function escapeAttr(s: string): string {
  return String(s || "").replace(/[<>&"]/g, "");
}

function buildInviteSectionHtml(householdInviteLink: string): string {
  if (!householdInviteLink) return "";
  return `
    <div style="margin:24px 0;padding:16px;background:#F4F6F2;border-radius:8px;">
      <p style="margin:0 0 8px 0;font-size:15px;font-weight:600;color:#1A2E1A;">Want your co-parent or another family member to have access too?</p>
      <p style="margin:0 0 12px 0;font-size:13px;line-height:1.5;color:#5F5E5A;">
        Share this invite link:
      </p>
      <a href="${escapeAttr(householdInviteLink)}" style="font-size:13px;color:#E8621A;word-break:break-all;">${escapeAttr(householdInviteLink)}</a>
      <p style="margin:12px 0 0 0;font-size:12px;color:#888780;font-style:italic;">
        Valid for 7 days. Works once. Anyone who joins gets access to your whole household — including any kids you add later.
      </p>
    </div>
  `;
}

function buildInviteSectionText(householdInviteLink: string): string {
  if (!householdInviteLink) return "";
  return `\n\nWant your co-parent or another family member to have access too? Share this invite link:\n\n${householdInviteLink}\n\nValid for 7 days. Works once. Anyone who joins gets access to your whole household — including any kids you add later.`;
}

function buildHtml(first: string, householdInviteLink: string): string {
  const safeFirst = (first || "there").replace(/[<>&"]/g, "");
  const inviteHtml = buildInviteSectionHtml(householdInviteLink);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Welcome to 3Ball Academy</title>
  </head>
  <body style="margin:0;padding:0;background:#F4F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif;color:#1A2E1A;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;padding:40px 20px;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:#085041;padding:32px 20px;text-align:center;">
                <img src="https://app.3ballacademy.com/logo-email.png"
                     alt="3Ball Academy"
                     width="220"
                     style="display:block;margin:0 auto;max-width:220px;height:auto;border:0;outline:none;" />
              </td>
            </tr>
            <tr>
              <td style="padding:40px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;color:#1A2E1A;">Hi ${safeFirst},</h1>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                  Mike Wozniak here — welcome to 3Ball Academy! Your account is approved and you're ready to go.
                </p>
                <p style="margin:0 0 32px 0;font-size:16px;line-height:1.6;color:#1A2E1A;">
                  Sign in to see your kid's schedule, RSVP for practices and tournaments, and stay connected with the team.
                </p>
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                  <tr>
                    <td style="background:#E8621A;border-radius:8px;">
                      <a href="${APP_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Sign In</a>
                    </td>
                  </tr>
                </table>
                ${inviteHtml}
                <p style="margin:32px 0 0 0;font-size:15px;line-height:1.6;color:#5F5E5A;">
                  See you on the court,<br>
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

function buildText(first: string, householdInviteLink: string): string {
  const safeFirst = first || "there";
  const inviteText = buildInviteSectionText(householdInviteLink);
  return `Hi ${safeFirst},

Mike Wozniak here — welcome to 3Ball Academy! Your account is approved and you're ready to go.

Sign in to see your kid's schedule, RSVP for practices and tournaments, and stay connected with the team.

Sign in: ${APP_URL}${inviteText}

See you on the court,
Mike Wozniak
3Ball Academy`;
}

// Look up unused, non-expired invites for this parent. Each invite belongs
// to one of their kids; we pull the kid's first name for the email body.
// Look up the most recent unused, non-expired invite this parent created.
// Household-scope invites are not kid-targeted; we return a single URL or "".
async function lookupHouseholdInviteLink(parent_user_id: string): Promise<string> {
  if (!parent_user_id || !ADMIN_API_KEY || !SUPABASE_URL) return "";
  try {
    const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);
    const { data: invites, error: iErr } = await sb
      .from("parent_invites")
      .select("token, expires_at, created_at")
      .eq("inviting_parent_id", parent_user_id)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (iErr) {
      console.error("invite lookup failed:", iErr);
      return "";
    }
    if (!invites || invites.length === 0) return "";
    return `${APP_URL}/invite/${encodeURIComponent(invites[0].token)}`;
  } catch (e) {
    console.error("lookupHouseholdInviteLink threw:", e);
    return "";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const email: string = body.email;
    const first: string = body.first || body.first_name || "";
    const parentUserId: string | undefined = body.parent_user_id;

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

    // Query unused invite links for this parent (if we got a user id) so the
    // welcome email can include the "share with co-parent" section. If
    // anything goes wrong here, we still send the welcome email — just
    // without the invite section.
    const householdInviteLink = parentUserId ? await lookupHouseholdInviteLink(parentUserId) : "";

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        reply_to: "wozzy20@aol.com",
        subject: "Welcome to 3Ball Academy",
        html: buildHtml(first, householdInviteLink),
        text: buildText(first, householdInviteLink),
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
      JSON.stringify({ ok: true, id: data.id, household_invite_included: !!householdInviteLink }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-welcome-email threw:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

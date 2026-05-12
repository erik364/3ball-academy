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

type KidInvite = { first_name: string; url: string };

function buildInviteSectionHtml(kidInviteLinks: KidInvite[]): string {
  if (!kidInviteLinks || kidInviteLinks.length === 0) return "";
  const rows = kidInviteLinks.map((k) => `
    <tr>
      <td style="padding:8px 0;">
        <div style="font-size:14px;font-weight:600;color:#1A2E1A;">${escapeAttr(k.first_name)}:</div>
        <a href="${escapeAttr(k.url)}" style="font-size:13px;color:#E8621A;word-break:break-all;">${escapeAttr(k.url)}</a>
      </td>
    </tr>
  `).join("");
  return `
    <div style="margin:24px 0;padding:16px;background:#F4F6F2;border-radius:8px;">
      <p style="margin:0 0 8px 0;font-size:15px;font-weight:600;color:#1A2E1A;">Want your co-parent to have access too?</p>
      <p style="margin:0 0 12px 0;font-size:13px;line-height:1.5;color:#5F5E5A;">
        Share these invite links for each of your children:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      <p style="margin:12px 0 0 0;font-size:12px;color:#888780;font-style:italic;">
        Each link is valid for 7 days and works once.
      </p>
    </div>
  `;
}

function buildInviteSectionText(kidInviteLinks: KidInvite[]): string {
  if (!kidInviteLinks || kidInviteLinks.length === 0) return "";
  const lines = kidInviteLinks.map((k) => `  ${k.first_name}: ${k.url}`).join("\n");
  return `\n\nWant your co-parent to have access too? Here are invite links for each of your children:\n\n${lines}\n\nEach link is valid for 7 days and works once.`;
}

function buildHtml(first: string, kidInviteLinks: KidInvite[]): string {
  const safeFirst = (first || "there").replace(/[<>&"]/g, "");
  const inviteHtml = buildInviteSectionHtml(kidInviteLinks);
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

function buildText(first: string, kidInviteLinks: KidInvite[]): string {
  const safeFirst = first || "there";
  const inviteText = buildInviteSectionText(kidInviteLinks);
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
async function lookupInviteLinks(parent_user_id: string): Promise<KidInvite[]> {
  if (!parent_user_id || !ADMIN_API_KEY || !SUPABASE_URL) return [];
  try {
    const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);
    const { data: invites, error: iErr } = await sb
      .from("parent_invites")
      .select("token, player_id, expires_at")
      .eq("inviting_parent_id", parent_user_id)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString());
    if (iErr) {
      console.error("invite lookup failed:", iErr);
      return [];
    }
    if (!invites || invites.length === 0) return [];

    const playerIds = [...new Set(invites.map((i: any) => i.player_id))];
    const { data: players, error: pErr } = await sb
      .from("players")
      .select("id, first")
      .in("id", playerIds);
    if (pErr) {
      console.error("players lookup for invite section failed:", pErr);
      return [];
    }
    const nameById = new Map<string, string>();
    (players || []).forEach((p: any) => nameById.set(p.id, p.first || ""));

    return invites
      .map((i: any) => ({
        first_name: nameById.get(i.player_id) || "Your child",
        url: `${APP_URL}/?invite=${encodeURIComponent(i.token)}`,
      }));
  } catch (e) {
    console.error("lookupInviteLinks threw:", e);
    return [];
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
    const kidInviteLinks = parentUserId ? await lookupInviteLinks(parentUserId) : [];

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
        html: buildHtml(first, kidInviteLinks),
        text: buildText(first, kidInviteLinks),
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
      JSON.stringify({ ok: true, id: data.id, invite_count: kidInviteLinks.length }),
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

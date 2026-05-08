// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_API_KEY = Deno.env.get("ADMIN_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  if (!ADMIN_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse(500, { error: "Server config missing" });
  }

  // 1. Validate caller — must be authenticated AND must be an admin coach.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse(401, { error: "Missing Authorization header" });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes || !userRes.user) {
    return jsonResponse(401, { error: "Invalid or expired token" });
  }
  const callerId = userRes.user.id;

  const adminClient = createClient(SUPABASE_URL, ADMIN_API_KEY);

  const { data: callerCoach, error: callerErr } = await adminClient
    .from("coaches")
    .select("id, is_admin")
    .eq("id", callerId)
    .maybeSingle();
  if (callerErr) {
    console.error("caller lookup failed:", callerErr);
    return jsonResponse(500, { error: "Caller lookup failed" });
  }
  if (!callerCoach || !callerCoach.is_admin) {
    return jsonResponse(403, { error: "Forbidden — admin only" });
  }

  // 2. Parse body
  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  const coachUserId: string = body.coach_user_id;
  const isAdmin: boolean = !!body.is_admin;
  if (!coachUserId || typeof coachUserId !== "string") {
    return jsonResponse(400, { error: "Missing coach_user_id" });
  }

  // 3. Update auth.users metadata. Both fields kept in sync — resolveSupabaseUser
  // currently only reads user_metadata.role, but app_metadata.role is the
  // server-trusted equivalent and we keep them aligned for safety.
  const role = isAdmin ? "admin" : "coach";
  const { data: updateRes, error: updErr } = await adminClient.auth.admin.updateUserById(
    coachUserId,
    {
      app_metadata: { role },
      user_metadata: { role },
    },
  );
  if (updErr) {
    console.error("auth.admin.updateUserById failed:", updErr);
    return jsonResponse(500, {
      error: "auth metadata update failed",
      details: { message: updErr.message, name: updErr.name },
    });
  }

  return jsonResponse(200, {
    ok: true,
    user_id: coachUserId,
    role,
    updated_user_meta: updateRes && updateRes.user
      ? (updateRes.user.user_metadata && updateRes.user.user_metadata.role)
      : null,
    updated_app_meta: updateRes && updateRes.user
      ? (updateRes.user.app_metadata && updateRes.user.app_metadata.role)
      : null,
  });
});

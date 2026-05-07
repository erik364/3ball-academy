// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_API_KEY = Deno.env.get("ADMIN_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function serverError(msg: string): Response {
  return new Response("Server Error: " + msg, {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

// RFC 5545 escaping for SUMMARY/LOCATION/DESCRIPTION text values
function ics(s: string): string {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

// "YYYY-MM-DD" + "HH:MM" → "YYYYMMDDTHHMMSS" (floating local time, no TZ)
function dtLocal(date: string, time: string): string {
  if (!date) return "";
  const dateOnly = date.replace(/-/g, "");
  if (!time) return dateOnly;
  const [h, m] = time.split(":").map(Number);
  return `${dateOnly}T${pad(h)}${pad(m)}00`;
}

// "YYYY-MM-DD" → "YYYYMMDD"
function dateOnly(date: string): string {
  return (date || "").replace(/-/g, "");
}

// Add N days to a YYYY-MM-DD string, return YYYYMMDD
function dateAddDaysOnly(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

function nowDtStamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function vevent(parts: Record<string, string | undefined>): string {
  const lines = ["BEGIN:VEVENT"];
  for (const [k, v] of Object.entries(parts)) {
    if (v === undefined || v === "") continue;
    lines.push(`${k}:${v}`);
  }
  lines.push("END:VEVENT");
  return lines.join("\r\n") + "\r\n";
}

function timedSlice(time: any): string {
  if (!time) return "";
  const s = String(time);
  return s.slice(0, 5);
}

interface FeedConfig {
  calName: string;
  practices: any[];
  tournaments: any[];
  games: { game: any; team: any; tournament: any }[];
}

function buildIcs(cfg: FeedConfig): string {
  const stamp = nowDtStamp();
  let ics_text = "BEGIN:VCALENDAR\r\n";
  ics_text += "VERSION:2.0\r\n";
  ics_text += "PRODID:-//3Ball Academy//Calendar Feed//EN\r\n";
  ics_text += "CALSCALE:GREGORIAN\r\n";
  ics_text += "METHOD:PUBLISH\r\n";
  ics_text += `X-WR-CALNAME:${ics(cfg.calName)}\r\n`;

  for (const p of cfg.practices) {
    const start = timedSlice(p.start_time);
    const end = timedSlice(p.end_time);
    const groups = Array.isArray(p.groups) ? p.groups.join(", ") : "";
    ics_text += vevent({
      UID: `practice-${p.id}@3ballacademy`,
      DTSTAMP: stamp,
      DTSTART: dtLocal(p.date, start),
      DTEND: dtLocal(p.date, end),
      SUMMARY: ics(`Practice — ${groups}`),
      LOCATION: ics(p.location || ""),
      DESCRIPTION: p.notes ? ics(p.notes) : undefined,
    });
  }

  for (const t of cfg.tournaments) {
    ics_text += vevent({
      UID: `tournament-${t.id}@3ballacademy`,
      DTSTAMP: stamp,
      "DTSTART;VALUE=DATE": dateOnly(t.start_date),
      // ICS DTEND is exclusive for all-day events
      "DTEND;VALUE=DATE": dateAddDaysOnly(t.end_date || t.start_date, 1),
      SUMMARY: ics(`🏆 ${t.name || "Tournament"}`),
      LOCATION: undefined,
      DESCRIPTION: t.notes ? ics(t.notes) : undefined,
    });
  }

  for (const { game, team, tournament } of cfg.games) {
    const start = timedSlice(game.start_time);
    const end = timedSlice(game.end_time);
    const tnName = tournament?.name || "Tournament";
    const opponent = game.opponent ? ` vs ${game.opponent}` : "";
    const teamLabel = team?.name ? ` (${team.name})` : "";
    ics_text += vevent({
      UID: `game-${game.id}@3ballacademy`,
      DTSTAMP: stamp,
      DTSTART: dtLocal(game.date, start),
      DTEND: end ? dtLocal(game.date, end) : dtLocal(game.date, start),
      SUMMARY: ics(`${tnName}${opponent}${teamLabel}`),
      LOCATION: ics(game.location_text || ""),
      DESCRIPTION: game.notes ? ics(game.notes) : undefined,
    });
  }

  ics_text += "END:VCALENDAR\r\n";
  return ics_text;
}

function icsResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "max-age=300, public",
    },
  });
}

// ---- Scope resolvers ----

async function loadKidScope(sb: any, player: any): Promise<FeedConfig> {
  const team = player.team;

  // Practices: team in groups
  let practicesData: any[] = [];
  if (team) {
    const { data } = await sb
      .from("practices")
      .select("id, date, start_time, end_time, location, groups, notes")
      .contains("groups", [team])
      .order("date");
    practicesData = data || [];
  }

  // Tournaments: kid's team in tournaments.teams (invited) OR kid is rostered
  // First, find tournaments where kid is rostered
  const { data: kidTeams } = await sb
    .from("tournament_teams")
    .select("id, tournament_id, name, coach_ids, player_ids")
    .contains("player_ids", [player.id]);
  const rosteredTournamentIds = new Set<string>(
    (kidTeams || []).map((t: any) => t.tournament_id)
  );

  // Plus tournaments where the kid's team is invited
  let invitedTournaments: any[] = [];
  if (team) {
    const { data } = await sb
      .from("tournaments")
      .select("id, name, start_date, end_date, notes, teams")
      .contains("teams", [team]);
    invitedTournaments = data || [];
  }

  const tournamentIds = new Set<string>([
    ...rosteredTournamentIds,
    ...invitedTournaments.map((t: any) => t.id),
  ]);

  let tournamentsData: any[] = [];
  if (tournamentIds.size > 0) {
    const { data } = await sb
      .from("tournaments")
      .select("id, name, start_date, end_date, notes")
      .in("id", [...tournamentIds]);
    tournamentsData = data || [];
  }

  // Games: only for teams the kid is on (rostered)
  const kidTournamentTeamIds = (kidTeams || []).map((t: any) => t.id);
  let gamesEntries: { game: any; team: any; tournament: any }[] = [];
  if (kidTournamentTeamIds.length > 0) {
    const { data: games } = await sb
      .from("tournament_games")
      .select("id, tournament_team_id, date, start_time, end_time, location_text, opponent, notes")
      .in("tournament_team_id", kidTournamentTeamIds);
    const teamById = new Map<string, any>();
    (kidTeams || []).forEach((t: any) => teamById.set(t.id, t));
    const tnById = new Map<string, any>();
    tournamentsData.forEach((t: any) => tnById.set(t.id, t));
    gamesEntries = (games || []).map((g: any) => {
      const team = teamById.get(g.tournament_team_id);
      const tournament = team ? tnById.get(team.tournament_id) : null;
      return { game: g, team, tournament };
    });
  }

  return {
    calName: `3Ball Academy — ${player.first || "Player"}`,
    practices: practicesData,
    tournaments: tournamentsData,
    games: gamesEntries,
  };
}

async function loadCoachScope(sb: any, coach: any): Promise<FeedConfig> {
  const teams: string[] = Array.isArray(coach.teams) ? coach.teams : [];

  let practicesData: any[] = [];
  if (teams.length > 0) {
    const { data } = await sb
      .from("practices")
      .select("id, date, start_time, end_time, location, groups, notes")
      .overlaps("groups", teams)
      .order("date");
    practicesData = data || [];
  }

  let tournamentsData: any[] = [];
  if (teams.length > 0) {
    const { data } = await sb
      .from("tournaments")
      .select("id, name, start_date, end_date, notes")
      .overlaps("teams", teams);
    tournamentsData = data || [];
  }

  // Games: where the coach is assigned to the tournament_team
  const { data: coachedTeams } = await sb
    .from("tournament_teams")
    .select("id, tournament_id, name, coach_ids, player_ids")
    .contains("coach_ids", [coach.id]);
  const coachedTeamIds = (coachedTeams || []).map((t: any) => t.id);

  let gamesEntries: { game: any; team: any; tournament: any }[] = [];
  if (coachedTeamIds.length > 0) {
    const { data: games } = await sb
      .from("tournament_games")
      .select("id, tournament_team_id, date, start_time, end_time, location_text, opponent, notes")
      .in("tournament_team_id", coachedTeamIds);
    const teamById = new Map<string, any>();
    (coachedTeams || []).forEach((t: any) => teamById.set(t.id, t));
    // Need parent tournaments for these games (in case any aren't in tournamentsData yet)
    const extraTnIds = [...new Set(
      (coachedTeams || [])
        .map((t: any) => t.tournament_id)
        .filter((id: string) => !tournamentsData.some((t: any) => t.id === id))
    )];
    if (extraTnIds.length > 0) {
      const { data: extra } = await sb
        .from("tournaments")
        .select("id, name, start_date, end_date, notes")
        .in("id", extraTnIds);
      tournamentsData = [...tournamentsData, ...(extra || [])];
    }
    const tnById = new Map<string, any>();
    tournamentsData.forEach((t: any) => tnById.set(t.id, t));
    gamesEntries = (games || []).map((g: any) => {
      const team = teamById.get(g.tournament_team_id);
      const tournament = team ? tnById.get(team.tournament_id) : null;
      return { game: g, team, tournament };
    });
  }

  return {
    calName: `3Ball Academy — ${coach.first || "Coach"}`,
    practices: practicesData,
    tournaments: tournamentsData,
    games: gamesEntries,
  };
}

async function loadAdminScope(sb: any, coach: any): Promise<FeedConfig> {
  const { data: practicesData } = await sb
    .from("practices")
    .select("id, date, start_time, end_time, location, groups, notes")
    .order("date");
  const { data: tournamentsData } = await sb
    .from("tournaments")
    .select("id, name, start_date, end_date, notes");
  const { data: games } = await sb
    .from("tournament_games")
    .select("id, tournament_team_id, date, start_time, end_time, location_text, opponent, notes");
  const { data: allTeams } = await sb
    .from("tournament_teams")
    .select("id, tournament_id, name");

  const teamById = new Map<string, any>();
  (allTeams || []).forEach((t: any) => teamById.set(t.id, t));
  const tnById = new Map<string, any>();
  (tournamentsData || []).forEach((t: any) => tnById.set(t.id, t));

  const gamesEntries = (games || []).map((g: any) => {
    const team = teamById.get(g.tournament_team_id);
    const tournament = team ? tnById.get(team.tournament_id) : null;
    return { game: g, team, tournament };
  });

  return {
    calName: `3Ball Academy — ${coach.first || "Admin"}`,
    practices: practicesData || [],
    tournaments: tournamentsData || [],
    games: gamesEntries,
  };
}

// ---- Handler ----

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!ADMIN_API_KEY || !SUPABASE_URL) {
    return serverError("config missing");
  }

  let token = "";
  try {
    const url = new URL(req.url);
    token = (url.searchParams.get("token") || "").trim();
  } catch (_) {
    return notFound();
  }
  if (!token) return notFound();
  // Tokens are uuids; cheap shape check before hitting DB
  if (!/^[0-9a-f-]{36}$/i.test(token)) return notFound();

  const sb = createClient(SUPABASE_URL, ADMIN_API_KEY);

  try {
    // 1. Try players (per-kid feed)
    const { data: player, error: pErr } = await sb
      .from("players")
      .select("id, first, last, team, parent_id, calendar_token")
      .eq("calendar_token", token)
      .maybeSingle();
    if (pErr) {
      console.error("players lookup error:", pErr);
      return serverError("player lookup failed");
    }
    if (player) {
      const cfg = await loadKidScope(sb, player);
      return icsResponse(buildIcs(cfg));
    }

    // 2. Try calendar_tokens → coach lookup
    const { data: tokenRow, error: tErr } = await sb
      .from("calendar_tokens")
      .select("user_id")
      .eq("token", token)
      .maybeSingle();
    if (tErr) {
      console.error("calendar_tokens lookup error:", tErr);
      return serverError("token lookup failed");
    }
    if (tokenRow) {
      const { data: coach, error: cErr } = await sb
        .from("coaches")
        .select("id, first, last, is_admin, teams")
        .eq("id", tokenRow.user_id)
        .maybeSingle();
      if (cErr) {
        console.error("coaches lookup error:", cErr);
        return serverError("coach lookup failed");
      }
      if (coach) {
        const cfg = coach.is_admin
          ? await loadAdminScope(sb, coach)
          : await loadCoachScope(sb, coach);
        return icsResponse(buildIcs(cfg));
      }
      // Token resolves to a non-coach user (e.g., parent backfill row from
      // the prior schema). Treat as not found — those rows are dead per
      // the per-kid design.
    }

    return notFound();
  } catch (err) {
    console.error("calendar-feed threw:", err);
    return serverError(String(err.message || err));
  }
});

-- Phase 1 of multi-parent support — schema only.
-- Adds many-to-many parent ↔ player linkage and an invite-token table for the
-- "Already in your family?" registration flow that ships in Phase 2.
--
-- Application code is NOT updated in this phase. players.parent_id stays as
-- the single source of truth that existing send-* functions and RLS policies
-- read from. The new tables are populated (backfilled) but currently unused.
--
-- FK target: players.parent_id is set at registration to auth.users.id (see
-- public/app.html registration flow). parent_players.parent_id and
-- parent_invites.inviting_parent_id / .consumed_by_parent_id mirror that.

-- ============================================================
-- parent_players: many-to-many join
-- ============================================================
create table public.parent_players (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (parent_id, player_id)
);

create index parent_players_parent_idx on public.parent_players(parent_id);
create index parent_players_player_idx on public.parent_players(player_id);

-- Enforce at most one primary parent per player at the DB level.
create unique index parent_players_one_primary_per_player
  on public.parent_players(player_id)
  where is_primary = true;

-- ============================================================
-- parent_invites: invite tokens for the "Already in your family?" flow
-- ============================================================
create table public.parent_invites (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  inviting_parent_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  used_at timestamptz,
  consumed_by_parent_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index parent_invites_token_idx on public.parent_invites(token);
create index parent_invites_inviting_parent_idx on public.parent_invites(inviting_parent_id);
create index parent_invites_player_idx on public.parent_invites(player_id);

-- ============================================================
-- Backfill: existing single-parent links → parent_players rows
-- ============================================================
-- On a freshly-wiped DB this is a no-op. On a populated DB this seeds
-- parent_players from the canonical players.parent_id column with each
-- existing parent marked is_primary=true so the new uniqueness invariant
-- holds without conflict.
insert into public.parent_players (parent_id, player_id, is_primary)
select parent_id, id, true
from public.players
where parent_id is not null
on conflict (parent_id, player_id) do nothing;

-- ============================================================
-- RLS — parent_players
-- ============================================================
alter table public.parent_players enable row level security;

drop policy if exists "parent_players_admin_all" on public.parent_players;
create policy "parent_players_admin_all"
  on public.parent_players
  for all
  using (
    exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true)
  )
  with check (
    exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true)
  );

-- Parents can read only their own linkage rows. Writes happen via Phase 2's
-- SECURITY DEFINER consume function, never directly from the client.
drop policy if exists "parent_players_parent_select_own" on public.parent_players;
create policy "parent_players_parent_select_own"
  on public.parent_players
  for select
  using (parent_id = auth.uid());

-- ============================================================
-- RLS — parent_invites
-- ============================================================
alter table public.parent_invites enable row level security;

drop policy if exists "parent_invites_admin_all" on public.parent_invites;
create policy "parent_invites_admin_all"
  on public.parent_invites
  for all
  using (
    exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true)
  )
  with check (
    exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true)
  );

-- A parent can see invites they created.
drop policy if exists "parent_invites_inviter_select_own" on public.parent_invites;
create policy "parent_invites_inviter_select_own"
  on public.parent_invites
  for select
  using (inviting_parent_id = auth.uid());

-- A parent can create invites they own. The Phase 2 client generates the
-- token + expiry; this policy gates the insert to "you're inviting on your
-- own behalf" and rejects spoofing another parent's id.
drop policy if exists "parent_invites_inviter_insert_own" on public.parent_invites;
create policy "parent_invites_inviter_insert_own"
  on public.parent_invites
  for insert
  with check (inviting_parent_id = auth.uid());

-- No UPDATE / DELETE policies for parents. Invite consumption (setting
-- used_at + consumed_by_parent_id and inserting into parent_players) will
-- happen via a SECURITY DEFINER function added in Phase 2 — that function
-- bypasses RLS and validates the token + expiry + unused-status atomically.

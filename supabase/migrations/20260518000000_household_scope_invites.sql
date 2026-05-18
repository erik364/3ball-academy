-- Household-scope invites: replace per-kid invite shape with per-household.
-- Adds households table + household_id on parent_players and parent_invites,
-- backfills existing data, makes player_id optional on invites, and rewrites
-- consume_parent_invite to grant access to ALL household kids.

-- ============================================================
-- households table
-- ============================================================
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  primary_parent_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists households_primary_parent_idx
  on public.households(primary_parent_id);

-- ============================================================
-- household_id on join tables
-- ============================================================
alter table public.parent_players
  add column if not exists household_id uuid
  references public.households(id) on delete cascade;

alter table public.parent_invites
  add column if not exists household_id uuid
  references public.households(id) on delete cascade;

create index if not exists parent_players_household_idx
  on public.parent_players(household_id);
create index if not exists parent_invites_household_idx
  on public.parent_invites(household_id);

-- ============================================================
-- parent_invites.player_id becomes optional (household-scope invites
-- don't target a specific kid). Existing Phase 2 rows retain their
-- player_id; new rows can leave it null.
-- ============================================================
alter table public.parent_invites alter column player_id drop not null;

-- ============================================================
-- Backfill: one household per existing primary parent
-- ============================================================
insert into public.households (primary_parent_id)
select distinct pp.parent_id
from public.parent_players pp
where pp.is_primary = true
  and not exists (
    select 1 from public.households h where h.primary_parent_id = pp.parent_id
  );

-- Stamp primary-parent rows with their household_id
update public.parent_players pp
set household_id = h.id
from public.households h
where pp.is_primary = true
  and h.primary_parent_id = pp.parent_id
  and pp.household_id is null;

-- Stamp co-parent rows (Phase 2 consumers) with the same household as the
-- primary parent of the linked player.
update public.parent_players co
set household_id = h.id
from public.parent_players prim
join public.households h on h.primary_parent_id = prim.parent_id
where co.household_id is null
  and prim.is_primary = true
  and co.player_id = prim.player_id;

-- ============================================================
-- RLS — households
-- ============================================================
alter table public.households enable row level security;

drop policy if exists "households_admin_all" on public.households;
create policy "households_admin_all"
  on public.households for all
  using (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true))
  with check (exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true));

-- A household is readable to anyone whose parent_players row points to it,
-- plus the primary_parent_id directly (covers the registration moment before
-- the parent_players row is inserted).
drop policy if exists "households_member_select" on public.households;
create policy "households_member_select"
  on public.households for select
  using (
    primary_parent_id = auth.uid()
    or exists (
      select 1 from public.parent_players pp
      where pp.household_id = households.id and pp.parent_id = auth.uid()
    )
  );

-- The first parent inserts their own household at registration; subsequent
-- members are added via the SECURITY DEFINER consume RPC (bypasses RLS).
drop policy if exists "households_self_insert" on public.households;
create policy "households_self_insert"
  on public.households for insert
  with check (primary_parent_id = auth.uid());

-- ============================================================
-- RLS — parent_players: add household-member select policy so members
-- can see each other's rows (for the Household Members list in the UI).
-- Existing admin_all and parent_self policies stay.
-- ============================================================
drop policy if exists "parent_players_household_member_select" on public.parent_players;
create policy "parent_players_household_member_select"
  on public.parent_players for select
  using (
    household_id is not null
    and exists (
      select 1 from public.parent_players me
      where me.household_id = parent_players.household_id
        and me.parent_id = auth.uid()
    )
  );

-- ============================================================
-- Rewrite consume_parent_invite: grant access to ALL household kids
-- ============================================================
drop function if exists public.consume_parent_invite(text, uuid);

create or replace function public.consume_parent_invite(
  p_token text,
  p_consuming_parent_id uuid
)
returns table (
  success boolean,
  error_code text,
  player_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.parent_invites%rowtype;
  v_household_id uuid;
  v_player_ids uuid[];
begin
  select * into v_invite
    from public.parent_invites
    where token = p_token
    for update;

  if not found then
    return query select false, 'not_found'::text, null::uuid[];
    return;
  end if;
  if v_invite.used_at is not null then
    return query select false, 'already_used'::text, null::uuid[];
    return;
  end if;
  if v_invite.expires_at < now() then
    return query select false, 'expired'::text, null::uuid[];
    return;
  end if;
  if v_invite.inviting_parent_id = p_consuming_parent_id then
    return query select false, 'self_claim'::text, null::uuid[];
    return;
  end if;

  -- Resolve the household: invite carries it for new flow; legacy Phase 2
  -- invites (no household_id) fall back to the inviter's household.
  v_household_id := v_invite.household_id;
  if v_household_id is null then
    select household_id into v_household_id
    from public.parent_players
    where parent_id = v_invite.inviting_parent_id
      and household_id is not null
    limit 1;
  end if;

  if v_household_id is null then
    return query select false, 'household_missing'::text, null::uuid[];
    return;
  end if;

  -- All player_ids currently in this household.
  select array_agg(distinct player_id) into v_player_ids
  from public.parent_players
  where household_id = v_household_id;

  -- Insert consumer linkages for every player. on conflict tolerates
  -- re-runs or pre-existing linkages.
  if v_player_ids is not null and array_length(v_player_ids, 1) > 0 then
    insert into public.parent_players (parent_id, player_id, is_primary, household_id)
    select p_consuming_parent_id, pid, false, v_household_id
    from unnest(v_player_ids) as t(pid)
    on conflict (parent_id, player_id) do nothing;
  end if;

  update public.parent_invites
    set used_at = now(),
        consumed_by_parent_id = p_consuming_parent_id
    where id = v_invite.id;

  return query select true, null::text, v_player_ids;
end;
$$;

grant execute on function public.consume_parent_invite(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';

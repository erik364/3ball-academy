-- Cross-parent "this kid already exists" guardrail.
--
-- Problem: a second parent of an existing child registers independently and
-- creates a DUPLICATE players row under a new household, because the
-- uq_players_signup index only blocks same-parent dupes (parent_id is in the key).
--
-- Solution: detect the cross-household match, and instead of inserting a
-- duplicate, let the second parent REQUEST to join the existing household.
-- The household's primary approves, which links the requester to every player
-- in that household -- reusing the exact pattern consume_parent_invite proves
-- in production.
--
-- No new guardianship model: rides on households + parent_players + the
-- existing SECURITY DEFINER helpers (current_user_household_id, is_admin, etc.).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Join-request table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.household_join_requests (
  id                   uuid primary key default gen_random_uuid(),
  requesting_parent_id uuid not null references auth.users(id) on delete cascade,
  household_id         uuid not null references public.households(id) on delete cascade,
  matched_player_id    uuid references public.players(id) on delete set null,
  status               text not null default 'pending'
                         check (status in ('pending','approved','denied')),
  created_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  resolved_by          uuid references auth.users(id)
);

-- At most one OPEN request per (requester, household): re-requesting is a no-op.
create unique index if not exists household_join_requests_one_pending
  on public.household_join_requests (requesting_parent_id, household_id)
  where status = 'pending';

create index if not exists household_join_requests_household_idx
  on public.household_join_requests (household_id)
  where status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS — reads only; all writes go through the SECURITY DEFINER RPCs below
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.household_join_requests enable row level security;

create policy household_join_requests_admin_all
  on public.household_join_requests for all
  using (is_admin())
  with check (is_admin());

create policy household_join_requests_requester_select
  on public.household_join_requests for select
  using (requesting_parent_id = auth.uid());

-- The household primary can see requests for THEIR household.
-- (Authority = households.primary_parent_id. To use the per-kid "first to add
--  the kid" instead, swap this for a join to parent_players on matched_player_id
--  AND is_primary = true -- see the matching note in resolve_household_join.)
create policy household_join_requests_primary_select
  on public.household_join_requests for select
  using (exists (
    select 1 from public.households h
    where h.id = household_join_requests.household_id
      and h.primary_parent_id = auth.uid()
  ));

grant select on public.household_join_requests to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Detection RPC — runs BEFORE inserting a player, in registration & saveChild.
--    SECURITY DEFINER because players RLS hides other households from the caller,
--    so a client-side query would falsely report "no match".
--    Returns ONLY routing handles (household_id + matched_player_id) -- never
--    names or contact info, per the "don't expose co-parent identity" rule.
--    The player id is an opaque uuid the caller can't read directly; it lets the
--    PRIMARY (who can read their own household's players) and the notification
--    email name the kid being requested. Returns zero rows when no match.
--    GRANTED TO authenticated ONLY -- do NOT grant to anon (no existence oracle);
--    call this after sign-up, while authenticated.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.find_matching_player(
  p_first text,
  p_last text,
  p_grad_year integer
)
returns table(match_found boolean, household_id uuid, matched_player_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select true, pp.household_id, pl.id
  from public.players pl
  join public.parent_players pp
    on pp.player_id = pl.id and pp.is_primary = true
  where lower(trim(pl.first)) = lower(trim(p_first))
    and lower(trim(pl.last))  = lower(trim(p_last))
    and pl.grad_year is not distinct from p_grad_year
    and pl.active = true
    and pp.household_id is not null
    and pp.household_id is distinct from public.current_user_household_id()
    and not exists (
      select 1 from public.parent_players me
      where me.player_id = pl.id and me.parent_id = auth.uid()
    )
  limit 1;
$function$;

grant execute on function public.find_matching_player(text, text, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Request RPC — the second parent asks to join the matched household.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.request_household_join(
  p_household_id uuid,
  p_matched_player_id uuid
)
returns table(success boolean, error_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return query select false, 'not_authenticated'::text; return;
  end if;

  if not exists (select 1 from public.households where id = p_household_id) then
    return query select false, 'household_missing'::text; return;
  end if;

  if exists (
    select 1 from public.parent_players
    where parent_id = v_uid and household_id = p_household_id
  ) then
    return query select false, 'already_member'::text; return;
  end if;

  insert into public.household_join_requests
    (requesting_parent_id, household_id, matched_player_id, status)
  values
    (v_uid, p_household_id, p_matched_player_id, 'pending')
  on conflict (requesting_parent_id, household_id) where status = 'pending'
  do nothing;

  return query select true, null::text;
end;
$function$;

grant execute on function public.request_household_join(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Resolve RPC — the household primary approves or denies.
--    On approve, links the requester to EVERY player in the household, exactly
--    like consume_parent_invite (on conflict (parent_id, player_id) do nothing).
--    NOTE: approval grants household-wide access (all kids), because the model
--    has no per-kid scoping by design -- which is why the household OWNER is the
--    consent authority here.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.resolve_household_join(
  p_request_id uuid,
  p_approve boolean
)
returns table(success boolean, error_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_req public.household_join_requests%rowtype;
  v_is_primary boolean;
  v_player_ids uuid[];
begin
  select * into v_req
  from public.household_join_requests
  where id = p_request_id
  for update;

  if not found then
    return query select false, 'not_found'::text; return;
  end if;
  if v_req.status <> 'pending' then
    return query select false, 'already_resolved'::text; return;
  end if;

  -- Authorize: only the household's primary (or an admin) may resolve.
  -- (For per-kid "first to add the kid" instead, replace this with a check that
  --  v_uid owns the is_primary=true parent_players link for v_req.matched_player_id.)
  select (h.primary_parent_id = v_uid) into v_is_primary
  from public.households h
  where h.id = v_req.household_id;

  if not coalesce(v_is_primary, false) and not public.is_admin() then
    return query select false, 'not_authorized'::text; return;
  end if;

  if p_approve then
    select array_agg(distinct player_id) into v_player_ids
    from public.parent_players
    where household_id = v_req.household_id;

    if v_player_ids is not null and array_length(v_player_ids, 1) > 0 then
      insert into public.parent_players (parent_id, player_id, is_primary, household_id)
      select v_req.requesting_parent_id, pid, false, v_req.household_id
      from unnest(v_player_ids) as t(pid)
      on conflict (parent_id, player_id) do nothing;
    end if;

    update public.household_join_requests
      set status = 'approved', resolved_at = now(), resolved_by = v_uid
      where id = v_req.id;
  else
    update public.household_join_requests
      set status = 'denied', resolved_at = now(), resolved_by = v_uid
      where id = v_req.id;
  end if;

  return query select true, null::text;
end;
$function$;

grant execute on function public.resolve_household_join(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

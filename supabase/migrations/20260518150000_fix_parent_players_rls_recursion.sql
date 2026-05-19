-- Phase 4's RLS policies on parent_players and households included subqueries
-- that referenced parent_players from within parent_players' own policy
-- evaluation, producing infinite-recursion errors (Postgres code 42P17) on
-- every household-aware SELECT.
--
-- Break the loop with two SECURITY DEFINER helpers that read parent_players
-- without triggering RLS, then recreate the affected policies to call the
-- helpers instead of subquerying directly. Helpers are STABLE (idempotent
-- within a single query plan) so the planner can hoist the call.

create or replace function public.current_user_household_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select household_id
  from public.parent_players
  where parent_id = auth.uid()
    and household_id is not null
  limit 1
$$;

create or replace function public.is_parent_in_household(
  p_parent_id uuid,
  p_household_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.parent_players
    where parent_id = p_parent_id
      and household_id = p_household_id
  )
$$;

grant execute on function public.current_user_household_id() to authenticated;
grant execute on function public.is_parent_in_household(uuid, uuid) to authenticated;

-- Recreate parent_players_household_member_select without recursion.
drop policy if exists "parent_players_household_member_select" on public.parent_players;
create policy "parent_players_household_member_select"
  on public.parent_players for select
  using (
    household_id is not null
    and household_id = public.current_user_household_id()
  );

-- Recreate parent_players_household_member_fanout without recursion.
drop policy if exists "parent_players_household_member_fanout" on public.parent_players;
create policy "parent_players_household_member_fanout"
  on public.parent_players for insert
  with check (
    household_id is not null
    and parent_id <> auth.uid()
    and household_id = public.current_user_household_id()
    and public.is_parent_in_household(parent_id, household_id)
  );

-- Recreate households_member_select to avoid the cross-table subquery that
-- triggered parent_players' policy evaluation. The helper returns the
-- caller's household_id directly.
drop policy if exists "households_member_select" on public.households;
create policy "households_member_select"
  on public.households for select
  using (
    primary_parent_id = auth.uid()
    or id = public.current_user_household_id()
  );

notify pgrst, 'reload schema';

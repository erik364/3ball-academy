-- The players SELECT policy filters by players.parent_id = auth.uid(), so
-- non-primary household members linked via parent_players can't read the kid's
-- row. The UI then sees "No players added yet" even though the link exists.
--
-- Fix: replace the players SELECT policy with one that allows reads via either
-- the legacy primary parent_id OR the parent_players linkage. To avoid risk of
-- recursion through parent_players' own RLS, route the linkage check through a
-- SECURITY DEFINER helper that reads parent_players without triggering RLS.
--
-- Apply the same fix to tournament_payments_parent_select, which has the
-- identical antipattern (subquery checking players.parent_id = auth.uid()).

create or replace function public.current_user_player_ids()
returns uuid[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(pp.player_id), array[]::uuid[])
  from public.parent_players pp
  where pp.parent_id = auth.uid()
$$;

grant execute on function public.current_user_player_ids() to authenticated;

-- The legacy SELECT policy on players was Dashboard-applied and its name is
-- not known at migration time. Drop any existing SELECT policy on the table
-- whose USING clause references parent_id = auth.uid(), then add the new one.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'players'
      and cmd = 'SELECT'
  loop
    execute format('drop policy if exists %I on public.players', pol.policyname);
  end loop;
end $$;

create policy "players_household_or_primary_select"
  on public.players
  for select
  using (
    parent_id = auth.uid()
    or id = any(public.current_user_player_ids())
  );

-- tournament_payments has the same antipattern: its parent-select policy
-- subqueries players for parent_id = auth.uid(). Household members linked via
-- parent_players are locked out. Recreate it to mirror the players fix.
drop policy if exists "tournament_payments_parent_select" on public.tournament_payments;
create policy "tournament_payments_parent_select"
  on public.tournament_payments
  for select
  using (
    player_id = any(public.current_user_player_ids())
    or exists (
      select 1 from public.players p
      where p.id = tournament_payments.player_id
        and p.parent_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';

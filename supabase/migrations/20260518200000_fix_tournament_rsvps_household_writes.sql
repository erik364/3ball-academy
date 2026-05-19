-- tournament_rsvps INSERT/UPDATE/DELETE policies were Dashboard-applied and
-- subquery players.parent_id = auth.uid(), which blocks household members
-- linked only via parent_players. SELECT is already correct (is_active_user()).
--
-- Replace the three write policies with household-aware versions that allow:
--   1. Admins (is_admin())
--   2. Household members linked via parent_players (current_user_player_ids())
--   3. Legacy primary parents (players.parent_id = auth.uid())
--
-- Drop existing write policies defensively — exact names are not known at
-- migration time. Don't touch SELECT.

do $$
declare
  pol record;
begin
  for pol in
    select policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tournament_rsvps'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  loop
    execute format('drop policy if exists %I on public.tournament_rsvps', pol.policyname);
  end loop;
end $$;

create policy "tournament_rsvps_insert_household_or_primary"
  on public.tournament_rsvps
  for insert
  with check (
    public.is_admin()
    or player_id = any(public.current_user_player_ids())
    or exists (
      select 1 from public.players p
      where p.id = tournament_rsvps.player_id
        and p.parent_id = auth.uid()
    )
  );

create policy "tournament_rsvps_update_household_or_primary"
  on public.tournament_rsvps
  for update
  using (
    public.is_admin()
    or player_id = any(public.current_user_player_ids())
    or exists (
      select 1 from public.players p
      where p.id = tournament_rsvps.player_id
        and p.parent_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or player_id = any(public.current_user_player_ids())
    or exists (
      select 1 from public.players p
      where p.id = tournament_rsvps.player_id
        and p.parent_id = auth.uid()
    )
  );

create policy "tournament_rsvps_delete_household_or_primary"
  on public.tournament_rsvps
  for delete
  using (
    public.is_admin()
    or player_id = any(public.current_user_player_ids())
    or exists (
      select 1 from public.players p
      where p.id = tournament_rsvps.player_id
        and p.parent_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';

-- parent_players has had only admin-write and parent-self-select policies
-- since Phase 1, which silently blocked the registration flow's mirror
-- insert (it was tolerated as non-blocking, with players.parent_id fallback
-- carrying the load). Phase 4 needs writes to land cleanly so household
-- queries return correctly.
--
-- Two policies added:
--  1) Parents can insert their own linkage rows (parent_id = auth.uid()).
--  2) A household member can insert linkage rows for *other already-existing*
--     members of their household — used by the "add a new kid" fan-out so
--     all current members auto-gain access without admin intervention.
--
-- The second policy is the tightest correct version: caller must already be
-- a member of the target household, AND the target parent must already be a
-- member of that same household. Adding a stranger requires knowing their
-- uuid AND them being a household member already — both true → safe insert.

drop policy if exists "parent_players_self_insert" on public.parent_players;
create policy "parent_players_self_insert"
  on public.parent_players
  for insert
  with check (parent_id = auth.uid());

drop policy if exists "parent_players_household_member_fanout" on public.parent_players;
create policy "parent_players_household_member_fanout"
  on public.parent_players
  for insert
  with check (
    household_id is not null
    and parent_id <> auth.uid()
    and exists (
      select 1 from public.parent_players me
      where me.household_id = parent_players.household_id
        and me.parent_id = auth.uid()
    )
    and exists (
      select 1 from public.parent_players existing
      where existing.household_id = parent_players.household_id
        and existing.parent_id = parent_players.parent_id
    )
  );

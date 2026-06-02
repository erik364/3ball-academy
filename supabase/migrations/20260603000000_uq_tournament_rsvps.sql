-- Unique constraint on tournament_rsvps (tournament_id, player_id) so the
-- admin RSVP controls (and any other write path) can use idempotent upserts
-- with onConflict='tournament_id,player_id' instead of the select-then-
-- update-or-insert dance that the parent-side flow uses today.
--
-- `if not exists` makes this safe to apply against a DB that already has
-- the constraint (in case Dashboard quietly added one).

create unique index if not exists uq_tournament_rsvps_tournament_player
  on public.tournament_rsvps (tournament_id, player_id);

notify pgrst, 'reload schema';

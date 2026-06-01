-- Prevent duplicate player rows under the same parent. A player's identity is
-- (parent_id, first, last, grad_year); siblings differ by `first` so they
-- remain distinct. NULLS NOT DISTINCT collapses NULL grad_year duplicates too
-- (a parent registering two un-classed kids with the same name would still be
-- caught — vanishingly rare but cheap to cover).
--
-- The application also guards with an in-flight submission flag and an
-- idempotent upsert (onConflict: parent_id,first,last,grad_year,
-- ignoreDuplicates: true). This index is the backstop and the conflict target.
--
-- Already applied directly in production; this file makes the schema
-- reproducible from migrations alone.

create unique index if not exists uq_players_signup
  on public.players (parent_id, first, last, grad_year) nulls not distinct;

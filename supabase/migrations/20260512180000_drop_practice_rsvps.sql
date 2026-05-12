-- Practice RSVP was friction; check-in is the real attendance signal.
-- Clean break: drop the table, its FKs, RLS policies, indexes. UI and
-- client-side state shape change in companion commits.
drop table if exists public.practice_rsvps cascade;

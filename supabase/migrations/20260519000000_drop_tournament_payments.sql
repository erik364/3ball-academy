-- Tournament fee payment tracking is out of scope for v1. Drop the table
-- entirely; cascade removes its indexes, RLS policies, and the
-- (tournament_payments_parent_select) policy recreated in
-- 20260518180000_fix_players_rls_household_access.sql. No other table FKs
-- back to tournament_payments, so cascade is safe.

drop table if exists public.tournament_payments cascade;

notify pgrst, 'reload schema';

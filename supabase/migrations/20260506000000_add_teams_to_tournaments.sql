-- Add teams array column to tournaments
alter table public.tournaments
  add column if not exists teams text[] default '{}'::text[];

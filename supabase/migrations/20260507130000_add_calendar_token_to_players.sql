-- Per-kid calendar subscription tokens. Parents get one Subscribe URL per
-- player so each kid is its own calendar in the parent's calendar app
-- (separate colors, toggleable, shareable). Coach/admin tokens stay on
-- calendar_tokens (created in 20260507120000_add_calendar_tokens.sql);
-- the Edge Function tries players first, then calendar_tokens.
alter table public.players
  add column if not exists calendar_token uuid unique not null default gen_random_uuid();

create index if not exists players_calendar_token_idx on public.players(calendar_token);

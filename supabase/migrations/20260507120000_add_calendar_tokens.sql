-- Per-user calendar subscription tokens. The token in a feed URL is the only
-- auth — keep it out of the regular parents/coaches payloads.

create table if not exists public.calendar_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid unique not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists calendar_tokens_token_idx on public.calendar_tokens(token);

-- Backfill: every existing parent and coach gets a token row.
insert into public.calendar_tokens (user_id)
select id from public.parents
on conflict (user_id) do nothing;

insert into public.calendar_tokens (user_id)
select id from public.coaches
on conflict (user_id) do nothing;

-- RLS: a user can read and create their own token row. The Edge Function
-- bypasses RLS via ADMIN_API_KEY when looking up by token.
alter table public.calendar_tokens enable row level security;

drop policy if exists "calendar_tokens_select_own" on public.calendar_tokens;
create policy "calendar_tokens_select_own" on public.calendar_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "calendar_tokens_insert_own" on public.calendar_tokens;
create policy "calendar_tokens_insert_own" on public.calendar_tokens
  for insert with check (auth.uid() = user_id);

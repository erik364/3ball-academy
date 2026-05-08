-- Tournament fee payment tracking. Per-player-per-tournament toggle.
-- Fee amount itself stays in tournaments.notes (free-text). This table only
-- records who has paid. confirmation_sent_at is the audit gate that prevents
-- the parent from getting a second confirmation email on un-mark/re-mark.

create table public.tournament_payments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  is_paid boolean not null default false,
  paid_at timestamptz,
  confirmation_sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tournament_id, player_id)
);

create index tournament_payments_tournament_idx on public.tournament_payments(tournament_id);
create index tournament_payments_player_idx on public.tournament_payments(player_id);

alter table public.tournament_payments enable row level security;

-- Admins (coaches.is_admin = true) have full read/write access.
drop policy if exists "tournament_payments_admin_all" on public.tournament_payments;
create policy "tournament_payments_admin_all"
  on public.tournament_payments
  for all
  using (
    exists (
      select 1 from public.coaches c
      where c.id = auth.uid() and c.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.coaches c
      where c.id = auth.uid() and c.is_admin = true
    )
  );

-- Parents can read rows for their own kids only.
drop policy if exists "tournament_payments_parent_select" on public.tournament_payments;
create policy "tournament_payments_parent_select"
  on public.tournament_payments
  for select
  using (
    exists (
      select 1 from public.players p
      where p.id = tournament_payments.player_id
        and p.parent_id = auth.uid()
    )
  );

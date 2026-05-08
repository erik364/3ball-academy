-- Replace the hardcoded ['T','C','B','G','O','3BHS','3BGals'] array with a
-- DB-backed groups table. Existing data references stay as text[] / text
-- columns of short_code strings — this table is a registry that backs the
-- pickers and lets admin add / rename / archive / delete groups.

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  short_code text unique not null,
  name text not null,
  display_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index groups_display_order_idx on public.groups(display_order);

-- Seed the existing seven groups, preserving short_codes so existing rows
-- in coaches.teams[], players.team, practices.groups[], tournaments.teams[]
-- continue to resolve. name == short_code for the seeded rows; admin can
-- rename via the CRUD UI.
insert into public.groups (short_code, name, display_order) values
  ('T',       'T',       1),
  ('C',       'C',       2),
  ('B',       'B',       3),
  ('G',       'G',       4),
  ('O',       'O',       5),
  ('3BHS',    '3BHS',    6),
  ('3BGals',  '3BGals',  7)
on conflict (short_code) do nothing;

-- RLS: anyone signed in reads; only admins write.
alter table public.groups enable row level security;

drop policy if exists "groups_select_authenticated" on public.groups;
create policy "groups_select_authenticated"
  on public.groups
  for select
  using (auth.uid() is not null);

drop policy if exists "groups_admin_write" on public.groups;
create policy "groups_admin_write"
  on public.groups
  for all
  using (
    exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true)
  )
  with check (
    exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true)
  );

-- Count how many existing rows reference a given short_code. Drives the
-- delete-vs-archive decision in the admin CRUD UI.
create or replace function public.group_reference_count(code text)
returns int
language sql
security definer
set search_path = public
as $$
  select
    (select count(*) from public.coaches c where code = ANY(c.teams))::int +
    (select count(*) from public.players p where p.team = code)::int +
    (select count(*) from public.practices pr where code = ANY(pr.groups))::int +
    (select count(*) from public.tournaments t where code = ANY(t.teams))::int
$$;

-- Atomic rename: update groups.short_code AND propagate the change across
-- every column that stores short_codes. SECURITY DEFINER + manual admin
-- check so the function bypasses RLS but still gates on caller role.
create or replace function public.rename_group_code(old_code text, new_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if old_code is null or new_code is null or old_code = '' or new_code = '' then
    raise exception 'old_code and new_code are required';
  end if;
  if old_code = new_code then
    return;
  end if;
  if not exists (select 1 from public.coaches c where c.id = auth.uid() and c.is_admin = true) then
    raise exception 'Only admins can rename group codes';
  end if;
  if exists (select 1 from public.groups where short_code = new_code) then
    raise exception 'short_code already in use: %', new_code;
  end if;

  update public.groups set short_code = new_code, updated_at = now() where short_code = old_code;
  update public.coaches set teams = array_replace(teams, old_code, new_code) where old_code = ANY(teams);
  update public.players set team = new_code where team = old_code;
  update public.practices set groups = array_replace(groups, old_code, new_code) where old_code = ANY(groups);
  update public.tournaments set teams = array_replace(teams, old_code, new_code) where old_code = ANY(teams);
end;
$$;

grant execute on function public.group_reference_count(text) to authenticated;
grant execute on function public.rename_group_code(text, text) to authenticated;

-- Weekly recurring practices: link series occurrences via series_id,
-- and mark individually-edited rows so series-level edits skip them.
alter table public.practices
  add column if not exists series_id uuid,
  add column if not exists is_series_exception boolean not null default false;

create index if not exists practices_series_id_idx on public.practices(series_id);

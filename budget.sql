-- Our Money database table.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

-- One row per person. The whole budget (income, bills, spending money,
-- one-offs and salary settings) is stored as one JSON document.
create table public.budgets (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Each signed-in person can only see and change their own budget.
alter table public.budgets enable row level security;

create policy "own budget" on public.budgets
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.budgets to authenticated;

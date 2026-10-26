-- Run once in Supabase → SQL Editor → New query → Run.
-- Separate table only for this prototype; nothing of the alley studio is touched.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  location   text not null default 'alley-1',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_location on public.push_subscriptions (location);

-- Locked: only the Edge Function (service role) can read/write it.
alter table public.push_subscriptions enable row level security;

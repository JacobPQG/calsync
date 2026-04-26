-- ─── CalSync Supabase Schema ─────────────────────────────────────────────────
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tables ────────────────────────────────────────────────────────────────────

-- users: one row per CalSync user persona.
-- `data` stores the full User object as JSON (name, color, createdAt).
-- `id` must equal the Supabase auth.uid() of the owning user so that the RLS
-- policy "auth.uid()::text = id" passes for writes.
create table if not exists public.users (
  id   text primary key,
  data jsonb not null
);

-- events: one row per CalEvent (including recurring events — each event has
-- one row; the recurrence rule is inside `data`).
-- `user_id` is redundant with data->>'userId' but kept as a real column so
-- RLS can use an index on it rather than parsing JSON on every row.
create table if not exists public.events (
  id      text primary key,
  user_id text not null,
  data    jsonb not null
);

create index if not exists events_user_id_idx on public.events (user_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Without RLS, anyone with the (public) anon key can read and overwrite all
-- data. With RLS, the database enforces ownership at the query level.

alter table public.users  enable row level security;
alter table public.events enable row level security;

-- Anyone (including unauthenticated visitors) can read all data.
-- This is intentional: the calendar is collaborative and shared by URL.
create policy "users: public read"
  on public.users for select
  to anon, authenticated
  using (true);

create policy "events: public read"
  on public.events for select
  to anon, authenticated
  using (true);

-- Authenticated users can only write (insert/update/delete) their own rows.
-- auth.uid() is the UUID assigned by Supabase Auth; it must match the row's
-- id / user_id column. The app sets these equal in createAuthUser().
create policy "users: own write"
  on public.users for all
  to authenticated
  using      (auth.uid()::text = id)
  with check (auth.uid()::text = id);

create policy "events: own write"
  on public.events for all
  to authenticated
  using      (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Adds the tables to Supabase's realtime publication so the app receives live
-- INSERT / UPDATE / DELETE events via the channel subscription in useStore.ts.
alter publication supabase_realtime add table public.users;
alter publication supabase_realtime add table public.events;

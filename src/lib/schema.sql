-- ─── CalSync Supabase Schema (v2 — private by default) ──────────────────────
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: statements use IF NOT EXISTS / OR REPLACE, and old v1
-- policies are dropped explicitly before the v2 policies are created.
--
-- REQUIRED AUTH SETTINGS (Dashboard → Authentication → Sign In / Up):
--   • "Confirm email" must be DISABLED. Accounts use synthetic addresses
--     (<username>@<VITE_ACCOUNT_DOMAIN>) that cannot receive mail.
--
-- PRIVACY MODEL
--   • Nothing is publicly readable. Anonymous visitors see no rows at all.
--   • A user always sees their own events.
--   • A user sees someone else's events ONLY if that person created a row in
--     `shares` granting them access — sharing is explicit and per-person.
--   • New accounts start with approved = false. Until the admin flips the flag
--     (Table Editor → users → approved), RLS blocks every read of other
--     people's data and every write.
--
-- ADMIN WORKFLOW (all via the Supabase Dashboard, using your service role —
-- never ship the service key to the client):
--   1. Create an invite code for a person you trust:
--        insert into public.invite_codes (code) values ('<long-random-string>');
--      Use 16+ random characters (e.g. a password-generator string).
--   2. Give them the code out-of-band. They sign up in the app with it.
--   3. Verify the new row in `users` (username + invite_code tell you who it
--      is), then set approved = true. Until then the account can log in but
--      can neither publish nor read anything.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tables ────────────────────────────────────────────────────────────────────

-- users: one row per account. `data` holds the UI profile (name, color,
-- createdAt) as JSON. `id` equals auth.uid() so RLS ownership checks work.
create table if not exists public.users (
  id   text primary key,
  data jsonb not null
);

-- v2 columns (added idempotently for existing deployments)
alter table public.users add column if not exists username    text unique;
alter table public.users add column if not exists approved    boolean not null default false;
alter table public.users add column if not exists invite_code text;

-- events: one row per CalEvent; recurrence rule lives inside `data`.
-- `user_id` mirrors data->>'userId' so RLS can use an indexed column.
create table if not exists public.events (
  id      text primary key,
  user_id text not null,
  data    jsonb not null
);

create index if not exists events_user_id_idx on public.events (user_id);

-- shares: explicit calendar grants. A row (owner, grantee) means the grantee
-- may READ the owner's events. No row → no visibility. Owner-managed.
create table if not exists public.shares (
  owner_id   text not null,
  grantee_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, grantee_id)
);

-- invite_codes: admin-issued signup codes. No RLS policies are defined for
-- clients — the table is reachable only through the SECURITY DEFINER
-- functions below, so codes can never be listed or enumerated in bulk.
create table if not exists public.invite_codes (
  code       text primary key,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  used_by    text,
  used_at    timestamptz
);

-- ── Helper: is the calling user an approved account? ─────────────────────────
-- SECURITY DEFINER lets policies consult `users` without tripping the RLS on
-- `users` itself (which would recurse).
create or replace function public.is_approved()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select approved from public.users where id = auth.uid()::text),
    false
  );
$$;

-- ── Invite-code functions ─────────────────────────────────────────────────────
-- validate_invite: pre-signup check so the UI can reject a bad code before
-- creating an auth user. Returns only true/false — it never leaks code rows.
create or replace function public.validate_invite(invite text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.invite_codes
    where code = invite and active and used_by is null
  );
$$;

-- redeem_invite: called once right after signup. Atomically marks the code as
-- used by the calling account and stamps the code onto the caller's profile
-- (server-side, so the client cannot fake which code it used).
create or replace function public.redeem_invite(invite text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  redeemed boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.invite_codes
     set used_by = auth.uid()::text, used_at = now()
   where code = invite and active and used_by is null
   returning true into redeemed;

  if redeemed is null then
    return false;
  end if;

  update public.users
     set invite_code = invite
   where id = auth.uid()::text;

  return true;
end;
$$;

grant execute on function public.validate_invite(text) to anon, authenticated;
grant execute on function public.redeem_invite(text)  to authenticated;
grant execute on function public.is_approved()        to authenticated;

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table public.users        enable row level security;
alter table public.events       enable row level security;
alter table public.shares       enable row level security;
alter table public.invite_codes enable row level security;
-- invite_codes: RLS on + zero policies = clients can never touch it directly.

-- Drop v1 policies (public read / plain own-write) if they exist.
drop policy if exists "users: public read"  on public.users;
drop policy if exists "events: public read" on public.events;
drop policy if exists "users: own write"    on public.users;
drop policy if exists "events: own write"   on public.events;

-- users: you can always read your own row (to see your approval status);
-- approved accounts can read everyone's profile (names/colors for the UI).
-- Availability lives in `events`, not here, so this leaks no schedule data.
create policy "users: read own or approved"
  on public.users for select
  to authenticated
  using (id = auth.uid()::text or public.is_approved());

-- users: create exactly your own profile row. `approved` cannot be set on the
-- way in: column-level grants below only expose id/data/username to clients.
create policy "users: insert self"
  on public.users for insert
  to authenticated
  with check (id = auth.uid()::text);

create policy "users: update self"
  on public.users for update
  to authenticated
  using      (id = auth.uid()::text)
  with check (id = auth.uid()::text);

-- Column-level privileges: clients may never write approved / invite_code.
-- (The service role and SECURITY DEFINER functions are unaffected.)
-- `id` stays in the update grant because PostgREST upserts SET every supplied
-- column (including the PK); the RLS with-check still pins id to auth.uid().
revoke insert, update on public.users from anon, authenticated;
grant  insert (id, data, username) on public.users to authenticated;
grant  update (id, data)           on public.users to authenticated;

-- events: readable by the owner, or by an approved account the owner has
-- explicitly shared with. No public/anon read at all.
create policy "events: read own or shared"
  on public.events for select
  to authenticated
  using (
    user_id = auth.uid()::text
    or (
      public.is_approved()
      and exists (
        select 1 from public.shares s
        where s.owner_id = user_id
          and s.grantee_id = auth.uid()::text
      )
    )
  );

-- events: only approved accounts may write, and only their own rows.
create policy "events: own write"
  on public.events for all
  to authenticated
  using      (user_id = auth.uid()::text and public.is_approved())
  with check (user_id = auth.uid()::text and public.is_approved());

-- shares: owners manage their own grants; grantees can see grants that
-- point at them (so the UI can say "shared with you").
create policy "shares: owner manages"
  on public.shares for all
  to authenticated
  using      (owner_id = auth.uid()::text and public.is_approved())
  with check (owner_id = auth.uid()::text and public.is_approved());

create policy "shares: grantee reads"
  on public.shares for select
  to authenticated
  using (grantee_id = auth.uid()::text);

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Postgres-changes subscriptions respect RLS, so a client only receives
-- realtime rows it is allowed to SELECT. Re-running these lines errors if the
-- tables are already in the publication — ignore that error, it's idempotent
-- in effect.
alter publication supabase_realtime add table public.users;
alter publication supabase_realtime add table public.events;

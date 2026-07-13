-- ─── CalSync Supabase Schema (v6 — multi-calendar) ───────────────────────────
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- ⚠ THIS IS A BREAKING SCHEMA CHANGE (ADR-12). v5 had ONE global calendar; v6
-- makes calendars first-class. `shares` is DROPPED — membership replaces it —
-- and `events` gains a NOT NULL `calendar_id`, so any v5 events would be
-- orphaned. This script therefore assumes an EMPTY / test-only database, which
-- is what it was written against. If you have real v5 data, do not run this:
-- you need a backfill (create a calendar per user, move their events into it)
-- before the NOT NULL can be added.
--
-- REQUIRED AUTH SETTINGS (Dashboard → Authentication → Sign In / Up):
--   • "Confirm email" must be DISABLED. Accounts use synthetic addresses
--     (<username>@<VITE_ACCOUNT_DOMAIN>) that cannot receive mail.
--
-- ── THE MODEL ────────────────────────────────────────────────────────────────
--
--   SITE            An account exists only by redeeming a site invite, and is
--                   inert until a site admin approves it (users.approved). This
--                   is unchanged from v5: it is the closed-community gate, and
--                   it governs whether you may use the app AT ALL.
--
--   CALENDAR        Any approved account may create calendars. The creator is
--                   the OWNER, which *is* the admin role — there is no separate
--                   per-calendar admin flag to get out of sync with ownership.
--
--   MEMBERSHIP      calendar_members(calendar_id, user_id, status). Membership
--                   is the sharing grant: it is what lets you see other people's
--                   events in that calendar. A member is 'pending' until the
--                   calendar's owner approves them — the confirmation step, and
--                   the point at which the seat cap bites.
--
--   SEAT CAP        calendars.max_members. Enforced in approve_member(), server
--                   side: approving past the cap raises. Minting more invites
--                   than seats is allowed on purpose (invites go unused, get
--                   rejected, expire) — the cap is on who actually gets IN.
--
-- Two gates therefore stand between a stranger and your events, and they are
-- independent: site approval says "you may use this app", calendar membership
-- says "…and you may see this calendar".
--
-- ── PRIVACY MODEL ────────────────────────────────────────────────────────────
--   • Nothing is publicly readable. Anonymous visitors see no rows at all.
--   • A user always sees their own events.
--   • A user sees someone else's event ONLY if both are approved members of the
--     calendar that event belongs to.
--   • AND, within that calendar, only the events they're permitted to see:
--       – 'public'    → always visible to fellow members.
--       – 'anonymous' → (the default) visible only once a DIFFERENT member has an
--                       event IN THE SAME CALENDAR on the same date whose hours
--                       overlap it.
--     Unmatched anonymous events are never sent to the client at all. This is
--     enforced here, in RLS — not in the browser. See ADR-7 / ADR-8 / ADR-12.
--
--   Note the coincidence search is now scoped to the calendar. In v5 it ranged
--   over the share graph; here, an event in calendar A can never be unlocked by
--   an event in calendar B, even between the same two people. Calendars are the
--   privacy boundary, so a coincidence that crosses one would be a leak.
--
-- KNOWN LIMIT — manufactured coincidences (unchanged from v5, ADR-8).
--   A fellow member can still force a reveal by genuinely creating a wide event
--   (00:00–24:00) that overlaps everything you have that day. The generated
--   columns below stop them LYING about their hours; they cannot stop them
--   CHOOSING those hours. Inherent to any reveal-on-overlap rule. Mitigations if
--   it ever matters: cap event duration, rate-limit events per user per day,
--   require the matching event to predate the one it reveals. Not implemented.
--   v6 narrows the blast radius, though: the attacker must be an approved member
--   of the calendar in question, not merely someone you shared with.
--
-- ADMIN WORKFLOW
--   ONE-TIME (site admin, in the Dashboard — neither is_admin nor approved is
--   client-writable, so neither can be self-granted):
--        update public.users
--           set is_admin = true, approved = true
--         where username = '<you>';
--
--   `approved` matters as much as `is_admin` here: accounts default to
--   approved = false, and is_approved() gates create_calendar and every RLS
--   read policy. An admin who is not also approved can mint invites and
--   nothing else — not even create their own calendar.
--
--   Site admins mint SITE invites (mint_invite) — these create accounts.
--   Calendar OWNERS mint CALENDAR invites (mint_calendar_invites) — these create
--   an account if the scanner has none, and join them to that calendar, in one
--   scan. Owners need no site-admin rights to do this: owning the calendar is
--   the authority. See ADR-12.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ═══ Tables ═══════════════════════════════════════════════════════════════════

-- users: one row per account. `data` holds the UI profile (name, color, avatar,
-- createdAt) as JSON. `id` equals auth.uid() so RLS ownership checks work.
create table if not exists public.users (
  id   text primary key,
  data jsonb not null
);

alter table public.users add column if not exists username    text unique;
alter table public.users add column if not exists approved    boolean not null default false;
alter table public.users add column if not exists invite_code text;
alter table public.users add column if not exists is_admin    boolean not null default false;

-- calendars: the unit of ownership, membership, and privacy.
--
-- owner_id IS the admin role. Deliberately not a separate is_admin column on
-- calendar_members: a nullable/duplicable admin flag can drift out of agreement
-- with ownership (owner rows missing, two admins, an admin who is not a member),
-- and every one of those states is a security question with no obvious answer.
-- One owner, named on the calendar, cannot drift.
create table if not exists public.calendars (
  id          text primary key,
  name        text not null,
  owner_id    text not null references public.users(id) on delete cascade,
  -- Seat cap. Counts APPROVED members, owner included. NULL = no limit, which
  -- must be chosen explicitly; the app offers a number by default.
  max_members integer,
  created_at  timestamptz not null default now(),

  constraint calendars_name_len  check (length(btrim(name)) between 1 and 60),
  constraint calendars_cap_sane  check (max_members is null or max_members between 1 and 500)
);

create index if not exists calendars_owner_idx on public.calendars (owner_id);

-- calendar_members: who is in a calendar, and whether the owner has confirmed it.
--
--   'pending'  — they claimed an invite; the account/join exists but grants
--                nothing. RLS never returns another member's events to them.
--   'approved' — confirmed by the owner. This is the sharing grant.
--
-- The owner is inserted as an approved member of their own calendar at creation
-- (see create_calendar), so "is a member" needs no special case for the owner
-- anywhere in the policies below.
create table if not exists public.calendar_members (
  calendar_id text not null references public.calendars(id) on delete cascade,
  user_id     text not null references public.users(id)     on delete cascade,
  status      text not null default 'pending',
  invited_as  text,                                   -- the name the owner typed
  joined_at   timestamptz not null default now(),
  primary key (calendar_id, user_id),

  constraint calendar_members_status check (status in ('pending', 'approved'))
);

create index if not exists calendar_members_user_idx
  on public.calendar_members (user_id, status);

-- events: one row per CalEvent; recurrence lives inside `data`.
-- `user_id` and `calendar_id` mirror the JSON so RLS can use indexed columns.
create table if not exists public.events (
  id          text primary key,
  user_id     text not null,
  calendar_id text not null references public.calendars(id) on delete cascade,
  data        jsonb not null
);

-- Pre-existing v5 deployments have `events` without calendar_id. Adding it NOT
-- NULL would fail on any existing row, which is the intended alarm: see the
-- banner at the top of this file. On an empty table it is a no-op.
alter table public.events
  add column if not exists calendar_id text references public.calendars(id) on delete cascade;

-- Visibility columns. These are GENERATED ALWAYS from `data`, which is the crux
-- of the security model: the RLS policy below tests these columns, and a client
-- CANNOT set them independently of the event it is actually publishing. If they
-- were plain columns the client could claim startHour=0/endHour=24 while storing
-- something else in `data`, and manufacture coincidences at will.
--
-- Generated columns are STORED, so they are also indexable — the coincidence
-- policy does a self-join on (calendar, date, hours) and would be unusable
-- otherwise.
--
-- calendar_id is NOT generated: it is a real FK column, so the database can
-- enforce that the calendar exists and cascade its deletion. The write policy
-- below is what stops a client from putting an event in a calendar it may not
-- write to — a generated column could not consult `calendar_members`.
alter table public.events
  add column if not exists visibility text
    generated always as (coalesce(data->>'visibility', 'anonymous')) stored;

alter table public.events
  add column if not exists event_date text
    generated always as (data->>'date') stored;

-- Hours are numeric (0–24, half-hour steps). Cast defensively: a malformed
-- `data` payload yields NULL rather than breaking the insert, and NULL hours
-- simply never satisfy the overlap test (fails closed — the event stays hidden).
alter table public.events
  add column if not exists start_hour numeric
    generated always as (
      case when jsonb_typeof(data->'startHour') = 'number'
           then (data->>'startHour')::numeric end
    ) stored;

alter table public.events
  add column if not exists end_hour numeric
    generated always as (
      case when jsonb_typeof(data->'endHour') = 'number'
           then (data->>'endHour')::numeric end
    ) stored;

create index if not exists events_user_id_idx  on public.events (user_id);
create index if not exists events_calendar_idx on public.events (calendar_id);

-- Supports the coincidence self-join: other members' events in THIS calendar on
-- this date whose hours overlap. Calendar first (it partitions the table), then
-- date (highly selective), then the range bounds.
drop index if exists events_coincidence_idx;
create index if not exists events_coincidence_idx
  on public.events (calendar_id, event_date, start_hour, end_hour);

create index if not exists events_visibility_idx
  on public.events (visibility) where visibility = 'public';

-- invite_codes: signup/join codes. No RLS policies are defined for clients — the
-- table is reachable only through the SECURITY DEFINER functions below, so codes
-- can never be listed or enumerated in bulk.
--
-- A code is one of two kinds, and calendar_id is what distinguishes them:
--   calendar_id IS NULL     → SITE invite. Creates an account. Minted by a site
--                             admin. This is the v5 invite, unchanged.
--   calendar_id IS NOT NULL → CALENDAR invite. Creates an account if the scanner
--                             has none, AND joins them (pending) to that
--                             calendar. Minted by that calendar's owner.
create table if not exists public.invite_codes (
  code       text primary key,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  used_by    text,
  used_at    timestamptz
);

alter table public.invite_codes add column if not exists invitee_name text;
alter table public.invite_codes add column if not exists created_by   text;
alter table public.invite_codes add column if not exists expires_at   timestamptz;
alter table public.invite_codes add column if not exists calendar_id  text
  references public.calendars(id) on delete cascade;

create index if not exists invite_codes_calendar_idx
  on public.invite_codes (calendar_id);

-- ═══ Helper predicates ════════════════════════════════════════════════════════
-- All SECURITY DEFINER so policies can consult tables that are themselves under
-- RLS without recursing.

-- Is the caller an approved account? (Site gate.)
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

-- Is the caller a site administrator? (Mints SITE invites; nothing else.)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select is_admin from public.users where id = auth.uid()::text),
    false
  );
$$;

-- Does the caller OWN this calendar? This is the per-calendar admin check, and
-- it is the authority behind every owner-only function below.
create or replace function public.owns_calendar(cal_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.calendars c
     where c.id = cal_id
       and c.owner_id = auth.uid()::text
  );
$$;

-- Is the caller an APPROVED member of this calendar? The sharing grant.
-- The owner is an approved member of their own calendar (create_calendar inserts
-- the row), so this needs no owner special case.
create or replace function public.is_calendar_member(cal_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.calendar_members m
     where m.calendar_id = cal_id
       and m.user_id     = auth.uid()::text
       and m.status      = 'approved'
  );
$$;

-- Is a GIVEN user an approved member? (Same as above but for a third party —
-- used by the coincidence check, which must ask about the viewer, not the caller
-- context of a SECURITY DEFINER function.)
create or replace function public.user_is_member(cal_id text, uid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.calendar_members m
     where m.calendar_id = cal_id
       and m.user_id     = uid
       and m.status      = 'approved'
  );
$$;

-- How many approved members does this calendar have? (Seat-cap arithmetic.)
create or replace function public.calendar_member_count(cal_id text)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
    from public.calendar_members m
   where m.calendar_id = cal_id
     and m.status      = 'approved';
$$;

-- May this invite code still make an account / join? One predicate, one
-- definition, so the call sites (lookup / validate / redeem) cannot drift apart
-- — which is precisely how an expired code ends up still redeemable in practice.
--
-- STABLE, not IMMUTABLE: it reads now(). Marking a time-dependent predicate
-- immutable invites the planner to fold it to a constant, and an expired code
-- would go on testing as live.
create or replace function public.invite_is_live(c public.invite_codes)
returns boolean
language sql
stable
as $$
  select c.active
     and c.used_by is null
     and (c.expires_at is null or c.expires_at > now());
$$;

-- Shared lifetime → expiry conversion, so the site and calendar minters cannot
-- disagree about what "72" means or which bounds are legal.
--
-- NULL means "never expires" — a deliberate opt-out, not a default: it must be
-- asked for explicitly. A non-positive lifetime would mint a code that is dead on
-- arrival; a wild one is almost certainly a client bug. Reject both.
--
-- VOLATILE (the default), not IMMUTABLE: it reads now(). Same trap as
-- invite_is_live above — an immutable now() is a constant, and a constant expiry
-- is not an expiry.
create or replace function public.invite_expiry(lifetime_hours integer)
returns timestamptz
language plpgsql
as $$
begin
  if lifetime_hours is null then
    return null;
  end if;
  if lifetime_hours <= 0 then
    raise exception 'invite lifetime must be positive';
  end if;
  if lifetime_hours > 8760 then   -- one year
    raise exception 'invite lifetime may not exceed one year';
  end if;
  return now() + make_interval(hours => lifetime_hours);
end;
$$;

-- ═══ Event coincidence (the anonymous-event rule) ═════════════════════════════
-- An anonymous event is released to a viewer only once a DIFFERENT member has an
-- event, IN THE SAME CALENDAR, on the same date, whose hours overlap it.
--
-- SECURITY DEFINER is required, not incidental: the events policy calls this
-- while deciding whether a row is selectable, so the lookup inside must bypass
-- RLS on `events` — otherwise evaluating row A would require selecting row B,
-- which would require evaluating row B, and Postgres would recurse. It returns a
-- bare boolean and never emits the matching row.
--
-- BUT security definer means this query sees EVERY event in the table, so it must
-- re-impose the membership boundary itself. `viewer_id`: a candidate match only
-- counts if the VIEWER is entitled to it too (it's theirs, or they are an
-- approved member of its calendar — which, since we also require the match to be
-- in the same calendar as the subject event, they necessarily are). Without the
-- check the function is a global oracle wearing a policy's clothes.
--
-- v6: the match must be in the SAME CALENDAR. Calendars are the privacy
-- boundary; an event in calendar A being unlocked by one in calendar B — even
-- between the same two people — would leak across it.
--
-- Overlap is half-open (a.start < b.end and b.start < a.end): back-to-back 9–11
-- and 11–13 do NOT coincide. This mirrors hoursOverlap() in engine/visibility.ts
-- exactly — the two definitions must stay in lockstep.
--
-- Matching is on the event's base `date` only; recurrence is NOT expanded here.
-- Expanding RRULEs inside a row-security predicate would be unindexable and slow.
-- Consequence: a recurring event is released by a coincidence on its FIRST
-- occurrence. See ADR-8.

-- Drop the v3/v5 signatures. A different signature is a different function, so
-- `create or replace` would NOT replace them — they would sit there alongside,
-- still granted, still answering "does anyone have an event in this window?".
-- Must be dropped, not shadowed.
drop function if exists
  public.event_has_coincidence(text, text, numeric, numeric);
drop function if exists
  public.event_has_coincidence(text, text, text, numeric, numeric);

create or replace function public.event_has_coincidence(
  viewer_id  text,
  cal_id     text,
  ev_user_id text,
  ev_date    text,
  ev_start   numeric,
  ev_end     numeric
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.events o
     where o.calendar_id = cal_id        -- same calendar: the privacy boundary
       and o.user_id    <> ev_user_id    -- must be a DIFFERENT person
       and o.event_date  = ev_date
       and o.start_hour  < ev_end        -- half-open overlap
       and ev_start      < o.end_hour
       -- …and the viewer must be entitled to the matching event as well.
       and (
         o.user_id = viewer_id
         or public.user_is_member(cal_id, viewer_id)
       )
  );
$$;

-- ── The de-identified "someone is here" hint ─────────────────────────────────
-- RLS withholds unmatched anonymous events, so the client cannot count them — it
-- never receives them. But the UI still wants the hint ("someone has something
-- on this day"), which is the whole point of anonymous events being discoverable
-- at all (ADR-7).
--
-- So the server counts them and returns ONLY a number per date. No user id, no
-- title, no hour. A count is the most that can be disclosed while the event stays
-- anonymous.
--
-- v6: scoped to ONE calendar — the one the viewer is looking at — and only if
-- they are an approved member of it.
--
-- The 2-arg v5 signature must be dropped: `create or replace` cannot change a
-- function's signature, so the old global-scope version would survive and go on
-- counting across every calendar.
drop function if exists public.hidden_event_counts(text, text);

create or replace function public.hidden_event_counts(
  cal_id    text,
  from_date text,
  to_date   text
)
returns table (event_date text, hidden_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select e.event_date, count(*)::bigint
    from public.events e
   where auth.uid() is not null
     and public.is_approved()
     and public.is_calendar_member(cal_id)      -- members only, full stop
     and e.calendar_id = cal_id
     and e.event_date between from_date and to_date
     and e.user_id <> auth.uid()::text          -- never count your own
     and e.visibility = 'anonymous'
     -- …and only the ones I'm NOT already allowed to see (an event that
     -- coincides is already in my result set; counting it would double-report).
     and not public.event_has_coincidence(
           auth.uid()::text, e.calendar_id, e.user_id,
           e.event_date, e.start_hour, e.end_hour)
   group by e.event_date;
$$;

-- ═══ Calendars ════════════════════════════════════════════════════════════════

-- create_calendar: any APPROVED account may create one. The creator becomes the
-- owner and is inserted as an approved member in the same transaction, so a
-- calendar is never in the nonsense state of having an owner who is not a member.
--
-- Done as a function rather than a plain INSERT policy precisely because of that
-- second write: a client-side "insert calendar, then insert membership" is two
-- round trips that can half-fail, leaving a calendar its own owner cannot read.
create or replace function public.create_calendar(
  cal_id      text,
  cal_name    text,
  cap         integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   text := auth.uid()::text;
  clean text;
begin
  if uid is null or not public.is_approved() then
    raise exception 'your account is not approved yet';
  end if;

  clean := nullif(btrim(cal_name), '');
  if clean is null then
    raise exception 'a calendar name is required';
  end if;
  if length(clean) > 60 then
    raise exception 'that calendar name is too long';
  end if;

  -- A cap below 1 would be a calendar its own owner cannot be approved into.
  if cap is not null and (cap < 1 or cap > 500) then
    raise exception 'member limit must be between 1 and 500';
  end if;

  insert into public.calendars (id, name, owner_id, max_members)
  values (cal_id, clean, uid, cap);

  -- The owner is a member of their own calendar, approved, from the start.
  insert into public.calendar_members (calendar_id, user_id, status, invited_as)
  values (cal_id, uid, 'approved', null);

  return cal_id;
end;
$$;

-- update_calendar: owner-only settings. The cap may not be lowered below the
-- membership it already has — silently un-approving people to satisfy a new
-- number would be a surprising way to lose access to your own calendar.
create or replace function public.update_calendar(
  cal_id   text,
  cal_name text,
  cap      integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  clean   text;
  current integer;
begin
  if not public.owns_calendar(cal_id) then
    raise exception 'only the calendar owner may change its settings';
  end if;

  clean := nullif(btrim(cal_name), '');
  if clean is null then
    raise exception 'a calendar name is required';
  end if;
  if length(clean) > 60 then
    raise exception 'that calendar name is too long';
  end if;

  if cap is not null then
    if cap < 1 or cap > 500 then
      raise exception 'member limit must be between 1 and 500';
    end if;
    current := public.calendar_member_count(cal_id);
    if cap < current then
      raise exception 'this calendar already has % members — the limit cannot be set below that', current;
    end if;
  end if;

  update public.calendars
     set name = clean, max_members = cap
   where id = cal_id;

  return found;
end;
$$;

-- delete_calendar: owner-only. Everything hanging off it — members, events,
-- invites — goes with it via ON DELETE CASCADE. That is deliberate and total:
-- there is no orphan state to reason about afterwards.
create or replace function public.delete_calendar(cal_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.owns_calendar(cal_id) then
    raise exception 'only the calendar owner may delete it';
  end if;

  delete from public.calendars where id = cal_id;
  return found;
end;
$$;

-- list_calendars: the home view. Every calendar the caller owns or is a member
-- of (pending included, so they can see they are waiting on someone), with the
-- counts the list needs — so the home screen is ONE round trip, not one per
-- calendar.
--
-- `pending_count` is only meaningful to an owner and is returned as 0 to anyone
-- else: how many people are queued at someone else's door is not a member's
-- business.
create or replace function public.list_calendars()
returns table (
  id            text,
  name          text,
  owner_id      text,
  owner_name    text,
  max_members   integer,
  member_count  integer,
  pending_count integer,
  my_status     text,          -- 'pending' | 'approved'
  is_owner      boolean,
  created_at    timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.id,
    c.name,
    c.owner_id,
    ou.data->>'name',
    c.max_members,
    public.calendar_member_count(c.id),
    case
      when c.owner_id = auth.uid()::text then (
        select count(*)::integer from public.calendar_members p
         where p.calendar_id = c.id and p.status = 'pending'
      )
      else 0
    end,
    m.status,
    (c.owner_id = auth.uid()::text),
    c.created_at
  from public.calendars c
  join public.calendar_members m
    on m.calendar_id = c.id
   and m.user_id     = auth.uid()::text
  left join public.users ou on ou.id = c.owner_id
  where auth.uid() is not null
    and public.is_approved()
  order by (c.owner_id = auth.uid()::text) desc, c.created_at desc;
$$;

-- list_members: the admin roster for one calendar. Owner-only — a plain member
-- has no need of the pending queue, nor of who else is waiting.
create or replace function public.list_members(cal_id text)
returns table (
  user_id     text,
  username    text,
  name        text,
  avatar      text,
  status      text,
  invited_as  text,
  joined_at   timestamptz,
  is_owner    boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.user_id,
    u.username,
    u.data->>'name',
    u.data->>'avatar',
    m.status,
    m.invited_as,
    m.joined_at,
    (m.user_id = c.owner_id)
  from public.calendar_members m
  join public.calendars c on c.id = m.calendar_id
  left join public.users  u on u.id = m.user_id
  where m.calendar_id = cal_id
    and public.owns_calendar(cal_id)
  order by (m.status = 'pending') desc, m.joined_at asc;
$$;

-- approve_member: THE confirmation step, and THE seat cap.
--
-- The cap is enforced here and nowhere else, and here is the right place: an
-- invite is not a seat (it may be ignored, rejected, or expire), a pending claim
-- is not a seat (same), but an approved member is. Counting anything earlier
-- would reserve seats for people who never arrive.
--
-- The count is re-read inside this function, under the caller's transaction, and
-- the row is locked — two owners' devices approving the last seat at the same
-- instant must not both succeed. (One owner, two tabs, is the realistic version.)
create or replace function public.approve_member(cal_id text, member_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cap     integer;
  current integer;
begin
  if not public.owns_calendar(cal_id) then
    raise exception 'only the calendar owner may approve members';
  end if;

  -- Lock the calendar row for the rest of this transaction. Without it, two
  -- concurrent approvals both read member_count = cap-1, both pass the check,
  -- and the calendar ends up one over its limit.
  select max_members into cap
    from public.calendars
   where id = cal_id
     for update;

  if not found then
    raise exception 'no such calendar';
  end if;

  -- Already approved → nothing to do, and crucially: do NOT let a repeat call
  -- consume a second seat.
  if exists (
    select 1 from public.calendar_members
     where calendar_id = cal_id and user_id = member_id and status = 'approved'
  ) then
    return true;
  end if;

  if cap is not null then
    current := public.calendar_member_count(cal_id);
    if current >= cap then
      raise exception 'this calendar is full (% of % seats)', current, cap;
    end if;
  end if;

  update public.calendar_members
     set status = 'approved'
   where calendar_id = cal_id
     and user_id     = member_id;

  if not found then
    raise exception 'that person has not requested to join this calendar';
  end if;

  return true;
end;
$$;

-- reject_member: remove them from the calendar. Their ACCOUNT is untouched —
-- they may be a perfectly good member of other calendars, and site membership is
-- the site admin's business, not a calendar owner's.
--
-- `reopen` puts the invite they used back into play so the same QR can be
-- re-sent. Sharp edge: any photo of that code goes live again — which is why it
-- is opt-in, and why the panel asks.
create or replace function public.reject_member(
  cal_id    text,
  member_id text,
  reopen    boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed boolean;
begin
  if not public.owns_calendar(cal_id) then
    raise exception 'only the calendar owner may remove members';
  end if;

  -- The owner cannot be removed from their own calendar. It would leave a
  -- calendar whose admin cannot read it, recoverable only in the Dashboard.
  if member_id = (select owner_id from public.calendars where id = cal_id) then
    raise exception 'the owner cannot be removed from their own calendar';
  end if;

  delete from public.calendar_members
   where calendar_id = cal_id and user_id = member_id;
  removed := found;

  if reopen then
    update public.invite_codes
       set used_by = null,
           used_at = null,
           -- An expired code reopened is still expired, and would confuse the
           -- owner into thinking the re-send worked. Give it a fresh window.
           expires_at = case
             when expires_at is not null and expires_at <= now()
             then now() + interval '72 hours'
             else expires_at
           end
     where calendar_id = cal_id
       and used_by     = member_id;
  end if;

  return removed;
end;
$$;

-- leave_calendar: a member's own exit. Not the owner's — they must delete the
-- calendar instead, which is a decision with different consequences and so is a
-- different button.
--
-- Their events in that calendar go with them: an event is only ever meaningful
-- inside the calendar it belongs to, and leaving a calendar whose members can
-- still see your availability is not leaving.
create or replace function public.leave_calendar(cal_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text := auth.uid()::text;
begin
  if uid is null then
    return false;
  end if;

  if public.owns_calendar(cal_id) then
    raise exception 'you own this calendar — delete it instead of leaving it';
  end if;

  delete from public.events
   where calendar_id = cal_id and user_id = uid;

  delete from public.calendar_members
   where calendar_id = cal_id and user_id = uid;

  return found;
end;
$$;

-- ═══ Invites ══════════════════════════════════════════════════════════════════
--
-- Two kinds, one table, distinguished by calendar_id (see the table comment).
-- The one-shot rule is the same for both and is enforced in redeem_invite: the
-- UPDATE matches `used_by is null`, atomically, so two phones scanning the same
-- QR race and exactly one wins.

-- lookup_invite: what the claim screen calls on page load. Granted to `anon` on
-- purpose — the whole point is that a person with no session can open the link
-- and be greeted by name.
--
-- Returns NOTHING that isn't needed to render that screen. It never echoes the
-- code back and never reveals `used_by`: knowing an invite is spent must not tell
-- you which account spent it, or a QR photo becomes a user-enumeration primitive.
--
-- v6 adds the calendar's name, so a scanner can see what they are being invited
-- INTO before they commit. Disclosed only for a live invite, and it is the
-- intended payload — they are the person it names.
--
-- Order matters: 'claimed' is tested BEFORE 'expired'. A code that was claimed
-- and has since sailed past its expiry is still *claimed* — the account exists,
-- and the honest thing to show its owner is the sign-in prompt, not a dead end.
drop function if exists public.lookup_invite(text);

create or replace function public.lookup_invite(invite text)
returns table (
  status        text,
  invitee_name  text,
  calendar_id   text,
  calendar_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when c.code is null        then 'invalid'
      when not c.active          then 'invalid'
      when c.used_by is not null then 'claimed'
      when c.expires_at is not null and c.expires_at <= now() then 'expired'
      else 'open'
    end,
    -- Only ever disclose these for a live, claimable invite. An expired or
    -- revoked code tells you nothing about who it was for or where it led.
    case when public.invite_is_live(c) then c.invitee_name end,
    case when public.invite_is_live(c) then c.calendar_id  end,
    case when public.invite_is_live(c) then cal.name       end
  from (select invite as probe) p
  left join public.invite_codes c   on c.code = p.probe
  left join public.calendars    cal on cal.id = c.calendar_id;
$$;

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
    select 1 from public.invite_codes c
    where c.code = invite and public.invite_is_live(c)
  );
$$;

-- redeem_invite: called once, right after signup (or, for an existing account
-- scanning a calendar QR, on its own). Does three things atomically:
--
--   1. Burns the code. `used_by is null` inside invite_is_live is what makes two
--      simultaneous scans race with exactly one winner, and the expiry test rides
--      along in the same statement so a code cannot expire between check and use.
--   2. Stamps the code onto the caller's profile (server-side, so the client
--      cannot fake which code it used).
--   3. If it is a CALENDAR invite, joins the caller to that calendar as PENDING.
--      Not approved — the owner still has to confirm them. That is the whole
--      point of the confirmation step: a valid QR gets you to the door, not
--      through it.
--
-- Note it does NOT touch users.approved. A calendar invite cannot promote a
-- site-unapproved account into an approved one; the two gates stay independent.
create or replace function public.redeem_invite(invite text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      text := auth.uid()::text;
  cal      text;
  who      text;
  redeemed boolean;
begin
  if uid is null then
    return false;
  end if;

  update public.invite_codes c
     set used_by = uid, used_at = now()
   where c.code = invite and public.invite_is_live(c)
   returning c.calendar_id, c.invitee_name into cal, who;

  get diagnostics redeemed = row_count;
  if not redeemed then
    return false;
  end if;

  update public.users
     set invite_code = invite
   where id = uid;

  -- Calendar invite → pending membership. on conflict do nothing: an existing
  -- member re-scanning a fresh QR must not be knocked back to 'pending', which
  -- would silently revoke an approved member's access.
  if cal is not null then
    insert into public.calendar_members (calendar_id, user_id, status, invited_as)
    values (cal, uid, 'pending', who)
    on conflict (calendar_id, user_id) do nothing;
  end if;

  return true;
end;
$$;

-- mint_invite: SITE invite. Admin-only, creates accounts. Unchanged from v5
-- except that it now explicitly records calendar_id = NULL.
--
-- The code is generated SERVER-side — a client-chosen "random" code is only as
-- unguessable as the client felt like being. 24 hex chars ≈ 96 bits from
-- pgcrypto's CSPRNG.
drop function if exists public.mint_invite(text);
drop function if exists public.mint_invite(text, integer);

create or replace function public.mint_invite(
  invitee        text,
  lifetime_hours integer default 72
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  clean    text;
  expiry   timestamptz;
begin
  if not public.is_admin() then
    raise exception 'only an administrator may create invites';
  end if;

  expiry := public.invite_expiry(lifetime_hours);

  clean := nullif(btrim(invitee), '');
  if clean is null then
    raise exception 'an invitee name is required';
  end if;
  if length(clean) > 60 then
    raise exception 'invitee name is too long';
  end if;

  new_code := encode(gen_random_bytes(12), 'hex');

  insert into public.invite_codes (code, invitee_name, created_by, expires_at, calendar_id)
  values (new_code, clean, auth.uid()::text, expiry, null);

  return new_code;
end;
$$;

-- mint_calendar_invites: BULK, calendar-scoped, owner-only. The feature as asked
-- for: name the people you want, get one QR each, hand them out individually.
--
-- One code PER NAME — never one code for the group. A shared code is a bearer
-- token that admits whoever forwards it fastest, and the single-use rule would
-- then mean the second person is simply locked out with no explanation. Separate
-- codes also mean revoking one person's invite does not invalidate everyone
-- else's.
--
-- Bulk minting is deliberately NOT capped at the calendar's free seats: an
-- invite is not a seat (people ignore them, get rejected, let them expire). The
-- cap is enforced at approval, where a seat is actually taken. The panel does
-- warn the owner when they mint more than they have room for.
create or replace function public.mint_calendar_invites(
  cal_id         text,
  invitees       text[],
  lifetime_hours integer default 72
)
returns table (code text, invitee_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  expiry   timestamptz;
  raw      text;
  clean    text;
  new_code text;
begin
  if not public.owns_calendar(cal_id) then
    raise exception 'only the calendar owner may invite people to it';
  end if;

  if invitees is null or array_length(invitees, 1) is null then
    raise exception 'name at least one person to invite';
  end if;
  if array_length(invitees, 1) > 100 then
    raise exception 'you can mint at most 100 invites at once';
  end if;

  expiry := public.invite_expiry(lifetime_hours);

  foreach raw in array invitees loop
    clean := nullif(btrim(raw), '');
    if clean is null then
      raise exception 'an invitee name is required';
    end if;
    if length(clean) > 60 then
      raise exception 'invitee name is too long: %', left(clean, 20) || '…';
    end if;

    new_code := encode(gen_random_bytes(12), 'hex');

    insert into public.invite_codes (code, invitee_name, created_by, expires_at, calendar_id)
    values (new_code, clean, auth.uid()::text, expiry, cal_id);

    code         := new_code;
    invitee_name := clean;
    return next;
  end loop;
end;
$$;

-- revoke_invite: kill switch for a QR that leaked or was mis-sent. Allowed to the
-- SITE admin (for site invites) or the CALENDAR owner (for that calendar's).
--
-- Deactivating a claimed code does NOT undo the membership it created — it only
-- stops a code from admitting anyone further, which a claimed code could not do
-- anyway. Remove the person with reject_member.
create or replace function public.revoke_invite(invite text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cal text;
begin
  select calendar_id into cal from public.invite_codes where code = invite;
  if not found then
    return false;
  end if;

  if cal is null then
    if not public.is_admin() then
      raise exception 'only an administrator may revoke invites';
    end if;
  else
    if not public.owns_calendar(cal) then
      raise exception 'only the calendar owner may revoke its invites';
    end if;
  end if;

  update public.invite_codes set active = false where code = invite;
  return found;
end;
$$;

-- list_invites: SITE invites, for the site admin. Calendar invites are excluded —
-- they belong to their calendar's owner, not to the site admin, and are listed by
-- list_calendar_invites instead.
--
-- A spent, expired or revoked code's VALUE is withheld: it has no further use,
-- and not returning it keeps dead codes out of the bundle.
--
-- The v5 11-col signature must be dropped: `create or replace` cannot change a
-- function's return type.
drop function if exists public.list_invites();

create or replace function public.list_invites()
returns table (
  code          text,
  invitee_name  text,
  active        boolean,
  claimed       boolean,
  expired       boolean,
  created_at    timestamptz,
  expires_at    timestamptz,
  claimed_by    text,
  claimed_name  text,
  claimed_at    timestamptz,
  approved      boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    case when public.invite_is_live(c) then c.code end,
    c.invitee_name,
    c.active,
    (c.used_by is not null),
    (c.expires_at is not null and c.expires_at <= now()),
    c.created_at,
    c.expires_at,
    c.used_by,
    u.username,
    c.used_at,
    u.approved
  from public.invite_codes c
  left join public.users u on u.id = c.used_by
  where public.is_admin()
    and c.calendar_id is null
  order by c.created_at desc;
$$;

-- list_calendar_invites: the invite roster for ONE calendar. Owner-only.
--
-- `joined_status` is the membership the claim produced, which is what the owner
-- actually needs to see: a claimed invite whose member is still 'pending' is a
-- person waiting on them.
create or replace function public.list_calendar_invites(cal_id text)
returns table (
  code          text,
  invitee_name  text,
  active        boolean,
  claimed       boolean,
  expired       boolean,
  created_at    timestamptz,
  expires_at    timestamptz,
  claimed_by    text,
  claimed_name  text,
  claimed_at    timestamptz,
  joined_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    case when public.invite_is_live(c) then c.code end,
    c.invitee_name,
    c.active,
    (c.used_by is not null),
    (c.expires_at is not null and c.expires_at <= now()),
    c.created_at,
    c.expires_at,
    c.used_by,
    u.username,
    c.used_at,
    m.status
  from public.invite_codes c
  left join public.users            u on u.id = c.used_by
  left join public.calendar_members m
    on m.calendar_id = c.calendar_id and m.user_id = c.used_by
  where c.calendar_id = cal_id
    and public.owns_calendar(cal_id)
  order by c.created_at desc;
$$;

-- ═══ Site-level claim approval (unchanged from v5) ════════════════════════════
-- These flip users.approved — the SITE gate. Site admin only. They say nothing
-- about calendars: a site-approved account still has to be let into each calendar
-- by that calendar's owner.

create or replace function public.approve_claim(user_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an administrator may approve accounts';
  end if;

  update public.users set approved = true where id = user_id;
  return found;
end;
$$;

create or replace function public.reject_claim(
  user_id text,
  reopen  boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  found_user boolean;
begin
  if not public.is_admin() then
    raise exception 'only an administrator may reject accounts';
  end if;

  update public.users set approved = false where id = user_id;
  found_user := found;

  if reopen then
    update public.invite_codes
       set used_by = null,
           used_at = null,
           expires_at = case
             when expires_at is not null and expires_at <= now()
             then now() + interval '72 hours'
             else expires_at
           end
     where used_by = user_id
       and calendar_id is null;   -- only site invites; a calendar's are its owner's
  end if;

  return found_user;
end;
$$;

-- ═══ Grants ═══════════════════════════════════════════════════════════════════
-- Each function gates internally on is_admin() / owns_calendar() / is_approved().
-- The grant is the door; the internal check is the lock.

grant execute on function public.lookup_invite(text)   to anon, authenticated;
grant execute on function public.validate_invite(text) to anon, authenticated;

grant execute on function public.redeem_invite(text)   to authenticated;
grant execute on function public.is_approved()         to authenticated;
grant execute on function public.is_admin()            to authenticated;

grant execute on function public.create_calendar(text, text, integer) to authenticated;
grant execute on function public.update_calendar(text, text, integer) to authenticated;
grant execute on function public.delete_calendar(text)                to authenticated;
grant execute on function public.list_calendars()                     to authenticated;
grant execute on function public.list_members(text)                   to authenticated;
grant execute on function public.approve_member(text, text)           to authenticated;
grant execute on function public.reject_member(text, text, boolean)   to authenticated;
grant execute on function public.leave_calendar(text)                 to authenticated;

grant execute on function public.mint_invite(text, integer)                    to authenticated;
grant execute on function public.mint_calendar_invites(text, text[], integer)  to authenticated;
grant execute on function public.revoke_invite(text)                           to authenticated;
grant execute on function public.list_invites()                                to authenticated;
grant execute on function public.list_calendar_invites(text)                   to authenticated;
grant execute on function public.approve_claim(text)                           to authenticated;
grant execute on function public.reject_claim(text, boolean)                   to authenticated;
grant execute on function public.hidden_event_counts(text, text, text)         to authenticated;

-- ── Functions clients must NOT hold ──────────────────────────────────────────
-- PUBLIC gets EXECUTE on new functions by default in Postgres, so silence here
-- would mean granted. Each of these is an oracle if handed to a client:

-- event_has_coincidence: called only from inside the events policy, which runs as
-- the policy owner. Granted, it would answer "does ANYONE have an event in this
-- window?" for arbitrary (calendar, date, start, end) — probing the whole
-- database's schedule, one boolean at a time, with no membership required.
revoke all on function public.event_has_coincidence(text, text, text, text, numeric, numeric)
  from public, anon, authenticated;

-- invite_is_live: a helper over an invite_codes row. Only ever called from inside
-- the SECURITY DEFINER functions above (which already hold the rows). It
-- discloses nothing on its own — you must already possess a row to pass one in —
-- but leaving it ungranted keeps the invite surface exactly as small as it was.
revoke all on function public.invite_is_live(public.invite_codes)
  from public, anon, authenticated;

-- The membership/count helpers are policy internals. user_is_member() in
-- particular would let any account test whether any OTHER account belongs to any
-- calendar — a membership-enumeration oracle. They are called from inside
-- SECURITY DEFINER functions and policies, so clients never need them.
revoke all on function public.owns_calendar(text)            from public, anon, authenticated;
revoke all on function public.is_calendar_member(text)       from public, anon, authenticated;
revoke all on function public.user_is_member(text, text)     from public, anon, authenticated;
revoke all on function public.calendar_member_count(text)    from public, anon, authenticated;
revoke all on function public.invite_expiry(integer)         from public, anon, authenticated;

-- ═══ Row Level Security ═══════════════════════════════════════════════════════

alter table public.users            enable row level security;
alter table public.events           enable row level security;
alter table public.calendars        enable row level security;
alter table public.calendar_members enable row level security;
alter table public.invite_codes     enable row level security;
-- invite_codes: RLS on + zero policies = clients can never touch it directly.

-- ── Retire v1–v5 policies ────────────────────────────────────────────────────
drop policy if exists "users: public read"                     on public.users;
drop policy if exists "events: public read"                    on public.events;
drop policy if exists "users: own write"                       on public.users;
drop policy if exists "events: own write"                      on public.events;
drop policy if exists "events: read own or shared"             on public.events;
drop policy if exists "events: read own or shared and visible" on public.events;
drop policy if exists "shares: owner manages"                  on public.shares;
drop policy if exists "shares: grantee reads"                  on public.shares;

-- ── Drop the CURRENT policies before recreating them below ───────────────────
-- `create policy` has no `or replace` form, so without this the second run of
-- this file fails with "policy already exists". Re-running the file is how a
-- policy change is deployed (there is no migration tool — this file IS the
-- schema of record), so it must survive a re-run. Every policy created below
-- must have a matching line here; a policy created but not dropped is a file
-- that only applies once.
drop policy if exists "users: read own or approved"            on public.users;
drop policy if exists "users: insert self"                     on public.users;
drop policy if exists "users: update self"                     on public.users;
drop policy if exists "calendars: members read"                on public.calendars;
drop policy if exists "calendar_members: read own or fellow"   on public.calendar_members;
drop policy if exists "events: read own or member and visible" on public.events;
drop policy if exists "events: own write in member calendar"   on public.events;

-- shares is SUBSUMED by calendar_members (ADR-12). Two independent grant systems
-- pointing at the same data is how a privacy bug gets in: every read path has to
-- be right in both, forever. Dropped, not deprecated.
drop table if exists public.shares;

-- ── users ────────────────────────────────────────────────────────────────────
-- You can always read your own row (to see your approval status); approved
-- accounts can read everyone's profile (names/colors/avatars for the UI).
-- Availability lives in `events`, not here, so this leaks no schedule data.
create policy "users: read own or approved"
  on public.users for select
  to authenticated
  using (id = auth.uid()::text or public.is_approved());

create policy "users: insert self"
  on public.users for insert
  to authenticated
  with check (id = auth.uid()::text);

create policy "users: update self"
  on public.users for update
  to authenticated
  using      (id = auth.uid()::text)
  with check (id = auth.uid()::text);

-- Column-level privileges: clients may never write approved / invite_code /
-- is_admin. (The service role and SECURITY DEFINER functions are unaffected.)
-- `id` stays in the update grant because PostgREST upserts SET every supplied
-- column (including the PK); the RLS with-check still pins id to auth.uid().
--
-- is_admin's absence here is load-bearing: it is what stops any signed-in user
-- from PATCHing themselves into an administrator.
revoke insert, update on public.users from anon, authenticated;
grant  insert (id, data, username) on public.users to authenticated;
grant  update (id, data)           on public.users to authenticated;

-- ── calendars ────────────────────────────────────────────────────────────────
-- Readable by its members (owner included — they are a member). Writable by NO
-- client directly: create/update/delete all go through the SECURITY DEFINER
-- functions above, which is what lets create_calendar insert the owner's
-- membership row in the same transaction, and what lets update_calendar refuse a
-- cap below the current headcount. A raw INSERT policy could do neither.
create policy "calendars: members read"
  on public.calendars for select
  to authenticated
  using (public.is_approved() and public.is_calendar_member(id));

revoke insert, update, delete on public.calendars from anon, authenticated;

-- ── calendar_members ─────────────────────────────────────────────────────────
-- You can see your OWN membership rows — that is how the app knows which
-- calendars you are in, and whether you are still pending. You can see other
-- people's rows only in a calendar you are an approved member of, which is what
-- draws the member list.
--
-- Writes are function-only: joining is redeem_invite (pending, always), approval
-- is approve_member (seat-capped, owner-gated), removal is reject_member /
-- leave_calendar. A client that could UPDATE this table could set its own status
-- to 'approved' and walk into any calendar it knew the id of. That is the whole
-- ballgame, so there is no write policy at all.
create policy "calendar_members: read own or fellow"
  on public.calendar_members for select
  to authenticated
  using (
    user_id = auth.uid()::text
    or (public.is_approved() and public.is_calendar_member(calendar_id))
  );

revoke insert, update, delete on public.calendar_members from anon, authenticated;

-- ── events ───────────────────────────────────────────────────────────────────
-- Two gates, composed (ADR-7 / ADR-8 / ADR-12):
--
--   1. MEMBERSHIP (outer) — are you an approved member of the calendar this
--      event belongs to? No → you see nothing of it, full stop.
--   2. VISIBILITY (inner) — of the events you could see, which do you get? A
--      'public' event: all of them. An 'anonymous' event (the default): only once
--      somebody else's event IN THAT SAME CALENDAR coincides with it.
--
-- The inner gate applies to people you ARE sharing a calendar with. That is the
-- point: an anonymous event must stay hidden from exactly the people most likely
-- to be looking at it, or the word "anonymous" means nothing.
create policy "events: read own or member and visible"
  on public.events for select
  to authenticated
  using (
    -- You always see your own events, whatever their visibility.
    user_id = auth.uid()::text
    or (
      public.is_approved()
      and public.is_calendar_member(calendar_id)
      and (
        visibility = 'public'
        or public.event_has_coincidence(
             auth.uid()::text, calendar_id, user_id,
             event_date, start_hour, end_hour)
      )
    )
  );

-- Writes: your own events, in a calendar you are an approved member of. Both
-- halves matter. Without the ownership half you could write events as someone
-- else; without the membership half you could inject events into any calendar
-- whose id you learned — and since an event of yours in a calendar can UNLOCK
-- other people's anonymous events there (that is what coincidence does), writing
-- into a calendar you are not in would be a privacy attack, not just vandalism.
--
-- is_calendar_member() is evaluated against the NEW row's calendar_id in the with
-- check, so moving an event into a calendar you are not in is refused too.
create policy "events: own write in member calendar"
  on public.events for all
  to authenticated
  using      (
    user_id = auth.uid()::text
    and public.is_approved()
    and public.is_calendar_member(calendar_id)
  )
  with check (
    user_id = auth.uid()::text
    and public.is_approved()
    and public.is_calendar_member(calendar_id)
  );

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Postgres-changes subscriptions respect RLS, so a client only receives realtime
-- rows it is allowed to SELECT. Re-running these lines errors if the tables are
-- already in the publication — ignore that error, it's idempotent in effect.
alter publication supabase_realtime add table public.users;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.calendar_members;

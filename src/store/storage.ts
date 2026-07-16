// ─── Storage adapter ──────────────────────────────────────────────────────────
// Dual-mode persistence — the same async interface works in two backends:
//
//   Supabase (cloud)  — when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set
//   localStorage      — fallback when those env vars are absent
//
// The store (useStore.ts) only imports from this file. To swap in a different
// backend (Firebase, PocketBase, etc.) change only this file.
//
// Database layout (Supabase mode):
//   users  (id text PK, data jsonb)          — full User object stored as JSON
//   events (id text PK, user_id text, calendar_id text, data jsonb)
//          — user_id and calendar_id are mirrored columns, for RLS to enforce on
//
// Calendars and membership are NOT here: they are reached exclusively through
// SECURITY DEFINER RPCs, so they live behind their own boundary in
// calendars/calendarService.ts.
//
// Every event read is CALENDAR-SCOPED (ADR-12) — the app shows one calendar at a
// time, and the calendar is the privacy boundary.
//
// The active-user ID is always kept in localStorage because it is an ephemeral
// UI preference (which pill is highlighted), not shared collaborative data.

import type { User, CalEvent } from '../types'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { IS_DEMO } from '../demo/demoMode'
import * as demo from '../demo/demoWorld'
import { log } from '../lib/log'

// Raised when a write the caller must not silently lose fails. saveUser throws
// this instead of only logging: a dropped profile insert during sign-up leaves
// an auth account with no users row — a login that can never see anything — and
// the sign-up flow must be able to surface that rather than report success.
export class StorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'StorageError'
  }
}

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS = {
  users:      'calsync:users',
  events:     'calsync:events',
  activeUser: 'calsync:activeUser',
  localIds:   'calsync:localIds',   // user ids that live only in this browser
}

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function lsWrite(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

// ── Active user ID ─────────────────────────────────────────────────────────────
// Synchronous — always localStorage, regardless of backend.

// Demo mode branches FIRST throughout this file: it is the in-memory backend,
// and must never fall through to localStorage (which persists — the demo
// promises nothing does) or to Supabase (which SUPABASE_ENABLED already rules
// out; demo forces it false).

export function loadActiveUserId(): string | null {
  if (IS_DEMO) return demo.dmActiveUserId()
  return lsRead<string | null>(LS.activeUser, null)
}

export function saveActiveUserId(id: string | null): void {
  if (IS_DEMO) { demo.dmSetActiveUserId(id); return }
  lsWrite(LS.activeUser, id)
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function loadUsers(): Promise<User[]> {
  if (IS_DEMO) return demo.dmUsers()
  if (!SUPABASE_ENABLED) return lsRead<User[]>(LS.users, [])

  const { data, error } = await supabase.from('users').select('data')
  if (error) { log.error('storage', 'loadUsers failed:', error.message); return [] }
  return data.map(r => r.data as User)
}

// Upsert a single user (insert or replace). `username` is only set when the
// profile row is first created after sign-up — the DB column is unique and
// used by the admin to identify who redeemed which invite code.
export async function saveUser(user: User, username?: string): Promise<void> {
  if (IS_DEMO) { demo.dmSaveUser(user); return }
  if (!SUPABASE_ENABLED) {
    const all = lsRead<User[]>(LS.users, [])
    lsWrite(LS.users, [...all.filter(u => u.id !== user.id), user])
    return
  }
  const row = username
    ? { id: user.id, data: user, username }
    : { id: user.id, data: user }
  const { error } = await supabase.from('users').upsert(row)
  if (error) {
    log.error('storage', `saveUser failed (id=${user.id}):`, error.message)
    throw new StorageError(`Could not save your profile: ${error.message}`, error)
  }
}

// ── Local-only personas (test mode) ──────────────────────────────────────────
// The set of user ids that live only in this browser. Their profile AND their
// events are kept in localStorage even when Supabase is the active backend, so
// throwaway test personas never reach the database (they'd fail RLS anyway).

function loadLocalIds(): Set<string> {
  return new Set(lsRead<string[]>(LS.localIds, []))
}

function markLocalId(id: string): void {
  const ids = loadLocalIds()
  ids.add(id)
  lsWrite(LS.localIds, [...ids])
}

export function isLocalUser(id: string): boolean {
  return loadLocalIds().has(id)
}

// Save a user to localStorage regardless of the active backend and remember it
// as local-only. Used by the test-mode "fast create". See siteConfig.TEST_MODE.
export function saveLocalUser(user: User): void {
  const all = lsRead<User[]>(LS.users, [])
  lsWrite(LS.users, [...all.filter(u => u.id !== user.id), user])
  markLocalId(user.id)
}

// Load local-only personas saved in this browser. In Supabase mode these are
// merged on top of the DB users so test personas reappear after a reload.
export function loadLocalUsers(): User[] {
  const ids = loadLocalIds()
  if (ids.size === 0) return []
  return lsRead<User[]>(LS.users, []).filter(u => ids.has(u.id))
}

// Load events belonging to local-only personas (test mode, Supabase backend),
// scoped to the calendar being viewed — a test persona's events belong to one
// calendar like anyone else's.
export function loadLocalEvents(calendarId: string): CalEvent[] {
  const ids = loadLocalIds()
  if (ids.size === 0) return []
  return lsRead<CalEvent[]>(LS.events, [])
    .filter(e => ids.has(e.userId) && e.calendarId === calendarId)
}

export async function removeUser(id: string): Promise<void> {
  if (IS_DEMO) { demo.dmRemoveUser(id); return }
  if (!SUPABASE_ENABLED) {
    lsWrite(LS.users, lsRead<User[]>(LS.users, []).filter(u => u.id !== id))
    return
  }
  const { error } = await supabase.from('users').delete().eq('id', id)
  if (error) log.error('storage', `removeUser failed (id=${id}):`, error.message)
}

// ── Events ────────────────────────────────────────────────────────────────────

// Events for ONE calendar (ADR-12). Every read is calendar-scoped: the app only
// ever shows one calendar at a time, and loading the union of all of them would
// mean a grid that mixes calendars — which is precisely the boundary the whole
// privacy model rests on.
//
// The `.eq('calendar_id')` here is a scope filter, NOT the security boundary. RLS
// is: the query returns only your own events, plus those of fellow APPROVED
// members of that calendar that you are permitted to see (public, or an anonymous
// one something of yours coincides with). Unmatched anonymous events never reach
// the client at all. Asking for a calendar you are not a member of returns zero
// rows — not an error, and not anyone's data. See db/schema/70_policies.sql.
export async function loadEvents(calendarId: string): Promise<CalEvent[]> {
  if (IS_DEMO) return demo.dmEvents(calendarId)
  if (!SUPABASE_ENABLED) {
    return lsRead<CalEvent[]>(LS.events, []).filter(e => e.calendarId === calendarId)
  }

  const { data, error } = await supabase
    .from('events').select('data').eq('calendar_id', calendarId)
  if (error) {
    log.error('storage', `loadEvents failed (cal=${calendarId}):`, error.message)
    return []
  }
  return data.map(r => r.data as CalEvent)
}

// Events for SEVERAL calendars in one round trip — the overview (the virtual
// "everything I am part of" view). Not a loosening of ADR-12: each id in the
// list is still its own privacy boundary (the client visibility engine judges
// coincidence per calendar), and RLS still decides row by row what comes back.
// An id the caller is not a member of contributes zero rows, not an error.
export async function loadEventsForCalendars(calendarIds: string[]): Promise<CalEvent[]> {
  if (calendarIds.length === 0) return []
  if (IS_DEMO) return demo.dmEventsForCalendars(calendarIds)
  if (!SUPABASE_ENABLED) {
    const wanted = new Set(calendarIds)
    return lsRead<CalEvent[]>(LS.events, []).filter(e => wanted.has(e.calendarId))
  }

  const { data, error } = await supabase
    .from('events').select('data').in('calendar_id', calendarIds)
  if (error) {
    log.error('storage', `loadEventsForCalendars failed (${calendarIds.length} calendars):`, error.message)
    return []
  }
  return data.map(r => r.data as CalEvent)
}

// Local-only personas' events across several calendars (test mode; see
// loadLocalEvents above for the single-calendar case).
export function loadLocalEventsForCalendars(calendarIds: string[]): CalEvent[] {
  const ids = loadLocalIds()
  if (ids.size === 0 || calendarIds.length === 0) return []
  const wanted = new Set(calendarIds)
  return lsRead<CalEvent[]>(LS.events, [])
    .filter(e => ids.has(e.userId) && wanted.has(e.calendarId))
}

// Per-date counts of anonymous events being withheld from us — the "someone has
// something here" hint. The server returns only a number per date, never the
// events themselves; that's what keeps them anonymous while still discoverable.
//
// localStorage mode has no RLS and no other users, so there is nothing to hide
// and nothing to count: the client-side filter in engine/visibility.ts already
// derives the hint from the events in hand.
export async function loadHiddenCounts(
  calendarId: string,
  fromDate:   string,
  toDate:     string,
): Promise<Map<string, number>> {
  if (!SUPABASE_ENABLED) return new Map()

  const { data, error } = await supabase.rpc('hidden_event_counts', {
    cal_id:    calendarId,
    from_date: fromDate,
    to_date:   toDate,
  })
  if (error) {
    log.error('storage', 'loadHiddenCounts failed:', error.message)
    return new Map()
  }
  return new Map(
    (data as { event_date: string; hidden_count: number }[])
      .map(r => [r.event_date, Number(r.hidden_count)]),
  )
}

function saveEventLocal(event: CalEvent): void {
  const all = lsRead<CalEvent[]>(LS.events, [])
  lsWrite(LS.events, [...all.filter(e => e.id !== event.id), event])
}

// Upsert a single event. user_id and calendar_id are mirrored into columns so RLS
// can enforce on them: the write policy requires the row be yours AND in a
// calendar you are an approved member of.
//
// Events owned by a local-only persona (test mode) always go to localStorage,
// never to Supabase — they'd fail RLS and don't belong in a real deployment.
//
// Returns an error message (or null on success) so the store can ROLL BACK its
// optimistic update — a write RLS rejects must not stay on screen as if saved.
export async function saveEvent(event: CalEvent): Promise<string | null> {
  if (IS_DEMO) { demo.dmSaveEvent(event); return null }
  if (!SUPABASE_ENABLED || isLocalUser(event.userId)) {
    saveEventLocal(event)
    return null
  }
  const { error } = await supabase.from('events').upsert({
    id:          event.id,
    user_id:     event.userId,
    calendar_id: event.calendarId,
    data:        event,
  })
  if (error) {
    log.error('storage', `saveEvent failed (id=${event.id}):`, error.message)
    return error.message
  }
  return null
}

// Returns an error message (or null on success), same contract as saveEvent.
export async function removeEvent(id: string): Promise<string | null> {
  if (IS_DEMO) { demo.dmRemoveEvent(id); return null }
  // Always clear the local copy (harmless if absent); this also covers events
  // owned by a local-only persona in Supabase mode.
  const localAll = lsRead<CalEvent[]>(LS.events, [])
  const wasLocal = localAll.some(e => e.id === id)
  if (wasLocal) lsWrite(LS.events, localAll.filter(e => e.id !== id))

  if (!SUPABASE_ENABLED || wasLocal) return null

  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) {
    log.error('storage', `removeEvent failed (id=${id}):`, error.message)
    return error.message
  }
  return null
}

// ── Sharing ───────────────────────────────────────────────────────────────────
// There is no `shares` table any more (ADR-12). Calendar MEMBERSHIP is the
// sharing grant: being an approved member of a calendar is what lets you see the
// other members' events in it. Two independent grant systems pointing at the same
// data is how a privacy bug gets in — every read path would have to be right in
// both, forever. See calendars/calendarService.ts.

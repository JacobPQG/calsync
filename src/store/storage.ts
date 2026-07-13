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
//   events (id text PK, user_id text, data jsonb) — user_id column is for RLS
//
// The active-user ID is always kept in localStorage because it is an ephemeral
// UI preference (which pill is highlighted), not shared collaborative data.

import type { User, CalEvent } from '../types'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { log } from '../lib/log'

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

export function loadActiveUserId(): string | null {
  return lsRead<string | null>(LS.activeUser, null)
}

export function saveActiveUserId(id: string | null): void {
  lsWrite(LS.activeUser, id)
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function loadUsers(): Promise<User[]> {
  if (!SUPABASE_ENABLED) return lsRead<User[]>(LS.users, [])

  const { data, error } = await supabase.from('users').select('data')
  if (error) { log.error('storage', 'loadUsers failed:', error.message); return [] }
  return data.map(r => r.data as User)
}

// Upsert a single user (insert or replace). `username` is only set when the
// profile row is first created after sign-up — the DB column is unique and
// used by the admin to identify who redeemed which invite code.
export async function saveUser(user: User, username?: string): Promise<void> {
  if (!SUPABASE_ENABLED) {
    const all = lsRead<User[]>(LS.users, [])
    lsWrite(LS.users, [...all.filter(u => u.id !== user.id), user])
    return
  }
  const row = username
    ? { id: user.id, data: user, username }
    : { id: user.id, data: user }
  const { error } = await supabase.from('users').upsert(row)
  if (error) log.error('storage', `saveUser failed (id=${user.id}):`, error.message)
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

// Load events belonging to local-only personas (test mode, Supabase backend).
export function loadLocalEvents(): CalEvent[] {
  const ids = loadLocalIds()
  if (ids.size === 0) return []
  return lsRead<CalEvent[]>(LS.events, []).filter(e => ids.has(e.userId))
}

export async function removeUser(id: string): Promise<void> {
  if (!SUPABASE_ENABLED) {
    lsWrite(LS.users, lsRead<User[]>(LS.users, []).filter(u => u.id !== id))
    return
  }
  const { error } = await supabase.from('users').delete().eq('id', id)
  if (error) log.error('storage', `removeUser failed (id=${id}):`, error.message)
}

// ── Events ────────────────────────────────────────────────────────────────────

// In Supabase mode the query returns only what RLS allows: your own events
// plus events of people who explicitly shared with you. Privacy is enforced
// server-side — the client never receives rows it shouldn't see.
export async function loadEvents(): Promise<CalEvent[]> {
  if (!SUPABASE_ENABLED) return lsRead<CalEvent[]>(LS.events, [])

  const { data, error } = await supabase.from('events').select('data')
  if (error) { log.error('storage', 'loadEvents failed:', error.message); return [] }
  return data.map(r => r.data as CalEvent)
}

function saveEventLocal(event: CalEvent): void {
  const all = lsRead<CalEvent[]>(LS.events, [])
  lsWrite(LS.events, [...all.filter(e => e.id !== event.id), event])
}

// Upsert a single event. user_id is stored as a column for RLS enforcement.
// Events owned by a local-only persona (test mode) always go to localStorage,
// never to Supabase — they'd fail RLS and don't belong in a real deployment.
export async function saveEvent(event: CalEvent): Promise<void> {
  if (!SUPABASE_ENABLED || isLocalUser(event.userId)) {
    saveEventLocal(event)
    return
  }
  const { error } = await supabase
    .from('events')
    .upsert({ id: event.id, user_id: event.userId, data: event })
  if (error) log.error('storage', `saveEvent failed (id=${event.id}):`, error.message)
}

export async function removeEvent(id: string): Promise<void> {
  // Always clear the local copy (harmless if absent); this also covers events
  // owned by a local-only persona in Supabase mode.
  const localAll = lsRead<CalEvent[]>(LS.events, [])
  const wasLocal = localAll.some(e => e.id === id)
  if (wasLocal) lsWrite(LS.events, localAll.filter(e => e.id !== id))

  if (!SUPABASE_ENABLED || wasLocal) return

  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) log.error('storage', `removeEvent failed (id=${id}):`, error.message)
}

// ── Calendar shares (Supabase mode only) ─────────────────────────────────────
// A share row (owner → grantee) lets the grantee read the owner's events.
// In localStorage mode everything is one browser, so shares don't apply.

export async function loadMyGrantees(ownerId: string): Promise<string[]> {
  if (!SUPABASE_ENABLED) return []
  const { data, error } = await supabase
    .from('shares').select('grantee_id').eq('owner_id', ownerId)
  if (error) { log.error('storage', 'loadMyGrantees failed:', error.message); return [] }
  return data.map(r => r.grantee_id as string)
}

export async function addShare(ownerId: string, granteeId: string): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false
  const { error } = await supabase
    .from('shares').upsert({ owner_id: ownerId, grantee_id: granteeId })
  if (error) log.error('storage', `addShare failed (grantee=${granteeId}):`, error.message)
  return !error
}

export async function removeShare(ownerId: string, granteeId: string): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false
  const { error } = await supabase
    .from('shares').delete().eq('owner_id', ownerId).eq('grantee_id', granteeId)
  if (error) log.error('storage', `removeShare failed (grantee=${granteeId}):`, error.message)
  return !error
}

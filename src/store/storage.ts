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

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS = {
  users:      'calsync:users',
  events:     'calsync:events',
  activeUser: 'calsync:activeUser',
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
  if (error) { console.error('[storage] loadUsers:', error.message); return [] }
  return data.map(r => r.data as User)
}

// Upsert a single user (insert or replace).
export async function saveUser(user: User): Promise<void> {
  if (!SUPABASE_ENABLED) {
    const all = lsRead<User[]>(LS.users, [])
    lsWrite(LS.users, [...all.filter(u => u.id !== user.id), user])
    return
  }
  const { error } = await supabase.from('users').upsert({ id: user.id, data: user })
  if (error) console.error('[storage] saveUser:', error.message)
}

export async function removeUser(id: string): Promise<void> {
  if (!SUPABASE_ENABLED) {
    lsWrite(LS.users, lsRead<User[]>(LS.users, []).filter(u => u.id !== id))
    return
  }
  const { error } = await supabase.from('users').delete().eq('id', id)
  if (error) console.error('[storage] removeUser:', error.message)
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function loadEvents(): Promise<CalEvent[]> {
  if (!SUPABASE_ENABLED) return lsRead<CalEvent[]>(LS.events, [])

  const { data, error } = await supabase.from('events').select('data')
  if (error) { console.error('[storage] loadEvents:', error.message); return [] }
  return data.map(r => r.data as CalEvent)
}

// Upsert a single event. user_id is stored as a column for RLS enforcement.
export async function saveEvent(event: CalEvent): Promise<void> {
  if (!SUPABASE_ENABLED) {
    const all = lsRead<CalEvent[]>(LS.events, [])
    lsWrite(LS.events, [...all.filter(e => e.id !== event.id), event])
    return
  }
  const { error } = await supabase
    .from('events')
    .upsert({ id: event.id, user_id: event.userId, data: event })
  if (error) console.error('[storage] saveEvent:', error.message)
}

export async function removeEvent(id: string): Promise<void> {
  if (!SUPABASE_ENABLED) {
    lsWrite(LS.events, lsRead<CalEvent[]>(LS.events, []).filter(e => e.id !== id))
    return
  }
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) console.error('[storage] removeEvent:', error.message)
}

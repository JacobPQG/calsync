// ─── Storage adapter ─────────────────────────────────────────────────────────
// Swap this entire file for a Supabase / Firebase adapter without touching
// anything else. The store only calls these functions.

import type { User, CalEvent } from '../types'

const KEYS = {
  users: 'calsync:users',
  events: 'calsync:events',
  activeUser: 'calsync:activeUser',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

// ── Users ────────────────────────────────────────────────────────────────────

export function loadUsers(): User[] {
  return read<User[]>(KEYS.users, [])
}

export function saveUsers(users: User[]): void {
  write(KEYS.users, users)
}

export function loadActiveUserId(): string | null {
  return read<string | null>(KEYS.activeUser, null)
}

export function saveActiveUserId(id: string | null): void {
  write(KEYS.activeUser, id)
}

// ── Events ───────────────────────────────────────────────────────────────────

export function loadEvents(): CalEvent[] {
  return read<CalEvent[]>(KEYS.events, [])
}

export function saveEvents(events: CalEvent[]): void {
  write(KEYS.events, events)
}

// ─── Discover: settings & cache persistence ───────────────────────────────────
// Discovery preferences, cached suggestions/quotes, and the dismissed-list are
// PERSONAL, PER-BROWSER state, so they live in localStorage — deliberately not
// in Postgres. They describe what one person wants suggested to them; nothing
// here is shared, so there is nothing for RLS to guard (ADR-22). A suggestion
// only becomes shared data when accepted, via the store's normal event write.
//
// All reads are defensive: a malformed blob (old shape, hand-edited) falls back
// to defaults rather than wedging the panel.

import type {
  DiscoverySettings, EventSuggestion, TravelSettings, TravelQuote,
} from './types'
import {
  DISCOVER_DEFAULT_MONTHS_AHEAD, DISCOVER_MAX_MONTHS_AHEAD,
  TRAVEL_DEFAULT_MAX_TOTAL, TRAVEL_DEFAULT_CURRENCY,
} from '../lib/config'
import { log } from '../lib/log'

const KEYS = {
  settings:    'calsync-discover-settings',
  travel:      'calsync-discover-travel',
  suggestions: 'calsync-discover-suggestions',
  dismissed:   'calsync-discover-dismissed',
  quotes:      'calsync-discover-quotes',
} as const

// ── Defaults ──────────────────────────────────────────────────────────────────

export function defaultDiscoverySettings(): DiscoverySettings {
  return {
    locations:   [],
    monthsAhead: DISCOVER_DEFAULT_MONTHS_AHEAD,
    granularity: 'day',
    categories:  [],
    // ai-paste needs no key, so it is the one source that always works.
    sources:     ['ai-paste'],
  }
}

export function defaultTravelSettings(): TravelSettings {
  return {
    origin:       '',
    destinations: [],
    monthsAhead:  6,
    departDow:    4,      // Friday
    nights:       2,      // Fri → Sun
    maxTotal:     TRAVEL_DEFAULT_MAX_TOTAL,
    currency:     TRAVEL_DEFAULT_CURRENCY,
    hotels:       [],
    airlines:     [],
  }
}

// ── Generic helpers ───────────────────────────────────────────────────────────

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    log.warn('discover', `unreadable localStorage blob at ${key} — using defaults`)
    return fallback
  }
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    log.warn('discover', `could not persist ${key}: ${String(e)}`)
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function loadDiscoverySettings(): DiscoverySettings {
  const s = read(KEYS.settings, defaultDiscoverySettings())
  // Clamp the window so a stale/edited blob cannot request years of searches.
  s.monthsAhead = Math.min(Math.max(1, s.monthsAhead || 1), DISCOVER_MAX_MONTHS_AHEAD)
  return s
}

export function saveDiscoverySettings(s: DiscoverySettings) {
  write(KEYS.settings, s)
}

export function loadTravelSettings(): TravelSettings {
  const s = read(KEYS.travel, defaultTravelSettings())
  s.monthsAhead = Math.min(Math.max(1, s.monthsAhead || 1), DISCOVER_MAX_MONTHS_AHEAD)
  return s
}

export function saveTravelSettings(s: TravelSettings) {
  write(KEYS.travel, s)
}

// ── Suggestion cache ──────────────────────────────────────────────────────────
// The last search's results, so reopening the panel does not re-hit the APIs.
// A fresh search replaces it wholesale.

export function loadCachedSuggestions(): EventSuggestion[] {
  return readArray<EventSuggestion>(KEYS.suggestions)
}

export function saveCachedSuggestions(list: EventSuggestion[]) {
  write(KEYS.suggestions, list)
}

// ── Dismissed suggestions ─────────────────────────────────────────────────────
// Content-hash ids, so a dismissed event stays dismissed when a later search
// finds it again. Pruning is by date inside the id-producing suggestions, so
// the list is simply capped to keep the blob bounded.

const MAX_DISMISSED = 500

export function loadDismissed(): Set<string> {
  return new Set(readArray<string>(KEYS.dismissed))
}

export function addDismissed(id: string) {
  const ids = readArray<string>(KEYS.dismissed)
  if (!ids.includes(id)) ids.push(id)
  write(KEYS.dismissed, ids.slice(-MAX_DISMISSED))
}

// ── Travel quote cache ────────────────────────────────────────────────────────
// Keyed by candidate id; a new quote for the same candidate replaces the old.

export function loadQuotes(): TravelQuote[] {
  return readArray<TravelQuote>(KEYS.quotes)
}

export function saveQuotes(quotes: TravelQuote[]) {
  write(KEYS.quotes, quotes)
}

export function upsertQuotes(fresh: TravelQuote[]): TravelQuote[] {
  const byId = new Map(loadQuotes().map(q => [q.candidateId, q]))
  fresh.forEach(q => byId.set(q.candidateId, q))
  const all = [...byId.values()]
  saveQuotes(all)
  return all
}

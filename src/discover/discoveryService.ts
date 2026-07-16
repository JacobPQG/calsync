// ─── Discovery service ────────────────────────────────────────────────────────
// The only orchestrator of event-suggestion searches: fans one search out over
// (enabled sources × locations), catches failures per source, dedupes by the
// content-hash id, and caches the result. The UI talks to this module and to
// the aiPrompt helpers — never to a source adapter directly.
//
// Suggestions are proposals, not events. They live in localStorage until the
// user ACCEPTS one, at which point suggestionToEventDraft() maps it onto an
// ordinary CalEvent draft and the store's normal addEvent path (optimistic
// write + RLS enforcement) takes over. Discovery adds no persistence of its
// own to the shared backend.

import type { DiscoverySettings, EventSuggestion } from './types'
import type { CalEvent } from '../types'
import type { DiscoveryQuery } from './sources/types'
import { DISCOVERY_SOURCES } from './sources'
import { saveCachedSuggestions, loadDismissed } from './settings'
import { DISCOVER_MAX_SUGGESTIONS } from '../lib/config'
import { log } from '../lib/log'

// The search window: today (events already underway are noise) → N months out.
export function searchWindow(monthsAhead: number): { fromDate: string; toDate: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const from = new Date()
  const to   = new Date()
  to.setMonth(to.getMonth() + monthsAhead)
  return { fromDate: iso(from), toDate: iso(to) }
}

export interface DiscoveryResult {
  suggestions: EventSuggestion[]
  // Human-readable failure per source that errored, keyed by source id. A
  // failing source is reported, never fatal — the others' results stand.
  errors: Record<string, string>
}

export async function runDiscovery(settings: DiscoverySettings): Promise<DiscoveryResult> {
  const { fromDate, toDate } = searchWindow(settings.monthsAhead)
  const errors: Record<string, string> = {}

  const sources = DISCOVERY_SOURCES.filter(
    s => settings.sources.includes(s.id as never) && s.unavailableReason() === null)

  const queries: DiscoveryQuery[] = settings.locations.map(location =>
    ({ location, fromDate, toDate, settings }))

  // All (source × location) fetches in parallel; each failure is caught and
  // attributed so one bad key or down API never empties the whole search.
  const batches = await Promise.all(sources.flatMap(source =>
    queries.map(q =>
      source.search(q).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        errors[source.id] = msg
        log.warn('discover', `source ${source.id} failed for ${q.location.city}: ${msg}`)
        return [] as EventSuggestion[]
      }))))

  const suggestions = mergeSuggestions(batches.flat())
  saveCachedSuggestions(suggestions)
  return { suggestions, errors }
}

// Dedupe (verified listings beat AI guesses for the same event), drop what the
// user already dismissed, sort by date, cap.
export function mergeSuggestions(all: EventSuggestion[]): EventSuggestion[] {
  const dismissed = loadDismissed()
  const byId = new Map<string, EventSuggestion>()
  for (const s of all) {
    if (dismissed.has(s.id)) continue
    const existing = byId.get(s.id)
    if (!existing || (s.verified && !existing.verified)) byId.set(s.id, s)
  }
  return [...byId.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
    .slice(0, DISCOVER_MAX_SUGGESTIONS)
}

// An accepted suggestion becomes a normal event in the OPEN calendar. Public,
// not anonymous: a discovered concert/meetup is something you are floating to
// the group ("who's in?"), the exact case the public visibility exists for —
// and unlike availability, it discloses nothing personal.
export function suggestionToEventDraft(
  s: EventSuggestion, userId: string,
): Omit<CalEvent, 'id' | 'createdAt' | 'calendarId'> {
  return {
    userId,
    title:       s.title,
    description: [s.description, s.verified ? undefined : 'AI-suggested — details unverified.']
      .filter(Boolean).join(' '),
    tags:        s.category ? [s.category] : [],
    date:        s.date,
    startHour:   s.startHour,
    endHour:     s.endHour,
    location:    { name: [s.venue, s.city].filter(Boolean).join(', ') || undefined },
    eventUrl:    s.url,
    recurring:   { frequency: 'none' },
    visibility:  'public',
  }
}

// ─── Discover: suggestion normalization ───────────────────────────────────────
// Shared by every source adapter: turn an untrusted raw record (API response or
// AI output — both external input) into a valid EventSuggestion, or null if it
// cannot be salvaged. Validation lives here, at the boundary, so the service
// and UI can trust every suggestion they hold.

import type { DiscoverySourceId, EventSuggestion } from '../types'
import { EVENT_CATEGORIES } from '../types'

// Content-hash id: the same event found by two sources (or found again after a
// dismiss) collapses to one id. Title is normalized hard so "Jazz Night!" and
// "jazz night" agree.
export function suggestionId(title: string, date: string, city: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return `${norm(title)}|${date}|${norm(city)}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Loose input shape every adapter maps its payload into before calling
// sanitizeSuggestion. Everything optional — the sanitizer decides.
export interface RawSuggestion {
  title?:       unknown
  description?: unknown
  category?:    unknown
  date?:        unknown
  startHour?:   unknown
  endHour?:     unknown
  city?:        unknown
  venue?:       unknown
  url?:         unknown
}

function asTrimmedString(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s ? s.slice(0, maxLen) : undefined
}

// Accept numbers or numeric strings; anything else is undefined.
function asHour(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : undefined
}

export function sanitizeSuggestion(
  raw: RawSuggestion,
  source: DiscoverySourceId,
  verified: boolean,
  window: { fromDate: string; toDate: string },
): EventSuggestion | null {
  const title = asTrimmedString(raw.title, 120)
  const date  = asTrimmedString(raw.date, 10)
  const city  = asTrimmedString(raw.city, 60) ?? ''
  if (!title || !date || !DATE_RE.test(date)) return null
  // Outside the asked-for window (AI models drift; APIs can too) → drop.
  if (date < window.fromDate || date > window.toDate) return null

  // Hours: clamp into the CalEvent contract (start 0–23, end 1–24, end>start).
  let startHour = asHour(raw.startHour) ?? 19
  let endHour   = asHour(raw.endHour)   ?? startHour + 2
  startHour = Math.min(Math.max(0, startHour), 23)
  endHour   = Math.min(Math.max(startHour + 1, endHour), 24)

  // Category must be one of ours or absent — sources map their own taxonomy
  // before calling this, so an unknown value is noise, not information.
  const cat = asTrimmedString(raw.category, 20)?.toLowerCase()
  const category = EVENT_CATEGORIES.some(c => c.id === cat) ? cat : undefined

  // Only http(s) URLs survive; anything else (javascript:, data:) is dropped —
  // this string ends up on an <a href> and in CalEvent.eventUrl.
  const rawUrl = asTrimmedString(raw.url, 500)
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined

  return {
    id: suggestionId(title, date, city),
    source, verified,
    title, date, city, category, url,
    description: asTrimmedString(raw.description, 500),
    venue:       asTrimmedString(raw.venue, 120),
    startHour, endHour,
  }
}

// Keep a suggestion only if its date matches the granularity: 'weekend' keeps
// Fri/Sat/Sun. Parsed at noon UTC so the weekday is timezone-stable.
export function matchesGranularity(date: string, granularity: 'day' | 'weekend'): boolean {
  if (granularity === 'day') return true
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay()  // 0=Sun … 6=Sat
  return dow === 0 || dow === 5 || dow === 6
}

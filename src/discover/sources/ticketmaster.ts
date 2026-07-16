// ─── Discover: Ticketmaster source ────────────────────────────────────────────
// Real event listings from the Ticketmaster Discovery API — chosen because it
// is one of the few large event APIs that a static SPA can call at all: free
// API key, CORS enabled, plain GET. (Meetup retired its public API; Eventbrite
// dropped public search; scraping arbitrary sites is blocked by CORS without a
// server we deliberately don't have. See ADR-22.)
//
// Results are VERIFIED listings (real pages with tickets), unlike the AI
// sources. The API key is public-safe by design (it is rate-limited, not a
// secret grant), same posture as the Supabase anon key.

import type { DiscoveryQuery, DiscoverySource } from './types'
import type { EventSuggestion } from '../types'
import { sanitizeSuggestion, matchesGranularity } from './normalize'
import { TICKETMASTER_API_KEY, TICKETMASTER_API_BASE, DISCOVER_MAX_PER_SOURCE } from '../../lib/config'

// Our category ids → Ticketmaster segment names (their top-level taxonomy).
// Unmapped categories (food, tech, …) have no Ticketmaster equivalent; when
// only those are selected the query runs unfiltered and the granularity/
// category cut happens client-side.
const SEGMENT_BY_CATEGORY: Record<string, string> = {
  music:  'Music',
  arts:   'Arts & Theatre',
  sports: 'Sports',
  film:   'Film',
  family: 'Family',
}
const CATEGORY_BY_SEGMENT: Record<string, string> = Object.fromEntries(
  Object.entries(SEGMENT_BY_CATEGORY).map(([cat, seg]) => [seg, cat]))

// Minimal slice of the Discovery API response we read.
interface TmEvent {
  name?:  string
  url?:   string
  info?:  string
  dates?: { start?: { localDate?: string; localTime?: string } }
  classifications?: { segment?: { name?: string } }[]
  _embedded?: { venues?: { name?: string; city?: { name?: string } }[] }
}

function toRaw(e: TmEvent, fallbackCity: string) {
  const start = e.dates?.start
  // "19:30:00" → 19; missing time → let the sanitizer default it.
  const startHour = start?.localTime ? Number(start.localTime.slice(0, 2)) : undefined
  const venue = e._embedded?.venues?.[0]
  const segment = e.classifications?.[0]?.segment?.name
  return {
    title:       e.name,
    description: e.info,
    date:        start?.localDate,
    startHour,
    endHour:     startHour !== undefined ? startHour + 2 : undefined,
    city:        venue?.city?.name ?? fallbackCity,
    venue:       venue?.name,
    url:         e.url,
    category:    segment ? CATEGORY_BY_SEGMENT[segment] : undefined,
  }
}

export const ticketmasterSource: DiscoverySource = {
  id: 'ticketmaster',
  label: 'Ticketmaster (live listings)',

  unavailableReason: () =>
    TICKETMASTER_API_KEY ? null : 'Set VITE_TICKETMASTER_API_KEY to enable.',

  async search(query: DiscoveryQuery): Promise<EventSuggestion[]> {
    const { location, fromDate, toDate, settings } = query
    const segments = settings.categories
      .map(c => SEGMENT_BY_CATEGORY[c])
      .filter((s): s is string => !!s)

    const params = new URLSearchParams({
      apikey:        TICKETMASTER_API_KEY,
      city:          location.city,
      // The API wants full instants; span the window's local days.
      startDateTime: `${fromDate}T00:00:00Z`,
      endDateTime:   `${toDate}T23:59:59Z`,
      size:          String(DISCOVER_MAX_PER_SOURCE),
      sort:          'date,asc',
    })
    if (location.countryCode) params.set('countryCode', location.countryCode)
    if (segments.length)      params.set('classificationName', segments.join(','))

    const res = await fetch(`${TICKETMASTER_API_BASE}/events.json?${params}`)
    if (!res.ok) throw new Error(`Ticketmaster responded ${res.status}`)
    const json = await res.json() as { _embedded?: { events?: TmEvent[] } }

    const window = { fromDate, toDate }
    return (json._embedded?.events ?? [])
      .map(e => sanitizeSuggestion(toRaw(e, location.city), 'ticketmaster', true, window))
      .filter((s): s is EventSuggestion => s !== null)
      .filter(s => matchesGranularity(s.date, settings.granularity))
  },
}

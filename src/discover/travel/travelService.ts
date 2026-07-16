// ─── Travel service ───────────────────────────────────────────────────────────
// Orchestrates the weekend-deal scan: enumerate candidates (weekends.ts), get
// prices onto them, judge them against the budget threshold, and map an
// accepted deal onto an ordinary CalEvent draft. Three ways prices arrive,
// all landing in the same TravelQuote shape and the same localStorage cache:
//
//   • scanPrices()      — the Amadeus API, sequential and capped per run so a
//                         six-month watch cannot fire hundreds of requests.
//   • AI paste          — buildTravelPrompt() + parseTravelQuotesText(): the
//                         user asks any free chatbot for typical prices and
//                         pastes the JSON back. Estimates, marked as such.
//   • manual            — recordManualQuote(): the user read the real price on
//                         Google Flights/Booking (deep links) and types it in.

import type {
  TravelQuote, TravelSettings, WeekendCandidate, WeekendDeal,
} from '../types'
import type { CalEvent } from '../../types'
import { enumerateWeekends, tripDates } from './weekends'
import { quoteCandidate } from './amadeus'
import { upsertQuotes } from '../settings'
import { TRAVEL_MAX_SCANS_PER_RUN, TRAVEL_QUOTE_STALE_HOURS } from '../../lib/config'

export function buildCandidates(settings: TravelSettings): WeekendCandidate[] {
  return enumerateWeekends(settings)
}

function isFresh(q: TravelQuote): boolean {
  return Date.now() - new Date(q.fetchedAt).getTime()
    < TRAVEL_QUOTE_STALE_HOURS * 3600 * 1000
}

// ── API scan ──────────────────────────────────────────────────────────────────
// Quotes the first N candidates that have no fresh quote yet — repeated clicks
// walk further into the window instead of re-fetching the same weekends.
// Sequential on purpose: politeness to a free-tier quota beats latency here.

export async function scanPrices(
  settings: TravelSettings,
  candidates: WeekendCandidate[],
  existing: TravelQuote[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ quotes: TravelQuote[]; error: string | null }> {
  const fresh = new Set(existing.filter(isFresh).map(q => q.candidateId))
  const todo = candidates.filter(c => !fresh.has(c.id)).slice(0, TRAVEL_MAX_SCANS_PER_RUN)

  const found: TravelQuote[] = []
  let error: string | null = null
  for (const [i, c] of todo.entries()) {
    try {
      const q = await quoteCandidate(c, settings)
      if (q) found.push(q)
    } catch (e) {
      // One failure usually means they all fail (auth, quota) — stop, keep
      // what we have, and tell the user rather than hammering the API.
      error = e instanceof Error ? e.message : String(e)
      break
    }
    onProgress?.(i + 1, todo.length)
  }
  return { quotes: upsertQuotes(found), error }
}

// ── AI paste flow ─────────────────────────────────────────────────────────────

export function buildTravelPrompt(
  settings: TravelSettings, candidates: WeekendCandidate[],
): string {
  const prefs = [
    settings.airlines.length ? `Prefer these airlines/sources: ${settings.airlines.join(', ')}.` : '',
    settings.hotels.length   ? `Price these hotels if possible: ${settings.hotels.join(', ')}.`   : '',
  ].filter(Boolean).join(' ')

  const list = candidates.map(c =>
    `{"id": "${c.id}", "to": "${c.destination}", "depart": "${c.departDate}", "return": "${c.returnDate}"}`)

  return [
    `Estimate typical round-trip flight prices (1 adult, from ${settings.origin}) and`,
    `hotel prices for the whole stay (1 adult) in ${settings.currency} for each trip below. ${prefs}`,
    'Use realistic current market levels; if you cannot estimate one, omit it.',
    '',
    'Trips:',
    ...list,
    '',
    'Reply with ONLY a JSON array, no prose, no markdown fence. Each item:',
    '{"id": string (copied from the trip), "flightPrice": number, "airline": string,',
    ' "hotelPrice": number, "hotel": string}',
  ].join('\n')
}

export function parseTravelQuotesText(
  text: string, candidates: WeekendCandidate[], currency: string,
): { quotes: TravelQuote[]; error: string | null } {
  const start = text.indexOf('[')
  const end   = text.lastIndexOf(']')
  if (start === -1 || end <= start) return { quotes: [], error: 'No JSON array found in the reply.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { quotes: [], error: 'The reply is not valid JSON.' }
  }
  if (!Array.isArray(parsed)) return { quotes: [], error: 'The reply is not a JSON array.' }

  // Only ids we actually asked about are accepted — the reply is untrusted.
  const known = new Set(candidates.map(c => c.id))
  const now = new Date().toISOString()
  const quotes: TravelQuote[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || !known.has(r.id)) continue
    const flightPrice = typeof r.flightPrice === 'number' && r.flightPrice > 0 ? r.flightPrice : undefined
    const hotelPrice  = typeof r.hotelPrice  === 'number' && r.hotelPrice  > 0 ? r.hotelPrice  : undefined
    if (flightPrice === undefined && hotelPrice === undefined) continue
    quotes.push({
      candidateId: r.id,
      flightPrice, hotelPrice,
      airline: typeof r.airline === 'string' ? r.airline.slice(0, 60) : undefined,
      hotel:   typeof r.hotel   === 'string' ? r.hotel.slice(0, 60)   : undefined,
      currency, source: 'ai-paste', fetchedAt: now,
    })
  }
  return { quotes: upsertQuotes(quotes), error: null }
}

// ── Manual entry ──────────────────────────────────────────────────────────────
// The user looked the price up on the real site (deep link) and types it in.

export function recordManualQuote(
  candidateId: string, flightPrice: number | undefined,
  hotelPrice: number | undefined, currency: string,
): TravelQuote[] {
  return upsertQuotes([{
    candidateId, flightPrice, hotelPrice, currency,
    source: 'manual', fetchedAt: new Date().toISOString(),
  }])
}

// ── Deals ─────────────────────────────────────────────────────────────────────

export function buildDeals(
  candidates: WeekendCandidate[], quotes: TravelQuote[], settings: TravelSettings,
): WeekendDeal[] {
  const byId = new Map(quotes.map(q => [q.candidateId, q]))
  return candidates.map(candidate => {
    const quote = byId.get(candidate.id) ?? null
    const total = quote && quote.flightPrice !== undefined && quote.hotelPrice !== undefined
      ? quote.flightPrice + quote.hotelPrice
      : null
    return {
      candidate, quote, total,
      withinBudget: total !== null && total <= settings.maxTotal,
    }
  })
}

// An accepted deal lands on the grid as one PUBLIC event laid across every day
// of the trip (custom recurrence over the trip's dates) — a trip proposal to
// the group, so the group can see it, exactly like a poll's spawned event.
export function tripToEventDraft(
  deal: WeekendDeal, settings: TravelSettings, userId: string,
): Omit<CalEvent, 'id' | 'createdAt' | 'calendarId'> {
  const { candidate: c, quote, total } = deal
  const parts = [
    quote?.flightPrice !== undefined
      ? `Flight ~${quote.flightPrice} ${quote.currency}${quote.airline ? ` (${quote.airline})` : ''}` : null,
    quote?.hotelPrice !== undefined
      ? `Hotel ~${quote.hotelPrice} ${quote.currency}${quote.hotel ? ` (${quote.hotel})` : ''}` : null,
    quote ? `Prices via ${quote.source === 'amadeus' ? 'Amadeus (indicative)' : quote.source === 'ai-paste' ? 'AI estimate — verify before booking' : 'manual lookup'}` : null,
  ].filter(Boolean)
  // Custom recurrence expands ONLY specificDates (the base date is not added —
  // see engine/recurrence.ts), so the full span, first day included, goes in.
  const dates = tripDates(deal.candidate)
  return {
    userId,
    title: `✈ ${c.destination} weekend${total !== null ? ` · ~${total} ${settings.currency}` : ''}`,
    description: `${c.departDate} → ${c.returnDate} from ${settings.origin}. ${parts.join(' · ')}`,
    tags:      ['travel'],
    date:      dates[0],
    startHour: 0,
    endHour:   24,
    recurring: dates.length > 1
      ? { frequency: 'custom', specificDates: dates, endDate: c.returnDate }
      : { frequency: 'none' },
    visibility: 'public',
  }
}

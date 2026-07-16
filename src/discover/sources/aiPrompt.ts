// ─── Discover: the AI prompt contract ─────────────────────────────────────────
// Two consumers, one contract:
//
//   • The 'ai-paste' source: the user copies buildEventPrompt()'s text into any
//     free chatbot they already have (Copilot in the browser, Gemini, ChatGPT),
//     and pastes the JSON reply back. Zero keys, zero cost — the AI runs in the
//     user's own tab. This is also the only browser-side way to cover sources
//     with no public API (Meetup retired theirs): an assistant that has read
//     meetup.com can still name its recurring groups.
//
//   • The 'gemini' source (gemini.ts): sends the same prompt to the Gemini API
//     directly, so the round trip is one click instead of copy/paste.
//
// Either way the reply is UNTRUSTED, UNVERIFIED text: parseSuggestionsText
// validates every record at this boundary (normalize.ts) and everything that
// survives is still marked verified:false so the UI can say "AI-suggested —
// check the link before you commit".

import type { DiscoveryQuery, DiscoverySource } from './types'
import type { EventSuggestion } from '../types'
import { EVENT_CATEGORIES } from '../types'
import { sanitizeSuggestion, matchesGranularity } from './normalize'
import { DISCOVER_MAX_PER_SOURCE } from '../../lib/config'

export function buildEventPrompt(query: DiscoveryQuery): string {
  const { location, fromDate, toDate, settings } = query
  const cats = settings.categories.length
    ? EVENT_CATEGORIES.filter(c => settings.categories.includes(c.id)).map(c => c.label).join(', ')
    : 'any kind'
  const days = settings.granularity === 'weekend'
    ? 'Only include events on Fridays, Saturdays or Sundays.'
    : ''
  const place = location.countryCode ? `${location.city} (${location.countryCode})` : location.city

  return [
    `List real public events in ${place} between ${fromDate} and ${toDate}.`,
    `I am interested in: ${cats}. ${days}`,
    'Include recurring events you know of (weekly meetups from meetup.com,',
    'markets, festivals, club nights) on their expected dates. Only include',
    'events you have genuine knowledge of — never invent names or venues.',
    '',
    'Reply with ONLY a JSON array, no prose, no markdown fence. Each item:',
    '{"title": string, "date": "YYYY-MM-DD", "startHour": 0-23, "endHour": 1-24,',
    ` "city": string, "venue": string, "category": one of [${EVENT_CATEGORIES.map(c => `"${c.id}"`).join(', ')}],`,
    ' "url": string (official page if known, else omit), "description": string (one sentence)}',
    `At most ${DISCOVER_MAX_PER_SOURCE} items. If you know none, reply [].`,
  ].join('\n')
}

// The copy/paste flow runs ONE prompt for all watched locations — the user
// should not have to paste once per city. (The API sources stay per-city:
// Ticketmaster queries one city at a time.)
export function buildCombinedEventPrompt(query: DiscoveryQuery): string {
  const cities = query.settings.locations
    .map(l => (l.countryCode ? `${l.city} (${l.countryCode})` : l.city))
    .join('; ')
  return buildEventPrompt(query)
    .replace(/^List real public events in .+? between/,
      `List real public events in each of these places — ${cities} — between`)
}

// Parse a chatbot/Gemini reply. Tolerates the usual dressing (```json fences,
// prose before/after) by extracting the outermost [...] block.
export function parseSuggestionsText(
  text: string,
  query: DiscoveryQuery,
  source: 'gemini' | 'ai-paste',
): { suggestions: EventSuggestion[]; error: string | null } {
  const start = text.indexOf('[')
  const end   = text.lastIndexOf(']')
  if (start === -1 || end <= start) {
    return { suggestions: [], error: 'No JSON array found in the reply.' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { suggestions: [], error: 'The reply is not valid JSON.' }
  }
  if (!Array.isArray(parsed)) {
    return { suggestions: [], error: 'The reply is not a JSON array.' }
  }
  const window = { fromDate: query.fromDate, toDate: query.toDate }
  const suggestions = parsed
    .slice(0, DISCOVER_MAX_PER_SOURCE)
    .map(item => sanitizeSuggestion(item as never, source, false, window))
    .filter((s): s is EventSuggestion => s !== null)
    .filter(s => matchesGranularity(s.date, query.settings.granularity))
  return { suggestions, error: null }
}

// The 'ai-paste' source cannot fetch anything itself — the user is the
// transport. search() therefore returns nothing; the panel drives this source
// through buildEventPrompt + parseSuggestionsText directly.
export const aiPasteSource: DiscoverySource = {
  id: 'ai-paste',
  label: 'AI assistant (copy prompt / paste reply — no key needed)',
  unavailableReason: () => null,
  search: async () => [],
}

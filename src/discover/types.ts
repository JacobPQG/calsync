// ─── Discover: domain types ───────────────────────────────────────────────────
// Event discovery ("what's on near me?") and weekend-trip scanning ("when is a
// trip to X cheap?"). Everything here is PERSONAL, PER-BROWSER state: settings
// and suggestions live in localStorage (see settings.ts), never in Postgres —
// a suggestion becomes shared data only at the moment the user accepts it,
// which creates an ordinary CalEvent through the store's existing write path.
// No new tables, no new RLS surface. See ADR-22.

// ── Event discovery ───────────────────────────────────────────────────────────

// Where suggestions come from. Every source implements sources/types.ts'
// DiscoverySource; the registry in sources/index.ts is the single list.
//   'ticketmaster' — real listings from the Ticketmaster Discovery API (free
//                    key, CORS-enabled — callable straight from the browser).
//   'gemini'       — the Google Gemini API's free tier suggests events it
//                    knows of (recurring festivals, markets, meetups). AI
//                    OUTPUT, marked unverified in the UI.
//   'ai-paste'     — no key at all: the app builds a prompt, the user runs it
//                    in any free chatbot (Copilot, Gemini, ChatGPT) and pastes
//                    the JSON reply back. Also how Meetup is covered — Meetup
//                    retired its public API, so a browser cannot query it
//                    directly (CORS + auth); an AI that has read meetup.com can
//                    still surface its recurring groups.
export type DiscoverySourceId = 'ticketmaster' | 'gemini' | 'ai-paste'

// A place to search. Free-text city; countryCode narrows API results.
export interface DiscoveryLocation {
  city:         string
  countryCode?: string   // ISO 3166-1 alpha-2, e.g. 'DE'
}

// Which days of the window are of interest.
export type DiscoveryGranularity = 'day' | 'weekend'

export interface DiscoverySettings {
  locations:   DiscoveryLocation[]
  // Window: today → today + monthsAhead months.
  monthsAhead: number
  granularity: DiscoveryGranularity
  // Ids from EVENT_CATEGORIES. Empty = all categories.
  categories:  string[]
  // Enabled sources; searches fan out over these.
  sources:     DiscoverySourceId[]
}

// One suggested event, normalized across sources. `id` is a content hash
// (title+date+city) so the same event found twice — or re-found after a
// dismiss — deduplicates and stays dismissed.
export interface EventSuggestion {
  id:          string
  source:      DiscoverySourceId
  title:       string
  description?: string
  category?:   string     // id from EVENT_CATEGORIES, best effort
  date:        string     // YYYY-MM-DD
  startHour:   number     // 0–23
  endHour:     number     // 1–24
  city:        string
  venue?:      string
  url?:        string
  // true = came from a real listings API; false = AI-suggested and unverified.
  // The UI must say which — an AI can misremember a date or invent an event.
  verified:    boolean
}

// Search categories, mapped best-effort onto each source's own taxonomy
// (Ticketmaster's classificationName; plain words in the AI prompts).
export const EVENT_CATEGORIES: { id: string; label: string; emoji: string }[] = [
  { id: 'music',    label: 'Music & concerts', emoji: '🎵' },
  { id: 'arts',     label: 'Arts & theatre',   emoji: '🎭' },
  { id: 'sports',   label: 'Sports',           emoji: '⚽' },
  { id: 'film',     label: 'Film',             emoji: '🎬' },
  { id: 'family',   label: 'Family',           emoji: '🧸' },
  { id: 'food',     label: 'Food & drink',     emoji: '🍜' },
  { id: 'tech',     label: 'Tech & meetups',   emoji: '💻' },
  { id: 'outdoors', label: 'Outdoors',         emoji: '🏞' },
  { id: 'markets',  label: 'Markets & fairs',  emoji: '🛍' },
  { id: 'nightlife',label: 'Nightlife',        emoji: '🌙' },
]

// ── Weekend-trip scanning ─────────────────────────────────────────────────────

export interface TravelSettings {
  // IATA airport/city code (e.g. 'BER'). Required by the flight API; the
  // deep links and AI prompts accept it too.
  origin:       string
  destinations: string[]     // IATA codes of cities being watched
  monthsAhead:  number
  // Trip shape: leave on `departDow` (0=Mon … 6=Sun, matching RecurringRule),
  // stay `nights` nights.
  departDow:    number
  nights:       number
  // The deal threshold: flight + hotel per person, in `currency`.
  maxTotal:     number
  currency:     string       // ISO 4217, e.g. 'EUR'
  // Free-text preferences, folded into AI prompts and shown as reminders next
  // to the deep links. The APIs themselves return whatever is cheapest.
  hotels:       string[]     // preferred hotels
  airlines:     string[]     // preferred airlines / flight sources
}

// One candidate weekend for one destination, enumerated by travel/weekends.ts.
export interface WeekendCandidate {
  id:          string   // `${destination}|${departDate}` — stable across scans
  destination: string
  departDate:  string   // YYYY-MM-DD
  returnDate:  string   // YYYY-MM-DD
}

export type TravelQuoteSource = 'amadeus' | 'ai-paste' | 'manual'

// Prices attached to a candidate. Partial on purpose: a scan may find a
// flight price but no hotel (or vice versa); the threshold test only fires
// when the parts it needs are present.
export interface TravelQuote {
  candidateId: string
  flightPrice?: number
  airline?:     string
  hotelPrice?:  number     // total for the stay, not per night
  hotel?:       string
  currency:     string
  source:       TravelQuoteSource
  fetchedAt:    string     // ISO timestamp
}

// A candidate joined with its best-known quote, judged against the threshold.
export interface WeekendDeal {
  candidate: WeekendCandidate
  quote:     TravelQuote | null
  total:     number | null   // flight + hotel when both known, else null
  withinBudget: boolean      // total !== null && total <= maxTotal
}

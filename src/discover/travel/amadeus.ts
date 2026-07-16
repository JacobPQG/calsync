// ─── Travel: Amadeus price source ─────────────────────────────────────────────
// The one real flight+hotel price API a hobby deployment can use: Amadeus
// Self-Service has a free tier with test-environment quotas, and its endpoints
// are CORS-enabled. Prices from the test environment are CACHED/INDICATIVE —
// good enough to spot "this weekend is cheap", not a bookable fare; the deep
// links (links.ts) are the ground truth.
//
// ⚠ Key exposure: OAuth here is client_credentials, so VITE_AMADEUS_* end up
// readable in the static bundle like every VITE_ var. That is tolerable ONLY
// for a free test-tier key (worst case: someone drains your test quota). A
// production Amadeus key must NOT ship this way — move the calls behind a
// Supabase Edge Function holding the secret first. config.ts says the same.

import type { TravelQuote, TravelSettings, WeekendCandidate } from '../types'
import {
  AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET, AMADEUS_API_BASE, TRAVEL_HOTELS_PER_QUERY,
} from '../../lib/config'
import { log } from '../../lib/log'

export function amadeusUnavailableReason(): string | null {
  return AMADEUS_CLIENT_ID && AMADEUS_CLIENT_SECRET
    ? null
    : 'Set VITE_AMADEUS_CLIENT_ID / VITE_AMADEUS_CLIENT_SECRET (free test key) to enable price scans.'
}

// ── OAuth token, cached until shortly before expiry ───────────────────────────

let token: { value: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value
  const res = await fetch(`${AMADEUS_API_BASE}/v1/security/oauth2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     AMADEUS_CLIENT_ID,
      client_secret: AMADEUS_CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`Amadeus auth failed (${res.status})`)
  const json = await res.json() as { access_token: string; expires_in: number }
  token = {
    value: json.access_token,
    // Refresh a minute early so a scan never runs into mid-loop expiry.
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  }
  return token.value
}

async function apiGet<T>(path: string, params: URLSearchParams): Promise<T> {
  const t = await getToken()
  const res = await fetch(`${AMADEUS_API_BASE}${path}?${params}`, {
    headers: { Authorization: `Bearer ${t}` },
  })
  if (!res.ok) throw new Error(`Amadeus ${path} responded ${res.status}`)
  return res.json() as Promise<T>
}

// ── Flights: cheapest round-trip offer for the candidate ─────────────────────

interface FlightOffersResponse {
  data?: {
    price?: { grandTotal?: string }
    validatingAirlineCodes?: string[]
  }[]
}

async function cheapestFlight(
  c: WeekendCandidate, s: TravelSettings,
): Promise<{ price: number; airline?: string } | null> {
  const json = await apiGet<FlightOffersResponse>('/v2/shopping/flight-offers',
    new URLSearchParams({
      originLocationCode:      s.origin,
      destinationLocationCode: c.destination,
      departureDate:           c.departDate,
      returnDate:              c.returnDate,
      adults:       '1',
      currencyCode: s.currency,
      max:          '5',
    }))
  const offers = (json.data ?? [])
    .map(o => ({ price: Number(o.price?.grandTotal), airline: o.validatingAirlineCodes?.[0] }))
    .filter(o => Number.isFinite(o.price))
  if (!offers.length) return null
  return offers.reduce((a, b) => (a.price <= b.price ? a : b))
}

// ── Hotels: cheapest offer among the city's first N hotels ───────────────────
// Two-step on Amadeus: list hotel ids by city (cached per destination — the
// list is static), then price offers for a batch of ids over the stay.

const hotelIdCache = new Map<string, { id: string; name: string }[]>()

async function cityHotels(cityCode: string): Promise<{ id: string; name: string }[]> {
  const cached = hotelIdCache.get(cityCode)
  if (cached) return cached
  const json = await apiGet<{ data?: { hotelId?: string; name?: string }[] }>(
    '/v1/reference-data/locations/hotels/by-city',
    new URLSearchParams({ cityCode }))
  const hotels = (json.data ?? [])
    .filter(h => h.hotelId)
    .map(h => ({ id: h.hotelId!, name: h.name ?? h.hotelId! }))
  hotelIdCache.set(cityCode, hotels)
  return hotels
}

interface HotelOffersResponse {
  data?: {
    hotel?: { name?: string }
    offers?: { price?: { total?: string } }[]
  }[]
}

async function cheapestHotel(
  c: WeekendCandidate, s: TravelSettings,
): Promise<{ price: number; hotel: string } | null> {
  let hotels = await cityHotels(c.destination)
  // Preferred hotels first: keep only name matches when the user named any
  // and at least one is present in this city.
  if (s.hotels.length) {
    const wanted = s.hotels.map(h => h.toLowerCase())
    const matches = hotels.filter(h => wanted.some(w => h.name.toLowerCase().includes(w)))
    if (matches.length) hotels = matches
  }
  const ids = hotels.slice(0, TRAVEL_HOTELS_PER_QUERY).map(h => h.id)
  if (!ids.length) return null

  const json = await apiGet<HotelOffersResponse>('/v3/shopping/hotel-offers',
    new URLSearchParams({
      hotelIds:     ids.join(','),
      checkInDate:  c.departDate,
      checkOutDate: c.returnDate,
      adults:       '1',
      currency:     s.currency,
    }))
  const offers = (json.data ?? [])
    .map(d => ({
      hotel: d.hotel?.name ?? 'Hotel',
      price: Number(d.offers?.[0]?.price?.total),
    }))
    .filter(o => Number.isFinite(o.price))
  if (!offers.length) return null
  return offers.reduce((a, b) => (a.price <= b.price ? a : b))
}

// ── One candidate → one quote ─────────────────────────────────────────────────
// Partial results are results: a flight with no hotel offer still tells the
// user something, so hotel failures degrade to "flight only" rather than
// sinking the quote.

export async function quoteCandidate(
  c: WeekendCandidate, s: TravelSettings,
): Promise<TravelQuote | null> {
  const flight = await cheapestFlight(c, s)
  let hotel: { price: number; hotel: string } | null = null
  try {
    hotel = await cheapestHotel(c, s)
  } catch (e) {
    log.warn('discover', `hotel quote failed for ${c.id}: ${String(e)}`)
  }
  if (!flight && !hotel) return null
  return {
    candidateId: c.id,
    flightPrice: flight?.price,
    airline:     flight?.airline,
    hotelPrice:  hotel?.price,
    hotel:       hotel?.hotel,
    currency:    s.currency,
    source:      'amadeus',
    fetchedAt:   new Date().toISOString(),
  }
}

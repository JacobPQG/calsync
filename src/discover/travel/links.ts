// ─── Travel: deep links ───────────────────────────────────────────────────────
// Google Flights and Booking.com have NO public price API a browser could call
// (Google Flights' data is partner-only; scraping either is CORS-blocked and
// against their terms). What a static SPA CAN do — reliably and at zero cost —
// is deep-link straight to the search results for one candidate weekend: one
// click shows live prices on the real site, and the "record price" flow lets
// the user carry the number back. These builders are pure string work.

import type { TravelSettings, WeekendCandidate } from '../types'

// Google Flights accepts a natural-language query; this form has been stable
// for years and needs no partner API.
export function googleFlightsUrl(c: WeekendCandidate, s: TravelSettings): string {
  const q = `flights from ${s.origin} to ${c.destination} on ${c.departDate} through ${c.returnDate}`
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`
}

export function bookingUrl(c: WeekendCandidate, s: TravelSettings): string {
  const params = new URLSearchParams({
    ss:       c.destination,
    checkin:  c.departDate,
    checkout: c.returnDate,
    group_adults: '1',
  })
  // A preferred hotel narrows the search string — Booking treats ss as free text.
  if (s.hotels.length) params.set('ss', `${s.hotels[0]} ${c.destination}`)
  return `https://www.booking.com/searchresults.html?${params}`
}

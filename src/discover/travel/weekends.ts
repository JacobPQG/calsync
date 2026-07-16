// ─── Travel: weekend enumeration ──────────────────────────────────────────────
// Pure date logic, no I/O: expand TravelSettings into the list of candidate
// trips — every occurrence of the chosen departure weekday within the window,
// for every watched destination. Everything downstream (deep links, price
// scans, the deals table) is keyed by these candidates' stable ids.

import type { TravelSettings, WeekendCandidate } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Settings use 0=Mon … 6=Sun (the RecurringRule convention); JS Date.getUTCDay
// is 0=Sun … 6=Sat. Convert once, here.
function toJsDow(dow: number): number {
  return (dow + 1) % 7
}

export function enumerateWeekends(settings: TravelSettings): WeekendCandidate[] {
  const out: WeekendCandidate[] = []
  const start = new Date()
  const end   = new Date()
  end.setMonth(end.getMonth() + settings.monthsAhead)

  // First occurrence of the departure weekday strictly after today.
  const cursor = new Date(Date.UTC(
    start.getFullYear(), start.getMonth(), start.getDate()))
  const wanted = toJsDow(settings.departDow)
  do { cursor.setTime(cursor.getTime() + DAY_MS) } while (cursor.getUTCDay() !== wanted)

  while (cursor <= end) {
    const departDate = iso(cursor)
    const returnDate = iso(new Date(cursor.getTime() + settings.nights * DAY_MS))
    for (const destination of settings.destinations) {
      out.push({
        id: `${destination}|${departDate}`,
        destination, departDate, returnDate,
      })
    }
    cursor.setTime(cursor.getTime() + 7 * DAY_MS)
  }
  return out
}

// Every date of the trip (departure through return, inclusive) — used to lay
// an accepted trip across the calendar grid via a custom recurrence.
export function tripDates(c: WeekendCandidate): string[] {
  const dates: string[] = []
  const d = new Date(`${c.departDate}T12:00:00Z`)
  const last = new Date(`${c.returnDate}T12:00:00Z`)
  while (d <= last) {
    dates.push(iso(d))
    d.setTime(d.getTime() + DAY_MS)
  }
  return dates
}

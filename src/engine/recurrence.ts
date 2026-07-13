// ─── Recurrence engine ───────────────────────────────────────────────────────
// Pure function: given an event and a date range, returns all dates it occurs on.

import { eachDayOfInterval, parseISO, format, getDay, isWithinInterval } from 'date-fns'
import type { CalEvent, EventInstance, DaySummary, User } from '../types'
import { filterForViewer } from './visibility'

export function expandEvent(event: CalEvent, rangeStart: Date, rangeEnd: Date): string[] {
  const { recurring, date } = event
  const baseDate = parseISO(date)
  const endBound = recurring.endDate ? parseISO(recurring.endDate) : rangeEnd

  if (recurring.frequency === 'none') {
    // Single event — only include if within range
    const d = format(baseDate, 'yyyy-MM-dd')
    return baseDate >= rangeStart && baseDate <= rangeEnd ? [d] : []
  }

  const effectiveEnd = endBound < rangeEnd ? endBound : rangeEnd
  if (baseDate > effectiveEnd) return []

  const effectiveStart = baseDate > rangeStart ? baseDate : rangeStart
  const allDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd })

  if (recurring.frequency === 'custom') {
    return (recurring.specificDates ?? []).filter(d => {
      const parsed = parseISO(d)
      return isWithinInterval(parsed, { start: rangeStart, end: effectiveEnd })
    })
  }

  return allDays
    .filter(day => {
      if (recurring.frequency === 'daily') return true
      if (recurring.frequency === 'weekly') {
        const dow = (getDay(day) + 6) % 7  // convert Sun=0 to Mon=0
        return (recurring.daysOfWeek ?? []).includes(dow)
      }
      if (recurring.frequency === 'monthly') {
        return day.getDate() === baseDate.getDate()
      }
      return false
    })
    .map(d => format(d, 'yyyy-MM-dd'))
}

// ─── Overlap detector ────────────────────────────────────────────────────────
// Builds a DaySummary map for the entire visible range, as seen by one viewer.
//
// `viewerId` is the user the summaries are FOR: anonymous events belonging to
// other people are withheld from them until something coincides (see
// engine/visibility.ts). Pass null for a signed-out viewer, who owns nothing.
//
// `serverHiddenCounts` carries the withheld-event tallies in Supabase mode, where
// RLS is the enforcement point and the hidden events never reach the browser at
// all — so the client cannot count what it cannot see, and the server must tell
// it. In localStorage mode there is no server and no RLS: every event is in hand,
// the client-side filter does the withholding, and its own count is the truth.
//
// Exactly one of the two is meaningful per mode, so the server count simply wins
// where it exists. They are never added — a sum would double-count the day RLS
// leaks something it shouldn't, which is precisely the day we'd want the number
// to stay honest.
export function buildDaySummaries(
  events: CalEvent[],
  users: User[],
  rangeStart: Date,
  rangeEnd: Date,
  viewerId: string | null = null,
  serverHiddenCounts?: Map<string, number>,
): Map<string, DaySummary> {
  const userMap = new Map(users.map(u => [u.id, u]))

  // Pass 1 — expand every event into the days it occurs on. Coincidence is a
  // property of the whole day, so nothing can be filtered until the day is
  // complete: an event only knows it's been matched once its neighbours exist.
  const byDate = new Map<string, EventInstance[]>()
  for (const event of events) {
    const user = userMap.get(event.userId)
    if (!user) continue

    for (const date of expandEvent(event, rangeStart, rangeEnd)) {
      const day = byDate.get(date) ?? []
      day.push({ event, user, date })
      byDate.set(date, day)
    }
  }

  // Pass 2 — reduce each complete day to what this viewer may see.
  const map = new Map<string, DaySummary>()
  for (const [date, all] of byDate) {
    const { visible, hiddenCount } = filterForViewer(all, viewerId)

    const dayUsers: User[] = []
    for (const i of visible) {
      if (!dayUsers.find(u => u.id === i.user.id)) dayUsers.push(i.user)
    }

    map.set(date, {
      date,
      instances:   visible,
      users:       dayUsers,
      isOverlap:   dayUsers.length >= 2,
      hiddenCount: serverHiddenCounts?.get(date) ?? hiddenCount,
    })
  }

  // Pass 3 — days that are ONLY a hint. Under RLS the withheld events never
  // arrive, so a date where everyone's events are hidden produces no instances
  // and never entered `byDate` above — yet it is exactly the day we most want to
  // flag ("someone is quietly free here"). Materialise a summary for it.
  if (serverHiddenCounts) {
    for (const [date, hiddenCount] of serverHiddenCounts) {
      if (hiddenCount <= 0 || map.has(date)) continue
      const d = parseISO(date)
      if (d < rangeStart || d > rangeEnd) continue
      map.set(date, {
        date, instances: [], users: [], isOverlap: false, hiddenCount,
      })
    }
  }

  return map
}

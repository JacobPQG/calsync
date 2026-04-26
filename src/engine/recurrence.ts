// ─── Recurrence engine ───────────────────────────────────────────────────────
// Pure function: given an event and a date range, returns all dates it occurs on.

import { eachDayOfInterval, parseISO, format, getDay, isWithinInterval } from 'date-fns'
import type { CalEvent, EventInstance, DaySummary, User } from '../types'

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
// Builds a DaySummary map for the entire visible range.

export function buildDaySummaries(
  events: CalEvent[],
  users: User[],
  rangeStart: Date,
  rangeEnd: Date
): Map<string, DaySummary> {
  const userMap = new Map(users.map(u => [u.id, u]))
  const map = new Map<string, DaySummary>()

  for (const event of events) {
    const user = userMap.get(event.userId)
    if (!user) continue

    const dates = expandEvent(event, rangeStart, rangeEnd)
    for (const date of dates) {
      if (!map.has(date)) {
        map.set(date, { date, instances: [], users: [], isOverlap: false })
      }
      const summary = map.get(date)!
      summary.instances.push({ event, user, date })
      if (!summary.users.find(u => u.id === user.id)) {
        summary.users.push(user)
      }
    }
  }

  // Mark overlap days
  for (const summary of map.values()) {
    summary.isOverlap = summary.users.length >= 2
  }

  return map
}

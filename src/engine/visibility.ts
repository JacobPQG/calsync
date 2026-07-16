// ─── Visibility engine ────────────────────────────────────────────────────────
// Decides which events a given viewer may see on a given day. Pure functions —
// no store, no React. The single source of truth for the anonymous/public rule;
// every consumer (month grid, day sidebar, ranking) goes through here.
//
// The rule (see types.ts EventVisibility):
//   • You always see your own events, whatever their visibility.
//   • A 'public' event is always visible to everyone.
//   • An 'anonymous' event is visible to others only once it COINCIDES with an
//     event owned by a different user — same day, overlapping hours. Until then
//     it is withheld and counted into DaySummary.hiddenCount instead, so the day
//     can show a de-identified "somebody created something" hint.
//
// NOTE: this is a presentation-layer rule. It decides what the UI reports, not
// what the server hands out — an unmatched anonymous event is still delivered to
// the client. Enforcing it for real needs an RLS policy; see
// docs/design-decisions.md.

import type { CalEvent, EventInstance, EventVisibility } from '../types'
import { DEFAULT_VISIBILITY } from '../types'

/** Events stored before `visibility` existed are anonymous — the standard. */
export function visibilityOf(event: CalEvent): EventVisibility {
  return event.visibility ?? DEFAULT_VISIBILITY
}

export function isPublic(event: CalEvent): boolean {
  return visibilityOf(event) === 'public'
}

/** Same-day time overlap. Half-open, so 9–11 and 11–13 do NOT coincide. */
export function hoursOverlap(a: CalEvent, b: CalEvent): boolean {
  return a.startHour < b.endHour && b.startHour < a.endHour
}

/**
 * True when some OTHER user's event on this same day overlaps `event` in time.
 * This is what "others coincide" means, and what unlocks an anonymous event.
 *
 * Any event by another user counts as a coincidence — including another
 * unmatched anonymous one. Two people quietly free at the same hour is exactly
 * the case this feature exists to surface, so they reveal to each other.
 *
 * The match must be in the SAME CALENDAR. Calendars are the privacy boundary,
 * and the overview view now feeds this function events from several calendars
 * at once — without the check, an event in calendar A could unlock an
 * anonymous one in calendar B. Mirrors event_has_coincidence() in
 * db/schema/30_visibility.sql, which imposes the same rule; the two must stay
 * in lockstep.
 */
export function hasCoincidence(event: CalEvent, sameDay: EventInstance[]): boolean {
  return sameDay.some(o =>
    o.event.userId !== event.userId
    && o.event.calendarId === event.calendarId
    && hoursOverlap(o.event, event))
}

/**
 * True when `viewer` may see `event` on a day whose full instance list is
 * `sameDay`. `viewerId` is null when nobody is signed in — such a viewer owns
 * nothing, so they see only public and matched-anonymous events.
 */
export function canView(
  event: CalEvent,
  sameDay: EventInstance[],
  viewerId: string | null,
): boolean {
  if (event.userId === viewerId) return true
  if (isPublic(event))           return true
  return hasCoincidence(event, sameDay)
}

/**
 * Split a day's instances into what `viewerId` may see and how many were
 * withheld. Withheld ones are unmatched anonymous events by other users; they
 * survive only as a count, which is what keeps them anonymous.
 */
export function filterForViewer(
  sameDay: EventInstance[],
  viewerId: string | null,
): { visible: EventInstance[]; hiddenCount: number } {
  const visible = sameDay.filter(i => canView(i.event, sameDay, viewerId))
  return { visible, hiddenCount: sameDay.length - visible.length }
}

/**
 * The events `viewerId` may see, across the whole calendar rather than one day.
 * For anything that leaves the app with events in it — an .ics export, a share
 * link — where "which day am I looking at" isn't the question; "what am I
 * allowed to hand over" is.
 *
 * Coincidence is judged per calendar date, not per recurrence expansion: an
 * event is released if it is matched on ANY day it occurs. That's the same
 * threshold the UI uses — once a match reveals an event, it's revealed, and a
 * file that omitted it would contradict what the user can already see.
 */
export function visibleEvents(
  events: CalEvent[],
  viewerId: string | null,
): CalEvent[] {
  // Group by the event's own date. Recurring events are compared on their base
  // date, which is where the calendar anchors them.
  const byDate = new Map<string, CalEvent[]>()
  for (const e of events) {
    const day = byDate.get(e.date) ?? []
    day.push(e)
    byDate.set(e.date, day)
  }

  return events.filter(event => {
    if (event.userId === viewerId) return true
    if (isPublic(event))           return true
    const sameDay = byDate.get(event.date) ?? []
    // Same-calendar only, like hasCoincidence above and the RLS policy.
    return sameDay.some(o =>
      o.userId !== event.userId
      && o.calendarId === event.calendarId
      && hoursOverlap(o, event))
  })
}

// ─── DayView ViewModel ────────────────────────────────────────────────────────
// All logic for the day sidebar: which day is selected, the hour-timeline
// geometry (column layout for overlapping events + current-time marker), the
// three view states (empty / timeline / event detail), and the event-detail
// derivation (result winner, relative time, safe URLs, owner checks).
//
// MVVM boundary: no JSX here. The view (DayView.view.tsx) renders from the
// plain objects this returns. Timeline PIXEL constants live in the view's
// STYLE block; this file receives them so geometry and rendering stay in sync.

import { useMemo, useState, useEffect } from 'react'
import {
  format, parseISO, formatDistanceToNow, isFuture, isToday as dateFnsIsToday,
} from 'date-fns'
import type { CalEvent, EventInstance } from '../types'
import { useStore }          from '../store/useStore'
import { buildDaySummaries } from '../engine/recurrence'
import { safeUrl }           from '../utils/safeUrl'
import { isPublic, hasCoincidence } from '../engine/visibility'
import { activityById, activityLabel } from '../sports/activities'

// ── Timeline geometry ─────────────────────────────────────────────────────────
// Which hours the timeline spans. These are logic (they decide positions), so
// they live here; the view's STYLE block holds HOUR_PX / LABEL_W (the pixels).
export const FIRST_HOUR = 6
export const LAST_HOUR  = 23

// ── Time formatting (pure) ────────────────────────────────────────────────────

// 9 → "9 AM", 9.5 → "9:30 AM" (compact; used on the hour ruler).
export function fmtHour(h: number): string {
  const hour = Math.floor(h)
  const min  = h % 1 !== 0 ? ':30' : ''
  if (hour === 0 || hour === 24) return `12${min} AM`
  if (hour === 12)               return `12${min} PM`
  return hour < 12 ? `${hour}${min} AM` : `${hour - 12}${min} PM`
}

// Always includes :00/:30 (used in the event detail).
export function fmtTime(h: number): string {
  const hour = Math.floor(h)
  const min  = h % 1 !== 0 ? ':30' : ':00'
  if (hour === 0 || hour === 24) return `12${min} AM`
  if (hour === 12)               return `12${min} PM`
  return hour < 12 ? `${hour}${min} AM` : `${hour - 12}${min} PM`
}

// ── Column layout for overlapping events (pure, greedy) ───────────────────────
// Sort by start; give each event the lowest column not taken by an earlier
// overlapping event; numCols = width of its overlap cluster.

export interface LayoutItem { inst: EventInstance; col: number; numCols: number }

function eventsOverlap(a: CalEvent, b: CalEvent): boolean {
  return a.startHour < b.endHour && b.startHour < a.endHour
}

export function layoutInstances(instances: EventInstance[]): LayoutItem[] {
  if (instances.length === 0) return []
  const sorted = [...instances].sort((a, b) => a.event.startHour - b.event.startHour)
  const n    = sorted.length
  const cols = new Array<number>(n).fill(0)

  for (let i = 0; i < n; i++) {
    const used = new Set<number>()
    for (let j = 0; j < i; j++) {
      if (eventsOverlap(sorted[j].event, sorted[i].event)) used.add(cols[j])
    }
    let c = 0
    while (used.has(c)) c++
    cols[i] = c
  }

  return sorted.map((inst, i) => {
    let maxCol = cols[i]
    for (let j = 0; j < n; j++) {
      if (j !== i && eventsOverlap(inst.event, sorted[j].event)) {
        maxCol = Math.max(maxCol, cols[j])
      }
    }
    return { inst, col: cols[i], numCols: maxCol + 1 }
  })
}

// De-dupe recurring expansions that produce the same event twice on one day.
export function dedupeInstances(instances: EventInstance[]): EventInstance[] {
  const seen = new Set<string>()
  return instances.filter(i => {
    if (seen.has(i.event.id)) return false
    seen.add(i.event.id)
    return true
  })
}

// ── Day-level ViewModel ───────────────────────────────────────────────────────

export interface DayViewVM {
  hasSelection: boolean
  dayLabel:     string              // "EEEE, MMMM d"
  isOverlap:    boolean
  overlapNames: string             // "Ana · Bo available" text (empty if none)
  instances:    EventInstance[]    // de-duped events for the selected day
  isToday:      boolean
  // Other people's unmatched anonymous events on this day. Shown as a
  // de-identified count only ("2 others have something here, unmatched").
  hiddenCount:  number

  // Event-detail state (null = show the timeline).
  activeEvent:   EventInstance | null
  openEvent:    (i: EventInstance) => void
  closeEvent:   () => void

  // Add / edit form state.
  showAddForm:   boolean
  openAddForm:  () => void
  closeAddForm: () => void
  editingEvent:  CalEvent | null
  openEdit:     (e: CalEvent) => void
  closeEdit:    () => void

  deleteActiveEvent: () => void
  selectedDate: string | null      // passed to the add form
}

export function useDayViewVM(): DayViewVM {
  const {
    selectedDate, events, users, activeUserId, hiddenCounts, deleteEvent,
  } = useStore()

  const [showAddForm,  setShowAddForm]  = useState(false)
  const [activeEvent,  setActiveEvent]  = useState<EventInstance | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null)

  // Reuses the store's hidden-count map, which MonthGrid keeps fresh for the
  // visible window — the selected day is always inside it, so no extra fetch.
  const summary = useMemo(() => {
    if (!selectedDate) return null
    const d = parseISO(selectedDate)
    return buildDaySummaries(events, users, d, d, activeUserId, hiddenCounts)
      .get(selectedDate) ?? null
  }, [selectedDate, events, users, activeUserId, hiddenCounts])

  // Reset detail/edit state whenever the day changes.
  useEffect(() => { setActiveEvent(null); setEditingEvent(null) }, [selectedDate])

  const instances = useMemo(
    () => dedupeInstances(summary?.instances ?? []), [summary])

  return {
    hasSelection: !!selectedDate,
    dayLabel:     selectedDate ? format(parseISO(selectedDate), 'EEEE, MMMM d') : '',
    isOverlap:    summary?.isOverlap ?? false,
    overlapNames: summary?.isOverlap
      ? `${summary.users.map(u => u.name).join(' · ')} available` : '',
    instances,
    isToday:      selectedDate ? dateFnsIsToday(parseISO(selectedDate)) : false,
    hiddenCount:  summary?.hiddenCount ?? 0,

    activeEvent,
    openEvent:  setActiveEvent,
    closeEvent: () => setActiveEvent(null),

    showAddForm,
    openAddForm:  () => setShowAddForm(true),
    closeAddForm: () => setShowAddForm(false),
    editingEvent,
    openEdit:  setEditingEvent,
    closeEdit: () => setEditingEvent(null),

    deleteActiveEvent: () => {
      if (activeEvent) { deleteEvent(activeEvent.event.id); setActiveEvent(null) }
    },
    selectedDate,
  }
}

// ── Current-time marker (its own hook so only the timeline re-renders) ─────────
// Returns the Y pixel of "now" within the timeline, or null if now is outside
// the visible hour range. `enabled` is false when the selected day isn't today.
export function useCurrentTimeY(hourPx: number, enabled: boolean): number | null {
  const [y, setY] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) { setY(null); return }
    function tick() {
      const now  = new Date()
      const frac = now.getHours() + now.getMinutes() / 60
      const py   = (frac - FIRST_HOUR) * hourPx
      const max  = (LAST_HOUR - FIRST_HOUR) * hourPx
      setY(py >= 0 && py <= max ? py : null)
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [hourPx, enabled])
  return y
}

// ── Event-detail ViewModel ────────────────────────────────────────────────────

export interface TeamRowVM {
  name:    string
  members: string   // comma-joined member names
  score:   number
  won:     boolean  // top score
}

export interface EventDetailVM {
  event:        CalEvent
  color:        string
  userInitial:  string
  userName:     string
  isOwner:      boolean

  activityLabel: string | null

  canScore:     boolean          // owner + scores feature on
  hasResult:    boolean
  teamRows:     TeamRowVM[]
  isDraw:       boolean

  timeRange:    string           // "9:00 AM – 5:00 PM"
  relativeTime: string           // "in 3 hours"
  isUpcoming:   boolean

  mapsUrl:      string | null
  eventUrl:     string | null
  recurrenceLabel: string | null // "Weekly · until 2026-08-01", or null

  // Visibility, explained in the owner's own terms. Non-owners never see this —
  // by the time they can open an event it is public or already matched, so the
  // badge would tell them nothing.
  visibilityBadge: { icon: string; label: string; hint: string } | null
}

/**
 * Derives everything the event-detail view renders. Reads the event fresh from
 * the store so a just-recorded result shows without re-selecting the day.
 */
export function useEventDetailVM(instance: EventInstance): EventDetailVM {
  const { activeUserId, users, events, features } = useStore()
  const liveEvent = useStore(s => s.events.find(e => e.id === instance.event.id))

  const { user, date } = instance
  const event   = liveEvent ?? instance.event
  const color   = event.color ?? user.color
  const isOwner = event.userId === activeUserId

  // Has anyone else landed on this event's slot?
  //
  // This is computed from the events WE hold — which, in Supabase mode, RLS has
  // already filtered. So it detects a match we can see, and it cannot rule out
  // one we can't: someone outside our share graph may have coincided with this
  // event and been shown it, without their event ever reaching us.
  //
  // The badge below is therefore worded to claim only what this can support. It
  // never promises "nobody has seen this" — an over-confident privacy indicator
  // is worse than a vague one, because it invites the user to write something
  // they'd only write if they believed it were truly unseen.
  const revealed = useMemo(() => {
    const d = parseISO(date)
    const sameDay = buildDaySummaries(events, users, d, d, null).get(date)?.instances ?? []
    return hasCoincidence(event, sameDay)
  }, [event, events, users, date])

  const visibilityBadge = !isOwner ? null
    : isPublic(event)
      ? { icon: '📣', label: 'Public',
          hint: 'Everyone you share with can see this, and that it is yours.' }
    : revealed
      ? { icon: '👀', label: 'Anonymous · matched',
          hint: 'Someone else coincides here, so this is now visible to them.' }
      : { icon: '🕶️', label: 'Anonymous',
          hint: 'Shown to someone only once their own event overlaps this one. Until then they see only that somebody has something on this day.' }

  const winningScore = event.result
    ? Math.max(...event.result.teams.map(t => t.score)) : null
  const isDraw = event.result
    ? event.result.teams.filter(t => t.score === winningScore).length > 1 : false

  const teamRows: TeamRowVM[] = event.result
    ? event.result.teams.map(t => ({
        name:    t.name,
        members: t.memberIds.map(id => users.find(u => u.id === id)?.name)
                            .filter(Boolean).join(', '),
        score:   t.score,
        won:     t.score === winningScore,
      }))
    : []

  const h = Math.floor(event.startHour)
  const m = event.startHour % 1 !== 0 ? '30' : '00'
  const eventStart = new Date(`${date}T${String(h).padStart(2, '0')}:${m}:00`)

  const mapsQuery  = event.location?.address || event.location?.name
  const rawMapsUrl = event.location?.mapsUrl
    ?? (mapsQuery ? `https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}` : null)

  const freq = event.recurring.frequency
  const recurrenceLabel = freq !== 'none'
    ? freq.charAt(0).toUpperCase() + freq.slice(1)
      + (event.recurring.endDate ? ` · until ${event.recurring.endDate}` : '')
    : null

  return {
    event,
    color,
    userInitial: user.name[0].toUpperCase(),
    userName:    user.name,
    isOwner,
    activityLabel: activityLabel(event.activity),
    // Scores are an opt-in of THIS calendar, not of the build. Owner-only either
    // way: recording a result is an edit of the event.
    canScore:  features.scores && isOwner,
    hasResult: !!event.result,
    teamRows,
    isDraw,
    timeRange:    `${fmtTime(event.startHour)} – ${fmtTime(event.endHour)}`,
    relativeTime: formatDistanceToNow(eventStart, { addSuffix: true }),
    isUpcoming:   isFuture(eventStart),
    mapsUrl:  safeUrl(rawMapsUrl),
    eventUrl: safeUrl(event.eventUrl),
    recurrenceLabel,
    visibilityBadge,
  }
}

// Re-export so the view can build activity emoji labels without another import.
export { activityById }

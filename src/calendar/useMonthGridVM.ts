// ─── MonthGrid ViewModel ──────────────────────────────────────────────────────
// All logic for the month calendar lives here: store access, date-grid
// computation, the "best days" ranking, and the click handlers. The view
// (MonthGrid.view.tsx) consumes this hook and contains only JSX + styling.
//
// MVVM boundary: this file has NO JSX and imports nothing visual. If you're
// reshaping how the calendar looks, you almost never need to touch this file —
// edit MonthGrid.view.tsx instead. If you're changing behavior (what counts as
// a "best day", navigation, selection), edit here.

import { useEffect, useMemo, useState } from 'react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday, parseISO,
} from 'date-fns'
import type { DaySummary, User } from '../types'
import { isOverviewCalendar } from '../types'
import { useStore }          from '../store/useStore'
import { buildDaySummaries } from '../engine/recurrence'
import { activityById }      from '../sports/activities'
import { buildDayPollMarkers } from '../polls/pollLogic'

// How many "best days" cards the ranking row shows.
const RANKING_LIMIT = 10

// ── Types the view renders from ───────────────────────────────────────────────

// One calendar cell, fully resolved — the view just reads these fields.
export interface DayCellVM {
  date:      string       // yyyy-MM-dd (stable key + click payload)
  label:     string       // day number, e.g. "7"
  inMonth:   boolean
  today:     boolean
  selected:  boolean
  isOverlap: boolean
  users:     User[]       // one colour dot per unique user
  userCount: number       // === users.length; convenience for the overlap badge
  // Unmatched anonymous events by other people. Renders as a de-identified
  // "somebody has something here" hint — never a name, time, or title.
  hiddenCount: number
  // Poll marker (ADR-19): a rounded square drawn at the right of the cell when a
  // poll has a slot on this day. Absent (null) when no poll touches the day.
  poll: {
    count:       number   // distinct open polls on this day
    needsMyVote: boolean  // an open poll here I have not voted on
    hasClosed:   boolean  // a decided poll whose winner is this day
  } | null
}

// One "best days" ranking card.
export interface RankingCardVM {
  date:       string
  weekdayNum: string      // "EEE d", e.g. "Wed 7"
  isToday:    boolean
  isSelected: boolean
  isOverlap:  boolean
  users:      User[]
  tags:       string[]    // up to 3 unique tags across the day's events
  emojis:     string[]    // up to 4 unique activity emojis (sports variant)
  eventCount: number
  hiddenCount: number     // de-identified "someone's free here too" hint
}

export interface MonthGridVM {
  monthLabel: string          // "MMMM yyyy"
  weekdays:   string[]        // column headers, Mon..Sun
  cells:      DayCellVM[]     // 6 weeks × 7 days, in order
  ranking:    RankingCardVM[] // best days this month (may be empty)
  goToToday:  () => void
  goPrevMonth: () => void
  goNextMonth: () => void
  toggleDay:  (date: string) => void
  selectDay:  (date: string) => void

  // Add-event modal, opened from the actions panel under the grid. False in the
  // OVERVIEW — it aggregates several calendars, so a new event would have no
  // single calendar to land in (the store's addEvent refuses too).
  canAddEvents: boolean
  showAddForm:  boolean
  openAddForm:  () => void
  closeAddForm: () => void
  addFormDate:  string        // the selected day, or today when none is picked
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function useMonthGridVM(): MonthGridVM {
  const {
    currentMonth, events, users, activeUserId, polls,
    hiddenCounts, refreshHiddenCounts,
    selectedDate, setSelectedDate,
    navigateMonth, setCurrentMonth,
    activeCalendarId,
  } = useStore()

  const [showAddForm, setShowAddForm] = useState(false)

  // The visible 6-week window. Derived once — it also bounds the hidden-count
  // fetch, so the two always agree on which dates are on screen.
  const { start, end } = useMemo(() => ({
    start: startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }),
    end:   endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 }),
  }), [currentMonth])

  // Under RLS the withheld events never reach us, so the server has to tell us
  // how many there are. Re-fetch whenever the window moves. (No-op in
  // localStorage mode, where the client already holds every event.)
  useEffect(() => {
    refreshHiddenCounts(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'))
  }, [start, end, events, refreshHiddenCounts])

  // Grid days + per-day summaries, as seen by the active user (other people's
  // unmatched anonymous events are withheld; only their tally comes through).
  const { days, summaries } = useMemo(() => ({
    days:      eachDayOfInterval({ start, end }),
    summaries: buildDaySummaries(events, users, start, end, activeUserId, hiddenCounts),
  }), [start, end, events, users, activeUserId, hiddenCounts])

  // Poll markers per day, from the active user's point of view (which open polls
  // still want their vote). Rebuilt only when the polls or the viewer change.
  const pollMarkers = useMemo(
    () => buildDayPollMarkers(polls, activeUserId),
    [polls, activeUserId],
  )

  // Resolve each grid day into a flat, render-ready cell.
  const cells = useMemo<DayCellVM[]>(() => days.map(day => {
    const date    = format(day, 'yyyy-MM-dd')
    const summary = summaries.get(date)
    const marker  = pollMarkers.get(date)
    return {
      date,
      label:     format(day, 'd'),
      inMonth:   isSameMonth(day, currentMonth),
      today:     isToday(day),
      selected:  selectedDate === date,
      isOverlap: summary?.isOverlap ?? false,
      users:     summary?.users ?? [],
      userCount: summary?.users.length ?? 0,
      hiddenCount: summary?.hiddenCount ?? 0,
      poll: marker
        ? { count: marker.pollCount, needsMyVote: marker.needsMyVote, hasClosed: marker.hasClosed }
        : null,
    }
  }), [days, summaries, pollMarkers, currentMonth, selectedDate])

  // "Best days": overlap first, then most users, then most events.
  // A day with nothing but withheld anonymous events still earns a card — the
  // hint that somebody is quietly free there is precisely what's worth ranking.
  const ranking = useMemo<RankingCardVM[]>(() => {
    return Array.from(summaries.values())
      .filter(s => (s.users.length >= 1 || s.hiddenCount > 0)
                && isSameMonth(parseISO(s.date), currentMonth))
      .sort((a, b) =>
        (a.isOverlap === b.isOverlap ? 0 : a.isOverlap ? -1 : 1)
        || b.users.length - a.users.length
        || b.instances.length - a.instances.length)
      .slice(0, RANKING_LIMIT)
      .map(s => summaryToCard(s, selectedDate))
  }, [summaries, currentMonth, selectedDate])

  return {
    monthLabel:  format(currentMonth, 'MMMM yyyy'),
    weekdays:    WEEKDAYS,
    cells,
    ranking,
    goToToday: () => {
      const today = new Date()
      setCurrentMonth(today)
      setSelectedDate(format(today, 'yyyy-MM-dd'))
    },
    goPrevMonth: () => navigateMonth(-1),
    goNextMonth: () => navigateMonth(1),
    toggleDay:   (date) => setSelectedDate(selectedDate === date ? null : date),
    selectDay:   (date) => setSelectedDate(date),

    canAddEvents: !isOverviewCalendar(activeCalendarId),
    showAddForm,
    openAddForm:  () => setShowAddForm(true),
    closeAddForm: () => setShowAddForm(false),
    addFormDate:  selectedDate ?? format(new Date(), 'yyyy-MM-dd'),
  }
}

// ── Helpers (pure) ────────────────────────────────────────────────────────────

function summaryToCard(s: DaySummary, selectedDate: string | null): RankingCardVM {
  const d = parseISO(s.date)
  return {
    date:       s.date,
    weekdayNum: format(d, 'EEE d'),
    isToday:    isToday(d),
    isSelected: selectedDate === s.date,
    isOverlap:  s.isOverlap,
    users:      s.users,
    tags:       [...new Set(s.instances.flatMap(i => i.event.tags))].slice(0, 3),
    emojis:     [...new Set(
                  s.instances.map(i => activityById(i.event.activity)?.emoji).filter(Boolean) as string[]
                )].slice(0, 4),
    eventCount: s.instances.length,
    hiddenCount: s.hiddenCount,
  }
}

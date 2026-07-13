// ─── MonthGrid ViewModel ──────────────────────────────────────────────────────
// All logic for the month calendar lives here: store access, date-grid
// computation, the "best days" ranking, and the click handlers. The view
// (MonthGrid.view.tsx) consumes this hook and contains only JSX + styling.
//
// MVVM boundary: this file has NO JSX and imports nothing visual. If you're
// reshaping how the calendar looks, you almost never need to touch this file —
// edit MonthGrid.view.tsx instead. If you're changing behavior (what counts as
// a "best day", navigation, selection), edit here.

import { useMemo } from 'react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday, parseISO,
} from 'date-fns'
import type { DaySummary, User } from '../types'
import { useStore }          from '../store/useStore'
import { buildDaySummaries } from '../engine/recurrence'
import { activityById }      from '../sports/activities'

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
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function useMonthGridVM(): MonthGridVM {
  const {
    currentMonth, events, users,
    selectedDate, setSelectedDate,
    navigateMonth, setCurrentMonth,
  } = useStore()

  // Grid days + per-day summaries for the visible 6-week window.
  const { days, summaries } = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 })
    return {
      days:      eachDayOfInterval({ start, end }),
      summaries: buildDaySummaries(events, users, start, end),
    }
  }, [currentMonth, events, users])

  // Resolve each grid day into a flat, render-ready cell.
  const cells = useMemo<DayCellVM[]>(() => days.map(day => {
    const date    = format(day, 'yyyy-MM-dd')
    const summary = summaries.get(date)
    return {
      date,
      label:     format(day, 'd'),
      inMonth:   isSameMonth(day, currentMonth),
      today:     isToday(day),
      selected:  selectedDate === date,
      isOverlap: summary?.isOverlap ?? false,
      users:     summary?.users ?? [],
      userCount: summary?.users.length ?? 0,
    }
  }), [days, summaries, currentMonth, selectedDate])

  // "Best days": overlap first, then most users, then most events.
  const ranking = useMemo<RankingCardVM[]>(() => {
    return Array.from(summaries.values())
      .filter(s => s.users.length >= 1 && isSameMonth(parseISO(s.date), currentMonth))
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
  }
}

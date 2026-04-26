// ─── MonthGrid ────────────────────────────────────────────────────────────────
// Monthly calendar with three sections:
//   1. Navigation header  — month/year + Today + prev/next arrows
//   2. Day grid           — 7-column grid; cells show user dots + overlap badge
//   3. Ranking panel      — scrollable row of the best-availability days,
//                          sorted by number of overlapping users (most first)
//
// Day cells use a dot-per-user design so the grid stays compact at any size.
// Overlap days get a green tint to make them immediately identifiable.

import { useMemo } from 'react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday, parseISO,
} from 'date-fns'
import type { DaySummary } from '../types'
import { useStore }          from '../store/useStore'
import { buildDaySummaries } from '../engine/recurrence'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── MonthGrid ────────────────────────────────────────────────────────────────

export function MonthGrid() {
  const {
    currentMonth, events, users,
    selectedDate, setSelectedDate,
    navigateMonth, setCurrentMonth,
  } = useStore()

  const { days, summaries } = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 })
    return {
      days:      eachDayOfInterval({ start, end }),
      summaries: buildDaySummaries(events, users, start, end),
    }
  }, [currentMonth, events, users])

  function goToToday() {
    const today = new Date()
    setCurrentMonth(today)
    setSelectedDate(format(today, 'yyyy-MM-dd'))
  }

  return (
    <div className="flex flex-col h-full p-3 sm:p-5 gap-0">

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <h2
          className="flex-1 text-base font-semibold tracking-tight select-none"
          style={{ color: 'var(--text)' }}
        >
          {format(currentMonth, 'MMMM yyyy')}
        </h2>
        <button className="btn-toolbar text-xs" onClick={goToToday}>Today</button>
        <div className="flex gap-1">
          <button className="btn-nav" onClick={() => navigateMonth(-1)}>‹</button>
          <button className="btn-nav" onClick={() => navigateMonth(1)}>›</button>
        </div>
      </div>

      {/* ── Day-of-week headers ─────────────────────────────────────────── */}
      <div className="grid grid-cols-7 mb-1">
        {DOW.map(d => (
          <div key={d} className="text-center select-none"
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
                     textTransform: 'uppercase', color: 'var(--text-muted)', paddingBottom: 5 }}>
            {d}
          </div>
        ))}
      </div>

      {/* ── Day grid ────────────────────────────────────────────────────── */}
      {/* content-start prevents the grid rows from stretching to fill extra height */}
      <div className="grid grid-cols-7 gap-1 content-start" style={{ flex: '0 0 auto' }}>
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd')
          return (
            <DayCell
              key={key}
              date={key}
              label={format(day, 'd')}
              inMonth={isSameMonth(day, currentMonth)}
              today={isToday(day)}
              selected={selectedDate === key}
              summary={summaries.get(key)}
              onClick={() => setSelectedDate(selectedDate === key ? null : key)}
            />
          )
        })}
      </div>

      {/* ── Availability ranking ─────────────────────────────────────────── */}
      <AvailabilityRanking
        summaries={summaries}
        currentMonth={currentMonth}
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
      />
    </div>
  )
}

// ─── DayCell ─────────────────────────────────────────────────────────────────
// Shows date number + one dot per user + overlap badge.
// Keeps the grid compact: no text chips, just colour signals.

interface DayCellProps {
  date:     string
  label:    string
  inMonth:  boolean
  today:    boolean
  selected: boolean
  summary?: DaySummary
  onClick:  () => void
}

function DayCell({ label, inMonth, today, selected, summary, onClick }: DayCellProps) {
  const isOverlap = summary?.isOverlap ?? false

  let cls = 'day-cell'
  if (!inMonth) cls += ' out-of-month'
  if (today)    cls += ' is-today'
  if (selected) cls += ' is-selected'
  else if (isOverlap) cls += ' is-overlap'

  // One dot per unique user (not per event) — avoids visual noise
  const userDots = summary?.users ?? []

  return (
    <div
      className={cls}
      onClick={onClick}
      style={{ minHeight: 56, padding: '5px 4px 4px' }}
    >
      {/* Date number row */}
      <div className="flex items-start justify-between mb-1">
        <div
          className="flex items-center justify-center rounded-full leading-none font-semibold select-none"
          style={{
            width: 20, height: 20, fontSize: 11,
            ...(today
              ? { background: 'var(--today-fill)', color: 'var(--today-text)' }
              : { color: 'var(--text)' }),
          }}
        >
          {label}
        </div>

        {/* Overlap badge: green pill with user count */}
        {isOverlap && (
          <span
            className="text-[9px] font-bold rounded-full leading-none"
            style={{
              background: 'var(--overlap-border)', color: 'var(--overlap-text)',
              padding: '2px 4px',
            }}
          >
            {summary!.users.length}✓
          </span>
        )}
      </div>

      {/* User colour dots — one per person */}
      {userDots.length > 0 && (
        <div className="flex gap-0.5 flex-wrap">
          {userDots.map(u => (
            <div
              key={u.id}
              title={u.name}
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: u.color, flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── AvailabilityRanking ──────────────────────────────────────────────────────
// Horizontal scrollable row beneath the grid showing the most-available days
// in the current month, ranked by: overlap first → most users → most events.
// Each card shows the date, user dots, unique tags, and event count.

interface RankingProps {
  summaries:    Map<string, DaySummary>
  currentMonth: Date
  selectedDate: string | null
  onSelect:     (date: string | null) => void
}

function AvailabilityRanking({ summaries, currentMonth, selectedDate, onSelect }: RankingProps) {
  // Collect days that have at least one user, filtered to current month
  const ranked = useMemo(() => {
    return Array.from(summaries.values())
      .filter(s => {
        if (s.users.length < 1) return false
        const d = parseISO(s.date)
        return isSameMonth(d, currentMonth)
      })
      .sort((a, b) => {
        // Overlap days first
        if (a.isOverlap !== b.isOverlap) return a.isOverlap ? -1 : 1
        // Then by number of users
        if (b.users.length !== a.users.length) return b.users.length - a.users.length
        // Then by number of events
        return b.instances.length - a.instances.length
      })
      .slice(0, 10)  // at most 10 cards
  }, [summaries, currentMonth])

  if (ranked.length === 0) return null

  return (
    <div
      className="mt-3 pt-3"
      style={{ borderTop: '0.5px solid var(--border)' }}
    >
      <p
        className="text-[10px] font-semibold uppercase tracking-wider mb-2 select-none"
        style={{ color: 'var(--text-muted)' }}
      >
        Best days this month
      </p>

      {/* Horizontally scrollable row of day cards */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {ranked.map(s => {
          const date    = parseISO(s.date)
          const isToday_ = isToday(date)
          const isSelected = selectedDate === s.date

          // Collect unique tags across all events on this day
          const tags = [...new Set(s.instances.flatMap(i => i.event.tags))].slice(0, 3)

          return (
            <button
              key={s.date}
              onClick={() => onSelect(isSelected ? null : s.date)}
              className="shrink-0 rounded-lg text-left transition-all"
              style={{
                padding: '7px 9px',
                minWidth: 80,
                border: `0.5px solid ${isSelected
                  ? 'var(--accent)'
                  : s.isOverlap
                    ? 'var(--overlap-border)'
                    : 'var(--border)'}`,
                background: isSelected
                  ? 'var(--accent-light)'
                  : s.isOverlap
                    ? 'var(--overlap-bg)'
                    : 'var(--bg-surface)',
                boxShadow: isSelected ? `0 0 0 1.5px var(--accent-bg)` : 'none',
              }}
            >
              {/* Date label */}
              <div
                className="font-semibold leading-tight"
                style={{
                  fontSize: 11,
                  color: isToday_ ? 'var(--today-fill)' : 'var(--text)',
                }}
              >
                {format(date, 'EEE d')}
              </div>

              {/* User dots */}
              <div className="flex gap-0.5 mt-1">
                {s.users.map(u => (
                  <div key={u.id} title={u.name}
                    style={{ width: 6, height: 6, borderRadius: '50%', background: u.color }} />
                ))}
                {s.isOverlap && (
                  <span style={{ fontSize: 8, color: 'var(--overlap-text)', marginLeft: 2, lineHeight: '6px' }}>✓</span>
                )}
              </div>

              {/* Tags (up to 3) */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {tags.map(t => (
                    <span key={t} style={{
                      fontSize: 8, padding: '1px 4px', borderRadius: 3,
                      background: 'var(--bg-subtle)', color: 'var(--text-muted)',
                    }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Event count */}
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                {s.instances.length} event{s.instances.length !== 1 ? 's' : ''}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

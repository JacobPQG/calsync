// ─── MonthGrid ────────────────────────────────────────────────────────────────
// Renders the monthly calendar grid.
//
// Layout:
//   Header row  — Month/Year label + "Today" jump + prev/next arrows
//   DOW row     — Mon Tue Wed Thu Fri Sat Sun (ISO week: Monday = first)
//   Day grid    — 7 columns × N rows; cells include event chips + overlap badge
//
// Clicking a day cell selects it; the DayView sidebar updates accordingly.
// Clicking the same day again deselects it.

import { useMemo } from 'react'
import {
  startOfMonth, endOfMonth,
  startOfWeek,  endOfWeek,
  eachDayOfInterval,
  format, isSameMonth, isToday,
} from 'date-fns'
import type { DaySummary, EventInstance } from '../types'
import { useStore }           from '../store/useStore'
import { buildDaySummaries }  from '../engine/recurrence'

// Short column headers – ISO week starts Monday
const DOW_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Maximum event chips visible per cell before "+N more" overflow label
const MAX_CHIPS = 3

// ─── MonthGrid ────────────────────────────────────────────────────────────────

export function MonthGrid() {
  const {
    currentMonth, events, users,
    selectedDate, setSelectedDate,
    navigateMonth, setCurrentMonth,
  } = useStore()

  // Build the visible day range (includes trailing/leading days outside the month
  // to fill the 7-column grid) and calculate per-day event summaries.
  const { days, summaries } = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 1 })
    return {
      days:      eachDayOfInterval({ start, end }),
      summaries: buildDaySummaries(events, users, start, end),
    }
  }, [currentMonth, events, users])

  // Jump the grid to today's month and select today.
  function goToToday() {
    const today = new Date()
    setCurrentMonth(today)
    setSelectedDate(format(today, 'yyyy-MM-dd'))
  }

  return (
    <div className="flex flex-col h-full p-5 gap-0">

      {/* ── Navigation header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4">
        <h2
          className="flex-1 text-base font-semibold tracking-tight select-none"
          style={{ color: 'var(--text)' }}
        >
          {format(currentMonth, 'MMMM yyyy')}
        </h2>

        {/* Jump to today */}
        <button
          onClick={goToToday}
          className="btn-toolbar text-xs"
          style={{ fontSize: 11.5 }}
        >
          Today
        </button>

        {/* Month navigation */}
        <div className="flex gap-1">
          <button className="btn-nav" onClick={() => navigateMonth(-1)} title="Previous month">‹</button>
          <button className="btn-nav" onClick={() => navigateMonth(1)}  title="Next month">›</button>
        </div>
      </div>

      {/* ── Day-of-week column headers ──────────────────────────────────── */}
      <div className="grid grid-cols-7 mb-1">
        {DOW_HEADERS.map(d => (
          <div
            key={d}
            className="text-center select-none"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              paddingBottom: 6,
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* ── Day grid ────────────────────────────────────────────────────── */}
      {/* flex-1 makes the grid fill the remaining height of the panel. */}
      <div className="grid grid-cols-7 gap-1 flex-1 content-start">
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
    </div>
  )
}

// ─── DayCell ─────────────────────────────────────────────────────────────────

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

  // Build the cell's CSS class string from state flags.
  // Order matters: more specific states (selected) should come last.
  let cls = 'day-cell'
  if (!inMonth) cls += ' out-of-month'
  if (today)    cls += ' is-today'
  if (selected) cls += ' is-selected'
  else if (isOverlap) cls += ' is-overlap'

  // Deduplicate event instances (recurring events expand to multiple instances
  // per date; we only want one chip per unique event ID).
  const seen   = new Set<string>()
  const unique = (summary?.instances ?? []).filter(i => {
    if (seen.has(i.event.id)) return false
    seen.add(i.event.id)
    return true
  })
  const visible  = unique.slice(0, MAX_CHIPS)
  const overflow = unique.length - visible.length

  return (
    <div className={cls} onClick={onClick}>

      {/* ── Date number row ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-0.5">
        {/* Today: filled accent circle. Other days: plain number. */}
        <div
          className="flex items-center justify-center rounded-full leading-none font-semibold select-none"
          style={{
            width: 22,
            height: 22,
            fontSize: 12,
            ...(today
              ? { background: 'var(--today-fill)', color: 'var(--today-text)' }
              : { color: 'var(--text)' }),
          }}
        >
          {label}
        </div>

        {/* Overlap badge: green pill showing count of users available */}
        {isOverlap && (
          <span
            className="text-[9px] font-semibold rounded-full px-1.5 leading-tight"
            style={{
              background: 'var(--overlap-border)',
              color: 'var(--overlap-text)',
              paddingTop: 2,
              paddingBottom: 2,
            }}
          >
            {summary!.users.length}✓
          </span>
        )}
      </div>

      {/* ── Event chips ──────────────────────────────────────────────────── */}
      {visible.map(inst => <EventChip key={inst.event.id} instance={inst} />)}

      {/* Overflow: "+2 more" when there are more events than MAX_CHIPS */}
      {overflow > 0 && (
        <div className="text-[9px] font-medium mt-0.5 pl-0.5" style={{ color: 'var(--text-muted)' }}>
          +{overflow} more
        </div>
      )}
    </div>
  )
}

// ─── EventChip ───────────────────────────────────────────────────────────────
// A small colored capsule inside a day cell representing one event.

function EventChip({ instance }: { instance: EventInstance }) {
  const { event, user } = instance
  const color = event.color ?? user.color
  return (
    <div className="event-chip" style={{ background: color + '20', color }}>
      <div className="event-chip-dot" style={{ background: color }} />
      <span className="truncate" style={{ maxWidth: '100%' }}>
        {event.title || user.name}
      </span>
    </div>
  )
}

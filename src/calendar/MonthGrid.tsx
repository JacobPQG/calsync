// ─── MonthGrid ────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday, parseISO
} from 'date-fns'
import type { DaySummary } from '../types'
import { useStore } from '../store/useStore'
import { buildDaySummaries } from '../engine/recurrence'

export function MonthGrid() {
  const { currentMonth, events, users, selectedDate, setSelectedDate, navigateMonth } = useStore()

  const { days, summaries } = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start, end })
    const summaries = buildDaySummaries(events, users, start, end)
    return { days, summaries }
  }, [currentMonth, events, users])

  return (
    <div className="flex flex-col h-full p-4">
      {/* Header */}
      <div className="flex items-center mb-4">
        <h2 className="flex-1 text-base font-medium">
          {format(currentMonth, 'MMMM yyyy')}
        </h2>
        <button onClick={() => navigateMonth(-1)} className="btn-nav">‹</button>
        <button onClick={() => navigateMonth(1)} className="btn-nav ml-2">›</button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => (
          <div key={d} className="text-center text-xs text-muted py-1 font-medium">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1 flex-1">
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd')
          const summary = summaries.get(key)
          const inMonth = isSameMonth(day, currentMonth)
          const selected = selectedDate === key
          const today = isToday(day)

          return (
            <DayCell
              key={key}
              date={key}
              label={format(day, 'd')}
              inMonth={inMonth}
              today={today}
              selected={selected}
              summary={summary}
              onClick={() => setSelectedDate(selected ? null : key)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── DayCell ─────────────────────────────────────────────────────────────────

interface DayCellProps {
  date: string
  label: string
  inMonth: boolean
  today: boolean
  selected: boolean
  summary?: DaySummary
  onClick: () => void
}

export function DayCell({ label, inMonth, today, selected, summary, onClick }: DayCellProps) {
  const isOverlap = summary?.isOverlap ?? false

  let cls = 'day-cell'
  if (!inMonth) cls += ' opacity-30'
  if (today) cls += ' border-purple-500'
  if (selected) cls += ' ring-2 ring-purple-500 ring-offset-1'
  if (isOverlap) cls += ' bg-purple-50 border-purple-200'

  return (
    <div className={cls} onClick={onClick}>
      <span className={`text-xs font-medium ${isOverlap ? 'text-purple-800' : ''}`}>
        {label}
      </span>

      {/* User color dots */}
      {summary && summary.users.length > 0 && (
        <div className="flex gap-0.5 mt-1 flex-wrap">
          {summary.users.map(u => (
            <div
              key={u.id}
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: u.color }}
              title={u.name}
            />
          ))}
        </div>
      )}

      {/* Overlap badge */}
      {isOverlap && (
        <div className="text-[9px] text-purple-600 font-medium mt-0.5">
          ✓ {summary!.users.length} free
        </div>
      )}
    </div>
  )
}

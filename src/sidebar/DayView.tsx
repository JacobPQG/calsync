// ─── DayView sidebar ─────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { EventInstance } from '../types'
import { useStore } from '../store/useStore'
import { buildDaySummaries } from '../engine/recurrence'
import { EventForm } from '../forms/EventForm'

export function DayView() {
  const { selectedDate, events, users } = useStore()
  const [showForm, setShowForm] = useState(false)

  const summary = useMemo(() => {
    if (!selectedDate) return null
    const d = parseISO(selectedDate)
    const map = buildDaySummaries(events, users, d, d)
    return map.get(selectedDate) ?? null
  }, [selectedDate, events, users])

  if (!selectedDate) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted">
        Select a day to see details
      </div>
    )
  }

  const dayLabel = format(parseISO(selectedDate), 'EEE, MMMM d')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-divider bg-surface">
        <div className="font-medium text-sm">{dayLabel}</div>
        {summary?.isOverlap && (
          <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full mt-1 inline-block">
            {summary.users.map(u => u.name).join(' + ')} available
          </span>
        )}
      </div>

      {/* Hour timeline */}
      <div className="flex-1 overflow-y-auto">
        <HourTimeline instances={summary?.instances ?? []} />
      </div>

      {/* Add event button */}
      <div className="p-3 border-t border-divider">
        <button
          className="w-full text-sm py-1.5 rounded-lg border border-divider hover:bg-surface transition-colors"
          onClick={() => setShowForm(true)}
        >
          + Add availability
        </button>
      </div>

      {showForm && <EventForm date={selectedDate} onClose={() => setShowForm(false)} />}
    </div>
  )
}

// ─── HourTimeline ─────────────────────────────────────────────────────────────

function HourTimeline({ instances }: { instances: EventInstance[] }) {
  const hours = Array.from({ length: 16 }, (_, i) => i + 7) // 7am–10pm

  return (
    <div>
      {hours.map(hour => {
        const atHour = instances.filter(
          i => i.event.startHour <= hour && i.event.endHour > hour
        )
        return (
          <div key={hour} className="flex items-start min-h-[44px]">
            <div className="w-10 text-[10px] text-muted pt-1 pr-2 text-right shrink-0">
              {hour === 12 ? '12pm' : hour < 12 ? `${hour}am` : `${hour - 12}pm`}
            </div>
            <div className="flex-1 border-t border-divider pt-1 pb-1 relative">
              {atHour.map(inst => (
                <EventBlock key={inst.event.id} instance={inst} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── EventBlock ───────────────────────────────────────────────────────────────

function EventBlock({ instance }: { instance: EventInstance }) {
  const { event, user } = instance
  return (
    <div
      className="rounded-md px-2 py-1 mb-1 text-xs font-medium"
      style={{
        background: user.color + '22',
        borderLeft: `3px solid ${user.color}`,
        color: user.color,
      }}
    >
      <span className="font-semibold">{user.name}</span>
      {event.title && ` · ${event.title}`}
      {event.location?.name && (
        <span className="text-[10px] opacity-70 block">{event.location.name}</span>
      )}
    </div>
  )
}

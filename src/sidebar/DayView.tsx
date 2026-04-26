// ─── DayView sidebar ─────────────────────────────────────────────────────────
// Three visual states:
//   1. No date selected  →  placeholder prompt
//   2. Date selected     →  hour timeline with non-overlapping event columns
//   3. Event clicked     →  event detail (inline; back button to return)
//
// Overlapping events are laid out in side-by-side columns using a greedy
// column-assignment algorithm: sort by start, assign each event the lowest
// column not taken by any earlier overlapping event.

import { useMemo, useState, useEffect } from 'react'
import {
  format, parseISO, formatDistanceToNow, isFuture, isToday as dateFnsIsToday,
} from 'date-fns'
import type { CalEvent, EventInstance } from '../types'
import { useStore }          from '../store/useStore'
import { buildDaySummaries } from '../engine/recurrence'
import { EventForm }         from '../forms/EventForm'
import { safeUrl }           from '../utils/safeUrl'

const FIRST_HOUR = 6
const LAST_HOUR  = 23
const HOUR_PX    = 56
const LABEL_W    = 54

// Format hour (supports half-hours): 9 → "9 AM", 9.5 → "9:30 AM"
function fmtHour(h: number): string {
  const hour = Math.floor(h)
  const min  = h % 1 !== 0 ? ':30' : ''
  if (hour === 0 || hour === 24) return `12${min} AM`
  if (hour === 12)               return `12${min} PM`
  return hour < 12 ? `${hour}${min} AM` : `${hour - 12}${min} PM`
}

// Like fmtHour but always includes :00/:30 for detail displays
function fmtTime(h: number): string {
  const hour = Math.floor(h)
  const min  = h % 1 !== 0 ? ':30' : ':00'
  if (hour === 0 || hour === 24) return `12${min} AM`
  if (hour === 12)               return `12${min} PM`
  return hour < 12 ? `${hour}${min} AM` : `${hour - 12}${min} PM`
}

// ── Column layout ─────────────────────────────────────────────────────────────

interface LayoutItem { inst: EventInstance; col: number; numCols: number }

function eventsOverlap(a: CalEvent, b: CalEvent): boolean {
  return a.startHour < b.endHour && b.startHour < a.endHour
}

function layoutInstances(instances: EventInstance[]): LayoutItem[] {
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

// ─── DayView ─────────────────────────────────────────────────────────────────

export function DayView() {
  const { selectedDate, events, users, deleteEvent } = useStore()

  const [showForm,     setShowForm]     = useState(false)
  const [activeEvent,  setActiveEvent]  = useState<EventInstance | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null)
  const [currentTimeY, setCurrentTimeY] = useState<number | null>(null)

  const summary = useMemo(() => {
    if (!selectedDate) return null
    const d = parseISO(selectedDate)
    return buildDaySummaries(events, users, d, d).get(selectedDate) ?? null
  }, [selectedDate, events, users])

  useEffect(() => {
    function tick() {
      const now  = new Date()
      const frac = now.getHours() + now.getMinutes() / 60
      const y    = (frac - FIRST_HOUR) * HOUR_PX
      const max  = (LAST_HOUR - FIRST_HOUR) * HOUR_PX
      setCurrentTimeY(y >= 0 && y <= max ? y : null)
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { setActiveEvent(null); setEditingEvent(null) }, [selectedDate])

  if (!selectedDate) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center"
        style={{ color: 'var(--text-muted)' }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.45">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Select a day</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Click any date on the calendar to view its schedule and add availability.
          </p>
        </div>
      </div>
    )
  }

  const dayLabel  = format(parseISO(selectedDate), 'EEEE, MMMM d')
  const instances = summary?.instances ?? []
  const isToday   = dateFnsIsToday(parseISO(selectedDate))

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate" style={{ color: 'var(--text)' }}>
              {dayLabel}
            </div>
            {summary?.isOverlap && (
              <div
                className="inline-flex items-center gap-1.5 text-xs mt-1.5 px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--overlap-bg)', color: 'var(--overlap-text)' }}
              >
                <span style={{ fontSize: 7 }}>●</span>
                {summary.users.map(u => u.name).join(' · ')} available
              </div>
            )}
          </div>
          {activeEvent && (
            <button
              onClick={() => setActiveEvent(null)}
              className="text-xs shrink-0 rounded px-2 py-1 font-medium"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-subtle)' }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {activeEvent
          ? (
            <EventDetail
              instance={activeEvent}
              onClose={() => setActiveEvent(null)}
              onDelete={() => { deleteEvent(activeEvent.event.id); setActiveEvent(null) }}
              onEdit={() => setEditingEvent(activeEvent.event)}
            />
          )
          : (
            <HourTimeline
              instances={instances}
              currentTimeY={isToday ? currentTimeY : null}
              onClickEvent={setActiveEvent}
            />
          )
        }
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {!activeEvent && (
        <div className="shrink-0 p-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          <button
            className="w-full text-sm py-2 rounded-lg border font-medium transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)', background: 'var(--bg-surface)' }}
            onClick={() => setShowForm(true)}
          >
            + Add availability
          </button>
        </div>
      )}

      {showForm && (
        <EventForm date={selectedDate} onClose={() => setShowForm(false)} />
      )}
      {editingEvent && (
        <EventForm date={editingEvent.date} existing={editingEvent} onClose={() => setEditingEvent(null)} />
      )}
    </div>
  )
}

// ─── HourTimeline ─────────────────────────────────────────────────────────────

interface TimelineProps {
  instances:    EventInstance[]
  currentTimeY: number | null
  onClickEvent: (i: EventInstance) => void
}

function HourTimeline({ instances, currentTimeY, onClickEvent }: TimelineProps) {
  const totalHours  = LAST_HOUR - FIRST_HOUR
  const totalHeight = totalHours * HOUR_PX
  const hourRows    = Array.from({ length: totalHours }, (_, i) => i + FIRST_HOUR)

  // One instance per event ID (recurring events may produce duplicates for a date)
  const seen    = new Set<string>()
  const deduped = instances.filter(i => {
    if (seen.has(i.event.id)) return false
    seen.add(i.event.id)
    return true
  })

  const laid = useMemo(() => layoutInstances(deduped), [deduped])

  return (
    <div className="relative" style={{ height: totalHeight }}>

      {/* Hour grid lines + labels */}
      {hourRows.map(hour => (
        <div
          key={hour}
          className="absolute flex w-full pointer-events-none"
          style={{ top: (hour - FIRST_HOUR) * HOUR_PX, height: HOUR_PX }}
        >
          <div
            className="shrink-0 text-right pr-3 pt-1 select-none"
            style={{ width: LABEL_W, fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}
          >
            {fmtHour(hour)}
          </div>
          <div className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
        </div>
      ))}

      {/* Event blocks — in a container that starts past the label column */}
      <div className="absolute" style={{ top: 0, left: LABEL_W + 3, right: 4, bottom: 0 }}>
        {laid.map(({ inst, col, numCols }) => {
          const { startHour, endHour } = inst.event
          const color  = inst.event.color ?? inst.user.color
          const top    = Math.max(0, (startHour - FIRST_HOUR) * HOUR_PX)
          const height = Math.max(HOUR_PX * 0.5, (endHour - startHour) * HOUR_PX - 2)
          const pct    = 100 / numCols

          return (
            <button
              key={inst.event.id}
              className="absolute rounded-md text-left overflow-hidden transition-opacity hover:opacity-85"
              style={{
                top,
                height,
                left:       `calc(${col * pct}% + 1px)`,
                width:      `calc(${pct}% - 2px)`,
                background: color + '1a',
                borderLeft: `3px solid ${color}`,
                boxShadow:  `inset 0 0 0 0.5px ${color}35`,
                padding:    '4px 6px',
              }}
              onClick={() => onClickEvent(inst)}
            >
              <div className="text-xs font-semibold truncate leading-tight" style={{ color }}>
                {inst.user.name}
              </div>
              {inst.event.title && height > HOUR_PX * 0.6 && (
                <div className="text-[11px] truncate leading-tight mt-0.5" style={{ color }}>
                  {inst.event.title}
                </div>
              )}
              {inst.event.location?.name && height > HOUR_PX && (
                <div className="text-[10px] truncate mt-0.5" style={{ color, opacity: 0.7 }}>
                  {inst.event.location.name}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Current-time red line + dot */}
      {currentTimeY !== null && (
        <div
          className="absolute pointer-events-none"
          style={{ top: currentTimeY, left: LABEL_W, right: 0 }}
        >
          <div className="relative">
            <div className="absolute rounded-full"
              style={{ left: -5, top: -4, width: 9, height: 9, background: '#ef4444' }} />
            <div style={{ height: 1.5, background: '#ef4444', opacity: 0.75 }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── EventDetail ─────────────────────────────────────────────────────────────
// Edit and Delete are owner-only (event.userId === activeUserId).

interface EventDetailProps {
  instance: EventInstance
  onClose:  () => void
  onDelete: () => void
  onEdit:   () => void
}

function EventDetail({ instance, onDelete, onEdit }: EventDetailProps) {
  const { activeUserId } = useStore()
  const { event, user, date } = instance
  const color   = event.color ?? user.color
  const isOwner = event.userId === activeUserId

  const h = Math.floor(event.startHour)
  const m = event.startHour % 1 !== 0 ? '30' : '00'
  const eventStart   = new Date(`${date}T${String(h).padStart(2, '0')}:${m}:00`)
  const relativeTime = formatDistanceToNow(eventStart, { addSuffix: true })
  const isUpcoming   = isFuture(eventStart)

  const mapsQuery    = event.location?.address || event.location?.name
  const rawMapsUrl   = event.location?.mapsUrl
    ?? (mapsQuery ? `https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}` : null)
  const mapsUrl      = safeUrl(rawMapsUrl)
  const safeEventUrl = safeUrl(event.eventUrl)

  return (
    <div className="p-4 space-y-5">

      {/* Color strip + title + user */}
      <div className="rounded-lg p-3"
        style={{ background: color + '12', borderLeft: `3px solid ${color}` }}>
        <div className="font-semibold text-sm" style={{ color }}>
          {event.title || '(untitled)'}
        </div>
        <div className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
          <span
            className="inline-flex w-4 h-4 items-center justify-center rounded-full text-white font-bold leading-none"
            style={{ background: user.color, fontSize: 8 }}
          >
            {user.name[0].toUpperCase()}
          </span>
          {user.name}
        </div>
      </div>

      {/* Time */}
      <div>
        <div className="field-label">Time</div>
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {fmtTime(event.startHour)} – {fmtTime(event.endHour)}
        </div>
        <div className="text-xs mt-0.5"
          style={{ color: isUpcoming ? 'var(--overlap-text)' : 'var(--text-muted)' }}>
          {relativeTime}
        </div>
      </div>

      {/* Notes */}
      {event.description && (
        <div>
          <div className="field-label">Notes</div>
          <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {event.description}
          </p>
        </div>
      )}

      {/* Tags */}
      {event.tags.length > 0 && (
        <div>
          <div className="field-label">Tags</div>
          <div className="flex flex-wrap gap-1.5">
            {event.tags.map(tag => (
              <span key={tag} className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: color + '20', color }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Location */}
      {(event.location?.name || event.location?.address) && (
        <div>
          <div className="field-label">Location</div>
          {event.location.name && (
            <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {event.location.name}
            </div>
          )}
          {event.location.address && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {event.location.address}
            </div>
          )}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs rounded border px-2.5 py-1 font-medium transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
              ↗ Get directions
            </a>
          )}
        </div>
      )}

      {/* Event URL */}
      {safeEventUrl && (
        <div>
          <div className="field-label">Event link</div>
          <a href={safeEventUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs break-all" style={{ color: 'var(--accent)' }}>
            {safeEventUrl}
          </a>
        </div>
      )}

      {/* Recurrence */}
      {event.recurring.frequency !== 'none' && (
        <div>
          <div className="field-label">Repeats</div>
          <div className="text-sm" style={{ color: 'var(--text-2)' }}>
            {event.recurring.frequency.charAt(0).toUpperCase() + event.recurring.frequency.slice(1)}
            {event.recurring.endDate && (
              <span style={{ color: 'var(--text-muted)' }}> · until {event.recurring.endDate}</span>
            )}
          </div>
        </div>
      )}

      {/* Owner-only actions */}
      {isOwner && (
        <div className="flex gap-2 pt-1" style={{ borderTop: '0.5px solid var(--border)' }}>
          <button
            onClick={onEdit}
            className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)', background: 'var(--bg-subtle)' }}
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
            style={{ borderColor: '#fca5a5', color: '#dc2626', background: '#fff5f5' }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

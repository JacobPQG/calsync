// ─── DayView sidebar ─────────────────────────────────────────────────────────
// Renders the right-side panel. Has three visual states:
//
//   1. No date selected  →  placeholder prompt
//   2. Date selected, no event clicked  →  hour timeline with events
//   3. Event clicked  →  event detail view (inline, back button to return)
//
// Hour timeline: events are absolutely positioned by their start/end hours,
// giving a proportional "Google Calendar day view" feel. A live red line marks
// the current time when the selected day is today.

import { useMemo, useState, useEffect } from 'react'
import {
  format, parseISO, formatDistanceToNow, isFuture, isToday as dateFnsIsToday,
} from 'date-fns'
import type { EventInstance } from '../types'
import { useStore }          from '../store/useStore'
import { buildDaySummaries } from '../engine/recurrence'
import { EventForm }         from '../forms/EventForm'
import { safeUrl }           from '../utils/safeUrl'

// Timeline configuration
const FIRST_HOUR  = 6    // 6 AM  — earliest visible row
const LAST_HOUR   = 23   // 11 PM — last row start (ends at midnight)
const HOUR_PX     = 56   // pixels per one-hour row

// ── Small utility ─────────────────────────────────────────────────────────────

// Format an integer hour (0–24) as a human-readable string: "6 AM", "12 PM", etc.
function fmtHour(h: number): string {
  if (h === 0 || h === 24) return '12 AM'
  if (h === 12)             return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// ─── DayView (root) ───────────────────────────────────────────────────────────

export function DayView() {
  const { selectedDate, events, users, deleteEvent } = useStore()

  const [showForm,    setShowForm]    = useState(false)
  const [activeEvent, setActiveEvent] = useState<EventInstance | null>(null)

  // Current-time indicator Y offset (null when time is outside visible range).
  const [currentTimeY, setCurrentTimeY] = useState<number | null>(null)

  // Rebuild summary when the selected date or event/user data changes.
  const summary = useMemo(() => {
    if (!selectedDate) return null
    const d = parseISO(selectedDate)
    return buildDaySummaries(events, users, d, d).get(selectedDate) ?? null
  }, [selectedDate, events, users])

  // Update the red "now" line every minute.
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

  // Reset event detail whenever the user switches to a different day.
  useEffect(() => { setActiveEvent(null) }, [selectedDate])

  // ── Empty state ─────────────────────────────────────────────────────────

  if (!selectedDate) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center"
        style={{ color: 'var(--text-muted)' }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.45">
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

      {/* ── Day header ─────────────────────────────────────────────────── */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderBottom: '0.5px solid var(--border)' }}
      >
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

          {/* Back button shown only in event-detail mode */}
          {activeEvent && (
            <button
              onClick={() => setActiveEvent(null)}
              className="text-xs shrink-0 rounded px-2 py-1 font-medium transition-colors"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-subtle)' }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable content area ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {activeEvent
          ? (
              <EventDetail
                instance={activeEvent}
                onClose={() => setActiveEvent(null)}
                onDelete={() => {
                  deleteEvent(activeEvent.event.id)
                  setActiveEvent(null)
                }}
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

      {/* ── Footer: add event ───────────────────────────────────────────── */}
      {!activeEvent && (
        <div className="shrink-0 p-3" style={{ borderTop: '0.5px solid var(--border)' }}>
          <button
            className="w-full text-sm py-2 rounded-lg border font-medium transition-colors"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-2)',
              background: 'var(--bg-surface)',
            }}
            onClick={() => setShowForm(true)}
          >
            + Add availability
          </button>
        </div>
      )}

      {showForm && <EventForm date={selectedDate} onClose={() => setShowForm(false)} />}
    </div>
  )
}

// ─── HourTimeline ─────────────────────────────────────────────────────────────
// Time grid spanning FIRST_HOUR…LAST_HOUR. Events are laid out using absolute
// CSS positioning so they scale proportionally with the hour row height.

interface TimelineProps {
  instances:    EventInstance[]
  currentTimeY: number | null
  onClickEvent: (i: EventInstance) => void
}

function HourTimeline({ instances, currentTimeY, onClickEvent }: TimelineProps) {
  const totalHours  = LAST_HOUR - FIRST_HOUR
  const totalHeight = totalHours * HOUR_PX
  const hourRows    = Array.from({ length: totalHours }, (_, i) => i + FIRST_HOUR)

  // Deduplicate: recurring events can produce multiple instances for the same
  // date (one per rule match). Keep the first occurrence per event ID.
  const seen     = new Set<string>()
  const deduped  = instances.filter(i => {
    if (seen.has(i.event.id)) return false
    seen.add(i.event.id)
    return true
  })

  return (
    // The outer container has a fixed height; events use position:absolute
    // with top values derived from (startHour - FIRST_HOUR) * HOUR_PX.
    <div className="relative" style={{ height: totalHeight }}>

      {/* ── Hour grid lines and labels ──────────────────────────────────── */}
      {hourRows.map(hour => (
        <div
          key={hour}
          className="absolute flex w-full pointer-events-none"
          style={{ top: (hour - FIRST_HOUR) * HOUR_PX, height: HOUR_PX }}
        >
          {/* Time label */}
          <div
            className="shrink-0 text-right pr-3 pt-1 select-none"
            style={{ width: 54, fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}
          >
            {fmtHour(hour)}
          </div>
          {/* Horizontal rule */}
          <div className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
        </div>
      ))}

      {/* ── Event blocks ────────────────────────────────────────────────── */}
      {/* Events live in a container that starts after the time-label column.  */}
      {deduped.map(inst => {
        const { startHour, endHour } = inst.event
        const color  = inst.event.color ?? inst.user.color
        const top    = Math.max(0, (startHour - FIRST_HOUR) * HOUR_PX)
        // Minimum height of half an hour so short events remain clickable.
        const height = Math.max(HOUR_PX * 0.5, (endHour - startHour) * HOUR_PX - 2)

        return (
          <button
            key={inst.event.id}
            className="absolute rounded-md text-left transition-all"
            style={{
              top,
              left: 57,         // aligns to the right of time labels
              right: 6,
              height,
              background: color + '1a',
              borderLeft: `3px solid ${color}`,
              boxShadow: `inset 0 0 0 0.5px ${color}35`,
              padding: '4px 8px',
            }}
            onClick={() => onClickEvent(inst)}
          >
            <div
              className="text-xs font-semibold truncate leading-tight"
              style={{ color }}
            >
              {inst.user.name}
            </div>
            {inst.event.title && (
              <div className="text-[11px] truncate leading-tight mt-0.5" style={{ color }}>
                {inst.event.title}
              </div>
            )}
            {inst.event.location?.name && height > HOUR_PX && (
              <div className="text-[10px] truncate mt-0.5" style={{ color, opacity: 0.7 }}>
                📍 {inst.event.location.name}
              </div>
            )}
          </button>
        )
      })}

      {/* ── Current-time indicator ──────────────────────────────────────── */}
      {/* Red dot + line, visible only when viewing today. */}
      {currentTimeY !== null && (
        <div
          className="absolute pointer-events-none"
          style={{ top: currentTimeY, left: 54, right: 0 }}
        >
          <div className="relative">
            <div
              className="absolute rounded-full"
              style={{
                left: -5, top: -4,
                width: 9, height: 9,
                background: '#ef4444',
              }}
            />
            <div style={{ height: 1.5, background: '#ef4444', opacity: 0.75 }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── EventDetail ─────────────────────────────────────────────────────────────
// Full-detail view for a single event, shown when the user clicks an event
// block in the timeline. Displays all fields: time, description, tags,
// location (+ directions link), external URL, recurrence info, and a
// time-relative label ("in 3 hours", "yesterday", etc.).

interface EventDetailProps {
  instance: EventInstance
  onClose:  () => void
  onDelete: () => void
}

function EventDetail({ instance, onDelete }: EventDetailProps) {
  const { event, user, date } = instance
  const color = event.color ?? user.color

  const startStr = fmtHour(event.startHour)
  const endStr   = fmtHour(event.endHour)

  // Build a Date for the event start so we can compute relative time.
  const eventStart   = new Date(`${date}T${String(event.startHour).padStart(2, '0')}:00:00`)
  const relativeTime = formatDistanceToNow(eventStart, { addSuffix: true })
  const isUpcoming   = isFuture(eventStart)

  // Resolve the maps URL. The user-supplied mapsUrl is run through safeUrl()
  // to block javascript: / data: URIs before it reaches any href attribute.
  // The fallback (constructed from address/name) uses a hardcoded https: prefix
  // so it is always safe; safeUrl() is still applied for consistency.
  const mapsQuery     = event.location?.address || event.location?.name
  const rawMapsUrl    = event.location?.mapsUrl
    ?? (mapsQuery ? `https://maps.google.com/?q=${encodeURIComponent(mapsQuery)}` : null)
  const mapsUrl       = safeUrl(rawMapsUrl)
  const safeEventUrl  = safeUrl(event.eventUrl)

  return (
    <div className="p-4 space-y-5">

      {/* ── Color strip + title + user ─────────────────────────────────── */}
      <div
        className="rounded-lg p-3"
        style={{
          background: color + '12',
          borderLeft: `3px solid ${color}`,
        }}
      >
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

      {/* ── Time ──────────────────────────────────────────────────────── */}
      <div>
        <div className="field-label">Time</div>
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {startStr} – {endStr}
        </div>
        <div
          className="text-xs mt-0.5"
          style={{ color: isUpcoming ? 'var(--overlap-text)' : 'var(--text-muted)' }}
        >
          {relativeTime}
        </div>
      </div>

      {/* ── Description / notes ───────────────────────────────────────── */}
      {event.description && (
        <div>
          <div className="field-label">Notes</div>
          <p
            className="text-sm whitespace-pre-wrap leading-relaxed"
            style={{ color: 'var(--text-2)' }}
          >
            {event.description}
          </p>
        </div>
      )}

      {/* ── Tags ──────────────────────────────────────────────────────── */}
      {event.tags.length > 0 && (
        <div>
          <div className="field-label">Tags</div>
          <div className="flex flex-wrap gap-1.5">
            {event.tags.map(tag => (
              <span
                key={tag}
                className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: color + '20', color }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Location + Directions ─────────────────────────────────────── */}
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
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs rounded border px-2.5 py-1 font-medium transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
            >
              ↗ Get directions
            </a>
          )}
        </div>
      )}

      {/* ── Event URL ─────────────────────────────────────────────────── */}
      {/* safeEventUrl is undefined for any non-http(s) scheme (javascript:, data:, etc.) */}
      {safeEventUrl && (
        <div>
          <div className="field-label">Event link</div>
          <a
            href={safeEventUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs break-all"
            style={{ color: 'var(--accent)' }}
          >
            {safeEventUrl}
          </a>
        </div>
      )}

      {/* ── Recurrence summary ────────────────────────────────────────── */}
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

      {/* ── Danger zone ───────────────────────────────────────────────── */}
      <div className="pt-1" style={{ borderTop: '0.5px solid var(--border)' }}>
        <button
          onClick={onDelete}
          className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
          style={{ borderColor: '#fca5a5', color: '#dc2626', background: '#fff5f5' }}
        >
          Delete event
        </button>
      </div>
    </div>
  )
}

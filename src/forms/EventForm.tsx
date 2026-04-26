// ─── EventForm ────────────────────────────────────────────────────────────────
// Modal form for creating a new availability entry. Opens when the user clicks
// "+ Add availability" in the DayView sidebar.
//
// Fields:
//   Title · Start/End hours · Repeat pattern · Tags
//   Notes · Location (name + address + maps URL) · Event URL
//
// On submit the new event is dispatched to the Zustand store, which also
// persists it to localStorage via the storage adapter.

import { useState } from 'react'
import type { RecurringRule } from '../types'
import { useStore } from '../store/useStore'

interface Props {
  date:    string   // ISO date string for the initial occurrence
  onClose: () => void
}

// Recurrence frequency options shown in the <select>
const FREQ_OPTIONS = [
  { value: 'none',    label: 'One time' },
  { value: 'daily',   label: 'Every day' },
  { value: 'weekly',  label: 'Weekly (pick days)' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom',  label: 'Specific dates' },
] as const

// Short labels for Monday-based day-of-week toggles (index 0 = Monday)
const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

// Preset tag chips for quick selection
const COMMON_TAGS = ['work', 'personal', 'travel', 'focus', 'flex', 'free']

// Format an hour integer (0–23) as "HH:00" for <option> labels
function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

export function EventForm({ date, onClose }: Props) {
  const { addEvent, activeUser, activeUserId } = useStore()
  const user = activeUser()

  const [title,           setTitle]           = useState('')
  const [description,     setDescription]     = useState('')
  const [startHour,       setStartHour]       = useState(9)
  const [endHour,         setEndHour]         = useState(17)
  const [tags,            setTags]            = useState<string[]>([])
  const [locationName,    setLocationName]    = useState('')
  const [locationAddress, setLocationAddress] = useState('')
  const [locationMapsUrl, setLocationMapsUrl] = useState('')
  const [eventUrl,        setEventUrl]        = useState('')
  const [frequency,       setFrequency]       = useState<RecurringRule['frequency']>('none')
  const [daysOfWeek,      setDaysOfWeek]      = useState<number[]>([])
  const [endDate,         setEndDate]         = useState('')

  // Guard: require an active user before showing the form body
  if (!user || !activeUserId) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.45)' }}>
        <div className="rounded-xl p-6 text-sm shadow-xl" style={{ background: 'var(--bg-surface)' }}>
          Please select a user first.
          <button onClick={onClose} className="ml-4 underline" style={{ color: 'var(--accent)' }}>Close</button>
        </div>
      </div>
    )
  }

  function toggleTag(tag: string) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  function toggleDow(i: number) {
    setDaysOfWeek(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i])
  }

  function submit() {
    if (!title.trim()) return
    addEvent({
      userId:    activeUserId,
      title:     title.trim(),
      description,
      tags,
      date,
      startHour,
      endHour,
      location: locationName || locationAddress || locationMapsUrl
        ? { name: locationName || undefined, address: locationAddress || undefined, mapsUrl: locationMapsUrl || undefined }
        : undefined,
      eventUrl: eventUrl || undefined,
      recurring: {
        frequency,
        daysOfWeek: frequency === 'weekly' ? daysOfWeek : undefined,
        endDate:    endDate || undefined,
      },
    })
    onClose()
  }

  // ── Shared chip style helpers ─────────────────────────────────────────────

  function chipStyle(active: boolean) {
    return {
      padding: '4px 12px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 500,
      border: `0.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'var(--accent-bg)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-muted)',
      cursor: 'pointer',
      transition: 'all 0.1s',
    } as React.CSSProperties
  }

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl shadow-xl flex flex-col"
        style={{ background: 'var(--bg-surface)' }}
      >
        {/* Header */}
        <div
          className="flex items-center px-5 py-4 shrink-0"
          style={{ borderBottom: '0.5px solid var(--border)' }}
        >
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              Add availability
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {date} · {user.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none ml-2 rounded p-1 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 flex-1">

          {/* Title */}
          <div>
            <label className="field-label">Title</label>
            <input
              className="field-input"
              placeholder="e.g. Free afternoon, Available for calls…"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              autoFocus
            />
          </div>

          {/* Hours */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="field-label">From</label>
              <select className="field-input" value={startHour} onChange={e => setStartHour(+e.target.value)}>
                {Array.from({ length: 24 }, (_, i) => i).map(h => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="field-label">To</label>
              <select className="field-input" value={endHour} onChange={e => setEndHour(+e.target.value)}>
                {Array.from({ length: 24 }, (_, i) => i + 1).map(h => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Recurrence */}
          <div>
            <label className="field-label">Repeat</label>
            <select
              className="field-input"
              value={frequency}
              onChange={e => setFrequency(e.target.value as RecurringRule['frequency'])}
            >
              {FREQ_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Day-of-week toggles for weekly recurrence */}
          {frequency === 'weekly' && (
            <div>
              <label className="field-label">Days</label>
              <div className="flex gap-1.5 flex-wrap">
                {DOW_LABELS.map((d, i) => (
                  <button key={i} type="button" onClick={() => toggleDow(i)} style={chipStyle(daysOfWeek.includes(i))}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* End date for recurring events */}
          {frequency !== 'none' && (
            <div>
              <label className="field-label">End date (optional)</label>
              <input
                type="date"
                className="field-input"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="field-label">Tags</label>
            <div className="flex gap-1.5 flex-wrap">
              {COMMON_TAGS.map(t => (
                <button key={t} type="button" onClick={() => toggleTag(t)} style={chipStyle(tags.includes(t))}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Notes / description */}
          <div>
            <label className="field-label">Notes</label>
            <textarea
              className="field-input resize-none"
              rows={2}
              placeholder="Any details, context, preferences…"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Location */}
          <div>
            <label className="field-label">Location</label>
            <input
              className="field-input mb-2"
              placeholder="Place name (e.g. Coffee Lab, Home)"
              value={locationName}
              onChange={e => setLocationName(e.target.value)}
            />
            <input
              className="field-input mb-2"
              placeholder="Address (used to generate a maps link)"
              value={locationAddress}
              onChange={e => setLocationAddress(e.target.value)}
            />
            <input
              className="field-input"
              placeholder="Custom map URL (optional)"
              value={locationMapsUrl}
              onChange={e => setLocationMapsUrl(e.target.value)}
            />
          </div>

          {/* External event URL */}
          <div>
            <label className="field-label">Event link</label>
            <input
              className="field-input"
              placeholder="https://…"
              value={eventUrl}
              onChange={e => setEventUrl(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-5 py-4 shrink-0"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg border font-medium transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="px-5 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40 transition-opacity"
            style={{ background: 'var(--accent)' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

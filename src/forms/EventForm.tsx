// ─── EventForm ────────────────────────────────────────────────────────────────
// Modal form for creating or editing an availability entry.
//
// Create mode: pass `date` only — addEvent is called on submit.
// Edit mode:   pass `existing` (a CalEvent) — updateEvent is called on submit.
//              The edit button is only shown in EventDetail for the event owner,
//              so ownership is enforced in the UI before this form is opened.
//
// Time selects use 30-minute increments (0:00, 0:30 … 23:30, and 24:00 for end).
// Custom tags can be typed and confirmed with Enter or comma.
// All text inputs have maxLength guards to prevent oversized payloads.

import { useState } from 'react'
import type { CalEvent, RecurringRule } from '../types'
import { useStore }          from '../store/useStore'
import { urlValidationError } from '../utils/safeUrl'

interface Props {
  date:      string        // ISO date for the initial occurrence (or existing event's date)
  existing?: CalEvent      // when set, form is in edit mode
  onClose:   () => void
}

const FREQ_OPTIONS = [
  { value: 'none',    label: 'One time'           },
  { value: 'daily',   label: 'Every day'          },
  { value: 'weekly',  label: 'Weekly (pick days)' },
  { value: 'monthly', label: 'Monthly'            },
  { value: 'custom',  label: 'Specific dates'     },
] as const

const DOW_LABELS  = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const COMMON_TAGS = ['work', 'personal', 'travel', 'focus', 'flex', 'free']

// 30-minute increment options: 0, 0.5, 1 … 23.5 (start) and 0.5 … 24 (end)
const START_HOURS = Array.from({ length: 48 }, (_, i) => i * 0.5)
const END_HOURS   = Array.from({ length: 48 }, (_, i) => (i + 1) * 0.5)

function fmtHalf(h: number): string {
  if (h === 24) return 'Midnight'
  const hour = Math.floor(h)
  const min  = h % 1 !== 0 ? ':30' : ':00'
  if (hour === 0)  return `12${min} AM`
  if (hour === 12) return `12${min} PM`
  return hour < 12 ? `${hour}${min} AM` : `${hour - 12}${min} PM`
}

export function EventForm({ date, existing, onClose }: Props) {
  const { addEvent, updateEvent, activeUser, activeUserId } = useStore()
  const user    = activeUser()
  const isEdit  = !!existing

  const [title,           setTitle]           = useState(existing?.title           ?? '')
  const [description,     setDescription]     = useState(existing?.description     ?? '')
  const [startHour,       setStartHour]       = useState(existing?.startHour       ?? 9)
  const [endHour,         setEndHour]         = useState(existing?.endHour         ?? 17)
  const [tags,            setTags]            = useState<string[]>(existing?.tags  ?? [])
  const [locationName,    setLocationName]    = useState(existing?.location?.name    ?? '')
  const [locationAddress, setLocationAddress] = useState(existing?.location?.address ?? '')
  const [locationMapsUrl, setLocationMapsUrl] = useState(existing?.location?.mapsUrl ?? '')
  const [eventUrl,        setEventUrl]        = useState(existing?.eventUrl         ?? '')
  const [frequency,       setFrequency]       = useState<RecurringRule['frequency']>(
    existing?.recurring?.frequency ?? 'none'
  )
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(existing?.recurring?.daysOfWeek ?? [])
  const [endDate,    setEndDate]    = useState(existing?.recurring?.endDate ?? '')
  const [customTag,  setCustomTag]  = useState('')

  if (!user || !activeUserId) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50"
        style={{ background: 'rgba(0,0,0,0.45)' }}>
        <div className="rounded-xl p-6 text-sm shadow-xl" style={{ background: 'var(--bg-surface)' }}>
          Please select a user first.
          <button onClick={onClose} className="ml-4 underline" style={{ color: 'var(--accent)' }}>Close</button>
        </div>
      </div>
    )
  }

  // ── Tag helpers ──────────────────────────────────────────────────────────────

  function toggleTag(tag: string) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  function commitCustomTag() {
    // Strip to safe alphanumeric/dash chars; max 30 chars; max 10 tags total
    const cleaned = customTag.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '').slice(0, 30)
    if (cleaned && !tags.includes(cleaned) && tags.length < 10) {
      setTags(prev => [...prev, cleaned])
    }
    setCustomTag('')
  }

  function handleCustomTagKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitCustomTag() }
  }

  function toggleDow(i: number) {
    setDaysOfWeek(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i])
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  function submit() {
    if (!title.trim()) return
    if (eventUrl        && urlValidationError(eventUrl))        return
    if (locationMapsUrl && urlValidationError(locationMapsUrl)) return

    const payload = {
      userId:      activeUserId,
      title:       title.trim().slice(0, 100),
      description: description.slice(0, 1000),
      tags,
      date:        existing?.date ?? date,
      startHour,
      endHour:     endHour > startHour ? endHour : startHour + 0.5,
      location:    locationName || locationAddress || locationMapsUrl
        ? {
            name:    locationName    || undefined,
            address: locationAddress || undefined,
            mapsUrl: locationMapsUrl || undefined,
          }
        : undefined,
      eventUrl: eventUrl || undefined,
      recurring: {
        frequency,
        daysOfWeek: frequency === 'weekly' ? daysOfWeek : undefined,
        endDate:    endDate || undefined,
      },
    }

    if (isEdit && existing) {
      updateEvent(existing.id, payload)
    } else {
      addEvent(payload)
    }
    onClose()
  }

  // ── Chip style ───────────────────────────────────────────────────────────────

  function chipStyle(active: boolean): React.CSSProperties {
    return {
      padding:     '4px 12px',
      borderRadius: 999,
      fontSize:    12,
      fontWeight:  500,
      border:      `0.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background:  active ? 'var(--accent-bg)' : 'transparent',
      color:       active ? 'var(--accent)' : 'var(--text-muted)',
      cursor:      'pointer',
      transition:  'all 0.1s',
    }
  }

  const customTags = tags.filter(t => !COMMON_TAGS.includes(t))

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
        <div className="flex items-center px-5 py-4 shrink-0"
          style={{ borderBottom: '0.5px solid var(--border)' }}>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              {isEdit ? 'Edit availability' : 'Add availability'}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {existing?.date ?? date} · {user.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none ml-2 rounded p-1 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >×</button>
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
              maxLength={100}
              autoFocus
            />
          </div>

          {/* Hours — 30-minute increments */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="field-label">From</label>
              <select
                className="field-input"
                value={startHour}
                onChange={e => setStartHour(parseFloat(e.target.value))}
              >
                {START_HOURS.map(h => (
                  <option key={h} value={h}>{fmtHalf(h)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="field-label">To</label>
              <select
                className="field-input"
                value={endHour}
                onChange={e => setEndHour(parseFloat(e.target.value))}
              >
                {END_HOURS.filter(h => h > startHour).map(h => (
                  <option key={h} value={h}>{fmtHalf(h)}</option>
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

          {frequency !== 'none' && (
            <div>
              <label className="field-label">End date (optional)</label>
              <input type="date" className="field-input" value={endDate}
                onChange={e => setEndDate(e.target.value)} />
            </div>
          )}

          {/* Tags — preset chips + custom */}
          <div>
            <label className="field-label">Tags</label>
            <div className="flex gap-1.5 flex-wrap mb-2">
              {COMMON_TAGS.map(t => (
                <button key={t} type="button" onClick={() => toggleTag(t)} style={chipStyle(tags.includes(t))}>
                  {t}
                </button>
              ))}
            </div>

            {/* Active custom tags */}
            {customTags.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-2">
                {customTags.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTags(prev => prev.filter(x => x !== t))}
                    style={{ ...chipStyle(true), paddingRight: 8 }}
                  >
                    {t} ×
                  </button>
                ))}
              </div>
            )}

            {/* Custom tag input */}
            {tags.length < 10 && (
              <input
                className="field-input"
                style={{ fontSize: 12, padding: '5px 10px' }}
                placeholder="Custom tag — Enter or comma to add"
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                onKeyDown={handleCustomTagKey}
                onBlur={commitCustomTag}
                maxLength={30}
              />
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="field-label">Notes</label>
            <textarea
              className="field-input resize-none"
              rows={2}
              placeholder="Any details, context, preferences…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={1000}
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
              maxLength={200}
            />
            <input
              className="field-input mb-2"
              placeholder="Address (used to generate a maps link)"
              value={locationAddress}
              onChange={e => setLocationAddress(e.target.value)}
              maxLength={200}
            />
            <input
              className="field-input"
              placeholder="Custom map URL (optional)"
              value={locationMapsUrl}
              onChange={e => setLocationMapsUrl(e.target.value)}
              maxLength={2048}
            />
          </div>

          {/* Event URL */}
          <div>
            <label className="field-label">Event link</label>
            <input
              className="field-input"
              placeholder="https://…"
              value={eventUrl}
              onChange={e => setEventUrl(e.target.value)}
              maxLength={2048}
            />
            {eventUrl && urlValidationError(eventUrl) && (
              <p className="text-xs mt-1" style={{ color: '#dc2626' }}>
                {urlValidationError(eventUrl)}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 shrink-0"
          style={{ borderTop: '0.5px solid var(--border)' }}>
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
            {isEdit ? 'Save changes' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

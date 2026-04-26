// ─── EventForm ────────────────────────────────────────────────────────────────

import { useState } from 'react'
import type { RecurringRule } from '../types'
import { useStore } from '../store/useStore'

interface Props {
  date: string
  onClose: () => void
}

const FREQ_OPTIONS = [
  { value: 'none', label: 'One time' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Weekly (pick days)' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Specific dates' },
] as const

const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const COMMON_TAGS = ['work', 'personal', 'travel', 'focus', 'flex']

export function EventForm({ date, onClose }: Props) {
  const { addEvent, activeUser, activeUserId } = useStore()
  const user = activeUser()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startHour, setStartHour] = useState(9)
  const [endHour, setEndHour] = useState(17)
  const [tags, setTags] = useState<string[]>([])
  const [locationName, setLocationName] = useState('')
  const [locationAddress, setLocationAddress] = useState('')
  const [eventUrl, setEventUrl] = useState('')
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>('none')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([])
  const [endDate, setEndDate] = useState('')

  if (!user || !activeUserId) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 text-sm">
          Please select a user first.
          <button onClick={onClose} className="ml-4 underline">Close</button>
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
      userId: activeUserId!,
      title: title.trim(),
      description,
      tags,
      date,
      startHour,
      endHour,
      location: locationName ? { name: locationName, address: locationAddress } : undefined,
      eventUrl: eventUrl || undefined,
      recurring: {
        frequency,
        daysOfWeek: frequency === 'weekly' ? daysOfWeek : undefined,
        endDate: endDate || undefined,
      },
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="p-4 border-b border-divider flex items-center">
          <h3 className="font-medium text-sm flex-1">Add availability · {date}</h3>
          <button onClick={onClose} className="text-muted text-lg leading-none">×</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="field-label">Title</label>
            <input
              className="field-input"
              placeholder="e.g. Free afternoon"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          {/* Hours */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="field-label">From</label>
              <select className="field-input" value={startHour} onChange={e => setStartHour(+e.target.value)}>
                {Array.from({length:24},(_,i)=>i).map(h=>(
                  <option key={h} value={h}>{h}:00</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="field-label">To</label>
              <select className="field-input" value={endHour} onChange={e => setEndHour(+e.target.value)}>
                {Array.from({length:24},(_,i)=>i+1).map(h=>(
                  <option key={h} value={h}>{h}:00</option>
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
              {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {frequency === 'weekly' && (
            <div>
              <label className="field-label">Days</label>
              <div className="flex gap-1.5 flex-wrap">
                {DOW_LABELS.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDow(i)}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                      daysOfWeek.includes(i)
                        ? 'bg-purple-100 border-purple-400 text-purple-800'
                        : 'border-divider text-muted'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {frequency !== 'none' && (
            <div>
              <label className="field-label">End date (optional)</label>
              <input type="date" className="field-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="field-label">Tags</label>
            <div className="flex gap-1.5 flex-wrap">
              {COMMON_TAGS.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    tags.includes(t)
                      ? 'bg-purple-100 border-purple-400 text-purple-800'
                      : 'border-divider text-muted'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="field-label">Notes</label>
            <textarea
              className="field-input resize-none"
              rows={2}
              placeholder="Any details…"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Location */}
          <div>
            <label className="field-label">Location</label>
            <input className="field-input mb-1.5" placeholder="Name" value={locationName} onChange={e => setLocationName(e.target.value)} />
            <input className="field-input" placeholder="Address (for maps link)" value={locationAddress} onChange={e => setLocationAddress(e.target.value)} />
          </div>

          {/* Event URL */}
          <div>
            <label className="field-label">Event link</label>
            <input className="field-input" placeholder="https://..." value={eventUrl} onChange={e => setEventUrl(e.target.value)} />
          </div>
        </div>

        <div className="p-4 border-t border-divider flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-divider rounded-lg hover:bg-surface">Cancel</button>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="px-4 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

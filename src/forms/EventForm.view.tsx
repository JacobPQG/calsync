// ─── EventForm View ───────────────────────────────────────────────────────────
// PURE VIEW. All state/validation/submit is in useEventFormVM.ts.
//
// Editing guide:
//   • Field order / layout / which fields show → move the JSX blocks below.
//   • Chip + option presentation → STYLE / chipStyle / the option lists here.
//   • Colours → CSS vars in src/index.css.
//   • Behavior (validation, submit payload, tag rules) → useEventFormVM.ts.

import type { CalEvent, RecurringRule } from '../types'
import { IS_SPORTS } from '../lib/siteConfig'
import { ACTIVITIES } from '../sports/activities'
import { useEventFormVM } from './useEventFormVM'

interface Props {
  date:      string
  existing?: CalEvent
  onClose:   () => void
}

// ── Visual constants + presentational option lists ────────────────────────────
const STYLE = {
  maxWidth:    'max-w-md',
  activityCols: 'grid-cols-3',   // activity picker columns (sports)
  bodyGap:     'space-y-5',
} as const

const FREQ_OPTIONS = [
  { value: 'none',    label: 'One time'           },
  { value: 'daily',   label: 'Every day'          },
  { value: 'weekly',  label: 'Weekly (pick days)' },
  { value: 'monthly', label: 'Monthly'            },
  { value: 'custom',  label: 'Specific dates'     },
] as const

const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

// 30-minute increments: 0, 0.5 … 23.5 (start) and 0.5 … 24 (end).
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

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
    border: `0.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-bg)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer', transition: 'all 0.1s',
  }
}

// ─── EventForm ────────────────────────────────────────────────────────────────

export function EventForm({ date, existing, onClose }: Props) {
  const vm = useEventFormVM({ date, existing, onClose })
  const f  = vm.fields

  // "Select a user first" fallback.
  if (!vm.ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.45)' }}>
        <div className="rounded-xl p-6 text-sm shadow-xl" style={{ background: 'var(--bg-surface)' }}>
          Please select a user first.
          <button onClick={onClose} className="ml-4 underline" style={{ color: 'var(--accent)' }}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={`modal-card w-full ${STYLE.maxWidth} overflow-y-auto rounded-xl shadow-xl flex flex-col`}
        style={{ background: 'var(--bg-surface)' }}>

        {/* Header */}
        <div className="flex items-center px-5 py-4 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              {IS_SPORTS
                ? (vm.isEdit ? 'Edit activity' : 'Add activity')
                : (vm.isEdit ? 'Edit availability' : 'Add availability')}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {vm.headerDate} · {vm.userName}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="text-xl leading-none ml-2 rounded p-1 transition-colors"
            style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        {/* Body */}
        <div className={`p-5 ${STYLE.bodyGap} flex-1`}>

          {/* Activity picker — sports variant's primary field */}
          {IS_SPORTS && (
            <div>
              <label className="field-label">Sport / activity</label>
              <div className={`grid ${STYLE.activityCols} gap-1.5`} role="radiogroup" aria-label="Activity">
                {ACTIVITIES.map(a => {
                  const active = f.activity === a.id
                  return (
                    <button key={a.id} type="button" role="radio" aria-checked={active}
                      onClick={() => f.setActivity(active ? '' : a.id)}
                      className="flex items-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-all"
                      style={{
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                        background:  active ? 'var(--accent-bg)' : 'var(--bg-subtle)',
                        color:       active ? 'var(--accent)' : 'var(--text-2)',
                        boxShadow:   active ? '0 0 0 2px var(--accent-bg)' : 'none',
                      }}>
                      <span style={{ fontSize: 15 }}>{a.emoji}</span>
                      <span className="truncate">{a.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="field-label">{IS_SPORTS ? 'Title (optional)' : 'Title'}</label>
            <input
              className="field-input"
              placeholder={IS_SPORTS
                ? 'e.g. Sunday five-a-side — defaults to the sport name'
                : 'e.g. Free afternoon, Available for calls…'}
              value={f.title}
              onChange={e => f.setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && vm.submit()}
              maxLength={100}
              autoFocus={!IS_SPORTS}
            />
          </div>

          {/* Hours — 30-minute increments */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="field-label">From</label>
              <select className="field-input" value={f.startHour}
                onChange={e => f.setStartHour(parseFloat(e.target.value))}>
                {START_HOURS.map(h => <option key={h} value={h}>{fmtHalf(h)}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="field-label">To</label>
              <select className="field-input" value={f.endHour}
                onChange={e => f.setEndHour(parseFloat(e.target.value))}>
                {END_HOURS.filter(h => h > f.startHour).map(h => <option key={h} value={h}>{fmtHalf(h)}</option>)}
              </select>
            </div>
          </div>

          {/* Recurrence */}
          <div>
            <label className="field-label">Repeat</label>
            <select className="field-input" value={f.frequency}
              onChange={e => f.setFrequency(e.target.value as RecurringRule['frequency'])}>
              {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {f.frequency === 'weekly' && (
            <div>
              <label className="field-label">Days</label>
              <div className="flex gap-1.5 flex-wrap">
                {DOW_LABELS.map((d, i) => (
                  <button key={i} type="button" onClick={() => vm.toggleDow(i)} style={chipStyle(f.daysOfWeek.includes(i))}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {f.frequency !== 'none' && (
            <div>
              <label className="field-label">End date (optional)</label>
              <input type="date" className="field-input" value={f.endDate}
                onChange={e => f.setEndDate(e.target.value)} />
            </div>
          )}

          {/* Tags — preset chips + custom */}
          <div>
            <label className="field-label">Tags</label>
            <div className="flex gap-1.5 flex-wrap mb-2">
              {vm.presetTags.map(t => (
                <button key={t} type="button" onClick={() => vm.toggleTag(t)} style={chipStyle(f.tags.includes(t))}>
                  {t}
                </button>
              ))}
            </div>

            {vm.customTags.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-2">
                {vm.customTags.map(t => (
                  <button key={t} type="button" onClick={() => vm.toggleTag(t)} style={{ ...chipStyle(true), paddingRight: 8 }}>
                    {t} ×
                  </button>
                ))}
              </div>
            )}

            {vm.canAddMoreTags && (
              <input
                className="field-input" style={{ fontSize: 12, padding: '5px 10px' }}
                placeholder="Custom tag — Enter or comma to add"
                value={f.customTag}
                onChange={e => f.setCustomTag(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); vm.commitCustomTag() } }}
                onBlur={vm.commitCustomTag}
                maxLength={30}
              />
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="field-label">Notes</label>
            <textarea className="field-input resize-none" rows={2}
              placeholder="Any details, context, preferences…"
              value={f.description} onChange={e => f.setDescription(e.target.value)} maxLength={1000} />
          </div>

          {/* Location */}
          <div>
            <label className="field-label">Location</label>
            <input className="field-input mb-2" placeholder="Place name (e.g. Coffee Lab, Home)"
              value={f.locationName} onChange={e => f.setLocationName(e.target.value)} maxLength={200} />
            <input className="field-input mb-2" placeholder="Address (used to generate a maps link)"
              value={f.locationAddress} onChange={e => f.setLocationAddress(e.target.value)} maxLength={200} />
            <input className="field-input" placeholder="Custom map URL (optional)"
              value={f.locationMapsUrl} onChange={e => f.setLocationMapsUrl(e.target.value)} maxLength={2048} />
            {vm.mapsUrlError && (
              <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{vm.mapsUrlError}</p>
            )}
          </div>

          {/* Event URL */}
          <div>
            <label className="field-label">Event link</label>
            <input className="field-input" placeholder="https://…"
              value={f.eventUrl} onChange={e => f.setEventUrl(e.target.value)} maxLength={2048} />
            {vm.eventUrlError && (
              <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{vm.eventUrlError}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="safe-bottom flex justify-end gap-2 px-5 py-4 shrink-0"
          style={{ borderTop: '0.5px solid var(--border)' }}>
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg border font-medium transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
            Cancel
          </button>
          <button onClick={vm.submit} disabled={!vm.canSubmit}
            className="px-5 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40 transition-opacity"
            style={{ background: 'var(--accent)' }}>
            {vm.isEdit ? 'Save changes' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

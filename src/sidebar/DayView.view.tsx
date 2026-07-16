// ─── DayView View ─────────────────────────────────────────────────────────────
// PURE VIEW. All logic is in useDayViewVM.ts. Reshape freely here.
//
// Three visual states, chosen by the VM:
//   1. No day selected  → placeholder prompt
//   2. Day selected     → hour timeline (event blocks in overlap columns)
//   3. Event clicked    → event detail (inline; Back returns to the timeline)
//
// Editing guide:
//   • Timeline proportions (row height, label width, hour span visuals) → STYLE.
//   • Colours → CSS vars in src/index.css.
//   • Behavior (layout algorithm, what data shows) → useDayViewVM.ts.

import type { EventInstance } from '../types'
import { EventForm } from '../forms/EventForm'
import { ScoreForm } from '../sports/ScoreForm'
import { useState } from 'react'
import {
  useDayViewVM, useCurrentTimeY, useEventDetailVM,
  layoutInstances, fmtHour, activityById,
  FIRST_HOUR, LAST_HOUR,
  type EventDetailVM,
} from './useDayViewVM'

// ── Visual constants ──────────────────────────────────────────────────────────
// The timeline's pixel proportions. HOUR_PX also feeds the VM (via the hook
// argument) so the current-time marker lines up with the ruler.
const STYLE = {
  hourPx:      40,     // px — height of one hour row (compact: the panel floats
                       //      inset from the screen edges, so rows earn less room)
  labelW:      54,     // px — width of the hour-label gutter
  blockPad:    '4px 6px',
  minBlockFraction: 0.5,   // shortest event block = half an hour row
  nowColor:    '#ef4444',  // current-time marker (intentionally not a token)
} as const

// ─── DayView ─────────────────────────────────────────────────────────────────

export function DayView() {
  const vm = useDayViewVM()

  // State 1: nothing selected.
  if (!vm.hasSelection) return <EmptyPrompt />

  return (
    <div className="flex flex-col h-full">

      {vm.editingEvent && (
        <EventForm date={vm.editingEvent.date} existing={vm.editingEvent} onClose={vm.closeEdit} />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate" style={{ color: 'var(--text)' }}>
              {vm.dayLabel}
            </div>
            {vm.isOverlap && (
              <div className="inline-flex items-center gap-1.5 text-xs mt-1.5 px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--overlap-bg)', color: 'var(--overlap-text)' }}>
                <span style={{ fontSize: 7 }}>●</span>
                {vm.overlapNames}
              </div>
            )}
            {/* De-identified hint: somebody has an anonymous event here that
                nothing of yours coincides with. No name, no time, no title. */}
            {vm.hiddenCount > 0 && (
              <div className="inline-flex items-center gap-1.5 text-xs mt-1.5 px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
                title="Anonymous — revealed only if your times coincide">
                <span aria-hidden style={{ fontSize: 9 }}>🕶️</span>
                {vm.hiddenCount === 1
                  ? 'Someone else has something here'
                  : `${vm.hiddenCount} others have something here`}
              </div>
            )}
          </div>
          {vm.activeEvent && (
            <button onClick={vm.closeEvent}
              className="text-xs shrink-0 rounded px-2 py-1 font-medium"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-subtle)' }}>
              ← Back
            </button>
          )}
        </div>
      </div>

      {/* ── Content: detail (state 3) or timeline (state 2) ─────────────── */}
      {/* Adding events and polls happens in the actions panel below the month
          grid (MonthGrid.view.tsx) — this panel is a pure timeline. */}
      <div className="flex-1 overflow-y-auto">
        {vm.activeEvent
          ? <EventDetail instance={vm.activeEvent} onDelete={vm.deleteActiveEvent} onEdit={vm.openEdit} />
          : <HourTimeline instances={vm.instances} isToday={vm.isToday} onClickEvent={vm.openEvent} />
        }
      </div>
    </div>
  )
}

// ─── EmptyPrompt (state 1) ────────────────────────────────────────────────────

function EmptyPrompt() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center"
      style={{ color: 'var(--text-muted)' }}>
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

// ─── HourTimeline (state 2) ───────────────────────────────────────────────────

function HourTimeline(
  { instances, isToday, onClickEvent }:
  { instances: EventInstance[]; isToday: boolean; onClickEvent: (i: EventInstance) => void },
) {
  const { hourPx, labelW } = STYLE
  const totalHours  = LAST_HOUR - FIRST_HOUR
  const totalHeight = totalHours * hourPx
  const hourRows    = Array.from({ length: totalHours }, (_, i) => i + FIRST_HOUR)
  const laid        = layoutInstances(instances)
  const nowY        = useCurrentTimeY(hourPx, isToday)

  return (
    <div className="relative" style={{ height: totalHeight }}>

      {/* Hour ruler: labels + gridlines */}
      {hourRows.map(hour => (
        <div key={hour} className="absolute flex w-full pointer-events-none"
          style={{ top: (hour - FIRST_HOUR) * hourPx, height: hourPx }}>
          <div className="shrink-0 text-right pr-3 pt-1 select-none"
            style={{ width: labelW, fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>
            {fmtHour(hour)}
          </div>
          <div className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
        </div>
      ))}

      {/* Event blocks, offset past the label gutter */}
      <div className="absolute" style={{ top: 0, left: labelW + 3, right: 4, bottom: 0 }}>
        {laid.map(({ inst, col, numCols }) => {
          const { startHour, endHour } = inst.event
          const color  = inst.event.color ?? inst.user.color
          const top    = Math.max(0, (startHour - FIRST_HOUR) * hourPx)
          const height = Math.max(hourPx * STYLE.minBlockFraction, (endHour - startHour) * hourPx - 2)
          const pct    = 100 / numCols

          return (
            <button
              key={inst.event.id}
              className="absolute rounded-md text-left overflow-hidden transition-opacity hover:opacity-85"
              style={{
                top, height,
                left:  `calc(${col * pct}% + 1px)`,
                width: `calc(${pct}% - 2px)`,
                background: color + '1a',
                borderLeft: `3px solid ${color}`,
                boxShadow:  `inset 0 0 0 0.5px ${color}35`,
                padding:    STYLE.blockPad,
              }}
              onClick={() => onClickEvent(inst)}
            >
              <div className="text-xs font-semibold truncate leading-tight" style={{ color }}>
                {inst.user.name}
              </div>
              {inst.event.title && height > hourPx * 0.6 && (
                <div className="text-[11px] truncate leading-tight mt-0.5" style={{ color }}>
                  {activityById(inst.event.activity)?.emoji}{' '}
                  {inst.event.title}
                  {inst.event.result && ' · 🏆'}
                </div>
              )}
              {inst.event.location?.name && height > hourPx && (
                <div className="text-[10px] truncate mt-0.5" style={{ color, opacity: 0.7 }}>
                  {inst.event.location.name}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Current-time marker */}
      {nowY !== null && (
        <div className="absolute pointer-events-none" style={{ top: nowY, left: labelW, right: 0 }}>
          <div className="relative">
            <div className="absolute rounded-full"
              style={{ left: -5, top: -4, width: 9, height: 9, background: STYLE.nowColor }} />
            <div style={{ height: 1.5, background: STYLE.nowColor, opacity: 0.75 }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── EventDetail (state 3) ────────────────────────────────────────────────────
// Edit/Delete are owner-only (enforced in the VM's isOwner).

function EventDetail(
  { instance, onDelete, onEdit }:
  { instance: EventInstance; onDelete: () => void; onEdit: (e: EventDetailVM['event']) => void },
) {
  const vm = useEventDetailVM(instance)
  const [showScoreForm, setShowScoreForm] = useState(false)
  const { color } = vm

  return (
    <div className="p-4 space-y-5">

      {/* Colour strip + title + user */}
      <div className="rounded-lg p-3" style={{ background: color + '12', borderLeft: `3px solid ${color}` }}>
        <div className="font-semibold text-sm" style={{ color }}>
          {vm.event.title || '(untitled)'}
        </div>
        <div className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
          <span className="inline-flex w-4 h-4 items-center justify-center rounded-full text-white font-bold leading-none"
            style={{ background: vm.event.color ?? color, fontSize: 8 }}>
            {vm.userInitial}
          </span>
          {vm.userName}
        </div>
      </div>

      {/* Visibility — owner-only; tells you who can currently see this. */}
      {vm.visibilityBadge && (
        <Field label="Visibility">
          <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-subtle)', border: '0.5px solid var(--border)' }}>
            <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
              <span aria-hidden>{vm.visibilityBadge.icon}</span>
              {vm.visibilityBadge.label}
            </div>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {vm.visibilityBadge.hint}
            </p>
          </div>
        </Field>
      )}

      {/* Activity (sports variant) */}
      {vm.activityLabel && (
        <Field label="Activity">
          <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{vm.activityLabel}</div>
        </Field>
      )}

      {/* Result (sports variant) */}
      {(vm.hasResult || vm.canScore) && (
        <Field label="Result">
          {vm.hasResult ? (
            <div className="rounded-lg overflow-hidden mb-2" style={{ border: '0.5px solid var(--border)' }}>
              {vm.teamRows.map((t, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2"
                  style={{
                    borderTop: i > 0 ? '0.5px solid var(--border)' : undefined,
                    background: t.won && !vm.isDraw ? 'var(--overlap-bg)' : 'var(--bg-subtle)',
                  }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate"
                      style={{ color: t.won && !vm.isDraw ? 'var(--overlap-text)' : 'var(--text)' }}>
                      {t.won && !vm.isDraw && '🏆 '}{t.name}
                    </div>
                    {t.members && (
                      <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                        {t.members}
                      </div>
                    )}
                  </div>
                  <div className="text-base font-bold tabular-nums shrink-0"
                    style={{ color: t.won ? 'var(--overlap-text)' : 'var(--text-muted)' }}>
                    {t.score}
                  </div>
                </div>
              ))}
              {vm.isDraw && (
                <div className="px-3 py-1.5 text-[10px]"
                  style={{ color: 'var(--text-muted)', borderTop: '0.5px solid var(--border)' }}>
                  Draw
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>No score recorded yet.</p>
          )}
          {vm.canScore && (
            <button onClick={() => setShowScoreForm(true)}
              className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)', background: 'var(--bg-subtle)' }}>
              {vm.hasResult ? 'Edit result' : '🏆 Record result'}
            </button>
          )}
        </Field>
      )}

      {/* Source calendar — with the jump to it when it is not the view you are
          already in (i.e. from the overview). */}
      {(vm.sourceCalendarName || vm.canSwitchToSource) && (
        <Field label="Calendar">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {vm.sourceCalendarName ?? 'Unknown calendar'}
            </span>
            {vm.canSwitchToSource && (
              <button onClick={vm.openSourceCalendar}
                className="text-xs px-2.5 py-1 rounded border font-medium transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-2)', background: 'var(--bg-subtle)' }}
                title={`Open ${vm.sourceCalendarName ?? 'this event’s calendar'}`}>
                ↗ Open calendar
              </button>
            )}
          </div>
        </Field>
      )}

      {/* Time */}
      <Field label="Time">
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{vm.timeRange}</div>
        <div className="text-xs mt-0.5" style={{ color: vm.isUpcoming ? 'var(--overlap-text)' : 'var(--text-muted)' }}>
          {vm.relativeTime}
        </div>
      </Field>

      {/* Notes */}
      {vm.event.description && (
        <Field label="Notes">
          <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {vm.event.description}
          </p>
        </Field>
      )}

      {/* Tags */}
      {vm.event.tags.length > 0 && (
        <Field label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {vm.event.tags.map(tag => (
              <span key={tag} className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: color + '20', color }}>
                {tag}
              </span>
            ))}
          </div>
        </Field>
      )}

      {/* Location */}
      {(vm.event.location?.name || vm.event.location?.address) && (
        <Field label="Location">
          {vm.event.location.name && (
            <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>{vm.event.location.name}</div>
          )}
          {vm.event.location.address && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{vm.event.location.address}</div>
          )}
          {vm.mapsUrl && (
            <a href={vm.mapsUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs rounded border px-2.5 py-1 font-medium transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
              ↗ Get directions
            </a>
          )}
        </Field>
      )}

      {/* Event URL */}
      {vm.eventUrl && (
        <Field label="Event link">
          <a href={vm.eventUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs break-all" style={{ color: 'var(--accent)' }}>
            {vm.eventUrl}
          </a>
        </Field>
      )}

      {/* Recurrence */}
      {vm.recurrenceLabel && (
        <Field label="Repeats">
          <div className="text-sm" style={{ color: 'var(--text-2)' }}>{vm.recurrenceLabel}</div>
        </Field>
      )}

      {/* Owner-only actions */}
      {vm.isOwner && (
        <div className="flex gap-2 pt-1" style={{ borderTop: '0.5px solid var(--border)' }}>
          <button onClick={() => onEdit(vm.event)}
            className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)', background: 'var(--bg-subtle)' }}>
            Edit
          </button>
          <button onClick={onDelete}
            className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
            style={{ borderColor: 'var(--danger-border)', color: 'var(--danger)', background: 'var(--danger-bg)' }}>
            Delete
          </button>
        </div>
      )}

      {showScoreForm && <ScoreForm event={vm.event} onClose={() => setShowScoreForm(false)} />}
    </div>
  )
}

// Small labelled section wrapper — keeps the detail markup uniform.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      {children}
    </div>
  )
}

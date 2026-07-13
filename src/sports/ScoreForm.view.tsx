// ─── ScoreForm View ───────────────────────────────────────────────────────────
// PURE VIEW. State/validation is in useScoreFormVM.ts. Reshape freely here.
//
// Editing guide:
//   • Team card layout, score input width, member chip look → STYLE / JSX below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior (validation, save/remove) → useScoreFormVM.ts.

import type { CalEvent } from '../types'
import { useScoreFormVM } from './useScoreFormVM'

interface Props {
  event:   CalEvent
  onClose: () => void
}

const STYLE = {
  maxWidth:    'max-w-md',
  scoreWidth:  76,      // px — width of each score number input
} as const

export function ScoreForm({ event, onClose }: Props) {
  const vm = useScoreFormVM({ event, onClose })

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
              {vm.hasExistingResult ? 'Edit result' : 'Record result'}
            </h3>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
              {event.title} · {event.date}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="text-xl leading-none ml-2 rounded p-1" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        {/* Teams */}
        <div className="p-5 space-y-4 flex-1">
          {vm.teams.map((team, i) => (
            <div key={i} className="rounded-lg p-3 space-y-2.5"
              style={{ border: '0.5px solid var(--border)', background: 'var(--bg-subtle)' }}>
              <div className="flex gap-2">
                <input className="field-input flex-1" value={team.name}
                  onChange={e => vm.patchTeam(i, { name: e.target.value })}
                  maxLength={40} aria-label={`Side ${i + 1} name`} />
                <input className="field-input text-center font-semibold" style={{ width: STYLE.scoreWidth }}
                  type="number" min={0} inputMode="numeric" placeholder="0"
                  value={team.score}
                  onChange={e => vm.patchTeam(i, { score: e.target.value })}
                  aria-label={`Side ${i + 1} score`} />
                {vm.teams.length > 2 && (
                  <button type="button" onClick={() => vm.removeTeam(i)}
                    aria-label={`Remove side ${i + 1}`} className="btn-nav shrink-0">×</button>
                )}
              </div>

              {/* Member picker */}
              <div className="flex flex-wrap gap-1.5">
                {vm.users.map(u => {
                  const active = team.memberIds.includes(u.id)
                  return (
                    <button key={u.id} type="button" onClick={() => vm.toggleMember(i, u.id)}
                      aria-pressed={active}
                      className="flex items-center gap-1.5 rounded-full text-xs border transition-all"
                      style={{
                        padding: '3px 10px 3px 5px',
                        ...(active
                          ? { borderColor: u.color, color: u.color, background: u.color + '18' }
                          : { borderColor: 'var(--border)', color: 'var(--text-muted)' }),
                      }}>
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
                        style={{ background: u.color, fontSize: 9 }}>
                        {u.name[0].toUpperCase()}
                      </span>
                      {u.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {vm.canAddTeam && (
            <button type="button" onClick={vm.addTeam} className="btn-toolbar w-full justify-center">
              + Add side
            </button>
          )}

          {vm.error && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {vm.error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="safe-bottom flex items-center gap-2 px-5 py-4 shrink-0"
          style={{ borderTop: '0.5px solid var(--border)' }}>
          {vm.hasExistingResult && (
            <button onClick={vm.removeResult}
              className="text-xs px-3 py-1.5 rounded border font-medium"
              style={{ borderColor: 'var(--danger-border)', color: 'var(--danger)', background: 'var(--danger-bg)' }}>
              Remove result
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg border font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
            Cancel
          </button>
          <button onClick={vm.save}
            className="px-5 py-1.5 text-sm rounded-lg text-white font-medium"
            style={{ background: 'var(--accent)' }}>
            Save result
          </button>
        </div>
      </div>
    </div>
  )
}

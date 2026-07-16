// ─── PollPanel View (ADR-19) ──────────────────────────────────────────────────
// PURE VIEW. All logic is in usePollPanelVM.ts. Reshape freely here.
//
// Renders the horizontal actions panel below the month grid: a row of action
// buttons (the caller's — e.g. "Add Event" — passed in via `actions`, plus this
// panel's own "New poll"), then the selected day's polls (tally + your vote) and
// the create-poll form. Hidden entirely when no calendar is open (the
// overview/home have no single calendar to poll in).
//
// Editing guide:
//   • Sizes / spacing → the STYLE block.
//   • Colours → CSS vars in src/index.css (var(--poll…), var(--overlap…)).
//   • Behaviour (tally, vote cycling, close) → usePollPanelVM.ts.

import { useState, type ReactNode } from 'react'
import { usePollPanelVM, nextVote, type PollCardVM, type OptionRowVM } from './usePollPanelVM'
import { buildOptions, formatHour } from '../forms/timepicker/timeOptions'
import type { PollVoteValue } from '../types'

const STYLE = {
  cardGap:     'gap-3',
  optionMinH:  34,   // px — one slot row
  tickW:       58,   // px — width of the yes/maybe/no toggle
} as const

// Per-vote visual vocabulary. Colours are tokens so light/dark both work.
const VOTE_UI: Record<PollVoteValue, { label: string; icon: string; fg: string; bg: string }> = {
  yes:   { label: 'Yes',   icon: '✓', fg: 'var(--overlap-text)', bg: 'var(--overlap-bg)' },
  maybe: { label: 'Maybe', icon: '~', fg: 'var(--poll-text)',    bg: 'var(--poll-bg)' },
  no:    { label: 'No',    icon: '✕', fg: 'var(--danger)',       bg: 'var(--danger-bg)' },
}

const TIME_OPTIONS = buildOptions(0, 24.5)   // includes 24:00 as an end time

// ─── PollPanel ────────────────────────────────────────────────────────────────

export function PollPanel({ actions }: { actions?: ReactNode }) {
  const vm = usePollPanelVM()
  if (!vm.canManage) return null

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
      {/* The horizontal action row: caller-supplied buttons first (Add Event),
          then New poll, then which day the actions will land on. */}
      <div className="flex items-center gap-2 mb-2">
        {actions}
        {!vm.creating && (
          <button onClick={vm.openCreate}
            className="text-xs px-2.5 py-1 rounded border font-medium transition-colors"
            style={{ borderColor: 'var(--poll-border)', color: 'var(--poll-text)', background: 'var(--poll-bg)' }}>
            ＋ New poll
          </button>
        )}
        <span className="text-xs select-none" style={{ color: 'var(--text-muted)' }}>
          for {vm.targetLabel}
        </span>
      </div>

      {vm.actionError && <ErrorLine msg={vm.actionError} />}

      {vm.creating && <CreateForm vm={vm} />}

      <div className={`flex flex-col ${STYLE.cardGap} ${vm.creating ? 'mt-3' : ''}`}>
        {vm.cards.map(card => <PollCard key={card.id} card={card} vm={vm} />)}
      </div>
    </div>
  )
}

function ErrorLine({ msg }: { msg: string }) {
  return (
    <p className="text-xs mb-2 px-2 py-1 rounded"
      style={{ color: 'var(--danger)', background: 'var(--danger-bg)' }}>
      {msg}
    </p>
  )
}

// ─── PollCard ─────────────────────────────────────────────────────────────────

function PollCard({ card, vm }: { card: PollCardVM; vm: ReturnType<typeof usePollPanelVM> }) {
  const [closing, setClosing] = useState<string | null>(null)   // option id staged to win
  const [spawn, setSpawn]     = useState(true)
  const isClosed = card.status === 'closed'

  return (
    <div className="rounded-lg" style={{ border: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div className="px-3 py-2 flex items-start justify-between gap-2"
        style={{ borderBottom: '0.5px solid var(--border)' }}>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
            {isClosed && '🏆 '}{card.title}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            by {card.creatorName} · {card.voters} {card.voters === 1 ? 'voter' : 'voters'}
            {isClosed ? ' · decided' : card.iVoted ? ' · you voted' : ' · you haven’t voted'}
          </div>
        </div>
        {card.isMine && !isClosed && (
          <button onClick={() => vm.deletePoll(card.id)}
            className="text-[10px] shrink-0 px-2 py-0.5 rounded border font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            title="Delete this poll">
            Delete
          </button>
        )}
      </div>

      {/* Options */}
      <div className="px-3 py-2 flex flex-col gap-1.5">
        {card.options.map(opt => (
          <OptionRow key={opt.option.id} opt={opt} isClosed={isClosed}
            isWinner={card.chosenOptionId === opt.option.id}
            staged={closing === opt.option.id}
            canClose={card.isMine && !isClosed}
            onVote={() => vm.setDraftVote(card.id, opt.option.id, nextVote(opt.myVote))}
            onStage={() => setClosing(closing === opt.option.id ? null : opt.option.id)}
          />
        ))}
      </div>

      {/* Footer: save votes (if dirty), or the close confirmation */}
      {!isClosed && (
        <div className="px-3 py-2 flex flex-col gap-2" style={{ borderTop: '0.5px solid var(--border)' }}>
          {vm.dirty(card.id) && (
            <button onClick={() => vm.saveVotes(card.id)} disabled={vm.voteBusy === card.id}
              className="text-xs py-1.5 rounded font-medium transition-colors"
              style={{ background: 'var(--accent)', color: '#fff', opacity: vm.voteBusy === card.id ? 0.6 : 1 }}>
              {vm.voteBusy === card.id ? 'Saving…' : 'Save my votes'}
            </button>
          )}

          {closing && card.isMine && (
            <div className="rounded p-2 flex flex-col gap-2" style={{ background: 'var(--poll-bg)' }}>
              <div className="text-[11px]" style={{ color: 'var(--poll-text)' }}>
                Close this poll on <strong>{card.options.find(o => o.option.id === closing)?.label}</strong>?
              </div>
              <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
                <input type="checkbox" checked={spawn} onChange={e => setSpawn(e.target.checked)} />
                Also add it to the calendar as an event
              </label>
              <div className="flex gap-2">
                <button onClick={async () => { await vm.closePoll(card.id, closing, spawn); setClosing(null) }}
                  className="text-xs px-3 py-1 rounded font-medium"
                  style={{ background: 'var(--poll)', color: '#1a1408' }}>
                  Close poll
                </button>
                <button onClick={() => setClosing(null)}
                  className="text-xs px-3 py-1 rounded border font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── OptionRow ────────────────────────────────────────────────────────────────
// One candidate slot: label, tally bars, and this user's vote toggle. When the
// poll's manager is closing it, the row also offers "pick this" to stage a winner.

function OptionRow(
  { opt, isClosed, isWinner, staged, canClose, onVote, onStage }:
  { opt: OptionRowVM; isClosed: boolean; isWinner: boolean; staged: boolean;
    canClose: boolean; onVote: () => void; onStage: () => void },
) {
  const total = opt.yes + opt.maybe + opt.no

  return (
    <div className="flex items-center gap-2 rounded px-2"
      style={{
        minHeight: STYLE.optionMinH,
        background: isWinner ? 'var(--overlap-bg)' : opt.isLeader && !isClosed ? 'var(--poll-bg)' : 'transparent',
        border: isWinner ? '0.5px solid var(--overlap-border)' : '0.5px solid transparent',
      }}>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate" style={{ color: 'var(--text)' }}>
          {isWinner && '🏆 '}{opt.label}
        </div>
        {total > 0 && (
          <div className="flex items-center gap-2 mt-0.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <TallyPip n={opt.yes}   ui={VOTE_UI.yes} />
            <TallyPip n={opt.maybe} ui={VOTE_UI.maybe} />
            <TallyPip n={opt.no}    ui={VOTE_UI.no} />
          </div>
        )}
      </div>

      {/* This user's vote toggle — click cycles yes → maybe → no. Hidden once the
          poll is closed (nothing left to decide). */}
      {!isClosed && (
        <button onClick={onVote}
          className="shrink-0 text-[10px] font-bold rounded px-1.5 py-1 border transition-colors"
          style={{
            width: STYLE.tickW,
            borderColor: opt.myVote ? VOTE_UI[opt.myVote].fg : 'var(--border)',
            background:  opt.myVote ? VOTE_UI[opt.myVote].bg : 'transparent',
            color:       opt.myVote ? VOTE_UI[opt.myVote].fg : 'var(--text-muted)',
          }}
          title="Click to change your availability">
          {opt.myVote ? `${VOTE_UI[opt.myVote].icon} ${VOTE_UI[opt.myVote].label}` : '— vote'}
        </button>
      )}

      {canClose && (
        <button onClick={onStage}
          className="shrink-0 text-[10px] px-1.5 py-1 rounded border font-medium"
          style={{
            borderColor: staged ? 'var(--poll)' : 'var(--border)',
            color: staged ? 'var(--poll-text)' : 'var(--text-muted)',
            background: staged ? 'var(--poll-bg)' : 'transparent',
          }}
          title="Pick this slot as the winner">
          {staged ? '● pick' : 'pick'}
        </button>
      )}
    </div>
  )
}

function TallyPip({ n, ui }: { n: number; ui: { icon: string; fg: string } }) {
  if (n === 0) return null
  return (
    <span className="inline-flex items-center gap-0.5" style={{ color: ui.fg }}>
      <span>{ui.icon}</span>{n}
    </span>
  )
}

// ─── CreateForm ───────────────────────────────────────────────────────────────

function CreateForm({ vm }: { vm: ReturnType<typeof usePollPanelVM> }) {
  return (
    <div className="rounded-lg p-3 mb-1" style={{ border: '0.5px solid var(--poll-border)', background: 'var(--bg-surface)' }}>
      <input
        className="field-input w-full mb-2"
        placeholder="Poll title — e.g. Team dinner"
        value={vm.draftTitle}
        onChange={e => vm.setDraftTitle(e.target.value)}
        maxLength={80}
        autoFocus
      />

      <div className="flex flex-col gap-1.5 mb-2">
        {vm.draftSlots.map(slot => (
          <div key={slot.key} className="flex items-center gap-1.5">
            <input type="date" value={slot.date}
              onChange={e => vm.updateSlot(slot.key, { date: e.target.value })}
              className="field-input flex-1" style={{ padding: '4px 7px', fontSize: 12 }} />
            <TimeSelect value={slot.startHour}
              onChange={v => vm.updateSlot(slot.key, { startHour: v })} />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>–</span>
            <TimeSelect value={slot.endHour}
              onChange={v => vm.updateSlot(slot.key, { endHour: v })} />
            {vm.draftSlots.length > 1 && (
              <button onClick={() => vm.removeSlot(slot.key)}
                className="text-xs px-1.5 rounded" style={{ color: 'var(--text-muted)' }}
                title="Remove this slot">✕</button>
            )}
          </div>
        ))}
      </div>

      <button onClick={vm.addSlot}
        className="text-[11px] mb-2 px-2 py-1 rounded border font-medium"
        style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
        ＋ Add time slot
      </button>

      {vm.createError && <ErrorLine msg={vm.createError} />}

      <div className="flex gap-2">
        <button onClick={vm.submitCreate} disabled={vm.creatingBusy}
          className="text-xs px-3 py-1.5 rounded font-medium flex-1"
          style={{ background: 'var(--poll)', color: '#1a1408', opacity: vm.creatingBusy ? 0.6 : 1 }}>
          {vm.creatingBusy ? 'Creating…' : 'Create poll'}
        </button>
        <button onClick={vm.closeCreate}
          className="text-xs px-3 py-1.5 rounded border font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function TimeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))}
      className="field-input" style={{ padding: '4px 6px', fontSize: 12 }}>
      {TIME_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{formatHour(o.value)}</option>
      ))}
    </select>
  )
}

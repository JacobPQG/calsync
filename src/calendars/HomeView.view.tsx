// ─── HomeView ─────────────────────────────────────────────────────────────────
// PURE VIEW. All logic is in useHomeVM.ts. This is the landing page: the
// calendars you administer, the calendars you were invited into, and the button
// that makes a new one.
//
// Editing guide:
//   • Card size, grid, spacing → STYLE below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior → useHomeVM.ts.

import type { Calendar } from '../types'
import { useHomeVM } from './useHomeVM'
import { MIN_CALENDAR_SEATS, MAX_CALENDAR_SEATS } from '../lib/config'

const STYLE = {
  maxWidth:  960,   // px — content column
  cardMinW:  260,   // px — calendar card, before the grid wraps
  cardPadY:  14,
  cardPadX:  16,
  gap:       12,
} as const

interface Props {
  // Enter a calendar (the month grid).
  onOpen:  (calendarId: string) => void
  // Open a calendar's admin panel. Only ever offered for calendars you own.
  onAdmin: (calendarId: string) => void
  // Open the OVERVIEW — every event you are part of, across all your calendars.
  onOpenOverview: () => void
}

export function HomeView({ onOpen, onAdmin, onOpenOverview }: Props) {
  const vm = useHomeVM()

  // The overview only makes sense once there is at least one calendar to
  // aggregate. Owned calendars always count (the owner is an approved member of
  // their own); a joined one counts only once its owner has approved you.
  const hasOverviewContent =
    vm.owned.length > 0 || vm.joined.some(c => c.myStatus === 'approved')

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-base)' }}>
      <div className="mx-auto px-4 py-6 flex flex-col gap-6"
        style={{ maxWidth: STYLE.maxWidth }}>

        {vm.error && (
          <div className="text-xs px-3 py-2 rounded-lg"
            style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
            {vm.error}
          </div>
        )}

        {/* ── All my events (the overview) ─────────────────────────────── */}
        {/* First and centered: this is the default place to look — one grid
            with everything you are part of, kept live as the calendars below
            change. Opening a specific calendar is the step after. */}
        {!vm.loading && hasOverviewContent && (
          <section className="flex justify-center">
            <button onClick={onOpenOverview}
              className="w-full rounded-xl flex flex-col items-center gap-1 py-5 px-4 text-center transition-opacity hover:opacity-90"
              style={{
                maxWidth: 520,
                background: 'var(--accent-bg)',
                border: '0.5px solid var(--accent)',
              }}
              title="One calendar with every event you are part of">
              <span className="text-base font-semibold" style={{ color: 'var(--accent)' }}>
                👁 All my events
              </span>
              <span className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Every event you are part of, across all your calendars —
                updated live as they change.
              </span>
            </button>
          </section>
        )}

        {/* ── My calendars ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              My calendars
            </h2>
            <button className="btn-toolbar" onClick={() => vm.setCreating(!vm.creating)}
              disabled={vm.createBlockedReason !== null}
              title={vm.createBlockedReason ?? undefined}>
              {vm.creating ? 'Cancel' : '+ New calendar'}
            </button>
          </div>

          {/* Say why the button is dead rather than leaving the user to poke it. */}
          {vm.createBlockedReason && (
            <p className="text-xs px-3 py-2 rounded-lg"
              style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
              {vm.createBlockedReason}
            </p>
          )}

          {vm.creating && !vm.createBlockedReason && <CreateForm vm={vm} onCreated={onOpen} />}

          {vm.loading ? (
            <Muted>Loading…</Muted>
          ) : vm.owned.length === 0 ? (
            <Muted>
              You don’t administer any calendars yet. Create one, then invite
              people into it with a QR code.
            </Muted>
          ) : (
            <Grid>
              {vm.owned.map(c => (
                <CalendarCard key={c.id} cal={c}
                  onOpen={() => onOpen(c.id)}
                  onAdmin={() => onAdmin(c.id)} />
              ))}
            </Grid>
          )}
        </section>

        {/* ── Shared with me ───────────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Shared with me
          </h2>

          {vm.loading ? (
            <Muted>Loading…</Muted>
          ) : vm.joined.length === 0 ? (
            <Muted>
              No one has invited you to a calendar yet. When they do, scan their
              QR code and it will appear here.
            </Muted>
          ) : (
            <Grid>
              {vm.joined.map(c => (
                <CalendarCard key={c.id} cal={c}
                  onOpen={() => onOpen(c.id)}
                  onLeave={() => vm.leave(c.id)}
                  busy={vm.busyId === c.id} />
              ))}
            </Grid>
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Create form ──────────────────────────────────────────────────────────────
// Name + seat count. The seat count is the "how many people will be added"
// decision, taken up front: it becomes a hard cap the server enforces when the
// owner approves members, so it is not merely a note to self.

function CreateForm({ vm, onCreated }: {
  vm: ReturnType<typeof useHomeVM>
  onCreated: (id: string) => void
}) {
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const id = await vm.create()
    if (id) onCreated(id)
  }

  const unlimited = vm.newSeats === null

  return (
    <form onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl p-4"
      style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
          Calendar name
        </span>
        <input className="field-input" autoFocus maxLength={60}
          placeholder="Five-a-side, Book club, Family…"
          value={vm.newName} onChange={e => vm.setNewName(e.target.value)} />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
          How many people, including you?
        </span>
        <div className="flex items-center gap-3">
          <input type="number" className="field-input" style={{ width: 90 }}
            min={MIN_CALENDAR_SEATS} max={MAX_CALENDAR_SEATS}
            disabled={unlimited}
            value={unlimited ? '' : vm.newSeats ?? ''}
            onChange={e => {
              const n = Number(e.target.value)
              vm.setNewSeats(Number.isFinite(n) && n > 0 ? n : null)
            }} />
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={unlimited}
              onChange={e => vm.setNewSeats(e.target.checked ? null : MIN_CALENDAR_SEATS + 7)} />
            No limit
          </label>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          A hard limit: once the calendar is full you cannot approve anyone else
          into it until someone leaves. You can raise it later, but never below
          the members it already has.
        </p>
      </div>

      {/* What kind of calendar is this? The sports features used to be a separate
          build of the whole site; now they are a property of one calendar, so you
          can keep a five-a-side and a work calendar side by side. Individually
          tunable afterwards in Manage. */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="mt-0.5"
          checked={vm.newSports}
          onChange={e => vm.setNewSports(e.target.checked)} />
        <span className="flex flex-col">
          <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
            🏆 Sports calendar
          </span>
          <span style={{ fontSize: 10.5, lineHeight: 1.35, color: 'var(--text-muted)' }}>
            Adds activities, match results, a leaderboard and monthly challenges.
            You can change this later.
          </span>
        </span>
      </label>

      <div className="flex justify-end">
        <button type="submit" disabled={!vm.canCreate || vm.submitting}
          className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)' }}>
          {vm.submitting ? 'Creating…' : 'Create calendar'}
        </button>
      </div>
    </form>
  )
}

// ─── Calendar card ────────────────────────────────────────────────────────────

function CalendarCard({ cal, onOpen, onAdmin, onLeave, busy }: {
  cal:      Calendar
  onOpen:   () => void
  onAdmin?: () => void
  onLeave?: () => void
  busy?:    boolean
}) {
  // A pending member cannot open the calendar: RLS would hand them an empty grid,
  // which reads as "broken" rather than "waiting". Say which it is.
  const pending = cal.myStatus === 'pending'
  const full    = cal.maxMembers !== null && cal.memberCount >= cal.maxMembers

  return (
    <div className="rounded-xl flex flex-col gap-2"
      style={{
        padding: `${STYLE.cardPadY}px ${STYLE.cardPadX}px`,
        background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
        opacity: busy ? 0.6 : 1,
      }}>

      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} disabled={pending}
          className="text-left font-semibold text-sm truncate disabled:cursor-not-allowed"
          style={{ color: pending ? 'var(--text-muted)' : 'var(--text)' }}
          title={pending ? 'Waiting for the owner to approve you' : `Open ${cal.name}`}>
          {cal.name}
        </button>

        {/* The owner's queue. This is the confirmation step made visible: a
            number here means somebody is waiting on you. */}
        {cal.isOwner && cal.pendingCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
            style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
            title={`${cal.pendingCount} waiting for your approval`}>
            {cal.pendingCount} pending
          </span>
        )}
      </div>

      <div className="text-[11px] flex items-center gap-1.5 flex-wrap"
        style={{ color: 'var(--text-muted)' }}>
        <span>
          {cal.memberCount}
          {cal.maxMembers !== null && ` / ${cal.maxMembers}`}
          {' '}member{cal.memberCount === 1 ? '' : 's'}
        </span>
        {full && <span style={{ color: 'var(--warning)' }}>· full</span>}
        {!cal.isOwner && cal.ownerName && <span>· {cal.ownerName}’s</span>}
      </div>

      {pending ? (
        <p className="text-[11px]" style={{ color: 'var(--warning)' }}>
          ⏳ Waiting for {cal.ownerName ?? 'the owner'} to approve you.
        </p>
      ) : (
        <div className="flex items-center gap-2 mt-1">
          <button className="btn-toolbar" onClick={onOpen}>Open</button>
          {onAdmin && <button className="btn-toolbar" onClick={onAdmin}>⚙ Manage</button>}
          {onLeave && (
            <button className="btn-toolbar" onClick={onLeave} disabled={busy}
              title="Leave this calendar — your events in it are deleted">
              Leave
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Small shared bits ────────────────────────────────────────────────────────

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid"
      style={{
        gap: STYLE.gap,
        gridTemplateColumns: `repeat(auto-fill, minmax(${STYLE.cardMinW}px, 1fr))`,
      }}>
      {children}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  )
}

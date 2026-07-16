// ─── MonthGrid View ───────────────────────────────────────────────────────────
// PURE VIEW. All logic is in useMonthGridVM.ts. This file is safe to reshape
// freely — move sections around, change markup, retune the STYLE block below —
// without worrying about breaking behavior.
//
// Editing guide:
//   • Sizes / spacing / layout numbers → the STYLE object at the top.
//   • Colours → CSS variables in src/index.css (var(--…)). Don't hardcode hex.
//   • Behavior (what a click does, what "best days" means) → useMonthGridVM.ts.

import type { DayCellVM, RankingCardVM } from './useMonthGridVM'
import { useMonthGridVM } from './useMonthGridVM'
import { EventForm } from '../forms/EventForm'
import { PollPanel } from '../polls/PollPanel'

// ── Visual constants ──────────────────────────────────────────────────────────
// Tune the calendar's proportions here. Nothing else in this file hardcodes a
// pixel size, so these are the single place to reshape the grid.
const STYLE = {
  padding:        'p-3 sm:p-5',   // outer padding (Tailwind classes)
  // Day-cell height scales with the viewport (6 rows ≈ half the screen) between
  // a phone-sized floor and a large-monitor ceiling; width scales for free via
  // the 7-column grid filling the calendar column (capped in App.view.tsx).
  cellMinHeight:  'clamp(56px, 9vh, 112px)',
  cellDateSize:   20,             // px — the round day-number badge
  cellDateFont:   11,             // px
  dotSize:        6,              // px — per-user colour dot
  maxDots:        4,              // most dots drawn per row before "+N" takes over
  gridGap:        'gap-1',        // Tailwind gap between day cells
  // Poll marker (ADR-19): a ROUNDED SQUARE at the cell's top-right, with two
  // small checkmarks floating over its top edge. Square — never a circle — so it
  // reads as a distinct kind of thing from the round user dots and date badge.
  poll: {
    squareSize:   16,   // px — the rounded square itself
    squareRadius: 5,    // px — corner radius (rounded, not a circle)
    tickSize:     7,    // px — each floating checkmark
    tickOffset:   4,    // px — how far the ticks float above the square's top
  },
  ranking: {
    cardMinWidth: 80,             // px
    cardGap:      'gap-2',        // Tailwind gap between ranking cards
    tagFont:      9,              // px — below this, tags stop being readable
  },
} as const

// The de-identified "somebody is quietly free here" dot. Deliberately hollow and
// colourless: a user dot carries an identity, this one must not.
function hiddenDotStyle(size: number): React.CSSProperties {
  return {
    width: size, height: size, borderRadius: '50%',
    border: '1px dashed var(--text-muted)', opacity: 0.75, flexShrink: 0,
  }
}

function hiddenLabel(n: number): string {
  return n === 1
    ? 'Someone has something here (anonymous)'
    : `${n} others have something here (anonymous)`
}

// One capped dot row: at most STYLE.maxDots dots (users first, hollow anonymous
// dots after), then a "+N" for the rest. Uncapped, a 30-member day silently
// clipped inside the 56px cell and looked like ~8 events (review finding #6).
function DotRow({ users, hiddenCount, wrap }: {
  users: DayCellVM['users']; hiddenCount: number; wrap?: boolean
}) {
  const total = users.length + hiddenCount
  if (total === 0) return null
  const shownUsers  = users.slice(0, STYLE.maxDots)
  const shownHidden = Math.max(0, Math.min(hiddenCount, STYLE.maxDots - shownUsers.length))
  const rest        = total - shownUsers.length - shownHidden

  return (
    <div className={`flex gap-0.5 items-center ${wrap ? 'flex-wrap' : ''}`}>
      {shownUsers.map(u => (
        <div key={u.id} title={u.name}
          style={{ width: STYLE.dotSize, height: STYLE.dotSize, borderRadius: '50%',
                   background: u.color, flexShrink: 0 }} />
      ))}
      {Array.from({ length: shownHidden }, (_, i) => (
        <div key={`hidden-${i}`} title={hiddenLabel(hiddenCount)}
          style={hiddenDotStyle(STYLE.dotSize)} />
      ))}
      {rest > 0 && (
        <span className="select-none" title={`${rest} more`}
          style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, color: 'var(--text-muted)' }}>
          +{rest}
        </span>
      )}
    </div>
  )
}

// Accessible description of the poll marker on a day.
function pollLabel(poll: NonNullable<DayCellVM['poll']>): string {
  if (poll.needsMyVote) {
    return poll.count > 1
      ? `${poll.count} time polls here — you haven’t voted`
      : 'Time poll here — you haven’t voted'
  }
  if (poll.count > 0) return poll.count > 1 ? `${poll.count} time polls here` : 'Time poll here'
  return poll.hasClosed ? 'A poll was decided for this day' : 'Poll'
}

// The poll marker (ADR-19): a ROUNDED SQUARE, deliberately not a circle, so it
// reads as its own kind of mark next to the round user dots. Two small checkmarks
// float over its top edge. When the active user still owes a vote the square is
// filled and the ticks are accented; once they've voted (or the poll is closed)
// it settles to an outline so it stops nagging.
function PollSquare({ poll }: { poll: NonNullable<DayCellVM['poll']> }) {
  const { squareSize, squareRadius, tickSize, tickOffset } = STYLE.poll
  const active = poll.needsMyVote          // still wants my attention
  const closed = poll.count === 0 && poll.hasClosed

  return (
    <span className="relative shrink-0 select-none" style={{ width: squareSize, height: squareSize }}
      title={pollLabel(poll)}>
      {/* Two floating checkmarks, gathered over the top edge and slightly
          overlapped, echoing Doodle's "tick your slots" motif. */}
      <span className="absolute flex" style={{ top: -tickOffset, right: 0, gap: 1 }} aria-hidden>
        <span style={{ fontSize: tickSize, lineHeight: 1, color: active ? 'var(--poll)' : 'var(--poll-border)' }}>✓</span>
        <span style={{ fontSize: tickSize, lineHeight: 1, color: active ? 'var(--poll-text)' : 'var(--poll-border)' }}>✓</span>
      </span>

      {/* The rounded square. */}
      <span className="absolute inset-0 flex items-center justify-center font-bold leading-none"
        style={{
          borderRadius: squareRadius,
          fontSize: 9,
          border: `1px solid var(--poll-border)`,
          background: active ? 'var(--poll-bg)' : 'transparent',
          color: active ? 'var(--poll-text)' : 'var(--poll)',
          opacity: closed ? 0.6 : 1,
        }}>
        {poll.count > 1 ? poll.count : ''}
      </span>
    </span>
  )
}

// ─── MonthGrid ────────────────────────────────────────────────────────────────

export function MonthGrid() {
  const vm = useMonthGridVM()

  return (
    // overflow-y-auto: on short viewports (laptop at 768px, phone landscape) the
    // column scrolls instead of clipping the month's last week (finding #5).
    <div className={`flex flex-col h-full ${STYLE.padding} gap-0 overflow-y-auto`}>

      {/* ── Navigation header ───────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="flex-1 text-base font-semibold tracking-tight select-none"
          style={{ color: 'var(--text)' }}>
          {vm.monthLabel}
        </h2>
        <button className="btn-toolbar text-xs" onClick={vm.goToToday}>Today</button>
        <div className="flex gap-1">
          <button className="btn-nav" aria-label="Previous month" onClick={vm.goPrevMonth}>‹</button>
          <button className="btn-nav" aria-label="Next month" onClick={vm.goNextMonth}>›</button>
        </div>
      </div>

      {/* ── Day-of-week headers ─────────────────────────────────────────── */}
      <div className="grid grid-cols-7 mb-1">
        {vm.weekdays.map(d => (
          <div key={d} className="text-center select-none"
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
                     textTransform: 'uppercase', color: 'var(--text-muted)', paddingBottom: 5 }}>
            {d}
          </div>
        ))}
      </div>

      {/* ── Day grid ────────────────────────────────────────────────────── */}
      {/* content-start stops the rows stretching to fill leftover height. */}
      <div className={`grid grid-cols-7 ${STYLE.gridGap} content-start`} style={{ flex: '0 0 auto' }}>
        {vm.cells.map(cell => (
          <DayCell key={cell.date} cell={cell} onClick={() => vm.toggleDay(cell.date)} />
        ))}
      </div>

      {/* ── Day actions + polls ──────────────────────────────────────────── */}
      {/* Horizontal panel under the grid: add an event / open a poll on the
          selected day (or today when none is picked), plus that day's polls.
          Lives here — not in the day side panel — so the panel stays a pure
          timeline. Self-hides in the overview. */}
      <PollPanel actions={
        vm.canAddEvents ? (
          <button onClick={vm.openAddForm}
            className="text-xs px-2.5 py-1 rounded border font-medium transition-colors"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }}>
            ＋ Add Event
          </button>
        ) : null
      } />

      {/* ── Availability ranking ─────────────────────────────────────────── */}
      {vm.ranking.length > 0 && (
        <AvailabilityRanking cards={vm.ranking} onSelect={vm.toggleDay} />
      )}

      {vm.showAddForm && (
        <EventForm date={vm.addFormDate} onClose={vm.closeAddForm} />
      )}
    </div>
  )
}

// ─── DayCell ─────────────────────────────────────────────────────────────────
// Date number + one dot per user + overlap badge. Compact by design: colour
// signals only, no text chips.

function DayCell({ cell, onClick }: { cell: DayCellVM; onClick: () => void }) {
  let cls = 'day-cell'
  if (!cell.inMonth)      cls += ' out-of-month'
  if (cell.today)         cls += ' is-today'
  if (cell.selected)      cls += ' is-selected'
  else if (cell.isOverlap) cls += ' is-overlap'

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-label={[
        cell.date,
        cell.isOverlap  ? `${cell.userCount} people available` : '',
        cell.hiddenCount ? hiddenLabel(cell.hiddenCount)       : '',
        cell.poll       ? pollLabel(cell.poll)                 : '',
      ].filter(Boolean).join(', ')}
      aria-pressed={cell.selected}
      style={{ minHeight: STYLE.cellMinHeight }}
    >
      {/* Top row — a structured 3-slot layout so everything gathers instead of
          wrapping loosely: date badge (left), overlap badge (centre-right), and
          the poll square pinned to the far right. */}
      <div className="flex items-start gap-1 mb-1">
        <div className="flex items-center justify-center rounded-full leading-none font-semibold select-none shrink-0"
          style={{
            width: STYLE.cellDateSize, height: STYLE.cellDateSize, fontSize: STYLE.cellDateFont,
            ...(cell.today
              ? { background: 'var(--today-fill)', color: 'var(--today-text)' }
              : { color: 'var(--text)' }),
          }}>
          {cell.label}
        </div>

        <div className="flex-1" />

        {cell.isOverlap && (
          <span className="text-[9px] font-bold rounded-full leading-none shrink-0"
            style={{ background: 'var(--overlap-border)', color: 'var(--overlap-text)', padding: '2px 4px' }}>
            {cell.userCount}✓
          </span>
        )}

        {/* Poll marker — rightmost, always last in the row. */}
        {cell.poll && <PollSquare poll={cell.poll} />}
      </div>

      {/* User colour dots — one per person, plus hollow dots for anonymous
          events we're not allowed to attribute to anyone yet. Capped with +N. */}
      <DotRow users={cell.users} hiddenCount={cell.hiddenCount} wrap />
    </button>
  )
}

// ─── AvailabilityRanking ──────────────────────────────────────────────────────
// Horizontal scroll row of the month's best-availability days.

function AvailabilityRanking(
  { cards, onSelect }: { cards: RankingCardVM[]; onSelect: (date: string) => void },
) {
  return (
    <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 select-none"
        style={{ color: 'var(--text-muted)' }}>
        Best days this month
      </p>

      <div className={`flex ${STYLE.ranking.cardGap} overflow-x-auto pb-1`} style={{ scrollbarWidth: 'none' }}>
        {cards.map(card => (
          <RankingCard key={card.date} card={card} onClick={() => onSelect(card.date)} />
        ))}
      </div>
    </div>
  )
}

function RankingCard({ card, onClick }: { card: RankingCardVM; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-lg text-left transition-all"
      style={{
        padding: '7px 9px',
        minWidth: STYLE.ranking.cardMinWidth,
        border: `0.5px solid ${card.isSelected
          ? 'var(--accent)'
          : card.isOverlap ? 'var(--overlap-border)' : 'var(--border)'}`,
        background: card.isSelected
          ? 'var(--accent-light)'
          : card.isOverlap ? 'var(--overlap-bg)' : 'var(--bg-surface)',
        boxShadow: card.isSelected ? '0 0 0 1.5px var(--accent-bg)' : 'none',
      }}
    >
      {/* Date */}
      <div className="font-semibold leading-tight"
        style={{ fontSize: 11, color: card.isToday ? 'var(--today-fill)' : 'var(--text)' }}>
        {card.weekdayNum}
      </div>

      {/* User dots (+ hollow dots for withheld anonymous events), capped */}
      <div className="flex gap-0.5 mt-1 items-center">
        <DotRow users={card.users} hiddenCount={card.hiddenCount} />
        {card.isOverlap && (
          <span style={{ fontSize: 8, color: 'var(--overlap-text)', marginLeft: 2, lineHeight: '6px' }}>✓</span>
        )}
      </div>

      {/* Activity emojis (sports variant) */}
      {card.emojis.length > 0 && (
        <div className="mt-1 leading-none" style={{ fontSize: 12 }}>
          {card.emojis.join(' ')}
        </div>
      )}

      {/* Tags (up to 3) */}
      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mt-1">
          {card.tags.map(t => (
            <span key={t} style={{
              fontSize: STYLE.ranking.tagFont, padding: '1px 4px', borderRadius: 3,
              background: 'var(--bg-subtle)', color: 'var(--text-muted)',
            }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Event count. A day can rank on withheld events alone, in which case
          there is no count to show — only the hint that somebody is there. */}
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
        {card.eventCount > 0
          ? `${card.eventCount} event${card.eventCount !== 1 ? 's' : ''}`
          : 'someone’s free'}
      </div>
    </button>
  )
}

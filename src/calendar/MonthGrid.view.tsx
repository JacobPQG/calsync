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

// ── Visual constants ──────────────────────────────────────────────────────────
// Tune the calendar's proportions here. Nothing else in this file hardcodes a
// pixel size, so these are the single place to reshape the grid.
const STYLE = {
  padding:        'p-3 sm:p-5',   // outer padding (Tailwind classes)
  cellMinHeight:  56,             // px — min height of a day cell
  cellDateSize:   20,             // px — the round day-number badge
  cellDateFont:   11,             // px
  dotSize:        6,              // px — per-user colour dot
  gridGap:        'gap-1',        // Tailwind gap between day cells
  ranking: {
    cardMinWidth: 80,             // px
    cardGap:      'gap-2',        // Tailwind gap between ranking cards
    tagFont:      8,              // px
  },
} as const

// ─── MonthGrid ────────────────────────────────────────────────────────────────

export function MonthGrid() {
  const vm = useMonthGridVM()

  return (
    <div className={`flex flex-col h-full ${STYLE.padding} gap-0`}>

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

      {/* ── Availability ranking ─────────────────────────────────────────── */}
      {vm.ranking.length > 0 && (
        <AvailabilityRanking cards={vm.ranking} onSelect={vm.toggleDay} />
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
      aria-label={`${cell.date}${cell.isOverlap ? `, ${cell.userCount} people available` : ''}`}
      aria-pressed={cell.selected}
      style={{ minHeight: STYLE.cellMinHeight }}
    >
      {/* Date number + overlap badge */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center justify-center rounded-full leading-none font-semibold select-none"
          style={{
            width: STYLE.cellDateSize, height: STYLE.cellDateSize, fontSize: STYLE.cellDateFont,
            ...(cell.today
              ? { background: 'var(--today-fill)', color: 'var(--today-text)' }
              : { color: 'var(--text)' }),
          }}>
          {cell.label}
        </div>

        {cell.isOverlap && (
          <span className="text-[9px] font-bold rounded-full leading-none"
            style={{ background: 'var(--overlap-border)', color: 'var(--overlap-text)', padding: '2px 4px' }}>
            {cell.userCount}✓
          </span>
        )}
      </div>

      {/* User colour dots — one per person */}
      {cell.users.length > 0 && (
        <div className="flex gap-0.5 flex-wrap">
          {cell.users.map(u => (
            <div key={u.id} title={u.name}
              style={{ width: STYLE.dotSize, height: STYLE.dotSize, borderRadius: '50%',
                       background: u.color, flexShrink: 0 }} />
          ))}
        </div>
      )}
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

      {/* User dots */}
      <div className="flex gap-0.5 mt-1">
        {card.users.map(u => (
          <div key={u.id} title={u.name}
            style={{ width: STYLE.dotSize, height: STYLE.dotSize, borderRadius: '50%', background: u.color }} />
        ))}
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

      {/* Event count */}
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
        {card.eventCount} event{card.eventCount !== 1 ? 's' : ''}
      </div>
    </button>
  )
}

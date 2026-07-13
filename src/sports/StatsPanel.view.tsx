// ─── StatsPanel View ──────────────────────────────────────────────────────────
// PURE VIEW. Data/derivations live in useStatsPanelVM.ts. Reshape freely here.
//
// Overlay with the competitive elements, each gated by an admin feature flag:
//   Leaderboard — standings + recent winning teams
//   Challenges  — monthly participation challenges
//
// Editing guide:
//   • Table columns, card layout, medal glyphs → STYLE / MEDALS / JSX below.
//   • Colours → CSS vars in src/index.css.
//   • What's computed (standings math, filters) → useStatsPanelVM.ts + standings/challenges.ts.

import type { User } from '../types'
import {
  useStatsTabs, useLeaderboardVM, useChallengesVM,
} from './useStatsPanelVM'

interface Props {
  onClose: () => void
}

const STYLE = {
  contentMaxWidth: 'max-w-2xl',
  medalSize:  13,      // px
  listLimit:  8,       // rows shown per challenge
} as const

const MEDALS = ['🥇', '🥈', '🥉']

// ─── StatsPanel ───────────────────────────────────────────────────────────────

export function StatsPanel({ onClose }: Props) {
  const { tabs, tab, setTab } = useStatsTabs()

  return (
    <div className="fixed inset-0 z-40 flex flex-col"
      style={{ background: 'var(--bg-base)', paddingTop: 'env(safe-area-inset-top)' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}>
        <button onClick={onClose} className="text-sm font-medium flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
          ← Calendar
        </button>
        <div className="flex-1" />
        {tabs.length > 1 && tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors"
            style={tab === t
              ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }
              : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            {t === 'leaderboard' ? '🏆 Leaderboard' : '🔥 Challenges'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto safe-bottom">
        <div className={`${STYLE.contentMaxWidth} mx-auto p-4 sm:p-6`}>
          {tab === 'leaderboard' ? <LeaderboardView /> : <ChallengesView />}
        </div>
      </div>
    </div>
  )
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function UserBadge({ user }: { user: User }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold shrink-0"
        style={{ background: user.color, fontSize: 9 }}>
        {user.name[0].toUpperCase()}
      </span>
      <span className="text-sm truncate" style={{ color: 'var(--text)' }}>{user.name}</span>
    </span>
  )
}

function Rank({ i }: { i: number }) {
  return (
    <span className="w-5 text-center shrink-0" style={{ fontSize: STYLE.medalSize }}>
      {MEDALS[i] ?? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</span>}
    </span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2 select-none" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h3>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed rounded-lg px-4 py-6 text-center"
      style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '0.5px solid var(--border)' }}>
      {children}
    </p>
  )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors"
      style={active
        ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }
        : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
      {label}
    </button>
  )
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function LeaderboardView() {
  const vm = useLeaderboardVM()

  return (
    <div className="space-y-6">
      {/* Activity filter */}
      {vm.usedActivities.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={vm.activity === null} onClick={() => vm.setActivity(null)} label="All sports" />
          {vm.usedActivities.map(a => (
            <FilterChip key={a.id} active={vm.activity === a.id}
              onClick={() => vm.setActivity(vm.activity === a.id ? null : a.id)}
              label={`${a.emoji} ${a.label}`} />
          ))}
        </div>
      )}

      {/* Standings table */}
      <section>
        <SectionTitle>Standings</SectionTitle>
        {vm.standings.length === 0 ? (
          <EmptyNote>
            No results yet. Open a past event and hit “Record result” —
            wins show up here as 🏆 {'{'}3 pts win · 1 pt draw{'}'}.
          </EmptyNote>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
            <table className="w-full text-sm" style={{ background: 'var(--bg-surface)' }}>
              <thead>
                <tr className="text-[10px] uppercase tracking-wider select-none" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left  font-semibold px-3 py-2">Player</th>
                  <th className="text-center font-semibold px-1 py-2" title="Played">P</th>
                  <th className="text-center font-semibold px-1 py-2" title="Wins">W</th>
                  <th className="text-center font-semibold px-1 py-2" title="Draws">D</th>
                  <th className="text-center font-semibold px-1 py-2" title="Losses">L</th>
                  <th className="text-right  font-semibold px-3 py-2">Pts</th>
                </tr>
              </thead>
              <tbody>
                {vm.standings.map((s, i) => (
                  <tr key={s.user.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <Rank i={i} />
                        <UserBadge user={s.user} />
                      </span>
                    </td>
                    <td className="text-center px-1 py-2" style={{ color: 'var(--text-2)' }}>{s.played}</td>
                    <td className="text-center px-1 py-2" style={{ color: 'var(--overlap-text)' }}>{s.wins}</td>
                    <td className="text-center px-1 py-2" style={{ color: 'var(--text-2)' }}>{s.draws}</td>
                    <td className="text-center px-1 py-2" style={{ color: 'var(--text-muted)' }}>{s.losses}</td>
                    <td className="text-right px-3 py-2 font-bold" style={{ color: 'var(--text)' }}>{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent results — winning-team callouts */}
      {vm.recent.length > 0 && (
        <section>
          <SectionTitle>Recent results</SectionTitle>
          <ul className="space-y-2">
            {vm.recent.map(({ match, label, dateText, isDraw }) => (
              <li key={match.event.id} className="rounded-lg px-3 py-2.5"
                style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}>
                <div className="flex items-center gap-2 text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  <span>{label}</span>
                  <span className="flex-1" />
                  <span>{dateText}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {match.result.teams.map((t, i) => {
                    const won = match.winners.includes(i)
                    return (
                      <span key={i} className="inline-flex items-center gap-1.5 text-sm">
                        {won && !isDraw && <span aria-label="winner">🏆</span>}
                        <span className={won ? 'font-semibold' : ''} style={{ color: won ? 'var(--text)' : 'var(--text-2)' }}>
                          {t.name}
                        </span>
                        <span className="font-bold tabular-nums" style={{ color: won ? 'var(--overlap-text)' : 'var(--text-muted)' }}>
                          {t.score}
                        </span>
                      </span>
                    )
                  })}
                  {isDraw && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>draw</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ── Challenges ────────────────────────────────────────────────────────────────

function ChallengesView() {
  const vm = useChallengesVM()

  return (
    <div className="space-y-6">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Challenges for <strong style={{ color: 'var(--text-2)' }}>{vm.monthLabel}</strong> —
        every planned session counts, no score needed.
      </p>

      {!vm.hasAny && (
        <EmptyNote>
          Nothing on the board yet — add activities to the calendar and the
          challenge standings fill up automatically.
        </EmptyNote>
      )}

      {vm.challenges.map(c => c.entries.length > 0 && (
        <section key={c.id}>
          <SectionTitle>{c.emoji} {c.title}</SectionTitle>
          <ul className="rounded-xl overflow-hidden"
            style={{ border: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}>
            {c.entries.slice(0, STYLE.listLimit).map((e, i) => (
              <li key={e.user.id} className="flex items-center gap-2 px-3 py-2"
                style={i > 0 ? { borderTop: '0.5px solid var(--border)' } : undefined}>
                <Rank i={i} />
                <UserBadge user={e.user} />
                <span className="flex-1" />
                <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text)' }}>{e.value}</span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{c.unit}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ─── Monthly challenges (sports variant) ──────────────────────────────────────
// Pure logic: computes challenge standings for a month from the same events
// the calendar shows (recurrence-expanded). No score entry needed — showing
// up counts. Add a challenge by appending to CHALLENGES.

import { startOfMonth, endOfMonth } from 'date-fns'
import type { CalEvent, User } from '../types'
import { buildDaySummaries } from '../engine/recurrence'

export interface ChallengeEntry {
  user:  User
  value: number
}

export interface ChallengeResult {
  id:      string
  title:   string
  emoji:   string
  unit:    string           // label for the value column, e.g. "sessions"
  entries: ChallengeEntry[] // ranked, best first
}

interface UserMonthStats {
  user: User
  sessions: number            // event instances in the month
  activities: Set<string>     // distinct activity ids
  groupSessions: number       // instances on days where 2+ people coincide
}

function collectMonthStats(events: CalEvent[], users: User[], month: Date): UserMonthStats[] {
  const stats = new Map<string, UserMonthStats>(users.map(u =>
    [u.id, { user: u, sessions: 0, activities: new Set<string>(), groupSessions: 0 }]))

  const summaries = buildDaySummaries(events, users, startOfMonth(month), endOfMonth(month))
  for (const day of summaries.values()) {
    for (const inst of day.instances) {
      const s = stats.get(inst.user.id)
      if (!s) continue
      s.sessions++
      if (inst.event.activity) s.activities.add(inst.event.activity)
      if (day.isOverlap) s.groupSessions++
    }
  }
  return [...stats.values()]
}

function ranked(all: UserMonthStats[], value: (s: UserMonthStats) => number): ChallengeEntry[] {
  return all
    .map(s => ({ user: s.user, value: value(s) }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value || a.user.name.localeCompare(b.user.name))
}

const CHALLENGES = [
  {
    id: 'most-active', title: 'Most active', emoji: '🔥', unit: 'sessions',
    value: (s: UserMonthStats) => s.sessions,
  },
  {
    id: 'multi-sport', title: 'Multi-sport', emoji: '🎽', unit: 'different sports',
    value: (s: UserMonthStats) => s.activities.size,
  },
  {
    id: 'team-player', title: 'Team player', emoji: '🤝', unit: 'shared days',
    value: (s: UserMonthStats) => s.groupSessions,
  },
]

export function buildChallenges(events: CalEvent[], users: User[], month: Date): ChallengeResult[] {
  const stats = collectMonthStats(events, users, month)
  return CHALLENGES.map(c => ({
    id: c.id, title: c.title, emoji: c.emoji, unit: c.unit,
    entries: ranked(stats, c.value),
  }))
}

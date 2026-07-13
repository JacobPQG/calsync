// ─── Standings engine (sports variant) ────────────────────────────────────────
// Pure logic: aggregates recorded MatchResults into a per-user leaderboard.
// No persistence or UI imports — mirrors engine/recurrence.ts in spirit.
//
// Scoring: the side with the highest score wins; equal top scores are a draw
// for every tied side. Points follow the football convention (see POINTS).

import type { CalEvent, MatchResult, User } from '../types'

// TODO(config): expose via env if a league ever wants different point values.
export const POINTS = { win: 3, draw: 1, loss: 0 } as const

export interface Standing {
  user:   User
  played: number
  wins:   number
  draws:  number
  losses: number
  points: number
}

export interface RecordedMatch {
  event:  CalEvent
  result: MatchResult
  /** Winning sides (more than one = draw between them). */
  winners: number[]   // indexes into result.teams
}

function winnerIndexes(result: MatchResult): number[] {
  const top = Math.max(...result.teams.map(t => t.score))
  return result.teams.flatMap((t, i) => (t.score === top ? [i] : []))
}

// Events that carry a result, newest first — the "recent winners" feed.
export function recordedMatches(events: CalEvent[]): RecordedMatch[] {
  return events
    .filter((e): e is CalEvent & { result: MatchResult } =>
      !!e.result && e.result.teams.length >= 2)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(event => ({ event, result: event.result, winners: winnerIndexes(event.result) }))
}

// Build the leaderboard, optionally restricted to one activity.
export function buildStandings(
  events: CalEvent[],
  users: User[],
  activity?: string | null,
): Standing[] {
  const byUser = new Map<string, Standing>()
  const userMap = new Map(users.map(u => [u.id, u]))

  for (const { result, winners, event } of recordedMatches(events)) {
    if (activity && event.activity !== activity) continue
    const isDraw = winners.length > 1

    result.teams.forEach((team, i) => {
      const won = winners.includes(i)
      for (const id of team.memberIds) {
        const user = userMap.get(id)
        if (!user) continue   // member no longer visible to this viewer
        let s = byUser.get(id)
        if (!s) {
          s = { user, played: 0, wins: 0, draws: 0, losses: 0, points: 0 }
          byUser.set(id, s)
        }
        s.played++
        if (won && isDraw)      { s.draws++;  s.points += POINTS.draw }
        else if (won)           { s.wins++;   s.points += POINTS.win }
        else                    { s.losses++; s.points += POINTS.loss }
      }
    })
  }

  return [...byUser.values()].sort((a, b) =>
    b.points - a.points
    || b.wins - a.wins
    || a.played - b.played
    || a.user.name.localeCompare(b.user.name))
}

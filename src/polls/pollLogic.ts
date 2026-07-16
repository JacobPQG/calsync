// ─── Poll logic (pure) ────────────────────────────────────────────────────────
// Tally arithmetic and per-day resolution for polls. No JSX, no store — just
// functions over Poll data, so the VMs and views can lean on one definition of
// "what does this poll say" and never each invent their own.

import type { Poll, PollOption, PollVoteValue } from '../types'

// A tallied option: how many said yes/maybe/no, and a score for ranking. `yes`
// counts full, `maybe` half — the usual Doodle weighting, so a slot everyone
// merely might make does not beat one a smaller group definitely can.
export interface OptionTally {
  option: PollOption
  yes:    number
  maybe:  number
  no:     number
  score:  number   // yes + maybe/2 — higher is better
  isLeader: boolean
}

export function tallyOption(poll: Poll, optionId: string): Omit<OptionTally, 'isLeader'> {
  const option = poll.options.find(o => o.id === optionId)!
  let yes = 0, maybe = 0, no = 0
  for (const v of poll.votes) {
    if (v.optionId !== optionId) continue
    if (v.value === 'yes') yes++
    else if (v.value === 'maybe') maybe++
    else no++
  }
  return { option, yes, maybe, no, score: yes + maybe / 2 }
}

// Every option of a poll, tallied and flagged with the current leader(s). A tie
// on score marks all the tied options as leaders — the UI can then show "no clear
// winner yet" rather than pick one arbitrarily.
export function tallyPoll(poll: Poll): OptionTally[] {
  const rows = poll.options.map(o => tallyOption(poll, o.id))
  const best = rows.reduce((m, r) => Math.max(m, r.score), 0)
  return rows.map(r => ({ ...r, isLeader: best > 0 && r.score === best }))
}

// How many distinct people have cast at least one vote on this poll.
export function voterCount(poll: Poll): number {
  return new Set(poll.votes.map(v => v.userId)).size
}

// This user's current ballot on a poll, as an { optionId: value } map — the shape
// castVotes takes. Empty if they have not voted.
export function myBallot(poll: Poll, userId: string | null): Record<string, PollVoteValue> {
  if (!userId) return {}
  const out: Record<string, PollVoteValue> = {}
  for (const v of poll.votes) {
    if (v.userId === userId) out[v.optionId] = v.value
  }
  return out
}

// Has this user voted on this poll at all?
export function hasVoted(poll: Poll, userId: string | null): boolean {
  return !!userId && poll.votes.some(v => v.userId === userId)
}

// ── Per-day resolution (for the month grid marker) ────────────────────────────
// A poll touches a day if any of its options falls on that day. The grid marker
// is a per-day summary, so it needs: is there a poll here, and does it want my
// attention (an open poll on this day I have not voted on yet)?

export interface DayPollMarker {
  date:       string
  pollCount:  number   // distinct OPEN polls with an option on this day
  needsMyVote: boolean // at least one of them I have not voted on
  hasClosed:  boolean  // a decided poll whose winning slot is on this day
}

// Build a date → marker map across the given polls, from the active user's point
// of view. Only OPEN polls drive the "needs vote" checkmarks; a closed poll shows
// only on its winning day, as a settled marker.
export function buildDayPollMarkers(
  polls: Poll[],
  userId: string | null,
): Map<string, DayPollMarker> {
  const map = new Map<string, DayPollMarker>()

  const ensure = (date: string): DayPollMarker => {
    let m = map.get(date)
    if (!m) { m = { date, pollCount: 0, needsMyVote: false, hasClosed: false }; map.set(date, m) }
    return m
  }

  for (const poll of polls) {
    if (poll.status === 'open') {
      const voted = hasVoted(poll, userId)
      // One marker per DAY the poll touches, but count the poll once per day it
      // appears on (a poll with two slots on the same day is still one poll there).
      const days = new Set(poll.options.map(o => o.date))
      for (const date of days) {
        const m = ensure(date)
        m.pollCount++
        if (!voted) m.needsMyVote = true
      }
    } else if (poll.chosenOptionId) {
      const opt = poll.options.find(o => o.id === poll.chosenOptionId)
      if (opt) ensure(opt.date).hasClosed = true
    }
  }

  return map
}

// The OPEN polls with at least one option on a given day — what the DayView panel
// lists when that day is selected. Closed polls are shown too if their winner is
// that day, so the panel can render the settled result.
export function pollsOnDay(polls: Poll[], date: string): Poll[] {
  return polls.filter(p =>
    (p.status === 'open' && p.options.some(o => o.date === date))
    || (p.status === 'closed'
        && !!p.chosenOptionId
        && p.options.find(o => o.id === p.chosenOptionId)?.date === date),
  )
}

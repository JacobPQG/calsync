// ─── Demo poll store (in-memory) ──────────────────────────────────────────────
// The demo-mode implementation of the poll boundary (polls/pollService.ts).
// Mirrors dev/sandboxPolls.ts minus persistence: module-level memory only, so a
// reload returns the poll world to its seed — the landing page's contract.
//
// Votes are pinned to the CURRENT demo persona (the active user pill), the
// demo's analog of cast_votes pinning user_id to auth.uid(). Not a security
// model — see demoWorld.ts.

import { nanoid } from 'nanoid'
import type { Poll, PollOption, PollVote, PollVoteValue } from '../types'
import type { PollOptionDraft } from '../polls/pollService'
import { DEMO_ME, DEMO_TEAM_CAL, dmActiveUserId, dayOffset } from './demoWorld'

// One open poll on the calendar the demo lands on, with two ballots already
// cast so the tally is non-trivial the moment the visitor finds it.
function seedPolls(): Poll[] {
  const pollId = 'demo-poll-dinner'
  const now    = new Date().toISOString()

  const options: PollOption[] = [
    { id: `${pollId}:0`, date: dayOffset(2), startHour: 18, endHour: 19.5 },
    { id: `${pollId}:1`, date: dayOffset(4), startHour: 19, endHour: 21 },
    { id: `${pollId}:2`, date: dayOffset(6), startHour: 12, endHour: 13.5 },
  ]
  const votes: PollVote[] = [
    { optionId: `${pollId}:0`, userId: 'demo-ana', value: 'yes' },
    { optionId: `${pollId}:1`, userId: 'demo-ana', value: 'maybe' },
    { optionId: `${pollId}:0`, userId: 'demo-ben', value: 'no' },
    { optionId: `${pollId}:1`, userId: 'demo-ben', value: 'yes' },
    { optionId: `${pollId}:2`, userId: 'demo-ben', value: 'yes' },
  ]

  return [{
    id: pollId, calendarId: DEMO_TEAM_CAL, createdBy: 'demo-ana',
    title: 'Team dinner', status: 'open',
    options, votes, chosenOptionId: null, chosenEventId: null, createdAt: now,
  }]
}

let polls: Poll[] | null = null

function all(): Poll[] {
  if (!polls) polls = seedPolls()
  return polls
}

function me(): string { return dmActiveUserId() ?? DEMO_ME }

// ── The poll API, demo edition ────────────────────────────────────────────────

export function dmListPolls(calendarId: string): Poll[] {
  return all()
    .filter(p => p.calendarId === calendarId)
    .sort((a, b) =>
      Number(b.status === 'open') - Number(a.status === 'open')
      || (a.createdAt < b.createdAt ? 1 : -1))
}

export function dmCreatePoll(
  calendarId: string, title: string, options: PollOptionDraft[],
): { id: string | null; error: string | null } {
  const clean = title.trim()
  if (!clean)               return { id: null, error: 'a poll needs a title' }
  if (clean.length > 80)    return { id: null, error: 'that poll title is too long' }
  if (options.length === 0) return { id: null, error: 'a poll needs at least one time slot' }

  const id = nanoid()
  const opts: PollOption[] = options.map((o, i) => ({
    id: `${id}:${i}`, date: o.date, startHour: o.startHour, endHour: o.endHour,
  }))
  polls = [...all(), {
    id, calendarId, createdBy: me(), title: clean, status: 'open',
    options: opts, votes: [], chosenOptionId: null, chosenEventId: null,
    createdAt: new Date().toISOString(),
  }]
  return { id, error: null }
}

// Replace the active persona's whole ballot on this poll — RPC semantics.
export function dmCastVotes(
  pollId: string, votes: Record<string, PollVoteValue>,
): string | null {
  const poll = all().find(p => p.id === pollId)
  if (!poll)                  return 'no such poll'
  if (poll.status !== 'open') return 'this poll is closed'

  const voter     = me()
  const optionIds = new Set(poll.options.map(o => o.id))
  const mine: PollVote[] = Object.entries(votes)
    .filter(([optId, v]) => optionIds.has(optId) && (v === 'yes' || v === 'maybe' || v === 'no'))
    .map(([optId, v]) => ({ optionId: optId, userId: voter, value: v }))

  const others = poll.votes.filter(v => v.userId !== voter)
  polls = all().map(p => p.id === pollId ? { ...p, votes: [...others, ...mine] } : p)
  return null
}

// Close on a winner. The caller pre-mints the event id; the store materializes
// the spawned event through the normal (demo) storage path — same division of
// labour as the sandbox.
export function dmClosePoll(
  pollId: string, optionId: string, spawnEvent: boolean, eventId: string | null,
): { eventId: string | null; error: string | null } {
  const poll = all().find(p => p.id === pollId)
  if (!poll)
    return { eventId: null, error: 'no such poll' }
  if (!poll.options.some(o => o.id === optionId))
    return { eventId: null, error: 'that time slot is not one of this poll’s options' }

  const chosenEventId = spawnEvent ? eventId : null
  polls = all().map(p =>
    p.id === pollId
      ? { ...p, status: 'closed' as const, chosenOptionId: optionId, chosenEventId }
      : p)
  return { eventId: chosenEventId, error: null }
}

export function dmDeletePoll(pollId: string): string | null {
  polls = all().filter(p => p.id !== pollId)
  return null
}

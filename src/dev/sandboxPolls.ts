// ─── Sandbox poll store (ADR-19) ──────────────────────────────────────────────
// A localStorage stand-in for the poll RPCs, active ONLY in sandbox mode. Mirrors
// the shape of pollService.ts minus every server-side guarantee — the guards here
// are `if` statements, not policies.
//
// WHAT THIS IS NOT: a security model. There is no RLS and no server; everything
// lives in one browser and belongs to whoever is sitting at it. The real rules
// live in db/schema/45_polls.sql and 70_policies.sql and are exercised only in
// live mode. See dev/sandboxStore.ts for the full version of this disclaimer.

import { nanoid } from 'nanoid'
import type { Poll, PollOption, PollVote, PollVoteValue } from '../types'
import { SANDBOX_ME } from './sandboxStore'
import type { PollOptionDraft } from '../polls/pollService'

const KEY = {
  polls:  'calsync:sandbox:polls',
  seeded: 'calsync:sandbox:pollsSeeded',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage off */ }
}

const readPolls  = () => read<Poll[]>(KEY.polls, [])
const writePolls = (p: Poll[]) => write(KEY.polls, p)

// Dates relative to today so the seeded poll's slots land in the month you open
// on, exactly like the seeded events (see sandboxStore.dayOffset).
function dayOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Seed one poll on the calendar you OWN ────────────────────────────────────
// Seeded once so the poll marker and vote panel have something to render the
// moment you open the seeded calendar. It sits on 'sandbox-cal-team' — the
// calendar you own in the sandbox world (sandboxStore.seedSandbox). Two personas
// have already voted, so the tally is non-trivial on first view.
function seedIfNeeded(): void {
  if (read<boolean>(KEY.seeded, false)) return

  const teamId = 'sandbox-cal-team'
  const pollId = 'sandbox-poll-dinner'
  const now    = new Date().toISOString()

  const options: PollOption[] = [
    { id: `${pollId}:0`, date: dayOffset(2), startHour: 18, endHour: 19.5 },
    { id: `${pollId}:1`, date: dayOffset(4), startHour: 19, endHour: 21 },
    { id: `${pollId}:2`, date: dayOffset(6), startHour: 12, endHour: 13.5 },
  ]

  const votes: PollVote[] = [
    { optionId: `${pollId}:0`, userId: 'sandbox-ana', value: 'yes' },
    { optionId: `${pollId}:1`, userId: 'sandbox-ana', value: 'maybe' },
    { optionId: `${pollId}:0`, userId: 'sandbox-ben', value: 'no' },
    { optionId: `${pollId}:1`, userId: 'sandbox-ben', value: 'yes' },
    { optionId: `${pollId}:2`, userId: 'sandbox-ben', value: 'yes' },
  ]

  const poll: Poll = {
    id: pollId, calendarId: teamId, createdBy: 'sandbox-ana',
    title: 'Team dinner', status: 'open',
    options, votes, chosenOptionId: null, chosenEventId: null, createdAt: now,
  }

  writePolls([...readPolls(), poll])
  write(KEY.seeded, true)
}

// ── The poll API, sandbox edition ────────────────────────────────────────────

export function sbListPolls(calendarId: string): Poll[] {
  seedIfNeeded()
  return readPolls()
    .filter(p => p.calendarId === calendarId)
    .sort((a, b) =>
      Number(b.status === 'open') - Number(a.status === 'open')
      || (a.createdAt < b.createdAt ? 1 : -1))
}

export function sbCreatePoll(
  calendarId: string, title: string, options: PollOptionDraft[],
): { id: string | null; error: string | null } {
  const clean = title.trim()
  if (!clean)            return { id: null, error: 'a poll needs a title' }
  if (clean.length > 80) return { id: null, error: 'that poll title is too long' }
  if (options.length === 0) return { id: null, error: 'a poll needs at least one time slot' }

  const id  = nanoid()
  const now = new Date().toISOString()
  const opts: PollOption[] = options.map((o, i) => ({
    id: `${id}:${i}`, date: o.date, startHour: o.startHour, endHour: o.endHour,
  }))
  const poll: Poll = {
    id, calendarId, createdBy: SANDBOX_ME, title: clean, status: 'open',
    options: opts, votes: [], chosenOptionId: null, chosenEventId: null, createdAt: now,
  }
  writePolls([...readPolls(), poll])
  return { id, error: null }
}

// Replace SANDBOX_ME's whole ballot on this poll — same semantics as the RPC.
export function sbCastVotes(
  pollId: string, votes: Record<string, PollVoteValue>,
): string | null {
  const polls = readPolls()
  const poll  = polls.find(p => p.id === pollId)
  if (!poll)                   return 'no such poll'
  if (poll.status !== 'open')  return 'this poll is closed'

  const optionIds = new Set(poll.options.map(o => o.id))
  const mine: PollVote[] = Object.entries(votes)
    .filter(([optId, v]) => optionIds.has(optId) && (v === 'yes' || v === 'maybe' || v === 'no'))
    .map(([optId, v]) => ({ optionId: optId, userId: SANDBOX_ME, value: v }))

  const others = poll.votes.filter(v => v.userId !== SANDBOX_ME)
  writePolls(polls.map(p =>
    p.id === pollId ? { ...p, votes: [...others, ...mine] } : p))
  return null
}

// Close on a winner. When spawnEvent is true the caller passes the pre-minted
// event id; the sandbox records it on the poll but does NOT create the event
// itself — the store does that, so the new event flows through the normal
// localStorage event path and appears on the grid like any other.
export function sbClosePoll(
  pollId: string, optionId: string, spawnEvent: boolean, eventId: string | null,
): { eventId: string | null; error: string | null } {
  const polls = readPolls()
  const poll  = polls.find(p => p.id === pollId)
  if (!poll)                                       return { eventId: null, error: 'no such poll' }
  if (!poll.options.some(o => o.id === optionId))  return { eventId: null, error: 'that time slot is not one of this poll’s options' }

  const chosenEventId = spawnEvent ? eventId : null
  writePolls(polls.map(p =>
    p.id === pollId
      ? { ...p, status: 'closed' as const, chosenOptionId: optionId, chosenEventId }
      : p))
  return { eventId: chosenEventId, error: null }
}

export function sbDeletePoll(pollId: string): string | null {
  writePolls(readPolls().filter(p => p.id !== pollId))
  return null
}

// Wipe seeded polls — called by the "Reset sandbox" button alongside the other
// sandbox keys so a reset returns the poll world to its seed too.
export function resetSandboxPolls(): void {
  ;[KEY.polls, KEY.seeded].forEach(k => {
    try { localStorage.removeItem(k) } catch { /* storage off */ }
  })
}

// ─── Poll service (ADR-19) ────────────────────────────────────────────────────
// The only module that talks to the poll RPCs (create / vote / close / delete /
// list). Same boundary discipline as calendars/calendarService.ts: callers get
// typed results and a friendly error string, never a PostgrestError, never raw
// SQL state.
//
// Every function here is a thin wrapper over a SECURITY DEFINER function in
// db/schema/45_polls.sql. The security lives THERE — who may vote, who may close,
// who may see a poll. This file must not re-implement any of it: a browser is not
// a policy enforcement point.
//
// In sandbox mode (local dev only) every function is served by a localStorage
// fixture (dev/sandboxPolls.ts), so the poll UI can be driven with no server. In
// plain localStorage mode with no backend, polls are unavailable — like
// calendars, they are an inherently multi-user feature.

import { nanoid } from 'nanoid'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { log } from '../lib/log'
import { IS_SANDBOX } from '../dev/devMode'
import { IS_DEMO } from '../demo/demoMode'
import * as demoPolls from '../demo/demoPolls'
import type { Poll, PollOption, PollVoteValue } from '../types'

const NO_BACKEND = 'Polls need a Supabase backend (see .env.example).'

// Dynamic import, deliberately — keeps the fixture out of production bundles.
// See the identical note in calendars/calendarService.ts.
const sandbox = () => import('../dev/sandboxPolls')

// A candidate slot as the create form hands it in (before the server mints ids).
export interface PollOptionDraft {
  date:      string
  startHour: number
  endHour:   number
}

// ── Row shape as list_polls returns it ────────────────────────────────────────

interface PollRow {
  id:               string
  calendar_id:      string
  created_by:       string
  title:            string
  status:           string
  chosen_option_id: string | null
  chosen_event_id:  string | null
  created_at:       string
  options:          unknown   // jsonb array — validated by toPoll
  votes:            unknown   // jsonb array
}

function toStatus(raw: string): Poll['status'] {
  return raw === 'closed' ? 'closed' : 'open'
}

function toVoteValue(raw: unknown): PollVoteValue | null {
  return raw === 'yes' || raw === 'maybe' || raw === 'no' ? raw : null
}

// jsonb is a claim, not a guarantee — validate defensively, dropping any option
// or vote that does not parse rather than trusting the shape.
function toOptions(raw: unknown): PollOption[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map(o => ({
      id:        String(o.id ?? ''),
      date:      String(o.date ?? ''),
      startHour: Number(o.startHour),
      endHour:   Number(o.endHour),
    }))
    .filter(o => o.id && o.date && Number.isFinite(o.startHour) && Number.isFinite(o.endHour))
}

function toVotes(raw: unknown): Poll['votes'] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map(v => ({
      optionId: String(v.optionId ?? ''),
      userId:   String(v.userId ?? ''),
      value:    toVoteValue(v.value),
    }))
    .filter((v): v is Poll['votes'][number] => !!v.optionId && !!v.userId && v.value !== null)
}

function toPoll(r: PollRow): Poll {
  return {
    id:             r.id,
    calendarId:     r.calendar_id,
    createdBy:      r.created_by,
    title:          r.title,
    status:         toStatus(r.status),
    options:        toOptions(r.options),
    votes:          toVotes(r.votes),
    chosenOptionId: r.chosen_option_id,
    chosenEventId:  r.chosen_event_id,
    createdAt:      r.created_at,
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

// Every poll in a calendar, with its options and all votes, in one round trip.
export async function listPolls(calendarId: string): Promise<Poll[]> {
  if (IS_DEMO) return demoPolls.dmListPolls(calendarId)
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbListPolls(calendarId)
  if (!SUPABASE_ENABLED) return []

  const { data, error } = await supabase.rpc('list_polls', { p_cal_id: calendarId })
  if (error) {
    log.error('poll', `list_polls failed (cal=${calendarId})`, error.message)
    return []
  }
  return (data as PollRow[]).map(toPoll)
}

// ── Writes ────────────────────────────────────────────────────────────────────

// Create a poll. The id is minted client-side (nanoid) and passed in, like event
// and calendar ids, so the caller can reference the new poll without a round trip.
export async function createPoll(
  calendarId: string,
  title: string,
  options: PollOptionDraft[],
): Promise<{ id: string | null; error: string | null }> {
  if (IS_DEMO) return demoPolls.dmCreatePoll(calendarId, title, options)
  if (import.meta.env.DEV && IS_SANDBOX) {
    return (await sandbox()).sbCreatePoll(calendarId, title, options)
  }
  if (!SUPABASE_ENABLED) return { id: null, error: NO_BACKEND }
  if (options.length === 0) return { id: null, error: 'Add at least one time slot.' }

  const id = nanoid()
  const { error } = await supabase.rpc('create_poll', {
    p_poll_id: id, p_cal_id: calendarId, p_title: title, p_options: options,
  })
  if (error) {
    log.error('poll', 'create_poll failed', error.message)
    return { id: null, error: friendlyPollError(error.message) }
  }
  return { id, error: null }
}

// Replace the caller's whole ballot on a poll. `votes` maps option id → value;
// an option the caller has no opinion on is simply omitted (the server un-votes
// anything not present).
export async function castVotes(
  pollId: string,
  votes: Record<string, PollVoteValue>,
): Promise<string | null> {
  if (IS_DEMO) return demoPolls.dmCastVotes(pollId, votes)
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbCastVotes(pollId, votes)
  if (!SUPABASE_ENABLED) return NO_BACKEND

  const { error } = await supabase.rpc('cast_votes', { p_poll_id: pollId, p_votes: votes })
  if (error) {
    log.error('poll', `cast_votes failed (poll=${pollId})`, error.message)
    return friendlyPollError(error.message)
  }
  return null
}

// Close a poll on a winning option, optionally spawning a real public event from
// that slot. Returns the spawned event's id (or null if none was asked for / on
// error). Creator or calendar owner only — enforced server-side.
export async function closePoll(
  pollId: string,
  optionId: string,
  spawnEvent: boolean,
): Promise<{ eventId: string | null; error: string | null }> {
  const eventId = spawnEvent ? nanoid() : null

  if (IS_DEMO) return demoPolls.dmClosePoll(pollId, optionId, spawnEvent, eventId)
  if (import.meta.env.DEV && IS_SANDBOX) {
    return (await sandbox()).sbClosePoll(pollId, optionId, spawnEvent, eventId)
  }
  if (!SUPABASE_ENABLED) return { eventId: null, error: NO_BACKEND }

  const { error } = await supabase.rpc('close_poll', {
    p_poll_id: pollId, p_option_id: optionId,
    p_spawn_event: spawnEvent, p_event_id: eventId,
  })
  if (error) {
    log.error('poll', `close_poll failed (poll=${pollId})`, error.message)
    return { eventId: null, error: friendlyPollError(error.message) }
  }
  return { eventId, error: null }
}

// Delete a poll. Creator or calendar owner only. A spawned event is NOT removed.
export async function deletePoll(pollId: string): Promise<string | null> {
  if (IS_DEMO) return demoPolls.dmDeletePoll(pollId)
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbDeletePoll(pollId)
  if (!SUPABASE_ENABLED) return NO_BACKEND

  const { error } = await supabase.rpc('delete_poll', { p_poll_id: pollId })
  if (error) {
    log.error('poll', `delete_poll failed (poll=${pollId})`, error.message)
    return friendlyPollError(error.message)
  }
  return null
}

// ── Errors ────────────────────────────────────────────────────────────────────
// The schema raises human-readable messages ("this poll is closed"), so pass the
// known ones through and generalize anything else rather than leaking SQL state.

function friendlyPollError(raw: string): string {
  if (/approved member of this calendar/i.test(raw))
    return 'You must be an approved member of this calendar.'
  if (/poll is closed/i.test(raw))            return 'This poll is already closed.'
  if (/needs a title|title is too long/i.test(raw)) return raw
  if (/at least one time slot/i.test(raw))    return raw
  if (/author or the calendar owner/i.test(raw))
    return 'Only the poll’s author or the calendar owner may do that.'
  if (/not one of this poll/i.test(raw))
    return 'That time slot is not one of this poll’s options.'
  if (/no such poll/i.test(raw))              return 'That poll no longer exists.'
  return 'That did not work — try again.'
}

// ─── Calendar service ─────────────────────────────────────────────────────────
// The only module that talks to the calendar RPCs (create / update / delete /
// list / members / approve / reject / leave). Same boundary discipline as
// store/storage.ts and invite/inviteService.ts: callers get typed results and a
// friendly error string, never a PostgrestError and never raw SQL state.
//
// Every function here is a thin wrapper over a SECURITY DEFINER function in
// lib/schema.sql. The security lives THERE — who owns a calendar, who may
// approve a member, and the seat cap. This file must not re-implement any of it,
// and must not be trusted to: a browser is not a policy enforcement point.
//
// In localStorage mode there are no calendars. The whole feature is inherently
// multi-user (owners, members, invites, approval), and a single browser with no
// server has none of those things to model. Callers get empty lists and a clear
// error, never a half-working local imitation.

import { nanoid } from 'nanoid'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { log } from '../lib/log'
import { IS_SANDBOX } from '../dev/devMode'
import { useStore } from '../store/useStore'
import type { Calendar, CalendarFeatures, CalendarMember, MemberStatus } from '../types'
import { NO_FEATURES } from '../types'

const NO_BACKEND = 'Calendars need a Supabase backend (see .env.example).'

// Sandbox mode (local dev only) substitutes a localStorage implementation for
// every function below, so the calendar UI can be driven with no server. It is a
// FIXTURE, not a security boundary — see dev/sandboxStore.ts. In every other
// mode, including production, IS_SANDBOX is false and none of this is reachable.
//
// Loaded by DYNAMIC import, deliberately. A static import would put the fixture —
// fake users, calendars, seeded events — into the production bundle even though
// IS_SANDBOX makes it unreachable there: the bundler keeps any module the graph
// references. Behind `await import()` it becomes a separate chunk that a
// production build, where IS_SANDBOX folds to a literal false, never requests.
const sandbox = () => import('../dev/sandboxStore')

// Names are resolved from the store's user directory so the sandbox can show
// "Ana's" on a calendar card without duplicating the user list.
function sandboxName(id: string): string | null {
  return useStore.getState().users.find(u => u.id === id)?.name ?? null
}

// ── Row shapes as the RPCs return them ───────────────────────────────────────

interface CalendarRow {
  id:            string
  name:          string
  owner_id:      string
  owner_name:    string | null
  max_members:   number | null
  member_count:  number
  pending_count: number
  my_status:     string
  is_owner:      boolean
  features:      unknown          // jsonb — shape is not guaranteed by the type
  created_at:    string
}

interface MemberRow {
  user_id:    string
  username:   string | null
  name:       string | null
  avatar:     string | null
  status:     string
  invited_as: string | null
  joined_at:  string
  is_owner:   boolean
}

// Anything the server doesn't recognise collapses to 'pending' — fail closed.
// 'pending' is the status that grants nothing, so an unreadable status must land
// there and not on 'approved'.
function toStatus(raw: string): MemberStatus {
  return raw === 'approved' ? 'approved' : 'pending'
}

// The server normalizes `features` before returning it, so in practice this sees
// a full {scores, leaderboard, challenges} object. It re-checks anyway: this is a
// jsonb column, the TypeScript type is a claim rather than a guarantee, and a
// feature that reads as `true` because the value was the string "false" would be
// a silently-wrong UI. Only a literal boolean true counts — everything else is
// off, so a malformed payload can only take a feature away, never grant one.
function toFeatures(raw: unknown): CalendarFeatures {
  if (!raw || typeof raw !== 'object') return NO_FEATURES
  const f = raw as Record<string, unknown>
  return {
    scores:      f.scores      === true,
    leaderboard: f.leaderboard === true,
    challenges:  f.challenges  === true,
  }
}

function toCalendar(r: CalendarRow): Calendar {
  return {
    id:           r.id,
    name:         r.name,
    ownerId:      r.owner_id,
    ownerName:    r.owner_name,
    maxMembers:   r.max_members,
    memberCount:  Number(r.member_count),
    pendingCount: Number(r.pending_count),
    myStatus:     toStatus(r.my_status),
    isOwner:      r.is_owner,
    features:     toFeatures(r.features),
    createdAt:    r.created_at,
  }
}

function toMember(r: MemberRow): CalendarMember {
  return {
    userId:    r.user_id,
    username:  r.username,
    name:      r.name,
    avatar:    r.avatar,
    status:    toStatus(r.status),
    invitedAs: r.invited_as,
    joinedAt:  r.joined_at,
    isOwner:   r.is_owner,
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

// Every calendar I own or belong to — the home view, in one round trip.
export async function listCalendars(): Promise<Calendar[]> {
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbListCalendars(sandboxName)
  if (!SUPABASE_ENABLED) return []

  const { data, error } = await supabase.rpc('list_calendars')
  if (error) {
    log.error('calendar', 'list_calendars failed', error.message)
    return []
  }
  return (data as CalendarRow[]).map(toCalendar)
}

// The member roster for one calendar. Owner-only, server-side: a non-owner gets
// an empty list, not an error, because the panel that calls this is only ever
// drawn for an owner anyway.
export async function listMembers(calendarId: string): Promise<CalendarMember[]> {
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbListMembers(calendarId, sandboxName)
  if (!SUPABASE_ENABLED) return []

  const { data, error } = await supabase.rpc('list_members', { cal_id: calendarId })
  if (error) {
    log.error('calendar', `list_members failed (cal=${calendarId})`, error.message)
    return []
  }
  return (data as MemberRow[]).map(toMember)
}

// ── Writes ────────────────────────────────────────────────────────────────────

// Create a calendar. The id is minted client-side (nanoid) and passed in, the
// same way event ids are: it lets the caller navigate to the new calendar
// immediately without a second round trip to learn what it was called.
//
// `maxMembers` is the seat cap — null means unlimited, which the UI makes the
// user choose rather than fall into. The server enforces it at approval time.
export async function createCalendar(
  name: string,
  maxMembers: number | null,
  features: CalendarFeatures = NO_FEATURES,
): Promise<{ id: string | null; error: string | null }> {
  if (import.meta.env.DEV && IS_SANDBOX) {
    return (await sandbox()).sbCreateCalendar(name, maxMembers, features)
  }
  if (!SUPABASE_ENABLED) return { id: null, error: NO_BACKEND }

  const id = nanoid()
  const { error } = await supabase.rpc('create_calendar', {
    cal_id: id, cal_name: name, cap: maxMembers, feats: features,
  })
  if (error) {
    log.error('calendar', 'create_calendar failed', error.message)
    return { id: null, error: friendlyCalendarError(error.message) }
  }
  return { id, error: null }
}

// `features` omitted (undefined) means "leave them alone" — the RPC's `feats`
// defaults to NULL, which it reads as "don't touch". Passing an explicit object
// with all-false is a different instruction: it turns everything off.
export async function updateCalendar(
  calendarId: string,
  name: string,
  maxMembers: number | null,
  features?: CalendarFeatures,
): Promise<string | null> {
  if (import.meta.env.DEV && IS_SANDBOX) {
    return (await sandbox()).sbUpdateCalendar(calendarId, name, maxMembers, features)
  }
  if (!SUPABASE_ENABLED) return NO_BACKEND

  const { error } = await supabase.rpc('update_calendar', {
    cal_id: calendarId, cal_name: name, cap: maxMembers,
    feats: features ?? null,
  })
  if (error) {
    log.error('calendar', `update_calendar failed (cal=${calendarId})`, error.message)
    return friendlyCalendarError(error.message)
  }
  return null
}

// Deletes the calendar and everything hanging off it — members, events, invites
// — by ON DELETE CASCADE. Total and irreversible; the UI must confirm first.
export async function deleteCalendar(calendarId: string): Promise<string | null> {
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbDeleteCalendar(calendarId)
  if (!SUPABASE_ENABLED) return NO_BACKEND

  const { error } = await supabase.rpc('delete_calendar', { cal_id: calendarId })
  if (error) {
    log.error('calendar', `delete_calendar failed (cal=${calendarId})`, error.message)
    return friendlyCalendarError(error.message)
  }
  return null
}

// ── Membership ────────────────────────────────────────────────────────────────
// The confirmation step you asked for: an invite gets someone to the door,
// approval lets them through it. This is also where the seat cap bites — the
// server refuses an approval past the limit, so a full calendar surfaces here as
// an error, not as a silently-exceeded number.

export async function approveMember(
  calendarId: string, userId: string,
): Promise<string | null> {
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbApproveMember(calendarId, userId)
  if (!SUPABASE_ENABLED) return NO_BACKEND

  const { error } = await supabase.rpc('approve_member', {
    cal_id: calendarId, member_id: userId,
  })
  if (error) {
    log.error('calendar', `approve_member failed (cal=${calendarId})`, error.message)
    return friendlyCalendarError(error.message)
  }
  return null
}

// `reopen` puts the invite they used back into play so the SAME QR can be
// re-sent. Sharp edge: any existing photo of that code goes live again — which is
// why it is opt-in, and why the panel asks before doing it.
export async function rejectMember(
  calendarId: string, userId: string, reopen: boolean,
): Promise<string | null> {
  // `reopen` has no meaning in the sandbox: there are no invite codes to put back
  // into play, because nothing minted one.
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbRejectMember(calendarId, userId)
  if (!SUPABASE_ENABLED) return NO_BACKEND

  const { error } = await supabase.rpc('reject_member', {
    cal_id: calendarId, member_id: userId, reopen,
  })
  if (error) {
    log.error('calendar', `reject_member failed (cal=${calendarId})`, error.message)
    return friendlyCalendarError(error.message)
  }
  return null
}

// A member's own exit. Takes their events in that calendar with them — leaving a
// calendar whose members can still see your availability is not leaving. The
// owner cannot call this (the server refuses); they delete the calendar instead.
export async function leaveCalendar(calendarId: string): Promise<string | null> {
  if (import.meta.env.DEV && IS_SANDBOX) return (await sandbox()).sbLeaveCalendar(calendarId)
  if (!SUPABASE_ENABLED) return NO_BACKEND

  const { error } = await supabase.rpc('leave_calendar', { cal_id: calendarId })
  if (error) {
    log.error('calendar', `leave_calendar failed (cal=${calendarId})`, error.message)
    return friendlyCalendarError(error.message)
  }
  return null
}

// ── Errors ────────────────────────────────────────────────────────────────────
// Postgres RAISE EXCEPTION text surfaces as the message. The messages the schema
// raises are already written for a human ("this calendar is full (8 of 8
// seats)"), so pass those through; generalize anything else rather than leaking
// SQL internals into the UI.
//
// The full/limit messages carry NUMBERS the owner needs, so they must survive
// intact — replacing them with "that did not work" would hide the one fact that
// explains the refusal.
function friendlyCalendarError(raw: string): string {
  if (/is full|member limit|already has \d+ members/i.test(raw)) return raw
  if (/calendar name is required|name is too long/i.test(raw))   return raw
  if (/not approved yet/i.test(raw))
    return 'Your account is still awaiting approval.'
  if (/only the calendar owner/i.test(raw))
    return 'Only the calendar’s owner may do that.'
  if (/has not requested to join/i.test(raw))
    return 'That person has not asked to join this calendar.'
  if (/owner cannot be removed/i.test(raw))                      return raw
  if (/you own this calendar/i.test(raw))                        return raw
  return 'That did not work — try again.'
}

// ─── Sandbox calendar store ───────────────────────────────────────────────────
// A localStorage stand-in for the calendar RPCs, active ONLY in sandbox mode.
//
// calendarService.ts is the boundary to the real calendar RPCs, and in
// localStorage mode it has always (correctly) returned empty lists: calendars are
// an inherently multi-user feature — owners, members, invites, approval — and a
// single browser with no server has none of those things to model. That is the
// right answer for a user who simply has no backend configured.
//
// It is the wrong answer for a DEVELOPER who wants to click through the calendar
// UI without standing up Postgres. So sandbox mode supplies exactly that: a fake
// multi-user world, held in localStorage, with enough fidelity to drive the
// screens — a calendar you own, one you were invited into, a pending member
// waiting for your approval, a guest who joined without signing in, and a seat
// cap that fills up.
//
// WHAT THIS IS NOT
// ----------------
// It is not a security model, and it must never be mistaken for one. There is no
// RLS here and no server to refuse anything: every check is a client-side `if`,
// which a client could trivially skip. That is acceptable precisely BECAUSE there
// is no shared data to protect — everything lives in one browser's localStorage
// and belongs to the person sitting at it. The real rules live in db/schema/
// and are exercised in live mode. Nothing in this file is evidence that they work.

import { nanoid } from 'nanoid'
import type { Calendar, CalendarFeatures, CalendarMember, User, CalEvent } from '../types'
import { NO_FEATURES } from '../types'
import { IS_SANDBOX } from './devMode'
import { SANDBOX_USER_ID, SANDBOX_MEMBER_ID, SANDBOX_GUEST_ID } from './sandboxPersona'

const KEY = {
  calendars: 'calsync:sandbox:calendars',
  members:   'calsync:sandbox:members',
  seeded:    'calsync:sandbox:seeded',
}

// The persona you are signed in as in sandbox mode. Persisted (sandboxPersona)
// so that "who am I" survives a reload — the whole point is to come back to the
// same fake world. Normally the member ("You"); the Dev panel can switch it to
// the guest, and every ownership/membership check below follows automatically.
export const SANDBOX_ME = SANDBOX_USER_ID

interface StoredCalendar {
  id:         string
  name:       string
  ownerId:    string
  maxMembers: number | null
  // Undefined on calendars seeded before per-calendar features existed; read it
  // through feats() below, which defaults them to all-off (the plain calendar).
  features?:  CalendarFeatures
  createdAt:  string
}

// Mirrors normalize_features() in db/schema/20_helpers.sql: unknown/absent =
// off. Features fail OFF here too, so the sandbox and the server agree.
function feats(f: CalendarFeatures | undefined): CalendarFeatures {
  return f ?? NO_FEATURES
}

interface StoredMember {
  calendarId: string
  userId:     string
  status:     'pending' | 'approved'
  invitedAs:  string | null
  joinedAt:   string
  // Mirrors users.is_guest (ADR-18). Optional so worlds seeded before guests
  // existed keep parsing; absent means a regular signed-in member.
  isGuest?:   boolean
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

const readCalendars = () => read<StoredCalendar[]>(KEY.calendars, [])
const readMembers   = () => read<StoredMember[]>(KEY.members, [])

// ── The seeded world ──────────────────────────────────────────────────────────
// Written once, then left alone: re-seeding on every load would discard whatever
// the developer just created, which is the opposite of useful.

// Avatar ids must exist in AVATARS (auth/credentials.ts) or they silently fall
// back to initials — which would make the seeded users look broken rather than
// deliberate.
// The seed always uses the FIXED ids, never SANDBOX_ME: the world must come out
// identical whichever persona happens to be active when it is (re)built.
const SEED_USERS: User[] = [
  { id: SANDBOX_MEMBER_ID, name: 'You',  color: '#7F77DD', avatar: 'compass',  createdAt: new Date().toISOString() },
  { id: 'sandbox-ana',     name: 'Ana',  color: '#1D9E75', avatar: 'whale',    createdAt: new Date().toISOString() },
  { id: 'sandbox-ben',     name: 'Ben',  color: '#D85A30', avatar: 'cactus',   createdAt: new Date().toISOString() },
  { id: 'sandbox-cleo',    name: 'Cleo', color: '#D4537E', avatar: 'lantern',  createdAt: new Date().toISOString() },
  { id: 'sandbox-dev',     name: 'Dev',  color: '#378ADD', avatar: 'mushroom', createdAt: new Date().toISOString() },
  // A GUEST (ADR-18): joined through the guest link with no sign-in. Guests
  // never pick an avatar, so none is set — the initials fallback is the
  // authentic rendering for this kind of account.
  { id: SANDBOX_GUEST_ID,  name: 'Gus',  color: '#8E7C3A', createdAt: new Date().toISOString() },
]

// Dates relative to today, so the seeded events are always in the month you land
// on rather than drifting into the past as the fixture ages.
function dayOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface SeedResult {
  users:  User[]
  events: CalEvent[]
}

// Build the fake world. Returns the users/events for the store to hold; the
// calendars and membership go straight to localStorage, where the sandbox
// calendar functions below read them.
export function seedSandbox(): SeedResult {
  const teamId   = 'sandbox-cal-team'
  const fiveAId  = 'sandbox-cal-fives'
  const now      = new Date().toISOString()

  const calendars: StoredCalendar[] = [
    // One the MEMBER persona owns — exercises Manage, invites, the approval
    // queue, the seat cap. Plain: every feature off, the classic availability
    // calendar.
    { id: teamId,  name: 'Team planning', ownerId: SANDBOX_MEMBER_ID, maxMembers: 8,
      features: NO_FEATURES, createdAt: now },
    // One you were INVITED into — exercises "Shared with me" and Leave. Seeded as
    // a SPORTS calendar so both shapes are on screen at once: this is what the
    // build-time variant used to be, and now it is just a calendar with its
    // features turned on.
    { id: fiveAId, name: 'Five-a-side',   ownerId: 'sandbox-ana', maxMembers: null,
      features: { scores: true, leaderboard: true, challenges: true }, createdAt: now },
  ]

  const members: StoredMember[] = [
    // The member persona's own calendar: them plus two approved, plus one
    // PENDING so the approval queue has something in it the moment they open
    // Manage.
    { calendarId: teamId, userId: SANDBOX_MEMBER_ID, status: 'approved', invitedAs: null,   joinedAt: now },
    { calendarId: teamId, userId: 'sandbox-ana',     status: 'approved', invitedAs: 'Ana',  joinedAt: now },
    { calendarId: teamId, userId: 'sandbox-ben',     status: 'approved', invitedAs: 'Ben',  joinedAt: now },
    { calendarId: teamId, userId: 'sandbox-cleo',    status: 'pending',  invitedAs: 'Cleo', joinedAt: now },
    // A guest member (ADR-18): came in through the guest link, no account
    // credentials. Exercises the "guest" badge and Remove wording in Manage —
    // and is who the Dev panel's guest persona signs you in as, so this is
    // deliberately their ONLY calendar (a real guest link joins exactly one).
    { calendarId: teamId, userId: SANDBOX_GUEST_ID,  status: 'approved', invitedAs: null,   joinedAt: now, isGuest: true },

    // Ana's calendar, which the member persona belongs to but does not own.
    { calendarId: fiveAId, userId: 'sandbox-ana',     status: 'approved', invitedAs: null,  joinedAt: now },
    { calendarId: fiveAId, userId: SANDBOX_MEMBER_ID, status: 'approved', invitedAs: 'You', joinedAt: now },
    { calendarId: fiveAId, userId: 'sandbox-dev',     status: 'approved', invitedAs: 'Dev', joinedAt: now },
  ]

  const events: CalEvent[] = [
    {
      id: nanoid(), calendarId: teamId, userId: SANDBOX_MEMBER_ID,
      title: 'Sprint planning', date: dayOffset(1), startHour: 10, endHour: 11.5,
      visibility: 'public', tags: [], recurring: { frequency: 'none' },
      createdAt: now,
    },
    // The guest's own event, so switching to the guest persona lands on a grid
    // where "your events" is not empty.
    {
      id: nanoid(), calendarId: teamId, userId: SANDBOX_GUEST_ID,
      title: 'Helping with setup', date: dayOffset(2), startHour: 9, endHour: 10,
      visibility: 'public', tags: [], recurring: { frequency: 'none' },
      createdAt: now,
    },
    {
      id: nanoid(), calendarId: teamId, userId: 'sandbox-ana',
      title: 'Design review', date: dayOffset(1), startHour: 11, endHour: 12,
      visibility: 'public', tags: [], recurring: { frequency: 'none' },
      createdAt: now,
    },
    // Anonymous + overlapping YOUR event above, so the coincidence/overlap
    // reveal behaviour has something to act on.
    {
      id: nanoid(), calendarId: teamId, userId: 'sandbox-ben',
      title: 'Busy', date: dayOffset(1), startHour: 10.5, endHour: 11,
      visibility: 'anonymous', tags: [], recurring: { frequency: 'none' },
      createdAt: now,
    },
    {
      id: nanoid(), calendarId: fiveAId, userId: 'sandbox-ana',
      title: 'Match vs Rovers', date: dayOffset(3), startHour: 18, endHour: 19,
      visibility: 'public', tags: [], recurring: { frequency: 'none' },
      createdAt: now,
    },
    {
      id: nanoid(), calendarId: fiveAId, userId: SANDBOX_MEMBER_ID,
      title: 'Training', date: dayOffset(5), startHour: 19, endHour: 20,
      visibility: 'public', tags: [], recurring: { frequency: 'weekly' },
      createdAt: now,
    },
  ]

  write(KEY.calendars, calendars)
  write(KEY.members, members)
  write(KEY.seeded, true)

  return { users: SEED_USERS, events }
}

export function isSeeded(): boolean {
  return read<boolean>(KEY.seeded, false)
}

// Wipe the fake world and rebuild it. The "Reset sandbox" button — the escape
// hatch for when you have clicked the fixture into a state you no longer want.
export function resetSandbox(): void {
  ;[KEY.calendars, KEY.members, KEY.seeded].forEach(k => {
    try { localStorage.removeItem(k) } catch { /* storage off */ }
  })
}

// ── The calendar API, sandbox edition ────────────────────────────────────────
// Mirrors the shape of the RPCs in calendarService.ts, minus every server-side
// guarantee. Guards are `if` statements, not policies; see the header.

function calendarOf(id: string): StoredCalendar | undefined {
  return readCalendars().find(c => c.id === id)
}

function approvedCount(calendarId: string): number {
  return readMembers().filter(m => m.calendarId === calendarId && m.status === 'approved').length
}

export function sbListCalendars(userName: (id: string) => string | null): Calendar[] {
  const members = readMembers()
  return readCalendars()
    .filter(c => members.some(m => m.calendarId === c.id && m.userId === SANDBOX_ME))
    .map(c => {
      const mine    = members.find(m => m.calendarId === c.id && m.userId === SANDBOX_ME)!
      const isOwner = c.ownerId === SANDBOX_ME
      return {
        id:           c.id,
        name:         c.name,
        ownerId:      c.ownerId,
        ownerName:    userName(c.ownerId),
        maxMembers:   c.maxMembers,
        memberCount:  approvedCount(c.id),
        // Only meaningful to an owner — mirrors list_calendars, which returns 0
        // to everyone else.
        pendingCount: isOwner
          ? members.filter(m => m.calendarId === c.id && m.status === 'pending').length
          : 0,
        myStatus:     mine.status,
        isOwner,
        features:     feats(c.features),
        createdAt:    c.createdAt,
      }
    })
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner))
}

export function sbListMembers(
  calendarId: string, userName: (id: string) => string | null,
): CalendarMember[] {
  const cal = calendarOf(calendarId)
  return readMembers()
    .filter(m => m.calendarId === calendarId)
    .map(m => ({
      userId:    m.userId,
      username:  m.userId,
      name:      userName(m.userId),
      avatar:    null,
      status:    m.status,
      invitedAs: m.invitedAs,
      joinedAt:  m.joinedAt,
      isOwner:   cal?.ownerId === m.userId,
      // Seeded from the fixture (real guest links need anonymous auth + RLS,
      // which the sandbox does not model — this only drives the guest UI).
      isGuest:   m.isGuest === true,
    }))
}

export function sbCreateCalendar(
  name: string, maxMembers: number | null,
  features: CalendarFeatures = NO_FEATURES,
): { id: string | null; error: string | null } {
  const clean = name.trim()
  if (!clean)             return { id: null, error: 'a calendar name is required' }
  if (clean.length > 60)  return { id: null, error: 'that calendar name is too long' }
  if (maxMembers !== null && (maxMembers < 1 || maxMembers > 500))
    return { id: null, error: 'member limit must be between 1 and 500' }

  const id  = nanoid()
  const now = new Date().toISOString()
  write(KEY.calendars, [
    ...readCalendars(),
    { id, name: clean, ownerId: SANDBOX_ME, maxMembers, features, createdAt: now },
  ])
  // The owner is an approved member of their own calendar from the start — the
  // same invariant create_calendar establishes in one transaction.
  write(KEY.members, [
    ...readMembers(),
    { calendarId: id, userId: SANDBOX_ME, status: 'approved' as const, invitedAs: null, joinedAt: now },
  ])
  return { id, error: null }
}

// `features` undefined means "leave them alone", matching update_calendar's NULL
// `feats`. An explicit all-false object is a different instruction: turn them off.
export function sbUpdateCalendar(
  calendarId: string, name: string, maxMembers: number | null,
  features?: CalendarFeatures,
): string | null {
  const cal = calendarOf(calendarId)
  if (!cal)                     return 'only the calendar owner may change its settings'
  if (cal.ownerId !== SANDBOX_ME) return 'only the calendar owner may change its settings'

  const clean = name.trim()
  if (!clean)            return 'a calendar name is required'
  if (clean.length > 60) return 'that calendar name is too long'

  if (maxMembers !== null) {
    if (maxMembers < 1 || maxMembers > 500)
      return 'member limit must be between 1 and 500'
    const current = approvedCount(calendarId)
    if (maxMembers < current)
      return `this calendar already has ${current} members — the limit cannot be set below that`
  }

  write(KEY.calendars, readCalendars().map(c =>
    c.id === calendarId
      ? { ...c, name: clean, maxMembers, features: features ?? feats(c.features) }
      : c))
  return null
}

export function sbDeleteCalendar(calendarId: string): string | null {
  const cal = calendarOf(calendarId)
  if (!cal || cal.ownerId !== SANDBOX_ME) return 'only the calendar owner may delete it'

  write(KEY.calendars, readCalendars().filter(c => c.id !== calendarId))
  write(KEY.members,   readMembers().filter(m => m.calendarId !== calendarId))
  return null
}

export function sbApproveMember(calendarId: string, userId: string): string | null {
  const cal = calendarOf(calendarId)
  if (!cal || cal.ownerId !== SANDBOX_ME) return 'only the calendar owner may approve members'

  const members = readMembers()
  const target  = members.find(m => m.calendarId === calendarId && m.userId === userId)
  if (!target) return 'that person has not requested to join this calendar'

  // The seat cap, enforced at approval — the same moment the server enforces it.
  if (cal.maxMembers !== null && target.status !== 'approved') {
    const current = approvedCount(calendarId)
    if (current >= cal.maxMembers)
      return `this calendar is full (${current} of ${cal.maxMembers} seats)`
  }

  write(KEY.members, members.map(m =>
    m.calendarId === calendarId && m.userId === userId
      ? { ...m, status: 'approved' as const }
      : m))
  return null
}

export function sbRejectMember(calendarId: string, userId: string): string | null {
  const cal = calendarOf(calendarId)
  if (!cal || cal.ownerId !== SANDBOX_ME) return 'only the calendar owner may reject members'
  if (userId === cal.ownerId)             return 'the owner cannot be removed from their own calendar'

  write(KEY.members, readMembers()
    .filter(m => !(m.calendarId === calendarId && m.userId === userId)))
  return null
}

export function sbLeaveCalendar(calendarId: string): string | null {
  const cal = calendarOf(calendarId)
  if (!cal) return 'that calendar does not exist'
  if (cal.ownerId === SANDBOX_ME)
    return 'you own this calendar — delete it instead of leaving it'

  write(KEY.members, readMembers()
    .filter(m => !(m.calendarId === calendarId && m.userId === SANDBOX_ME)))
  return null
}

// Guard for callers: every sandbox function above assumes it is only reached in
// sandbox mode. Exported so calendarService can assert rather than assume.
export function assertSandbox(): void {
  if (!IS_SANDBOX) throw new Error('sandbox store used outside sandbox mode')
}

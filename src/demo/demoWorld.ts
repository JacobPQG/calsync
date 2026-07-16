// ─── Demo world (in-memory fixture) ───────────────────────────────────────────
// The sample data behind the landing page's live demo, plus the demo-mode
// implementations of the storage and calendar-service boundaries. Everything
// lives in MODULE-LEVEL MEMORY: seeded when the module loads, mutated freely by
// the visitor's clicking, and gone on reload — the landing page promises
// exactly that ("nothing is saved"), so nothing here may touch localStorage or
// the network.
//
// WHAT THIS IS NOT — a security model. Same disclaimer as dev/sandboxStore.ts:
// there is no RLS and no server; every rule is a client-side `if` over data the
// visitor already fully owns. The real rules live in db/schema/ and are not
// exercised here.
//
// The world is READ-ONLY at the calendar level, deliberately: events and polls
// are fully interactive (that is the demo), but creating/managing calendars
// leads straight into surfaces that need a real server (invites, approvals),
// so those return a friendly "sign in for the real thing" instead.

import type { Calendar, CalendarMember, User, CalEvent } from '../types'
import { NO_FEATURES } from '../types'

// Fixed ids so the fixture is self-consistent and useAppVM can open the
// default calendar without searching for it by name.
export const DEMO_ME        = 'demo-you'
export const DEMO_TEAM_CAL  = 'demo-cal-team'
export const DEMO_FIVES_CAL = 'demo-cal-fives'

// Refusal shown by every calendar-management write in demo mode.
export const DEMO_READONLY =
  'This is the live demo — sign in to create and manage real calendars.'

// Dates relative to today, so the sample events always land in the month the
// visitor is looking at instead of aging into the past.
export function dayOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Avatar ids must exist in AVATARS (auth/credentials.ts) or they fall back to
// initials and the sample people look broken rather than deliberate.
function seedUsers(): User[] {
  const now = new Date().toISOString()
  return [
    { id: DEMO_ME,     name: 'You',  color: '#7F77DD', avatar: 'compass',  createdAt: now },
    { id: 'demo-ana',  name: 'Ana',  color: '#1D9E75', avatar: 'whale',    createdAt: now },
    { id: 'demo-ben',  name: 'Ben',  color: '#D85A30', avatar: 'cactus',   createdAt: now },
    { id: 'demo-cleo', name: 'Cleo', color: '#D4537E', avatar: 'lantern',  createdAt: now },
    { id: 'demo-dev',  name: 'Dev',  color: '#378ADD', avatar: 'mushroom', createdAt: now },
  ]
}

// The seeded events tell the product's story on first paint:
//   • a public event of yours next to Ana's — the shared grid;
//   • Ben's ANONYMOUS slot overlapping yours — revealed by coincidence;
//   • Cleo's anonymous slot overlapping nothing — the de-identified hint dot;
//   • a sports calendar with a recorded result — standings have data.
function seedEvents(): CalEvent[] {
  const now  = new Date().toISOString()
  const none = { frequency: 'none' as const }
  return [
    // ── Team planning (the calendar the demo opens on) ──────────────────────
    { id: 'demo-ev-sprint', calendarId: DEMO_TEAM_CAL, userId: DEMO_ME,
      title: 'Sprint planning', date: dayOffset(1), startHour: 10, endHour: 11.5,
      visibility: 'public', tags: [], recurring: none, createdAt: now },
    { id: 'demo-ev-review', calendarId: DEMO_TEAM_CAL, userId: 'demo-ana',
      title: 'Design review', date: dayOffset(1), startHour: 11, endHour: 12,
      visibility: 'public', tags: [], recurring: none, createdAt: now },
    // Anonymous, overlapping YOUR event above → revealed to you by coincidence.
    { id: 'demo-ev-busy', calendarId: DEMO_TEAM_CAL, userId: 'demo-ben',
      title: 'Busy', date: dayOffset(1), startHour: 10.5, endHour: 11,
      visibility: 'anonymous', tags: [], recurring: none, createdAt: now },
    // Anonymous and UNMATCHED → you only get the "someone has something" hint.
    { id: 'demo-ev-hidden', calendarId: DEMO_TEAM_CAL, userId: 'demo-cleo',
      title: 'Errands', date: dayOffset(4), startHour: 14, endHour: 16,
      visibility: 'anonymous', tags: [], recurring: none, createdAt: now },
    // Your own anonymous event — always visible to you, whatever its state.
    { id: 'demo-ev-dentist', calendarId: DEMO_TEAM_CAL, userId: DEMO_ME,
      title: 'Dentist', date: dayOffset(2), startHour: 9, endHour: 10,
      visibility: 'anonymous', tags: [], recurring: none, createdAt: now },

    // ── Five-a-side (sports features on) ────────────────────────────────────
    // A played match with a recorded result, so the leaderboard has standings.
    { id: 'demo-ev-match-past', calendarId: DEMO_FIVES_CAL, userId: 'demo-ana',
      title: 'Match vs Rovers', date: dayOffset(-4), startHour: 18, endHour: 19,
      visibility: 'public', tags: [], recurring: none, activity: 'football',
      result: {
        teams: [
          { name: 'Us',     memberIds: [DEMO_ME, 'demo-ana'],    score: 3 },
          { name: 'Rovers', memberIds: ['demo-ben', 'demo-dev'], score: 2 },
        ],
        recordedAt: now,
      },
      createdAt: now },
    { id: 'demo-ev-match-next', calendarId: DEMO_FIVES_CAL, userId: 'demo-ana',
      title: 'Match vs Harbour FC', date: dayOffset(3), startHour: 18, endHour: 19,
      visibility: 'public', tags: [], recurring: none, activity: 'football',
      createdAt: now },
    { id: 'demo-ev-training', calendarId: DEMO_FIVES_CAL, userId: DEMO_ME,
      title: 'Training', date: dayOffset(5), startHour: 19, endHour: 20,
      visibility: 'public', tags: [], recurring: { frequency: 'weekly' },
      activity: 'football', createdAt: now },
  ]
}

// ── The mutable world ─────────────────────────────────────────────────────────
// Users and events are what the visitor can change; calendars and membership
// are fixed (see the header). Seeded lazily on first touch so importing this
// module outside demo mode costs nothing.

interface DemoWorld {
  users:        User[]
  events:       CalEvent[]
  activeUserId: string | null
}

let state: DemoWorld | null = null

function world(): DemoWorld {
  if (!state) state = { users: seedUsers(), events: seedEvents(), activeUserId: DEMO_ME }
  return state
}

// ── Storage boundary, demo edition (called from store/storage.ts) ─────────────

export function dmActiveUserId(): string | null       { return world().activeUserId }
export function dmSetActiveUserId(id: string | null)  { world().activeUserId = id }

export function dmUsers(): User[] { return [...world().users] }

export function dmSaveUser(user: User): void {
  const w = world()
  w.users = [...w.users.filter(u => u.id !== user.id), user]
}

export function dmRemoveUser(id: string): void {
  const w = world()
  w.users = w.users.filter(u => u.id !== id)
}

export function dmEvents(calendarId: string): CalEvent[] {
  return world().events.filter(e => e.calendarId === calendarId)
}

export function dmEventsForCalendars(calendarIds: string[]): CalEvent[] {
  const wanted = new Set(calendarIds)
  return world().events.filter(e => wanted.has(e.calendarId))
}

export function dmSaveEvent(event: CalEvent): void {
  const w = world()
  w.events = [...w.events.filter(e => e.id !== event.id), event]
}

export function dmRemoveEvent(id: string): void {
  const w = world()
  w.events = w.events.filter(e => e.id !== id)
}

// ── Calendar boundary, demo edition (called from calendarService.ts) ──────────
// Two fixed calendars, both owned by Ana: with nothing owned by the demo
// visitor, the Manage surface (invites, approvals — server territory) never
// draws, and the demo stays inside what actually works.

interface FixedCalendar {
  id: string; name: string; ownerId: string; maxMembers: number | null
  features: Calendar['features']; memberIds: string[]
}

const FIXED_CALENDARS: FixedCalendar[] = [
  { id: DEMO_TEAM_CAL, name: 'Team planning', ownerId: 'demo-ana', maxMembers: 8,
    features: NO_FEATURES,
    memberIds: ['demo-ana', DEMO_ME, 'demo-ben', 'demo-cleo'] },
  { id: DEMO_FIVES_CAL, name: 'Five-a-side', ownerId: 'demo-ana', maxMembers: 10,
    features: { scores: true, leaderboard: true, challenges: true },
    memberIds: ['demo-ana', DEMO_ME, 'demo-ben', 'demo-dev'] },
]

function userName(id: string): string | null {
  return world().users.find(u => u.id === id)?.name ?? null
}

export function dmListCalendars(): Calendar[] {
  const now = new Date().toISOString()
  return FIXED_CALENDARS.map(c => ({
    id:           c.id,
    name:         c.name,
    ownerId:      c.ownerId,
    ownerName:    userName(c.ownerId),
    maxMembers:   c.maxMembers,
    memberCount:  c.memberIds.length,
    pendingCount: 0,
    myStatus:     'approved' as const,
    isOwner:      false,
    features:     c.features,
    createdAt:    now,
  }))
}

export function dmListMembers(calendarId: string): CalendarMember[] {
  const cal = FIXED_CALENDARS.find(c => c.id === calendarId)
  if (!cal) return []
  return cal.memberIds.map(id => ({
    userId:    id,
    username:  id,
    name:      userName(id),
    avatar:    world().users.find(u => u.id === id)?.avatar ?? null,
    status:    'approved' as const,
    invitedAs: null,
    joinedAt:  new Date().toISOString(),
    isOwner:   cal.ownerId === id,
    isGuest:   false,
  }))
}

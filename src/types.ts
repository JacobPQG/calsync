// ─── Core domain types ────────────────────────────────────────────────────────

export interface User {
  id: string
  name: string
  color: string        // hex, assigned on creation
  // The picture the user chose at signup, drawn as their icon. PUBLIC and purely
  // cosmetic — it is NOT part of the credential (ADR-9). Id from AVATARS in
  // auth/credentials.ts. Optional: accounts predating avatars have none and fall
  // back to their initial.
  avatar?: string
  createdAt: string
}

// ── Calendars (ADR-12) ────────────────────────────────────────────────────────
// The unit of ownership, membership, and privacy. Every event belongs to exactly
// one. The OWNER is the admin — there is no separate admin flag, so ownership and
// authority cannot drift apart.

export interface Calendar {
  id:          string
  name:        string
  ownerId:     string
  ownerName:   string | null    // denormalized for the home list; null if unknown
  maxMembers:  number | null    // seat cap; null = unlimited. Enforced server-side.
  memberCount: number           // approved members, owner included
  // People who claimed an invite and are waiting on the owner. Only meaningful to
  // an owner — the server returns 0 to everyone else.
  pendingCount: number
  myStatus:    MemberStatus     // where *I* stand in this calendar
  isOwner:     boolean
  features:    CalendarFeatures // which optional elements this calendar has on
  createdAt:   string
}

// ── Per-calendar optional features (replaces the build-time site variant) ─────
// The owner turns these on to make a calendar a "sports" calendar: activities,
// recorded scores, a leaderboard. All off = the plain availability calendar.
//
// NOT a permission. These decide which UI a member is offered, not what they may
// read — a match result lives inside the event's own JSON and is already governed
// by the events policy. Turning `scores` off hides the button; it does not
// retract a result anyone could already see.

export interface CalendarFeatures {
  /** Record match results on events and show them in the event detail. */
  scores:      boolean
  /** Standings table (wins / draws / losses / points) + recent winners. */
  leaderboard: boolean
  /** Monthly activity challenges (most active, multi-sport). */
  challenges:  boolean
}

export const NO_FEATURES: CalendarFeatures = {
  scores: false, leaderboard: false, challenges: false,
}

// Any of them on means this calendar is "a sports calendar": the event form shows
// the activity picker and lets the title be optional. One derived predicate, so
// the components cannot each invent their own answer.
export function isSportsCalendar(f: CalendarFeatures | null | undefined): boolean {
  return !!f && (f.scores || f.leaderboard || f.challenges)
}

// 'pending' — claimed an invite, but the owner has not confirmed them. The
//   membership exists and grants NOTHING: RLS returns no other member's events.
// 'approved' — confirmed. This is the sharing grant.
export type MemberStatus = 'pending' | 'approved'

export interface CalendarMember {
  userId:    string
  username:  string | null
  name:      string | null
  avatar:    string | null
  status:    MemberStatus
  invitedAs: string | null      // the name the owner typed when minting the invite
  joinedAt:  string
  isOwner:   boolean
}

export type FrequencyType = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom'

export interface RecurringRule {
  frequency: FrequencyType
  daysOfWeek?: number[]   // 0=Mon … 6=Sun, used when frequency='weekly'
  specificDates?: string[] // ISO date strings, used when frequency='custom'
  endDate?: string         // ISO date, undefined = forever
}

export interface EventLocation {
  name?: string
  address?: string
  mapsUrl?: string
}

// ── Event visibility ──────────────────────────────────────────────────────────
// 'anonymous' (the default): the event is only reported to other users if
//   somebody else's event coincides with it — same day, overlapping hours. Until
//   then other users see only a de-identified "activity" hint on the day, never
//   the event itself. Once matched, it is revealed in full.
// 'public': always visible and attributed — you want others to know about it,
//   or you're inviting them.
//
// The owner always sees their own events in full. See engine/visibility.ts.

export type EventVisibility = 'anonymous' | 'public'

export const DEFAULT_VISIBILITY: EventVisibility = 'anonymous'

// ── Sports variant (see lib/siteConfig.ts) ────────────────────────────────────
// A result recorded against an event: 2+ sides with members and a score.
// It lives inside the event's JSON payload, so it needs no extra table and is
// visible to exactly the people who can see the event (RLS-enforced).

export interface TeamScore {
  name: string            // display name ("Team A" by default)
  memberIds: string[]     // participating user ids
  score: number
}

export interface MatchResult {
  teams: TeamScore[]      // 2+ sides; highest score wins, equal = draw
  recordedAt: string
}

export interface CalEvent {
  id: string
  userId: string
  // The calendar this event lives in. Required (ADR-12): an event outside a
  // calendar has no membership to be judged against, so no visibility rule
  // applies to it — it would be a row nobody, including RLS, knows what to do
  // with. Mirrored to an indexed events.calendar_id column for the policy.
  calendarId: string
  title: string
  description?: string
  tags: string[]
  date: string            // ISO date of first occurrence (YYYY-MM-DD)
  startHour: number       // 0–23
  endHour: number         // 1–24
  location?: EventLocation
  eventUrl?: string       // link to external event page
  recurring: RecurringRule
  // Undefined on events stored before visibility existed — read it through
  // visibilityOf() in engine/visibility.ts, which defaults them to anonymous.
  visibility?: EventVisibility
  color?: string          // override user color if desired
  activity?: string       // sports variant: id from sports/activities.ts
  result?: MatchResult    // sports variant: recorded score
  createdAt: string
}

// An expanded event instance for a specific date (after recurrence expansion)
export interface EventInstance {
  event: CalEvent
  user: User
  date: string
}

// Per-day summary used by the calendar grid.
//
// When built for a viewer (buildDaySummaries' `viewerId`), `instances` and
// `users` are already filtered to what that viewer may see. `hiddenCount` then
// carries the de-identified remainder: unmatched anonymous events by other
// people. It's the "somebody created something here" hint — a count only, with
// no user, time, or title attached.
export interface DaySummary {
  date: string
  instances: EventInstance[]
  users: User[]           // unique users with visible events this day
  isOverlap: boolean      // 2+ users coincide
  hiddenCount: number     // unmatched anonymous events withheld from this viewer
}

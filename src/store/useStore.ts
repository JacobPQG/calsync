// ─── Global Store (Zustand) ───────────────────────────────────────────────────
// Central application state. Two important patterns used here:
//
//   Optimistic updates — UI state changes immediately; the async storage call
//   runs in the background. If it FAILS (e.g. RLS rejects the write), the
//   optimistic change is ROLLED BACK and `lastError` is set so the shell can
//   show a banner — the screen must never claim a write the server refused.
//
//   initialize() — called once from App.tsx on mount. Loads all data from the
//   backend (Supabase or localStorage), merges any URL-shared state, and wires
//   up Supabase Realtime subscriptions so changes by other users appear live.

import { create } from 'zustand'
import type { User, CalEvent, Calendar, CalendarFeatures, Poll, PollVoteValue } from '../types'
import { NO_FEATURES, OVERVIEW_CALENDAR_ID, isOverviewCalendar } from '../types'
import * as storage             from './storage'
import * as pollService         from '../polls/pollService'
import type { PollOptionDraft } from '../polls/pollService'
import { nanoid }               from 'nanoid'
import { decodeStateFromUrl }   from '../sharing/urlState'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { IS_SANDBOX }           from '../dev/devMode'
import { log }                  from '../lib/log'

const USER_COLORS = [
  '#7F77DD', '#1D9E75', '#D85A30', '#D4537E',
  '#378ADD', '#639922', '#BA7517', '#E24B4A',
]

// ── Store shape ───────────────────────────────────────────────────────────────

interface StoreState {
  // ── Persistent data ──────────────────────────────────────────────────────
  users:        User[]
  // Events of the ACTIVE CALENDAR only (ADR-12). The app shows one calendar at a
  // time and the calendar is the privacy boundary, so mixing them in one array
  // would be both wrong on screen and a trap for every consumer downstream.
  events:       CalEvent[]
  activeUserId: string | null

  // Which calendar is open. null = the home view (no calendar selected), which is
  // the landing state: you pick a calendar before you see any events.
  // OVERVIEW_CALENDAR_ID = the read-only overview aggregating every calendar the
  // user is an approved member of.
  activeCalendarId: string | null
  // Open a calendar (or null to go home). Loads that calendar's events and
  // re-points the realtime subscription at it.
  openCalendar: (calendarId: string | null) => Promise<void>
  // Open the OVERVIEW: every event the user is part of, across all the given
  // calendars at once. The ids are PUSHED IN by the caller (useAppVM / HomeView)
  // rather than fetched here, for the same import-cycle reason `features` is —
  // calendarService already imports this store. Read-only: addEvent refuses
  // while the overview is open, because no real calendar is.
  openOverview: (calendarIds: string[]) => Promise<void>

  // The calendars the signed-in user belongs to, as the server described them.
  // Pushed in by useAppVM (which owns the fetch) so deep consumers — the event
  // detail naming an event's source calendar — can resolve a calendarId to a
  // name without their own round trip.
  calendars: Calendar[]
  setCalendars: (cs: Calendar[]) => void

  // The OPEN calendar's optional features (scores / leaderboard / challenges).
  // This is what replaced the build-time site variant: "is this a sports
  // calendar" is now a property of the calendar you are looking at, not of the
  // build. Every consumer reads it from here so they cannot disagree.
  //
  // All-off on the home view — with no calendar open there is no feature set to
  // speak of, and that is also the safe default (features fail off).
  features: CalendarFeatures
  setFeatures: (f: CalendarFeatures) => void

  // Per-date counts of anonymous events RLS is withholding from us (Supabase
  // mode only — see storage.loadHiddenCounts). The events themselves never
  // arrive, so this count is all the client has to render the "someone has
  // something here" hint. Empty in localStorage mode, where the client-side
  // filter derives the hint directly instead.
  hiddenCounts: Map<string, number>
  refreshHiddenCounts: (fromDate: string, toDate: string) => Promise<void>

  // ── UI state ─────────────────────────────────────────────────────────────
  selectedDate: string | null
  currentMonth: Date
  isLoading:    boolean   // true while initialize() is running

  // The most recent failed write, phrased for the user. The shell (App) renders
  // it as a dismissible banner; a rolled-back optimistic update sets it so the
  // user learns WHY the event they just saw vanished again.
  lastError:    string | null
  dismissError: () => void

  // ── Selectors ────────────────────────────────────────────────────────────
  activeUser: () => User | null

  // ── Lifecycle ────────────────────────────────────────────────────────────
  // Must be called once on app mount (App.tsx useEffect). Loads users only —
  // events belong to a calendar, and no calendar is open yet.
  initialize: () => Promise<void>

  // ── User actions ─────────────────────────────────────────────────────────
  // createUser: assigns a random color + nanoid; used for local (non-auth) users.
  createUser:     (name: string) => User
  // createTestUser: like createUser but always persists to localStorage even in
  // Supabase mode. Test-mode only (fast create) — never writes to the backend.
  createTestUser: (name: string) => User
  // createAuthUser: used after Supabase sign-up; id must equal auth.uid() for RLS.
  // `username` is persisted to the users.username column on first creation.
  // `avatar` is the cosmetic icon picked at signup (ADR-9) — id from AVATARS.
  createAuthUser: (id: string, name: string, username?: string, avatar?: string) => Promise<User>
  setActiveUser:  (id: string) => void
  // Change a user's icon. Cosmetic only — it has no bearing on their password.
  setAvatar:      (id: string, avatar: string) => Promise<void>

  // ── Event actions ─────────────────────────────────────────────────────────
  // calendarId is NOT a parameter: the event goes into the calendar that is
  // open. Letting a caller name the calendar would let a UI bug write into one
  // the user is not even looking at.
  addEvent:    (event: Omit<CalEvent, 'id' | 'createdAt' | 'calendarId'>) => void
  updateEvent: (id: string, patch: Partial<CalEvent>) => void
  deleteEvent: (id: string) => void

  // ── Polls (ADR-19) ──────────────────────────────────────────────────────────
  // Polls of the ACTIVE (single) calendar only, mirroring `events`. Empty on the
  // home view and in the overview — a poll belongs to one calendar, and the
  // overview aggregates several, so there is no single calendar to create or vote
  // in. openCalendar loads them; openOverview / going home clears them.
  polls: Poll[]
  // Create a poll in the open calendar. Like addEvent, no calendarId parameter —
  // it lands in whatever calendar is open, and refuses if that is none/overview.
  // Returns the new poll id (or null + a message on failure).
  createPoll: (title: string, options: PollOptionDraft[]) =>
    Promise<{ id: string | null; error: string | null }>
  // Replace the active user's whole ballot on a poll.
  castVotes:  (pollId: string, votes: Record<string, PollVoteValue>) => Promise<string | null>
  // Close a poll on a winning option, optionally spawning a public event from it.
  // When an event is spawned it is folded into `events` so it appears at once.
  closePoll:  (pollId: string, optionId: string, spawnEvent: boolean) => Promise<string | null>
  deletePoll: (pollId: string) => Promise<string | null>
  // Internal: re-fetch the given calendar's polls into state. Called after every
  // poll write and by the realtime handler. Underscore-prefixed — not for views.
  _reloadPolls: (calendarId: string) => Promise<void>

  // ── Navigation ────────────────────────────────────────────────────────────
  setSelectedDate: (date: string | null) => void
  navigateMonth:   (direction: 1 | -1) => void
  setCurrentMonth: (date: Date) => void

  // ── Sharing ───────────────────────────────────────────────────────────────
  mergeSharedState: (shared: { users: User[]; events: CalEvent[] }) => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

// The live realtime channel, if any. Held at module scope rather than in the
// store because it is a resource to be torn down, not state to be rendered —
// and because openCalendar must be able to unsubscribe the PREVIOUS calendar's
// channel before subscribing to the next one. Leaving the old one running would
// stream a calendar you have navigated away from into the events array.
let liveChannel: ReturnType<typeof supabase.channel> | null = null

// The active calendar's POLL channel (ADR-19). Module-level and torn down on every
// calendar switch, exactly like liveChannel — it streams poll/option/vote changes
// for the open calendar, and must not outlive it.
let pollChannel: ReturnType<typeof supabase.channel> | null = null

// The `users` directory channel. Module-level and created at most once, for the
// same reason liveChannel is module-level — it is a resource, not state.
//
// initialize() runs TWICE in development: React StrictMode deliberately mounts,
// unmounts and remounts every component to surface exactly this class of bug. A
// supabase-js channel may only be configured BEFORE it is subscribed, so the
// second run calling .on() on the already-subscribed 'calsync-users' channel
// throws "cannot add `postgres_changes` callbacks ... after `subscribe()`".
// Guarding on the handle means the second run finds the channel already live and
// leaves it alone.
let usersChannel: ReturnType<typeof supabase.channel> | null = null

export const useStore = create<StoreState>((set, get) => ({
  users:            [],
  events:           [],
  activeUserId:     storage.loadActiveUserId(),
  activeCalendarId: null,
  calendars:        [],
  polls:            [],
  features:         NO_FEATURES,
  hiddenCounts:     new Map(),
  selectedDate:     null,
  currentMonth:     new Date(),
  isLoading:        true,
  lastError:        null,

  dismissError: () => set({ lastError: null }),

  setFeatures:  (f)  => set({ features: f }),
  setCalendars: (cs) => set({ calendars: cs }),

  refreshHiddenCounts: async (fromDate, toDate) => {
    const calendarId = get().activeCalendarId
    // The overview has no hidden-count RPC of its own: hidden_event_counts is
    // per calendar, and summing it across calendars would cost one round trip
    // each for a hint. The overview simply doesn't show the "someone has
    // something here" hint — every calendar still does.
    if (!calendarId || isOverviewCalendar(calendarId)) {
      set({ hiddenCounts: new Map() })
      return
    }
    const counts = await storage.loadHiddenCounts(calendarId, fromDate, toDate)
    set({ hiddenCounts: counts })
  },

  activeUser: () => {
    const { users, activeUserId } = get()
    return users.find(u => u.id === activeUserId) ?? null
  },

  // ── initialize ─────────────────────────────────────────────────────────────
  // Loads the user directory. NOT events: events belong to a calendar (ADR-12)
  // and no calendar is open on the home view. openCalendar() loads those.
  initialize: async () => {
    set({ isLoading: true })

    // Sandbox: build the fake world on first run, then never again — re-seeding
    // on every load would discard whatever the developer just created. The users
    // and events go through the normal storage adapter (which is localStorage
    // here), so every read path below finds them without a special case.
    //
    // The `import.meta.env.DEV &&` is load-bearing, not redundant: it is what
    // lets the bundler drop the fixture from the production build entirely.
    // See the note in dev/devMode.ts before touching it.
    if (import.meta.env.DEV && IS_SANDBOX) {
      const { seedSandbox, isSeeded, SANDBOX_ME } = await import('../dev/sandboxStore')
      if (!isSeeded()) {
        const { users: seedUsers, events: seedEvents } = seedSandbox()
        await Promise.all(seedUsers.map(u => storage.saveUser(u)))
        await Promise.all(seedEvents.map(e => storage.saveEvent(e)))
        storage.saveActiveUserId(SANDBOX_ME)
        set({ activeUserId: SANDBOX_ME })
      }
    }

    const backendUsers = await storage.loadUsers().catch(() => [] as User[])

    // Test mode: merge local-only personas saved in this browser on top of the
    // backend data so they persist across reloads. In pure localStorage mode
    // loadUsers already returns them, so this is a no-op.
    let users = backendUsers
    if (SUPABASE_ENABLED) {
      const known = new Set(backendUsers.map(u => u.id))
      users = [...backendUsers, ...storage.loadLocalUsers().filter(u => !known.has(u.id))]
    }

    set({ users, isLoading: false })

    // Realtime on `users` only — it is calendar-independent (it is the directory
    // of people, not of anyone's schedule). The events subscription is per
    // calendar and is wired in openCalendar().
    if (!SUPABASE_ENABLED || usersChannel) return

    usersChannel = supabase
      .channel('calsync-users')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'users' },
        p => {
          const u = p.new.data as User
          set(s => ({ users: [...s.users.filter(x => x.id !== u.id), u] }))
        })
      .subscribe()
  },

  // ── openCalendar ───────────────────────────────────────────────────────────
  // Enter a calendar (or pass null to return to the home view). This is the only
  // place `events` is populated, and it replaces the array wholesale rather than
  // merging: the previous calendar's events must not survive the switch, or the
  // grid would show two calendars at once — across the very boundary the privacy
  // model is built on.
  openCalendar: async (calendarId) => {
    // Tear down the previous calendar's subscriptions FIRST. Otherwise they keep
    // streaming rows into `events` / `polls` from a calendar the user has left.
    if (liveChannel) {
      supabase.removeChannel(liveChannel)
      liveChannel = null
    }
    if (pollChannel) {
      supabase.removeChannel(pollChannel)
      pollChannel = null
    }

    if (!calendarId) {
      set({
        activeCalendarId: null, events: [], polls: [], hiddenCounts: new Map(),
        selectedDate: null,
        // Clear the feature set on the way out. Left standing, a sports calendar's
        // flags would still be in the store when the NEXT calendar opens, and for
        // one render that plain calendar would draw an activity picker and a
        // leaderboard button.
        features: NO_FEATURES,
      })
      return
    }

    // Same reasoning for the switch between two calendars: blank the features
    // before the new calendar's arrive, so the outgoing calendar's flags are never
    // shown against the incoming one's events.
    //
    // The features themselves are PUSHED IN by the caller (setFeatures), not
    // fetched here. They live on the calendar row, which only listCalendars()
    // returns — and the store importing calendarService would close an import
    // cycle, since calendarService already imports the store. The caller
    // (useAppVM) is holding that list anyway.
    set({
      isLoading: true, activeCalendarId: calendarId, selectedDate: null,
      features: NO_FEATURES, polls: [],
    })

    // Polls load in parallel with events — they are independent reads scoped to
    // the same calendar, and blocking one on the other only slows the open.
    const pollsPromise = pollService.listPolls(calendarId).catch(() => [] as Poll[])

    const backendEvents = await storage.loadEvents(calendarId).catch(() => [] as CalEvent[])

    let events = backendEvents
    if (SUPABASE_ENABLED) {
      const known = new Set(backendEvents.map(e => e.id))
      events = [
        ...backendEvents,
        ...storage.loadLocalEvents(calendarId).filter(e => !known.has(e.id)),
      ]
    }

    // Additively merge any state encoded in the URL hash (#share=…), binding the
    // shared events into the calendar being opened — a share link carries events,
    // which now have to land somewhere.
    const shared = decodeStateFromUrl()
    if (shared) {
      const knownUsers  = new Set(get().users.map(u => u.id))
      const knownEvents = new Set(events.map(e => e.id))
      const newUsers    = shared.users.filter(u => !knownUsers.has(u.id))
      const newEvents   = shared.events
        .filter(e => !knownEvents.has(e.id))
        .map(e => ({ ...e, calendarId }))
      if (newUsers.length)  set(s => ({ users: [...s.users, ...newUsers] }))
      events = [...events, ...newEvents]
      newUsers.forEach(u  => storage.saveUser(u))
      newEvents.forEach(e => storage.saveEvent(e))
    }

    set({ events, polls: await pollsPromise, isLoading: false })

    if (!SUPABASE_ENABLED) return

    // ── Poll realtime, scoped to this calendar (ADR-19) ──────────────────────
    // A vote is a row in poll_votes, which carries no calendar_id — so unlike
    // events, the changes cannot be server-filtered by calendar. Instead any poll
    // change re-fetches this calendar's polls: the write set is small (one poll's
    // votes), a re-list is one round trip that reassembles the whole tally
    // consistently, and RLS guarantees the re-list only ever returns this
    // calendar's polls. Simpler and race-free versus reconciling three tables by
    // hand from partial change payloads.
    const reloadPolls = () => {
      // Guard against a late event after the user switched calendars.
      if (get().activeCalendarId !== calendarId) return
      void pollService.listPolls(calendarId).then(ps => {
        if (get().activeCalendarId === calendarId) set({ polls: ps })
      })
    }
    pollChannel = supabase
      .channel(`calsync-polls-${calendarId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' },        reloadPolls)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_options' }, reloadPolls)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' },   reloadPolls)
      .subscribe()

    // ── Supabase Realtime, scoped to this calendar ──────────────────────────
    // The server-side `filter` matters: without it we would receive every event
    // row RLS lets us see, from every calendar we belong to, and have to discard
    // most of them client-side. RLS still decides WHAT we may receive; this
    // decides which of it we asked for.
    const scope = `calendar_id=eq.${calendarId}`
    liveChannel = supabase
      .channel(`calsync-cal-${calendarId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: scope },
        p => {
          const e = p.new.data as CalEvent
          set(s => ({ events: [...s.events.filter(x => x.id !== e.id), e] }))
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: scope },
        p => {
          const e = p.new.data as CalEvent
          set(s => ({ events: s.events.map(x => x.id === e.id ? e : x) }))
        })
      .on('postgres_changes',
        // DELETE carries only the OLD row's primary key — Postgres does not send
        // the rest of it, so `filter` on calendar_id cannot match and would drop
        // every delete. Subscribe unfiltered and reconcile by id: an id we don't
        // hold is simply not in the array, so a delete from another calendar is a
        // no-op rather than a leak.
        { event: 'DELETE', schema: 'public', table: 'events' },
        p => {
          const id = (p.old as { id: string }).id
          set(s => ({ events: s.events.filter(x => x.id !== id) }))
        })
      .subscribe()
  },

  // ── openOverview ───────────────────────────────────────────────────────────
  // The virtual "everything I am part of" view: the events of EVERY calendar in
  // `calendarIds`, in one grid. Mirrors openCalendar's lifecycle (tear down the
  // old channel, replace `events` wholesale, resubscribe) but differs in two
  // deliberate ways:
  //
  //   • Read-only. activeCalendarId becomes the OVERVIEW sentinel, which is not
  //     a calendar an event could belong to — addEvent refuses while it is open.
  //     Every event still carries the real calendarId it came from, which is
  //     what lets the event detail offer "open this event's calendar".
  //
  //   • Features stay all-off. Feature flags belong to ONE calendar; an
  //     aggregation of several has no single answer, and all-off is the safe one.
  //
  // Privacy is unchanged: RLS filters each row exactly as it would calendar by
  // calendar, and the client engine judges coincidence per calendar, so merging
  // the arrays cannot unlock anything across the boundary.
  openOverview: async (calendarIds) => {
    if (liveChannel) {
      supabase.removeChannel(liveChannel)
      liveChannel = null
    }
    // The overview aggregates several calendars and has no single one to poll in,
    // so polls are cleared and their channel torn down — there is nothing to show
    // or subscribe to here.
    if (pollChannel) {
      supabase.removeChannel(pollChannel)
      pollChannel = null
    }

    set({
      isLoading: true, activeCalendarId: OVERVIEW_CALENDAR_ID, selectedDate: null,
      features: NO_FEATURES, polls: [],
    })

    const backendEvents = await storage
      .loadEventsForCalendars(calendarIds).catch(() => [] as CalEvent[])

    let events = backendEvents
    if (SUPABASE_ENABLED) {
      const known = new Set(backendEvents.map(e => e.id))
      events = [
        ...backendEvents,
        ...storage.loadLocalEventsForCalendars(calendarIds).filter(e => !known.has(e.id)),
      ]
    }

    set({ events, isLoading: false })

    if (!SUPABASE_ENABLED) return

    // One unfiltered subscription instead of one channel per calendar. RLS still
    // caps what can arrive (only rows we may SELECT); the membership check here
    // narrows that to the calendars this overview was opened WITH, so a calendar
    // joined mid-session appears on the next open rather than half-live now.
    const wanted = new Set(calendarIds)
    liveChannel = supabase
      .channel('calsync-overview')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        p => {
          const e = p.new.data as CalEvent
          if (!wanted.has(e.calendarId)) return
          set(s => ({ events: [...s.events.filter(x => x.id !== e.id), e] }))
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        p => {
          const e = p.new.data as CalEvent
          if (!wanted.has(e.calendarId)) return
          set(s => ({ events: s.events.map(x => x.id === e.id ? e : x) }))
        })
      .on('postgres_changes',
        // Same reconcile-by-id reasoning as openCalendar: DELETE only carries
        // the old PK, and an id we don't hold is a no-op.
        { event: 'DELETE', schema: 'public', table: 'events' },
        p => {
          const id = (p.old as { id: string }).id
          set(s => ({ events: s.events.filter(x => x.id !== id) }))
        })
      .subscribe()
  },

  // ── User actions ───────────────────────────────────────────────────────────

  createUser: (name) => {
    const { users } = get()
    const color = USER_COLORS[users.length % USER_COLORS.length]
    const user: User = {
      id: nanoid(), name: name.trim(), color,
      createdAt: new Date().toISOString(),
    }
    // Optimistic update first, then persist in background.
    set({ users: [...users, user], activeUserId: user.id })
    storage.saveActiveUserId(user.id)
    storage.saveUser(user)
    return user
  },

  // Fast create (test mode): a name-only persona kept in localStorage even when
  // a Supabase backend is configured, so it never touches the real database.
  createTestUser: (name) => {
    const { users } = get()
    const color = USER_COLORS[users.length % USER_COLORS.length]
    const user: User = {
      id: nanoid(), name: name.trim(), color,
      createdAt: new Date().toISOString(),
    }
    set({ users: [...users, user], activeUserId: user.id })
    storage.saveActiveUserId(user.id)
    storage.saveLocalUser(user)
    return user
  },

  // Used by the QR claim screen and AuthModal after a successful Supabase
  // sign-up. id = auth.uid() ensures the RLS policy "auth.uid()::text = id" passes.
  createAuthUser: async (id, name, username, avatar) => {
    const { users } = get()
    const color = USER_COLORS[users.length % USER_COLORS.length]
    const user: User = {
      id, name: name.trim(), color, avatar,
      createdAt: new Date().toISOString(),
    }
    // Await here — the auth flow must complete before the modal closes.
    await storage.saveUser(user, username)
    storage.saveActiveUserId(id)
    set({ users: [...users, user], activeUserId: id })
    return user
  },

  setActiveUser: (id) => {
    storage.saveActiveUserId(id)
    set({ activeUserId: id })
  },

  // The avatar lives inside users.data, which RLS already lets a user rewrite
  // for their own row — no new grant, and no credential consequence (ADR-9).
  setAvatar: async (id, avatar) => {
    const user = get().users.find(u => u.id === id)
    if (!user) return
    const updated = { ...user, avatar }
    set(s => ({ users: s.users.map(u => (u.id === id ? updated : u)) }))
    await storage.saveUser(updated)
  },

  // ── Event actions ──────────────────────────────────────────────────────────

  // The event lands in the calendar currently open — callers never pass a
  // calendarId, so they cannot accidentally write into a different one. Without
  // an open calendar there is nowhere for an event to go, and creating one would
  // produce a row RLS must reject; refuse here instead of writing a doomed event.
  addEvent: (draft) => {
    const calendarId = get().activeCalendarId
    if (!calendarId) {
      log.error('store', 'addEvent called with no calendar open — event discarded')
      return
    }
    // The overview is not a calendar — an event written "into" it would carry
    // the sentinel as its calendarId, which RLS would rightly refuse. The UI
    // hides the add affordances there; this is the backstop.
    if (isOverviewCalendar(calendarId)) {
      log.error('store', 'addEvent called in the overview — event discarded')
      return
    }
    const event: CalEvent = {
      ...draft, calendarId, id: nanoid(), createdAt: new Date().toISOString(),
    }
    set(s => ({ events: [...s.events, event] }))
    // Optimistic; if the backend refuses (e.g. RLS — membership revoked
    // mid-session), take the phantom row back off the screen and say why.
    void storage.saveEvent(event).then(err => {
      if (!err) return
      set(s => ({
        events: s.events.filter(e => e.id !== event.id),
        lastError: `Your event was not saved: ${err}`,
      }))
    })
  },

  updateEvent: (id, patch) => {
    const previous = get().events.find(e => e.id === id)
    if (!previous) return
    const updated = { ...previous, ...patch }
    set(s => ({ events: s.events.map(e => (e.id === id ? updated : e)) }))
    void storage.saveEvent(updated).then(err => {
      if (!err) return
      set(s => ({
        events: s.events.map(e => (e.id === id ? previous : e)),
        lastError: `Your change was not saved: ${err}`,
      }))
    })
  },

  deleteEvent: (id) => {
    const removed = get().events.find(e => e.id === id)
    set(s => ({ events: s.events.filter(e => e.id !== id) }))
    void storage.removeEvent(id).then(err => {
      if (!err || !removed) return
      set(s => ({
        events: [...s.events, removed],
        lastError: `The event was not deleted: ${err}`,
      }))
    })
  },

  // ── Poll actions (ADR-19) ────────────────────────────────────────────────────
  // These delegate to pollService and then refresh from it — polls are a
  // multi-row artifact (poll + options + votes) reassembled server-side by
  // list_polls, so a re-list is the honest way to reflect a write, and it is what
  // realtime does for other users anyway. No optimistic local mutation of the
  // tally: it would risk disagreeing with the authoritative re-list.

  createPoll: async (title, options) => {
    const calendarId = get().activeCalendarId
    if (!calendarId || isOverviewCalendar(calendarId)) {
      return { id: null, error: 'Open a calendar first to create a poll.' }
    }
    const res = await pollService.createPoll(calendarId, title, options)
    if (res.id) await get()._reloadPolls(calendarId)
    return res
  },

  castVotes: async (pollId, votes) => {
    const err = await pollService.castVotes(pollId, votes)
    const calendarId = get().activeCalendarId
    if (!err && calendarId) await get()._reloadPolls(calendarId)
    return err
  },

  closePoll: async (pollId, optionId, spawnEvent) => {
    const calendarId = get().activeCalendarId
    const { eventId, error } = await pollService.closePoll(pollId, optionId, spawnEvent)
    if (error) return error

    // In sandbox / localStorage mode the backend does not create the event —
    // close_poll's INSERT only runs in Supabase. So when a poll spawns an event
    // outside Supabase, materialize it here so it lands on the grid, mirroring
    // the row close_poll would have written. In Supabase mode realtime delivers
    // the server-inserted event, so we must NOT also insert it (double row).
    if (spawnEvent && eventId && !SUPABASE_ENABLED && calendarId) {
      const poll = get().polls.find(p => p.id === pollId)
      const opt  = poll?.options.find(o => o.id === optionId)
      if (poll && opt) {
        const event: CalEvent = {
          id: eventId, userId: get().activeUserId ?? '', calendarId,
          title: poll.title, date: opt.date,
          startHour: opt.startHour, endHour: opt.endHour,
          visibility: 'public', tags: [], recurring: { frequency: 'none' },
          createdAt: new Date().toISOString(),
        }
        set(s => ({ events: [...s.events, event] }))
        storage.saveEvent(event)
      }
    }

    if (calendarId) await get()._reloadPolls(calendarId)
    return null
  },

  deletePoll: async (pollId) => {
    const err = await pollService.deletePoll(pollId)
    const calendarId = get().activeCalendarId
    if (!err && calendarId) await get()._reloadPolls(calendarId)
    return err
  },

  // Re-fetch the open calendar's polls. Guarded so a response that arrives after
  // the user has navigated away does not overwrite the new calendar's polls.
  _reloadPolls: async (calendarId: string) => {
    if (isOverviewCalendar(calendarId)) return
    const ps = await pollService.listPolls(calendarId)
    if (get().activeCalendarId === calendarId) set({ polls: ps })
  },

  // ── Navigation ─────────────────────────────────────────────────────────────

  setSelectedDate: (date) => set({ selectedDate: date }),

  navigateMonth: (dir) => {
    const next = new Date(get().currentMonth)
    next.setMonth(next.getMonth() + dir)
    set({ currentMonth: next })
  },

  setCurrentMonth: (date) => set({ currentMonth: date }),

  // ── Sharing ────────────────────────────────────────────────────────────────

  // Shared events are bound to the calendar currently open — a share link carries
  // events, and an event has to belong to a calendar. With none open there is
  // nowhere to put them.
  mergeSharedState: ({ users: su, events: se }) => {
    const { users, events, activeCalendarId } = get()
    if (!activeCalendarId || isOverviewCalendar(activeCalendarId)) {
      log.warn('store', 'mergeSharedState with no real calendar open — events ignored')
      return
    }
    const knownUsers  = new Set(users.map(u => u.id))
    const knownEvents = new Set(events.map(e => e.id))
    const newUsers    = su.filter(u => !knownUsers.has(u.id))
    const newEvents   = se
      .filter(e => !knownEvents.has(e.id))
      .map(e => ({ ...e, calendarId: activeCalendarId }))
    set({ users: [...users, ...newUsers], events: [...events, ...newEvents] })
    newUsers.forEach(u  => storage.saveUser(u))
    newEvents.forEach(e => storage.saveEvent(e))
  },
}))

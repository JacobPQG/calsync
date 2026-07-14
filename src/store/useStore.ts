// ─── Global Store (Zustand) ───────────────────────────────────────────────────
// Central application state. Two important patterns used here:
//
//   Optimistic updates — UI state changes immediately; the async storage call
//   runs in the background. If it fails, an error is logged but the UI doesn't
//   roll back. Suitable for collaborative tools where eventual consistency is
//   acceptable. Add rollback logic here if you need stricter guarantees.
//
//   initialize() — called once from App.tsx on mount. Loads all data from the
//   backend (Supabase or localStorage), merges any URL-shared state, and wires
//   up Supabase Realtime subscriptions so changes by other users appear live.

import { create } from 'zustand'
import type { User, CalEvent, CalendarFeatures } from '../types'
import { NO_FEATURES }          from '../types'
import * as storage             from './storage'
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
  activeCalendarId: string | null
  // Open a calendar (or null to go home). Loads that calendar's events and
  // re-points the realtime subscription at it.
  openCalendar: (calendarId: string | null) => Promise<void>

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
  features:         NO_FEATURES,
  hiddenCounts:     new Map(),
  selectedDate:     null,
  currentMonth:     new Date(),
  isLoading:        true,

  setFeatures: (f) => set({ features: f }),

  refreshHiddenCounts: async (fromDate, toDate) => {
    const calendarId = get().activeCalendarId
    if (!calendarId) { set({ hiddenCounts: new Map() }); return }
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
    // Tear down the previous calendar's subscription FIRST. Otherwise it keeps
    // streaming rows into `events` from a calendar the user has left.
    if (liveChannel) {
      supabase.removeChannel(liveChannel)
      liveChannel = null
    }

    if (!calendarId) {
      set({
        activeCalendarId: null, events: [], hiddenCounts: new Map(),
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
      features: NO_FEATURES,
    })

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

    set({ events, isLoading: false })

    if (!SUPABASE_ENABLED) return

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
    const event: CalEvent = {
      ...draft, calendarId, id: nanoid(), createdAt: new Date().toISOString(),
    }
    set(s => ({ events: [...s.events, event] }))
    storage.saveEvent(event)
  },

  updateEvent: (id, patch) => {
    set(s => {
      const events = s.events.map(e => {
        if (e.id !== id) return e
        const updated = { ...e, ...patch }
        storage.saveEvent(updated)
        return updated
      })
      return { events }
    })
  },

  deleteEvent: (id) => {
    set(s => ({ events: s.events.filter(e => e.id !== id) }))
    storage.removeEvent(id)
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
    if (!activeCalendarId) {
      log.warn('store', 'mergeSharedState with no calendar open — events ignored')
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

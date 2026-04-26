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
import type { User, CalEvent } from '../types'
import * as storage             from './storage'
import { nanoid }               from 'nanoid'
import { decodeStateFromUrl }   from '../sharing/urlState'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'

const USER_COLORS = [
  '#7F77DD', '#1D9E75', '#D85A30', '#D4537E',
  '#378ADD', '#639922', '#BA7517', '#E24B4A',
]

// ── Store shape ───────────────────────────────────────────────────────────────

interface StoreState {
  // ── Persistent data ──────────────────────────────────────────────────────
  users:        User[]
  events:       CalEvent[]
  activeUserId: string | null

  // ── UI state ─────────────────────────────────────────────────────────────
  selectedDate: string | null
  currentMonth: Date
  isLoading:    boolean   // true while initialize() is running

  // ── Selectors ────────────────────────────────────────────────────────────
  activeUser: () => User | null

  // ── Lifecycle ────────────────────────────────────────────────────────────
  // Must be called once on app mount (App.tsx useEffect).
  initialize: () => Promise<void>

  // ── User actions ─────────────────────────────────────────────────────────
  // createUser: assigns a random color + nanoid; used for local (non-auth) users.
  createUser:     (name: string) => User
  // createAuthUser: used after Supabase sign-up; id must equal auth.uid() for RLS.
  createAuthUser: (id: string, name: string) => Promise<User>
  setActiveUser:  (id: string) => void

  // ── Event actions ─────────────────────────────────────────────────────────
  addEvent:    (event: Omit<CalEvent, 'id' | 'createdAt'>) => void
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

export const useStore = create<StoreState>((set, get) => ({
  users:        [],
  events:       [],
  activeUserId: storage.loadActiveUserId(),
  selectedDate: null,
  currentMonth: new Date(),
  isLoading:    true,

  activeUser: () => {
    const { users, activeUserId } = get()
    return users.find(u => u.id === activeUserId) ?? null
  },

  // ── initialize ─────────────────────────────────────────────────────────────
  // Loads data, merges URL-shared state, and sets up Realtime (Supabase only).
  initialize: async () => {
    set({ isLoading: true })

    // Load all data from backend (errors fall back to empty arrays, not a crash).
    const [users, events] = await Promise.all([
      storage.loadUsers().catch(()  => [] as User[]),
      storage.loadEvents().catch(() => [] as CalEvent[]),
    ])

    // Additively merge any state encoded in the URL hash (#share=…).
    // New items are persisted to the backend so they survive a reload.
    let finalUsers  = users
    let finalEvents = events
    const shared = decodeStateFromUrl()
    if (shared) {
      const knownUsers  = new Set(users.map(u => u.id))
      const knownEvents = new Set(events.map(e => e.id))
      const newUsers    = shared.users.filter(u  => !knownUsers.has(u.id))
      const newEvents   = shared.events.filter(e => !knownEvents.has(e.id))
      finalUsers  = [...users,  ...newUsers]
      finalEvents = [...events, ...newEvents]
      newUsers.forEach(u  => storage.saveUser(u))
      newEvents.forEach(e => storage.saveEvent(e))
    }

    set({ users: finalUsers, events: finalEvents, isLoading: false })

    // ── Supabase Realtime ───────────────────────────────────────────────────
    // Subscribe to INSERT / UPDATE / DELETE on both tables so changes made by
    // other users appear in this browser without a page reload.
    // Requires the tables to be added to the supabase_realtime publication
    // (see src/lib/schema.sql).
    if (!SUPABASE_ENABLED) return

    supabase
      .channel('calsync-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        p => {
          const e = p.new.data as CalEvent
          set(s => ({ events: [...s.events.filter(x => x.id !== e.id), e] }))
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        p => {
          const e = p.new.data as CalEvent
          set(s => ({ events: s.events.map(x => x.id === e.id ? e : x) }))
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'events' },
        p => {
          const id = (p.old as { id: string }).id
          set(s => ({ events: s.events.filter(x => x.id !== id) }))
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'users' },
        p => {
          const u = p.new.data as User
          set(s => ({ users: [...s.users.filter(x => x.id !== u.id), u] }))
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

  // Used exclusively by AuthModal after a successful Supabase sign-up.
  // id = auth.uid() ensures the RLS policy "auth.uid()::text = id" passes.
  createAuthUser: async (id, name) => {
    const { users } = get()
    const color = USER_COLORS[users.length % USER_COLORS.length]
    const user: User = {
      id, name: name.trim(), color,
      createdAt: new Date().toISOString(),
    }
    // Await here — the auth flow must complete before the modal closes.
    await storage.saveUser(user)
    storage.saveActiveUserId(id)
    set({ users: [...users, user], activeUserId: id })
    return user
  },

  setActiveUser: (id) => {
    storage.saveActiveUserId(id)
    set({ activeUserId: id })
  },

  // ── Event actions ──────────────────────────────────────────────────────────

  addEvent: (draft) => {
    const event: CalEvent = {
      ...draft, id: nanoid(), createdAt: new Date().toISOString(),
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

  mergeSharedState: ({ users: su, events: se }) => {
    const { users, events } = get()
    const knownUsers  = new Set(users.map(u => u.id))
    const knownEvents = new Set(events.map(e => e.id))
    const newUsers    = su.filter(u => !knownUsers.has(u.id))
    const newEvents   = se.filter(e => !knownEvents.has(e.id))
    set({ users: [...users, ...newUsers], events: [...events, ...newEvents] })
    newUsers.forEach(u  => storage.saveUser(u))
    newEvents.forEach(e => storage.saveEvent(e))
  },
}))

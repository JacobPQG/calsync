// ─── Global Store (Zustand) ───────────────────────────────────────────────────
// All application state lives here. Zustand was chosen over React Context
// because:
//   • No wrapper providers – any component can subscribe without tree changes
//   • Fine-grained subscriptions – components re-render only when their slice
//     of state changes (no cascading renders from unrelated updates)
//   • The store is callable outside React (e.g. in event handlers, utilities)
//
// Persistence: all data (users, events) is mirrored to localStorage via the
// storage adapter in ./storage.ts. Swapping that file for a Supabase or
// Firebase adapter is the only change needed to go "real backend".

import { create } from 'zustand'
import type { User, CalEvent } from '../types'
import * as storage from './storage'   // <-- note: ./storage, same directory
import { nanoid } from 'nanoid'
import { decodeStateFromUrl } from '../sharing/urlState'

// Eight distinct colors, one per user (cycles if more than 8 users).
const USER_COLORS = [
  '#7F77DD', '#1D9E75', '#D85A30', '#D4537E',
  '#378ADD', '#639922', '#BA7517', '#E24B4A',
]

// ── Store shape ───────────────────────────────────────────────────────────────

interface StoreState {
  // ── Persistent data (saved to localStorage) ───────────────────────────────
  users:        User[]
  events:       CalEvent[]
  activeUserId: string | null

  // ── Ephemeral UI state (reset on page reload) ─────────────────────────────
  selectedDate:  string | null   // ISO date string, e.g. "2024-04-26"
  currentMonth:  Date            // controls which month the grid shows

  // ── Selectors ─────────────────────────────────────────────────────────────
  activeUser: () => User | null

  // ── User actions ──────────────────────────────────────────────────────────
  createUser:   (name: string) => User
  setActiveUser:(id: string) => void

  // ── Event actions ─────────────────────────────────────────────────────────
  addEvent:    (event: Omit<CalEvent, 'id' | 'createdAt'>) => void
  updateEvent: (id: string, patch: Partial<CalEvent>) => void
  deleteEvent: (id: string) => void

  // ── Navigation ────────────────────────────────────────────────────────────
  setSelectedDate: (date: string | null) => void
  navigateMonth:   (direction: 1 | -1) => void
  setCurrentMonth: (date: Date) => void   // jump to arbitrary month (e.g. "Today")

  // ── Sharing ───────────────────────────────────────────────────────────────
  // Merge externally-shared users/events into local state (additive, no duplicates).
  mergeSharedState: (shared: { users: User[]; events: CalEvent[] }) => void
}

// ── Initial state setup ───────────────────────────────────────────────────────
// Load base state from localStorage, then additively merge any state that was
// encoded in the URL hash (from a "Share" link).

function buildInitialState(): Pick<StoreState, 'users' | 'events' | 'activeUserId'> {
  const baseUsers  = storage.loadUsers()
  const baseEvents = storage.loadEvents()
  const shared     = decodeStateFromUrl()

  if (!shared) {
    return { users: baseUsers, events: baseEvents, activeUserId: storage.loadActiveUserId() }
  }

  // Merge: add shared items that don't already exist (keyed by id).
  const existingUserIds  = new Set(baseUsers.map(u => u.id))
  const existingEventIds = new Set(baseEvents.map(e => e.id))
  const newUsers  = shared.users.filter(u => !existingUserIds.has(u.id))
  const newEvents = shared.events.filter(e => !existingEventIds.has(e.id))

  const mergedUsers  = [...baseUsers,  ...newUsers]
  const mergedEvents = [...baseEvents, ...newEvents]

  if (newUsers.length || newEvents.length) {
    // Persist the newly imported items so they survive a reload.
    storage.saveUsers(mergedUsers)
    storage.saveEvents(mergedEvents)
  }

  return {
    users:        mergedUsers,
    events:       mergedEvents,
    activeUserId: storage.loadActiveUserId(),
  }
}

// ── Store creation ────────────────────────────────────────────────────────────

export const useStore = create<StoreState>((set, get) => ({
  ...buildInitialState(),
  selectedDate: null,
  currentMonth: new Date(),

  activeUser: () => {
    const { users, activeUserId } = get()
    return users.find(u => u.id === activeUserId) ?? null
  },

  createUser: (name) => {
    const { users } = get()
    const color = USER_COLORS[users.length % USER_COLORS.length]
    const user: User = {
      id:        nanoid(),
      name:      name.trim(),
      color,
      createdAt: new Date().toISOString(),
    }
    const next = [...users, user]
    storage.saveUsers(next)
    storage.saveActiveUserId(user.id)
    set({ users: next, activeUserId: user.id })
    return user
  },

  setActiveUser: (id) => {
    storage.saveActiveUserId(id)
    set({ activeUserId: id })
  },

  addEvent: (draft) => {
    const event: CalEvent = {
      ...draft,
      id:        nanoid(),
      createdAt: new Date().toISOString(),
    }
    const next = [...get().events, event]
    storage.saveEvents(next)
    set({ events: next })
  },

  updateEvent: (id, patch) => {
    const next = get().events.map(e => e.id === id ? { ...e, ...patch } : e)
    storage.saveEvents(next)
    set({ events: next })
  },

  deleteEvent: (id) => {
    const next = get().events.filter(e => e.id !== id)
    storage.saveEvents(next)
    set({ events: next })
  },

  setSelectedDate: (date) => set({ selectedDate: date }),

  navigateMonth: (dir) => {
    const next = new Date(get().currentMonth)
    next.setMonth(next.getMonth() + dir)
    set({ currentMonth: next })
  },

  // Jump directly to any month (used by the "Today" button).
  setCurrentMonth: (date) => set({ currentMonth: date }),

  mergeSharedState: ({ users: su, events: se }) => {
    const { users, events } = get()
    const existingUserIds  = new Set(users.map(u => u.id))
    const existingEventIds = new Set(events.map(e => e.id))
    const nextUsers  = [...users,  ...su.filter(u => !existingUserIds.has(u.id))]
    const nextEvents = [...events, ...se.filter(e => !existingEventIds.has(e.id))]
    storage.saveUsers(nextUsers)
    storage.saveEvents(nextEvents)
    set({ users: nextUsers, events: nextEvents })
  },
}))

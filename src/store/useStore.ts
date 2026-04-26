import { create } from 'zustand'
import type { User, CalEvent } from '../types'
import * as storage from '../storage'
import { nanoid } from 'nanoid' // npm install nanoid

const USER_COLORS = [
  '#7F77DD', '#1D9E75', '#D85A30', '#D4537E',
  '#378ADD', '#639922', '#BA7517', '#E24B4A',
]

interface StoreState {
  // ── Data ──────────────────────────────────────────────────────────────────
  users: User[]
  events: CalEvent[]
  activeUserId: string | null

  // ── UI state ──────────────────────────────────────────────────────────────
  selectedDate: string | null   // ISO date
  currentMonth: Date

  // ── Selectors ─────────────────────────────────────────────────────────────
  activeUser: () => User | null

  // ── User actions ──────────────────────────────────────────────────────────
  createUser: (name: string) => User
  setActiveUser: (id: string) => void

  // ── Event actions ─────────────────────────────────────────────────────────
  addEvent: (event: Omit<CalEvent, 'id' | 'createdAt'>) => void
  updateEvent: (id: string, patch: Partial<CalEvent>) => void
  deleteEvent: (id: string) => void

  // ── Navigation ────────────────────────────────────────────────────────────
  setSelectedDate: (date: string | null) => void
  navigateMonth: (direction: 1 | -1) => void
}

export const useStore = create<StoreState>((set, get) => ({
  users: storage.loadUsers(),
  events: storage.loadEvents(),
  activeUserId: storage.loadActiveUserId(),
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
      id: nanoid(),
      name: name.trim(),
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
      id: nanoid(),
      createdAt: new Date().toISOString(),
    }
    const next = [...get().events, event]
    storage.saveEvents(next)
    set({ events: next })
  },

  updateEvent: (id, patch) => {
    const next = get().events.map(e => (e.id === id ? { ...e, ...patch } : e))
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
    const { currentMonth } = get()
    const next = new Date(currentMonth)
    next.setMonth(next.getMonth() + dir)
    set({ currentMonth: next })
  },
}))

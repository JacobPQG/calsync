// ─── Core domain types ────────────────────────────────────────────────────────

export interface User {
  id: string
  name: string
  color: string        // hex, assigned on creation
  createdAt: string
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

export interface CalEvent {
  id: string
  userId: string
  title: string
  description?: string
  tags: string[]
  date: string            // ISO date of first occurrence (YYYY-MM-DD)
  startHour: number       // 0–23
  endHour: number         // 1–24
  location?: EventLocation
  eventUrl?: string       // link to external event page
  recurring: RecurringRule
  color?: string          // override user color if desired
  createdAt: string
}

// An expanded event instance for a specific date (after recurrence expansion)
export interface EventInstance {
  event: CalEvent
  user: User
  date: string
}

// Per-day summary used by the calendar grid
export interface DaySummary {
  date: string
  instances: EventInstance[]
  users: User[]           // unique users with events this day
  isOverlap: boolean      // 2+ users coincide
}

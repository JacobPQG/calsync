// ─── Home ViewModel ───────────────────────────────────────────────────────────
// The landing view: every calendar you own, every calendar you have been invited
// into, and the button that makes a new one.
//
// The two lists are the same query (list_calendars) split on `isOwner` — the
// server decides which is which, from the `owner_id` on the calendar itself. The
// split is presentational; the authority is not.
//
// All security lives in lib/schema.sql. This VM only renders what the server
// already decided the user may see.

import { useState, useEffect, useCallback } from 'react'
import type { Calendar } from '../types'
import {
  listCalendars, createCalendar, leaveCalendar,
} from './calendarService'
import { useAuthSession } from '../auth/useAuth'
import { SUPABASE_ENABLED } from '../lib/supabase'
import { IS_SANDBOX } from '../dev/devMode'
import { DEFAULT_CALENDAR_SEATS } from '../lib/config'

export interface HomeVM {
  // The two sections of the home view.
  owned:  Calendar[]     // I am the admin of these
  joined: Calendar[]     // I was invited into these

  loading: boolean
  error:   string | null

  // Why creating a calendar is unavailable right now, or null if it is available.
  // create_calendar refuses an unapproved account server-side (is_approved()), so
  // without this the user types a name, submits, and only then learns they were
  // never allowed. The server remains the enforcement point; this is the
  // explanation.
  createBlockedReason: string | null

  // ── Create-calendar form ──────────────────────────────────────────────────
  creating:    boolean          // is the form open
  setCreating: (v: boolean) => void
  newName:     string; setNewName: (v: string) => void
  // How many people this calendar is for. The number the owner "defines up front"
  // — a hard cap, enforced at approval, server-side.
  newSeats:    number | null; setNewSeats: (v: number | null) => void
  canCreate:   boolean
  submitting:  boolean
  // Resolves to the new calendar's id, so the caller can navigate straight into
  // it — creating a calendar and then having to find it would be silly.
  create:      () => Promise<string | null>

  // ── Row actions ───────────────────────────────────────────────────────────
  leave:  (calendarId: string) => Promise<void>
  busyId: string | null

  refresh: () => Promise<void>
}

const MIN_NAME = 2

export function useHomeVM(): HomeVM {
  const auth = useAuthSession()

  const [calendars,  setCalendars]  = useState<Calendar[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const [creating,   setCreating]   = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newSeats,   setNewSeats]   = useState<number | null>(DEFAULT_CALENDAR_SEATS)
  const [submitting, setSubmitting] = useState(false)
  const [busyId,     setBusyId]     = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setCalendars(await listCalendars())
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Mirrors the server's own preconditions for create_calendar. Kept in this
  // order because "you are not signed in" explains "you are not approved".
  //
  // The sandbox is exempt: it has no auth and no server, and creating calendars
  // is the main thing it exists to let you do. See dev/devMode.ts.
  const createBlockedReason: string | null =
    IS_SANDBOX            ? null
    : !SUPABASE_ENABLED     ? 'Calendars need a Supabase backend (see .env.example).'
    : !auth.isAuthenticated ? 'Sign in to create a calendar.'
    : auth.approved === false
      ? 'Your account is awaiting approval by the administrator. You can create calendars once it is approved.'
    : null

  async function create(): Promise<string | null> {
    setError(null)
    if (createBlockedReason) { setError(createBlockedReason); return null }

    const clean = newName.trim()
    if (clean.length < MIN_NAME) { setError('Give the calendar a name.'); return null }

    setSubmitting(true)
    try {
      const { id, error: errMsg } = await createCalendar(clean, newSeats)
      if (errMsg || !id) {
        setError(errMsg ?? 'Could not create the calendar.')
        return null
      }
      setNewName('')
      setNewSeats(DEFAULT_CALENDAR_SEATS)
      setCreating(false)
      await refresh()
      return id
    } finally {
      setSubmitting(false)
    }
  }

  async function leave(calendarId: string) {
    setError(null)
    setBusyId(calendarId)
    try {
      const errMsg = await leaveCalendar(calendarId)
      if (errMsg) { setError(errMsg); return }
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  return {
    owned:  calendars.filter(c =>  c.isOwner),
    joined: calendars.filter(c => !c.isOwner),
    loading, error,

    createBlockedReason,

    creating, setCreating,
    newName, setNewName,
    newSeats, setNewSeats,
    canCreate: createBlockedReason === null && newName.trim().length >= MIN_NAME,
    submitting,
    create,

    leave, busyId,
    refresh,
  }
}

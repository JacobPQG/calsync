// ─── CalendarAdmin ViewModel ──────────────────────────────────────────────────
// The owner's control panel for ONE calendar. Four jobs:
//
//   1. SETTINGS  — rename it, change the seat cap, delete it.
//   2. INVITE    — name the people you want and mint one QR each (bulk).
//   3. CONFIRM   — someone claimed a QR; their membership exists but is PENDING
//                  and grants nothing. Approve or reject them. This is the
//                  confirmation step, and where the seat cap actually bites.
//   4. ROSTER    — who is in, who is waiting, and removing people.
//
// Everything here is gated server-side by owns_calendar() inside the RPCs
// (lib/schema.sql). Whether this panel is drawn at all is a UI decision made from
// `isOwner` — that is not a security boundary and must never be treated as one.

import { useState, useEffect, useCallback } from 'react'
import type { Calendar, CalendarFeatures, CalendarMember } from '../types'
import { NO_FEATURES } from '../types'
import {
  listCalendars, listMembers, updateCalendar, deleteCalendar,
  approveMember, rejectMember,
} from './calendarService'
import {
  mintCalendarInvites, listCalendarInvites, revokeInvite,
  type MintedInvite, type CalendarInviteRecord,
} from '../invite/inviteService'
import { buildInviteUrl } from '../invite/inviteLink'
import {
  INVITE_LIFETIME_HOURS, INVITE_LIFETIME_OPTIONS,
  MIN_CALENDAR_SEATS, MAX_CALENDAR_SEATS, MAX_BULK_INVITES,
} from '../lib/config'

export interface CalendarAdminVM {
  calendar: Calendar | null
  loading:  boolean
  error:    string | null

  // ── Roster ────────────────────────────────────────────────────────────────
  // Split so the UI can lead with the queue: a pending member is the one thing
  // here that has somebody blocked, waiting on the owner.
  pending:  CalendarMember[]
  members:  CalendarMember[]      // approved
  busyId:   string | null         // uid currently being approved/rejected

  approve: (userId: string) => Promise<void>
  reject:  (userId: string, reopen: boolean) => Promise<void>

  // ── Seats ─────────────────────────────────────────────────────────────────
  seatsUsed: number
  seatsFree: number | null        // null = no cap
  isFull:    boolean

  // ── Bulk invites ──────────────────────────────────────────────────────────
  // The owner types names, one per line. Each becomes its own single-use QR — a
  // shared code would admit whoever forwarded it fastest and lock out the rest.
  names:     string; setNames: (v: string) => void
  nameList:  string[]             // parsed from `names`, for the count + validation
  canMint:   boolean
  minting:   boolean
  // Warn (don't refuse) when minting more than there are seats for: invites go
  // unused and get rejected, so reserving a seat per invite would be wrong.
  overSeats: boolean

  lifetimeHours: number | null; setLifetimeHours: (v: number | null) => void
  lifetimeOptions: typeof INVITE_LIFETIME_OPTIONS

  // The batch just minted — the QRs to show and hand out, one per person.
  fresh:        MintedInvite[]
  dismissFresh: () => void

  mint:    () => Promise<void>
  invites: CalendarInviteRecord[]
  revoke:  (code: string) => Promise<void>
  copyUrl: (code: string) => Promise<void>
  copied:  string | null

  // ── Settings ──────────────────────────────────────────────────────────────
  name:  string; setName:  (v: string) => void
  seats: number | null; setSeats: (v: number | null) => void

  // Optional features, the owner's choice. Turning any of them on is what makes
  // this "a sports calendar" — there is no separate site variant any more.
  //
  // Toggling one is a preference, not a permission: a result already recorded
  // stays in the event's data and stays visible to whoever could see that event.
  // Switching `scores` off hides the button, it does not retract anything.
  features:   CalendarFeatures
  setFeature: (key: keyof CalendarFeatures, on: boolean) => void

  canSave: boolean
  saving:  boolean
  save:    () => Promise<void>

  confirmDelete:    boolean; setConfirmDelete: (v: boolean) => void
  deleting:         boolean
  // Resolves true once the calendar is gone, so the caller can navigate home —
  // staying on the admin panel of a deleted calendar would be a dead screen.
  remove:           () => Promise<boolean>
}

const MIN_NAME  = 2
const COPIED_MS = 2000

// One name per line, blanks dropped. Deliberately permissive about what a name
// looks like ("Anna", "anna@work", "Dad") — it is a label the owner will
// recognise on a QR, not an identifier the system resolves against anything.
function parseNames(raw: string): string[] {
  return raw
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

export function useCalendarAdminVM(calendarId: string): CalendarAdminVM {
  const [calendar, setCalendar] = useState<Calendar | null>(null)
  const [members,  setMembers]  = useState<CalendarMember[]>([])
  const [invites,  setInvites]  = useState<CalendarInviteRecord[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [busyId,   setBusyId]   = useState<string | null>(null)

  const [names,         setNames]         = useState('')
  const [lifetimeHours, setLifetimeHours] = useState<number | null>(INVITE_LIFETIME_HOURS)
  const [minting,       setMinting]       = useState(false)
  const [fresh,         setFresh]         = useState<MintedInvite[]>([])
  const [copied,        setCopied]        = useState<string | null>(null)

  const [name,          setName]          = useState('')
  const [seats,         setSeats]         = useState<number | null>(null)
  const [features,      setFeatures]      = useState<CalendarFeatures>(NO_FEATURES)
  const [saving,        setSaving]        = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting,      setDeleting]      = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [cals, mem, inv] = await Promise.all([
      listCalendars(),
      listMembers(calendarId),
      listCalendarInvites(calendarId),
    ])
    const cal = cals.find(c => c.id === calendarId) ?? null
    setCalendar(cal)
    setMembers(mem)
    setInvites(inv)
    // Seed the settings form from the server's copy, so it always opens showing
    // what is actually stored rather than whatever was last typed.
    if (cal) { setName(cal.name); setSeats(cal.maxMembers); setFeatures(cal.features) }
    setLoading(false)
  }, [calendarId])

  useEffect(() => { refresh() }, [refresh])

  // ── Roster ──────────────────────────────────────────────────────────────────

  async function approve(userId: string) {
    setError(null)
    setBusyId(userId)
    try {
      // The seat cap is enforced in the database, not here: approving into a full
      // calendar comes back as an error carrying the numbers, which we surface.
      const errMsg = await approveMember(calendarId, userId)
      if (errMsg) { setError(errMsg); return }
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function reject(userId: string, reopen: boolean) {
    setError(null)
    setBusyId(userId)
    try {
      const errMsg = await rejectMember(calendarId, userId, reopen)
      if (errMsg) { setError(errMsg); return }
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  // ── Invites ─────────────────────────────────────────────────────────────────

  const nameList = parseNames(names)

  async function mint() {
    setError(null)
    if (nameList.length === 0) { setError('Name at least one person.'); return }
    if (nameList.length > MAX_BULK_INVITES) {
      setError(`That is more than ${MAX_BULK_INVITES} invites at once.`)
      return
    }

    setMinting(true)
    try {
      const { invites: minted, error: errMsg } =
        await mintCalendarInvites(calendarId, nameList, lifetimeHours)
      if (errMsg || minted.length === 0) {
        setError(errMsg ?? 'Could not create the invites.')
        return
      }
      setFresh(minted)
      setNames('')
      await refresh()
    } finally {
      setMinting(false)
    }
  }

  async function revoke(code: string) {
    setError(null)
    const errMsg = await revokeInvite(code)
    if (errMsg) { setError(errMsg); return }
    // If the revoked code is on screen in the fresh batch, take it down with it.
    setFresh(f => f.filter(i => i.code !== code))
    await refresh()
  }

  // The link is built from the code, by the same builder the QR uses — so what
  // gets pasted into a message and what gets scanned off the screen are the same
  // URL. A code that is still live always has one; a spent one has no code at all
  // (the server withholds it), so there is nothing to copy.
  async function copyUrl(code: string) {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(code))
      setCopied(code)
      setTimeout(() => setCopied(null), COPIED_MS)
    } catch {
      setError('Could not copy — your browser blocked clipboard access.')
    }
  }

  // ── Settings ────────────────────────────────────────────────────────────────

  async function save() {
    setError(null)
    const clean = name.trim()
    if (clean.length < MIN_NAME) { setError('Give the calendar a name.'); return }
    if (seats !== null && (seats < MIN_CALENDAR_SEATS || seats > MAX_CALENDAR_SEATS)) {
      setError(`The limit must be between ${MIN_CALENDAR_SEATS} and ${MAX_CALENDAR_SEATS}.`)
      return
    }

    setSaving(true)
    try {
      // The server refuses a cap below the current headcount — silently
      // un-approving people to satisfy a smaller number would be a surprising way
      // to lose access to your own calendar.
      const errMsg = await updateCalendar(calendarId, clean, seats, features)
      if (errMsg) { setError(errMsg); return }
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<boolean> {
    setError(null)
    setDeleting(true)
    try {
      const errMsg = await deleteCalendar(calendarId)
      if (errMsg) { setError(errMsg); return false }
      return true
    } finally {
      setDeleting(false)
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const approved  = members.filter(m => m.status === 'approved')
  const seatsUsed = approved.length
  const cap       = calendar?.maxMembers ?? null
  const seatsFree = cap === null ? null : Math.max(0, cap - seatsUsed)

  const featuresDirty = calendar !== null && (
    features.scores      !== calendar.features.scores ||
    features.leaderboard !== calendar.features.leaderboard ||
    features.challenges  !== calendar.features.challenges
  )
  const dirty = calendar !== null &&
    (name.trim() !== calendar.name || seats !== calendar.maxMembers || featuresDirty)

  return {
    calendar, loading, error,

    pending: members.filter(m => m.status === 'pending'),
    members: approved,
    busyId,
    approve, reject,

    seatsUsed,
    seatsFree,
    isFull: seatsFree !== null && seatsFree === 0,

    names, setNames,
    nameList,
    canMint:   nameList.length > 0 && nameList.length <= MAX_BULK_INVITES,
    minting,
    overSeats: seatsFree !== null && nameList.length > seatsFree,

    lifetimeHours, setLifetimeHours,
    lifetimeOptions: INVITE_LIFETIME_OPTIONS,

    fresh,
    dismissFresh: () => setFresh([]),

    mint, invites, revoke, copyUrl, copied,

    name, setName,
    seats, setSeats,

    features,
    setFeature: (key, on) => setFeatures(f => ({ ...f, [key]: on })),

    canSave: dirty && name.trim().length >= MIN_NAME,
    saving, save,

    confirmDelete, setConfirmDelete,
    deleting, remove,
  }
}

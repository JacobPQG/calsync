// ─── PollPanel ViewModel (ADR-19) ─────────────────────────────────────────────
// All logic for the day sidebar's poll section: which polls sit on the selected
// day, this user's ballot, the tally, and the create / vote / close / delete
// handlers. No JSX — the view (PollPanel.view.tsx) renders from what this returns.
//
// A "poll day" is one where an open poll has a candidate slot, or a closed poll's
// winner landed. The panel is only shown when there is something to show.

import { useMemo, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import type { Poll, PollVoteValue } from '../types'
import { isOverviewCalendar } from '../types'
import {
  tallyPoll, voterCount, myBallot, hasVoted, pollsOnDay,
  type OptionTally,
} from './pollLogic'
import { formatHour } from '../forms/timepicker/timeOptions'

// One option row as the view renders it: the tally plus this user's current mark.
export interface OptionRowVM extends OptionTally {
  label:  string          // "Wed 3 · 6:00 PM – 7:30 PM"
  myVote: PollVoteValue | null
}

// One poll as the view renders it.
export interface PollCardVM {
  id:        string
  title:     string
  status:    Poll['status']
  createdBy: string
  creatorName: string
  isMine:    boolean       // I created it (or own the calendar) → may close/delete
  iVoted:    boolean
  voters:    number
  options:   OptionRowVM[]
  chosenOptionId: string | null
  chosenEventId:  string | null
}

// A draft slot in the create-poll form.
export interface DraftSlot {
  key:       string        // stable react key
  date:      string
  startHour: number
  endHour:   number
}

export interface PollPanelVM {
  // Nothing to show → the view renders null. True when the selected day has at
  // least one poll OR the create form is open on it.
  visible:   boolean
  canManage: boolean       // a real calendar is open (not the overview/home)
  cards:     PollCardVM[]

  // The day new polls (and the caller's other actions) land on: the selected
  // day, or today when none is picked. `targetLabel` is its human form for the
  // action row ("today" / "Tue, Jul 15").
  targetDate:  string
  targetLabel: string

  // Create-poll form.
  creating:    boolean
  openCreate:  () => void
  closeCreate: () => void
  draftTitle:  string
  setDraftTitle: (t: string) => void
  draftSlots:  DraftSlot[]
  addSlot:     () => void
  removeSlot:  (key: string) => void
  updateSlot:  (key: string, patch: Partial<Omit<DraftSlot, 'key'>>) => void
  submitCreate: () => Promise<void>
  createError: string | null
  creatingBusy: boolean

  // Voting: a local, uncommitted ballot per poll until "Save votes" is pressed —
  // so a member can set several slots before one round trip.
  draftVote:   (pollId: string, optionId: string) => PollVoteValue | null
  setDraftVote: (pollId: string, optionId: string, value: PollVoteValue) => void
  saveVotes:   (pollId: string) => Promise<void>
  voteBusy:    string | null       // poll id currently saving, or null
  dirty:       (pollId: string) => boolean

  // Closing / deleting (creator or calendar owner only).
  closePoll:  (pollId: string, optionId: string, spawnEvent: boolean) => Promise<void>
  deletePoll: (pollId: string) => Promise<void>
  actionError: string | null
}

const CYCLE: PollVoteValue[] = ['yes', 'maybe', 'no']

function slotLabel(date: string, startHour: number, endHour: number): string {
  // "Wed 3" — kept short; the day is already the panel's context, but a poll's
  // slots can span several days, so each row still names its own.
  const d = new Date(`${date}T00:00:00`)
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
  return `${day} · ${formatHour(startHour)} – ${formatHour(endHour)}`
}

export function usePollPanelVM(): PollPanelVM {
  const {
    polls, selectedDate, activeUserId, users, calendars, activeCalendarId,
    createPoll, castVotes, closePoll: storeClose, deletePoll: storeDelete,
  } = useStore()

  const canManage = !!activeCalendarId && !isOverviewCalendar(activeCalendarId)

  const [creating, setCreating]       = useState(false)
  const [draftTitle, setDraftTitle]   = useState('')
  const [draftSlots, setDraftSlots]   = useState<DraftSlot[]>([])
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingBusy, setCreatingBusy] = useState(false)

  // pollId → { optionId → value } local uncommitted ballot, seeded from the
  // user's stored votes the first time a poll is touched.
  const [drafts, setDrafts] = useState<Record<string, Record<string, PollVoteValue>>>({})
  const [voteBusy, setVoteBusy]       = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const dayPolls = useMemo(
    () => (selectedDate ? pollsOnDay(polls, selectedDate) : []),
    [polls, selectedDate],
  )

  // Where a new poll's first slot goes: the selected day, falling back to today
  // so the panel works below the calendar even before a day is picked.
  const today      = new Date().toISOString().slice(0, 10)
  const targetDate = selectedDate ?? today
  const targetLabel = selectedDate && selectedDate !== today
    ? new Date(`${selectedDate}T00:00:00`)
        .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : 'today'

  const nameOf = useCallback(
    (id: string) => users.find(u => u.id === id)?.name ?? 'Someone',
    [users],
  )

  const ownsCalendar = useMemo(
    () => calendars.find(c => c.id === activeCalendarId)?.isOwner ?? false,
    [calendars, activeCalendarId],
  )

  const cards = useMemo<PollCardVM[]>(() => dayPolls.map(poll => {
    const stored = myBallot(poll, activeUserId)
    const draft  = drafts[poll.id]
    const tallies = tallyPoll(poll)
    return {
      id:        poll.id,
      title:     poll.title,
      status:    poll.status,
      createdBy: poll.createdBy,
      creatorName: nameOf(poll.createdBy),
      isMine:    poll.createdBy === activeUserId || ownsCalendar,
      iVoted:    hasVoted(poll, activeUserId),
      voters:    voterCount(poll),
      chosenOptionId: poll.chosenOptionId,
      chosenEventId:  poll.chosenEventId,
      options:   tallies.map(t => ({
        ...t,
        label:  slotLabel(t.option.date, t.option.startHour, t.option.endHour),
        // Show the uncommitted draft mark if the user is mid-edit, else the stored one.
        myVote: (draft ?? stored)[t.option.id] ?? null,
      })),
    }
  }), [dayPolls, drafts, activeUserId, nameOf, ownsCalendar])

  // ── Create form ────────────────────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setCreateError(null)
    setDraftTitle('')
    // Seed with one slot on the target day, a sensible default window.
    setDraftSlots(
      [{ key: crypto.randomUUID(), date: targetDate, startHour: 18, endHour: 19 }])
    setCreating(true)
  }, [targetDate])

  const closeCreate = useCallback(() => { setCreating(false); setCreateError(null) }, [])

  const addSlot = useCallback(() => {
    setDraftSlots(s => {
      const last = s[s.length - 1]
      return [...s, {
        key: crypto.randomUUID(),
        date: last?.date ?? targetDate,
        startHour: last?.startHour ?? 18,
        endHour: last?.endHour ?? 19,
      }]
    })
  }, [targetDate])

  const removeSlot = useCallback((key: string) => {
    setDraftSlots(s => s.filter(x => x.key !== key))
  }, [])

  const updateSlot = useCallback((key: string, patch: Partial<Omit<DraftSlot, 'key'>>) => {
    setDraftSlots(s => s.map(x => {
      if (x.key !== key) return x
      const next = { ...x, ...patch }
      // Keep end after start — nudge end forward if a start change would invert it.
      if (next.endHour <= next.startHour) next.endHour = Math.min(24, next.startHour + 0.5)
      return next
    }))
  }, [])

  const submitCreate = useCallback(async () => {
    setCreateError(null)
    if (!draftTitle.trim()) { setCreateError('Give the poll a title.'); return }
    if (draftSlots.length === 0) { setCreateError('Add at least one time slot.'); return }
    setCreatingBusy(true)
    const res = await createPoll(
      draftTitle,
      draftSlots.map(s => ({ date: s.date, startHour: s.startHour, endHour: s.endHour })),
    )
    setCreatingBusy(false)
    if (res.error) { setCreateError(res.error); return }
    setCreating(false)
  }, [draftTitle, draftSlots, createPoll])

  // ── Voting ───────────────────────────────────────────────────────────────

  const draftVote = useCallback((pollId: string, optionId: string): PollVoteValue | null => {
    const poll = polls.find(p => p.id === pollId)
    const stored = poll ? myBallot(poll, activeUserId) : {}
    return (drafts[pollId] ?? stored)[optionId] ?? null
  }, [drafts, polls, activeUserId])

  const setDraftVote = useCallback((pollId: string, optionId: string, value: PollVoteValue) => {
    setDrafts(d => {
      const poll = polls.find(p => p.id === pollId)
      const base = d[pollId] ?? (poll ? myBallot(poll, activeUserId) : {})
      return { ...d, [pollId]: { ...base, [optionId]: value } }
    })
  }, [polls, activeUserId])

  const dirty = useCallback((pollId: string) => {
    const draft = drafts[pollId]
    if (!draft) return false
    const poll = polls.find(p => p.id === pollId)
    const stored = poll ? myBallot(poll, activeUserId) : {}
    const keys = new Set([...Object.keys(draft), ...Object.keys(stored)])
    for (const k of keys) if (draft[k] !== stored[k]) return true
    return false
  }, [drafts, polls, activeUserId])

  const saveVotes = useCallback(async (pollId: string) => {
    const ballot = drafts[pollId]
    if (!ballot) return
    setActionError(null)
    setVoteBusy(pollId)
    const err = await castVotes(pollId, ballot)
    setVoteBusy(null)
    if (err) { setActionError(err); return }
    // Committed — drop the local draft so the card reflects stored state again.
    setDrafts(d => {
      const rest = { ...d }
      delete rest[pollId]
      return rest
    })
  }, [drafts, castVotes])

  // ── Close / delete ─────────────────────────────────────────────────────────

  const closePoll = useCallback(async (pollId: string, optionId: string, spawnEvent: boolean) => {
    setActionError(null)
    const err = await storeClose(pollId, optionId, spawnEvent)
    if (err) setActionError(err)
  }, [storeClose])

  const deletePoll = useCallback(async (pollId: string) => {
    setActionError(null)
    const err = await storeDelete(pollId)
    if (err) setActionError(err)
  }, [storeDelete])

  return {
    visible: canManage && (dayPolls.length > 0 || creating),
    canManage,
    cards,
    targetDate, targetLabel,
    creating, openCreate, closeCreate,
    draftTitle, setDraftTitle,
    draftSlots, addSlot, removeSlot, updateSlot,
    submitCreate, createError, creatingBusy,
    draftVote, setDraftVote, saveVotes, voteBusy, dirty,
    closePoll, deletePoll, actionError,
  }
}

// Re-export so the view can cycle a vote without importing the constant twice.
export function nextVote(current: PollVoteValue | null): PollVoteValue {
  if (current === null) return 'yes'
  const i = CYCLE.indexOf(current)
  return CYCLE[(i + 1) % CYCLE.length]
}

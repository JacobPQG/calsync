// ─── ClaimScreen ViewModel ────────────────────────────────────────────────────
// Drives what happens when someone opens a QR invite link (#invite=<code>).
//
// The screen has one job and three outcomes, decided by the server:
//
//   open      → "Hi <name>" — set a password, pick an icon, done. The username
//               is pre-filled from the name the admin typed, so the invitee
//               types as little as possible.
//   claimed   → the QR has already made its account. It degrades to a plain
//               sign-in prompt: the link still opens the site (as requested),
//               it just can no longer create anything.
//   invalid   → unknown/revoked code. Say so and get out of the way.
//
// The status is NEVER decided here. lookup_invite() decides, redeem_invite()
// enforces, and this VM only renders the answer.

import { useState, useEffect, useCallback } from 'react'
import { useAuthSession }  from '../auth/useAuth'
import { useStore }        from '../store/useStore'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { identifierError, passwordError, normalizeUsername, toDisplayHandle } from '../auth/credentials'
import { lookupInvite, redeemInvite, joinAsGuest, type InviteStatus } from './inviteService'
import { readInviteCode, clearInviteFromUrl } from './inviteLink'
import { log } from '../lib/log'

// 'loading' covers the lookup round trip; 'done' is the post-signup screen.
export type ClaimPhase = 'loading' | InviteStatus | 'done'

export interface ClaimScreenVM {
  phase:       ClaimPhase
  inviteeName: string | null      // who the admin addressed this invite to

  // The calendar this invite leads into, when it is a CALENDAR invite (ADR-12).
  // Null on a SITE invite, which creates an account and nothing more.
  calendarName: string | null

  // TRUE when someone who is ALREADY SIGNED IN scans a calendar QR. There is no
  // account to create — they just need joining to the calendar. One tap, no form.
  // This is the other half of "one QR does both": the same code works whether or
  // not the scanner has been here before.
  joinOnly: boolean
  join:     () => Promise<void>

  // ── Guest links (ADR-18) ───────────────────────────────────────────────────
  // The Doodle path: this is the calendar's shared GROUP link. The form is a
  // display name + icon — no username, no password, nothing to remember.
  isGuestLink: boolean
  guestName:   string; setGuestName: (v: string) => void
  // TRUE when a signed-in PASSWORD account opened a guest link. Guest links only
  // mint guests; the screen explains and offers nothing else (the owner can send
  // them a personal invite).
  guestBlocked: boolean
  submitGuest:  (e: React.FormEvent) => Promise<void>

  username: string; setUsername: (v: string) => void
  password: string; setPassword: (v: string) => void
  avatarId: string | null; setAvatarId: (v: string) => void

  error:      string | null
  submitting: boolean
  submit:     (e: React.FormEvent) => Promise<void>

  // Dismiss the screen and drop #invite= from the address bar.
  dismiss: () => void
}

// Turn the admin's free-text name ("Anna Bell") into a legal username ("anna-bell").
// Only a suggestion — the invitee can overwrite it, and the server has the final
// say via the unique constraint on users.username.
function suggestUsername(name: string | null): string {
  if (!name) return ''
  return normalizeUsername(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
}

export function useClaimScreenVM(onClose: () => void): ClaimScreenVM {
  const auth  = useAuthSession()
  const store = useStore()

  const [code,         setCode]         = useState<string | null>(null)
  const [phase,        setPhase]        = useState<ClaimPhase>('loading')
  const [inviteeName,  setInviteeName]  = useState<string | null>(null)
  const [calendarName, setCalendarName] = useState<string | null>(null)
  const [isCalendar,   setIsCalendar]   = useState(false)
  const [isGuestLink,  setIsGuestLink]  = useState(false)
  const [guestName,    setGuestName]    = useState('')
  const [username,     setUsername]     = useState('')
  const [password,     setPassword]     = useState('')
  const [avatarId,     setAvatarId]     = useState<string | null>(null)
  const [error,        setError]        = useState<string | null>(null)
  const [submitting,   setSubmitting]   = useState(false)

  // Ask the server about the code in the URL, once, on mount.
  useEffect(() => {
    const found = readInviteCode()
    if (!found) { setPhase('invalid'); return }
    setCode(found)

    let cancelled = false
    lookupInvite(found).then(({ status, inviteeName: name, calendarId, calendarName: cal, isGuestLink: guest }) => {
      if (cancelled) return
      setPhase(status)
      setInviteeName(name)
      setCalendarName(cal)
      setIsCalendar(calendarId !== null)
      setIsGuestLink(guest)
      setUsername(suggestUsername(name))
    })
    return () => { cancelled = true }
  }, [])

  // Already signed in, and this is a calendar invite → nothing to create, just
  // join. The account exists; only the membership is missing. Guest links are
  // NOT this path: they never redeem, and a password account cannot use one.
  const joinOnly = isCalendar && auth.isAuthenticated && !isGuestLink

  // A signed-in PASSWORD account holding the group's guest link. join_as_guest
  // would refuse them anyway (the anonymous-session check); this just says so
  // before they type anything. An existing GUEST session is fine — re-joining
  // their calendar is idempotent server-side.
  const guestBlocked = isGuestLink && auth.isAuthenticated && !auth.isGuest

  // The guest path (ADR-18), in the order the comments in db/schema/50_invites.sql
  // assume: anonymous session → own profile row → join_as_guest. The profile row
  // is created client-side through the same store call the signup flow uses, so
  // guests get the same data shape and palette colors as everyone else; the
  // server then flags it is_guest (a column no client can write) and takes the
  // seat. On success the app drops the guest straight into the calendar — there
  // is nothing else their account can see.
  async function submitGuest(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!code) { setError('This invite link is malformed.'); return }
    const name = guestName.trim()
    if (name.length < 2)  { setError('Enter your name — it is how the group will see you.'); return }
    if (name.length > 60) { setError('That name is too long.'); return }
    if (!avatarId) { setError('Pick an icon.'); return }

    setSubmitting(true)
    try {
      const { userId, error: authErr } = await auth.signInAnonymously()
      if (authErr)  { setError(authErr); return }
      if (!userId)  { setError('Could not start a guest session.'); return }

      // Idempotent on re-tap: an existing guest already has a profile row.
      if (!store.users.some(u => u.id === userId)) {
        try {
          await store.createAuthUser(userId, name, undefined, avatarId)
        } catch (err) {
          log.error('invite', 'guest profile insert failed', err)
          setError('Could not save your name — try again.')
          return
        }
      }

      const { calendarId, error: joinErr } = await joinAsGuest(code)
      if (joinErr || !calendarId) {
        setError(joinErr ?? 'Could not join the calendar.')
        return
      }

      await auth.refreshApproval()          // picks up is_guest
      store.setActiveUser(userId)
      clearInviteFromUrl()
      setPhase('done')
      // Land inside the calendar the link is for — a guest has no other view.
      await store.openCalendar(calendarId)
    } finally {
      setSubmitting(false)
    }
  }

  // Redeem the code against the existing session. redeem_invite joins the caller
  // to the calendar as PENDING — a valid QR gets you to the door, not through it.
  // The owner still has to approve.
  async function join() {
    setError(null)
    if (!code) { setError('This invite link is malformed.'); return }

    setSubmitting(true)
    try {
      const errMsg = await redeemInvite(code)
      if (errMsg) { setError(errMsg); return }
      clearInviteFromUrl()
      setPhase('done')
    } finally {
      setSubmitting(false)
    }
  }

  const dismiss = useCallback(() => {
    clearInviteFromUrl()
    onClose()
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!code) { setError('This invite link is malformed.'); return }
    if (!avatarId) { setError('Pick an icon.'); return }
    const uErr = identifierError(username); if (uErr) { setError(uErr); return }
    const pErr = passwordError(password); if (pErr) { setError(pErr); return }

    setSubmitting(true)
    try {
      const { userId, error: errMsg } = await auth.signUp({
        inviteCode: code, username, password,
      })
      if (errMsg)  { setError(errMsg); return }
      if (!userId) { setError('Sign-up failed — no user id returned.'); return }

      // Profile row: display name is the name the admin gave (it's what other
      // people will recognise), with the chosen avatar as the icon.
      //
      // The stored handle is toDisplayHandle(), NOT the raw identifier: if the
      // user signed up with an email, only its local part is kept. Their address
      // is a credential, and must never end up rendered beside their events.
      const handle = toDisplayHandle(username)
      const name   = inviteeName?.trim() || handle
      try {
        await store.createAuthUser(userId, name, handle, avatarId)
      } catch (err) {
        // The auth account and the redeemed invite both exist now, but the
        // profile row did not land — the account can log in yet has no identity
        // and can see nothing. Surface it instead of reaching 'done': a silent
        // failure here is exactly the half-created account this guards against.
        log.error('invite', 'profile row insert failed after sign-up', err)
        setError('Your account was created but your profile could not be saved. Sign in and try again, or ask the administrator.')
        return
      }

      // The code is spent now. Drop it from the URL so a refresh — or a
      // screenshot of this very page — cannot reopen the claim flow.
      clearInviteFromUrl()
      setPhase('done')
    } finally {
      setSubmitting(false)
    }
  }

  return {
    phase, inviteeName, calendarName,
    joinOnly, join,
    isGuestLink, guestName, setGuestName, guestBlocked, submitGuest,
    username, setUsername,
    password, setPassword,
    avatarId, setAvatarId,
    error, submitting, submit,
    dismiss,
  }
}

// ── Sign-in on a spent QR ─────────────────────────────────────────────────────
// A claimed invite still opens the site, so the claim screen offers sign-in
// directly rather than bouncing the user to another modal. Same credentials, same
// hook — this just wires the store's profile bookkeeping the way AuthModal does.
export function useClaimSignIn(onDone: () => void) {
  const auth  = useAuthSession()
  const store = useStore()

  const [username,   setUsername]   = useState('')
  const [password,   setPassword]   = useState('')
  const [error,      setError]      = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const errMsg = await auth.signIn(username, password)
      if (errMsg) { setError(errMsg); return }
      if (!SUPABASE_ENABLED) { onDone(); return }

      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user.id
      if (!uid) { onDone(); return }

      if (store.users.some(u => u.id === uid)) store.setActiveUser(uid)
      else log.warn('invite', 'signed-in account has no profile row')

      await auth.refreshApproval()
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return { username, setUsername, password, setPassword, error, submitting, submit }
}

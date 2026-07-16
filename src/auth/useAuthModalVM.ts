// ─── AuthModal ViewModel ──────────────────────────────────────────────────────
// State + submit orchestration for the sign-in modal (identifier + password).
// The identifier is whatever the account was created with — a username or an
// email address; credentials.ts decides which and derives the auth email.
//
// SIGN-UP LIVES ELSEWHERE. Accounts are created only by claiming a QR invite
// (invite/ClaimScreen) — that is what makes an invite one-shot and lets it carry
// the invitee's name. This modal therefore signs in and nothing else; the old
// "create an account" tab is gone, and with it the invite-code text field.
//
// LEGACY SIGN-IN: accounts created before ADR-9 have a password of
// `<secret word>:<memory image>`. They cannot restate that under the new scheme,
// so the modal offers an optional image picker; when one is chosen, useAuth
// retries with the old derivation. New accounts never need it.
//
// This wraps the lower-level auth hook (useAuthSession) and the store; the view
// never calls Supabase or the store directly.

import { useState } from 'react'
import { useAuthSession }      from './useAuth'
import { useStore }            from '../store/useStore'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { identifierError, toDisplayHandle } from './credentials'
import { log } from '../lib/log'

export interface AuthModalVM {
  // Bound fields.
  username: string; setUsername: (v: string) => void
  password: string; setPassword: (v: string) => void

  // Legacy escape hatch for pre-ADR-9 accounts.
  showLegacy:    boolean; setShowLegacy: (v: boolean) => void
  legacyImageId: string | null; setLegacyImageId: (v: string) => void

  error:      string | null
  submitting: boolean
  submit:     (e: React.FormEvent) => Promise<void>
}

export function useAuthModalVM(onClose: () => void): AuthModalVM {
  const auth  = useAuthSession()
  const store = useStore()

  const [username,      setUsername]      = useState('')
  const [password,      setPassword]      = useState('')
  const [showLegacy,    setShowLegacy]    = useState(false)
  const [legacyImageId, setLegacyImageId] = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [submitting,    setSubmitting]    = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const uErr = identifierError(username)
    if (uErr) { setError(uErr); return }
    if (password.length === 0) { setError('Enter your password.'); return }

    setSubmitting(true)
    try {
      // Pass the legacy image only when the user actually opened that section —
      // otherwise a stale selection would trigger a pointless second round trip.
      const errMsg = await auth.signIn(
        username, password,
        showLegacy && legacyImageId ? legacyImageId : undefined,
      )
      if (errMsg) { setError(errMsg); return }
      if (!SUPABASE_ENABLED) { onClose(); return }

      // auth state updates async — read the session directly for the uid.
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user.id
      if (!uid) { onClose(); return }

      // The profile row is created when the invite is claimed. If it is missing,
      // this is a pre-existing account whose row never landed — recreate it
      // rather than leaving the user with no identity in the UI. If that
      // recreate also fails (e.g. RLS rejects the insert), stay on the modal
      // with the reason rather than closing onto an identity-less session.
      const name = toDisplayHandle(username)
      if (!store.users.some(u => u.id === uid)) {
        try {
          await store.createAuthUser(uid, name, name)
        } catch (err) {
          log.error('auth', 'profile row insert failed on sign-in', err)
          setError('Signed in, but your profile could not be loaded. Try again, or ask the administrator.')
          return
        }
      } else {
        store.setActiveUser(uid)
      }

      await auth.refreshApproval()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return {
    username, setUsername,
    password, setPassword,
    showLegacy, setShowLegacy,
    legacyImageId, setLegacyImageId,
    error, submitting, submit,
  }
}

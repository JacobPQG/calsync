// ─── AuthModal ViewModel ──────────────────────────────────────────────────────
// All state + submit orchestration for the anonymous sign-in / sign-up modal
// (username + secret word + memory image, invite-gated sign-up). The view
// (AuthModal.view.tsx) binds to these fields and renders per `mode`.
//
// This wraps the lower-level auth hook (useAuthSession) and the store; the view
// never calls Supabase or the store directly.

import { useState } from 'react'
import { useAuthSession }      from './useAuth'
import { useStore }            from '../store/useStore'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { usernameError, secretWordError, normalizeUsername } from './credentials'

export type AuthMode = 'signin' | 'signup' | 'pending'

export interface AuthModalVM {
  mode:        AuthMode
  switchMode:  () => void          // toggles signin ⇄ signup, clears errors

  // Bound fields.
  inviteCode:  string; setInviteCode:  (v: string) => void
  username:    string; setUsername:    (v: string) => void
  secretWord:  string; setSecretWord:  (v: string) => void
  confirmWord: string; setConfirmWord: (v: string) => void
  imageId:     string | null; setImageId: (v: string) => void

  error:       string | null
  submitting:  boolean
  submit:      (e: React.FormEvent) => Promise<void>

  // For the "pending approval" screen.
  normalizedUsername: string
}

export function useAuthModalVM(onClose: () => void): AuthModalVM {
  const auth  = useAuthSession()
  const store = useStore()

  const [mode,        setMode]        = useState<AuthMode>('signin')
  const [inviteCode,  setInviteCode]  = useState('')
  const [username,    setUsername]    = useState('')
  const [secretWord,  setSecretWord]  = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [imageId,     setImageId]     = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [submitting,  setSubmitting]  = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!imageId) { setError('Pick your memory image.'); return }
    const uErr = usernameError(username); if (uErr) { setError(uErr); return }
    const wErr = secretWordError(secretWord); if (wErr) { setError(wErr); return }

    setSubmitting(true)
    if (mode === 'signup') await handleSignUp(imageId)
    else                   await handleSignIn(imageId)
    setSubmitting(false)
  }

  async function handleSignIn(img: string) {
    const errMsg = await auth.signIn(username, secretWord, img)
    if (errMsg) { setError(errMsg); return }
    if (!SUPABASE_ENABLED) { onClose(); return }

    // auth state updates async — read the session directly for the uid.
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user.id
    if (!uid) { onClose(); return }

    // Ensure a CalSync profile exists (normally created at sign-up).
    const name = normalizeUsername(username)
    const existing = store.users.find(u => u.id === uid)
    if (!existing) await store.createAuthUser(uid, name, name)
    else           store.setActiveUser(uid)

    await auth.refreshApproval()
    onClose()
  }

  async function handleSignUp(img: string) {
    if (inviteCode.trim().length === 0) { setError('An invite code is required.'); return }
    if (secretWord !== confirmWord)     { setError('Secret words do not match.');  return }

    const { userId, error: errMsg } = await auth.signUp({
      inviteCode: inviteCode.trim(), username, secretWord, imageId: img,
    })
    if (errMsg)  { setError(errMsg); return }
    if (!userId) { setError('Sign-up failed — no user id returned.'); return }

    // Create the profile row (id = auth.uid() so RLS ownership works).
    const name = normalizeUsername(username)
    await store.createAuthUser(userId, name, name)

    setMode('pending')   // account exists but unapproved
  }

  return {
    mode,
    switchMode: () => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) },
    inviteCode,  setInviteCode,
    username,    setUsername,
    secretWord,  setSecretWord,
    confirmWord, setConfirmWord,
    imageId,     setImageId,
    error,
    submitting,
    submit,
    normalizedUsername: normalizeUsername(username),
  }
}

// ─── AuthModal ────────────────────────────────────────────────────────────────
// Sign-in / Sign-up modal. Handles two flows:
//
//   Sign in  — email + password → Supabase auth → set active user in store
//              If the user has no CalSync profile yet, one is created from their email.
//
//   Sign up  — email + password + display name → Supabase auth → create CalSync
//              User record with id = auth.uid() (required for RLS policies).
//
// The modal closes itself on success. On error, it shows the message from
// Supabase (e.g. "Invalid login credentials", "Email already in use").

import { useState, FormEvent } from 'react'
import { useAuthSession }    from './useAuth'
import { useStore }          from '../store/useStore'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'

interface Props {
  onClose: () => void
}

type Mode = 'signin' | 'signup'

export function AuthModal({ onClose }: Props) {
  const auth  = useAuthSession()
  const store = useStore()

  const [mode,        setMode]        = useState<Mode>('signin')
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error,       setError]       = useState<string | null>(null)
  const [submitting,  setSubmitting]  = useState(false)

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    if (mode === 'signup') {
      await handleSignUp()
    } else {
      await handleSignIn()
    }

    setSubmitting(false)
  }

  async function handleSignIn() {
    const errMsg = await auth.signIn(email, password)
    if (errMsg) { setError(errMsg); return }

    // auth.userId updates asynchronously via onAuthStateChange, so we read the
    // uid directly from the Supabase session to use it immediately here.
    if (!SUPABASE_ENABLED) { onClose(); return }

    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user.id
    if (!uid) { onClose(); return }

    // Ensure this user has a CalSync profile. If they signed up outside the
    // app (e.g. directly via Supabase dashboard), create one automatically.
    const existing = store.users.find(u => u.id === uid)
    if (!existing) {
      const name = email.split('@')[0]  // derive name from email prefix
      await store.createAuthUser(uid, name)
    } else {
      store.setActiveUser(uid)
    }

    onClose()
  }

  async function handleSignUp() {
    if (displayName.trim().length < 2) {
      setError('Display name must be at least 2 characters.')
      return
    }

    const { userId, error: errMsg } = await auth.signUp(email, password)
    if (errMsg) { setError(errMsg); return }
    if (!userId) { setError('Sign-up succeeded but no user ID was returned.'); return }

    // Create the CalSync user record. id = auth.uid() is required so that the
    // RLS policy "auth.uid()::text = id" allows this user to write their own rows.
    await store.createAuthUser(userId, displayName.trim())
    onClose()
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-xl shadow-xl"
        style={{ background: 'var(--bg-surface)' }}
      >

        {/* Header */}
        <div
          className="flex items-center px-5 py-4"
          style={{ borderBottom: '0.5px solid var(--border)' }}
        >
          <h2 className="flex-1 font-semibold text-sm" style={{ color: 'var(--text)' }}>
            {mode === 'signin' ? 'Sign in to CalSync' : 'Create an account'}
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none"
            style={{ color: 'var(--text-muted)' }}
          >×</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          <div>
            <label className="field-label">Email</label>
            <input
              type="email"
              className="field-input"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="field-label">Password</label>
            <input
              type="password"
              className="field-input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {/* Display name shown only on sign-up */}
          {mode === 'signup' && (
            <div>
              <label className="field-label">Display name</label>
              <input
                type="text"
                className="field-input"
                placeholder="Your name (shown on the calendar)"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
              />
            </div>
          )}

          {/* Error message */}
          {error && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#fff5f5', color: '#dc2626' }}>
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--accent)' }}
          >
            {submitting
              ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
              : (mode === 'signin' ? 'Sign in' : 'Create account')}
          </button>

          {/* Mode toggle */}
          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
              className="font-medium underline"
              style={{ color: 'var(--accent)' }}
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}

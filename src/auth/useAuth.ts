// ─── Auth hook ────────────────────────────────────────────────────────────────
// Wraps Supabase Auth and exposes a stable interface identical to the old stub.
// When SUPABASE_ENABLED is false the hook returns no-op values so the rest of
// the app compiles and runs without any env vars configured.
//
// Supabase auth flow used here: email + password (simplest, no OAuth setup).
// To add Google/GitHub OAuth, replace signIn/signUp with:
//   supabase.auth.signInWithOAuth({ provider: 'google' })
// The hook interface doesn't need to change.

import { useState, useEffect } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'

export interface AuthSession {
  isAuthenticated: boolean
  isLoading:       boolean          // true during initial session check
  userId:          string | null    // Supabase auth.uid() — used as CalSync user ID
  email:           string | null

  // Returns null on success, error message string on failure.
  signIn:  (email: string, password: string) => Promise<string | null>

  // Returns the new user's UUID on success (used to create the CalSync profile).
  signUp:  (email: string, password: string) => Promise<{ userId: string | null; error: string | null }>

  signOut: () => Promise<void>
}

export function useAuthSession(): AuthSession {
  const [user,       setUser]       = useState<SupabaseUser | null>(null)
  // Start as loading only when Supabase is configured — otherwise we know
  // immediately that there's no session.
  const [authLoading, setAuthLoading] = useState(SUPABASE_ENABLED)

  useEffect(() => {
    if (!SUPABASE_ENABLED) return

    // Check for an existing session on mount (e.g. returning visitor).
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setAuthLoading(false)
    })

    // Keep the local state in sync with any auth-state changes (sign-in from
    // another tab, token refresh, sign-out, etc.).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function signIn(email: string, password: string): Promise<string | null> {
    if (!SUPABASE_ENABLED) return 'Supabase is not configured (see .env.example).'
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error?.message ?? null
  }

  async function signUp(
    email: string,
    password: string,
  ): Promise<{ userId: string | null; error: string | null }> {
    if (!SUPABASE_ENABLED)
      return { userId: null, error: 'Supabase is not configured (see .env.example).' }
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { userId: data.user?.id ?? null, error: error?.message ?? null }
  }

  async function signOut(): Promise<void> {
    if (!SUPABASE_ENABLED) return
    await supabase.auth.signOut()
  }

  return {
    isAuthenticated: !!user,
    isLoading:       authLoading,
    userId:          user?.id   ?? null,
    email:           user?.email ?? null,
    signIn,
    signUp,
    signOut,
  }
}

// ─── Auth hook ────────────────────────────────────────────────────────────────
// Wraps Supabase Auth behind CalSync's anonymous credential scheme
// (username + secret word + memory image — see credentials.ts). When
// SUPABASE_ENABLED is false the hook returns inert values so the app runs
// in localStorage mode with no env vars configured.
//
// Approval flow: new accounts exist but are NOT approved. RLS blocks all
// data access until the admin flips users.approved in the dashboard. The
// hook exposes `approved` so the UI can show a "pending approval" state.

import { useState, useEffect, useCallback } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { log } from '../lib/log'
import { toAccountEmail, derivePassword } from './credentials'

export interface SignUpInput {
  inviteCode: string
  username:   string
  secretWord: string
  imageId:    string
}

export interface AuthSession {
  isAuthenticated: boolean
  isLoading:       boolean            // true during initial session check
  userId:          string | null      // Supabase auth.uid() — doubles as CalSync user id
  username:        string | null      // derived from the synthetic email
  approved:        boolean | null     // null = unknown / not signed in

  // Returns null on success, or a human-readable error message.
  signIn: (username: string, secretWord: string, imageId: string) => Promise<string | null>

  // Returns the new auth uid on success (needed to create the profile row).
  signUp: (input: SignUpInput) => Promise<{ userId: string | null; error: string | null }>

  signOut:         () => Promise<void>
  refreshApproval: () => Promise<void>
}

// Map raw Supabase auth errors to messages that make sense for a
// username+word scheme (the user never sees the synthetic email).
function friendlyAuthError(raw: string): string {
  if (/invalid login credentials/i.test(raw)) {
    return 'Wrong username, secret word, or image.'
  }
  if (/already registered/i.test(raw)) {
    return 'That username is already taken.'
  }
  if (/rate limit|too many/i.test(raw)) {
    return 'Too many attempts — wait a minute and try again.'
  }
  return raw
}

async function fetchApproved(uid: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('users').select('approved').eq('id', uid).maybeSingle()
  if (error) {
    log.warn('auth', 'could not read approval status', error.message)
    return null
  }
  return (data as { approved?: boolean } | null)?.approved ?? false
}

export function useAuthSession(): AuthSession {
  const [user,        setUser]        = useState<SupabaseUser | null>(null)
  const [approved,    setApproved]    = useState<boolean | null>(null)
  const [authLoading, setAuthLoading] = useState(SUPABASE_ENABLED)

  useEffect(() => {
    if (!SUPABASE_ENABLED) return

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setAuthLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Keep the approval flag in sync with the signed-in user.
  useEffect(() => {
    if (!SUPABASE_ENABLED || !user) { setApproved(null); return }
    fetchApproved(user.id).then(setApproved)
  }, [user])

  const refreshApproval = useCallback(async () => {
    if (SUPABASE_ENABLED && user) setApproved(await fetchApproved(user.id))
  }, [user])

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function signIn(username: string, secretWord: string, imageId: string): Promise<string | null> {
    if (!SUPABASE_ENABLED) return 'Supabase is not configured (see .env.example).'
    const { error } = await supabase.auth.signInWithPassword({
      email:    toAccountEmail(username),
      password: derivePassword(secretWord, imageId),
    })
    if (error) log.warn('auth', 'sign-in failed')  // no username in logs
    return error ? friendlyAuthError(error.message) : null
  }

  async function signUp(
    { inviteCode, username, secretWord, imageId }: SignUpInput,
  ): Promise<{ userId: string | null; error: string | null }> {
    if (!SUPABASE_ENABLED)
      return { userId: null, error: 'Supabase is not configured (see .env.example).' }

    // 1. Pre-validate the invite code so we don't create orphan auth users.
    const { data: valid, error: vErr } = await supabase.rpc('validate_invite', { invite: inviteCode })
    if (vErr) {
      log.error('auth', 'validate_invite RPC failed', vErr.message)
      return { userId: null, error: 'Could not verify the invite code — try again.' }
    }
    if (!valid) return { userId: null, error: 'Invalid or already-used invite code.' }

    // 2. Create the auth account with derived credentials.
    const { data, error } = await supabase.auth.signUp({
      email:    toAccountEmail(username),
      password: derivePassword(secretWord, imageId),
    })
    if (error)      return { userId: null, error: friendlyAuthError(error.message) }
    if (!data.user) return { userId: null, error: 'Sign-up succeeded but no user was returned.' }
    if (!data.session) {
      // Happens when "Confirm email" is still enabled in Supabase — synthetic
      // addresses can never confirm, so surface it clearly.
      return {
        userId: null,
        error:  'Server misconfiguration: email confirmation must be disabled in Supabase Auth settings.',
      }
    }

    // 3. Burn the invite code server-side (SECURITY DEFINER stamps it onto
    //    the profile so the admin can see which code created this account).
    const { data: redeemed, error: rErr } = await supabase.rpc('redeem_invite', { invite: inviteCode })
    if (rErr || !redeemed) {
      log.error('auth', 'redeem_invite failed for new account', rErr?.message ?? 'code not redeemable')
      // Account exists but unproven — it stays unapproved; tell the user.
      return { userId: null, error: 'Invite code could not be redeemed. Contact the administrator.' }
    }

    return { userId: data.user.id, error: null }
  }

  async function signOut(): Promise<void> {
    if (!SUPABASE_ENABLED) return
    await supabase.auth.signOut()
  }

  return {
    isAuthenticated: !!user,
    isLoading:       authLoading,
    userId:          user?.id ?? null,
    username:        user?.email?.split('@')[0] ?? null,
    approved,
    signIn,
    signUp,
    signOut,
    refreshApproval,
  }
}

// ─── Auth hook ────────────────────────────────────────────────────────────────
// Wraps Supabase Auth behind CalSync's anonymous credential scheme
// (username + password — see credentials.ts). When SUPABASE_ENABLED is false the
// hook returns inert values so the app runs in localStorage mode with no env
// vars configured.
//
// Approval flow: new accounts exist but are NOT approved. RLS blocks all
// data access until the admin flips users.approved in the dashboard. The
// hook exposes `approved` so the UI can show a "pending approval" state.
//
// Sign-up is invite-gated and now happens through the QR claim screen
// (invite/ClaimScreen): the code is validated, the account created, and the code
// redeemed — atomically single-use, so the same QR can never make a second
// account. See ADR-9 / ADR-10 and db/schema/50_invites.sql.

import { useState, useEffect, useCallback } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { log } from '../lib/log'
import { toAccountEmail, toDisplayHandle, legacyPassword } from './credentials'

export interface SignUpInput {
  inviteCode: string
  username:   string
  password:   string
}

export interface AuthSession {
  isAuthenticated: boolean
  isLoading:       boolean            // true during initial session check
  userId:          string | null      // Supabase auth.uid() — doubles as CalSync user id
  username:        string | null      // handle only — never a full email address
  approved:        boolean | null     // null = unknown / not signed in

  // `username` here is the IDENTIFIER as typed: a username, or an email address
  // if the account was created with one. credentials.ts derives the auth email.
  //
  // Returns null on success, or a human-readable error message.
  // `legacyImageId` is only for pre-ADR-9 accounts whose password was
  // `word:image`; the sign-in form offers it as an optional fallback.
  signIn: (username: string, password: string, legacyImageId?: string) => Promise<string | null>

  // Returns the new auth uid on success (needed to create the profile row).
  signUp: (input: SignUpInput) => Promise<{ userId: string | null; error: string | null }>

  signOut:         () => Promise<void>
  refreshApproval: () => Promise<void>
}

// Map raw Supabase auth errors to messages that make sense for an
// identifier+password scheme (a username user never sees the synthetic email).
function friendlyAuthError(raw: string): string {
  if (/invalid login credentials/i.test(raw)) {
    return 'Wrong username or password.'
  }
  if (/already registered/i.test(raw)) {
    return 'That username is already taken.'
  }
  if (/rate limit|too many/i.test(raw)) {
    return 'Too many attempts — wait a minute and try again.'
  }
  // Supabase rejects reserved-TLD domains (.invalid/.test/.example). If this
  // fires for a username signup, VITE_ACCOUNT_DOMAIN is set to one of them.
  if (/email address.*invalid|invalid.*email/i.test(raw)) {
    return 'That address was rejected. If you entered an email, check it; otherwise VITE_ACCOUNT_DOMAIN is not a usable domain.'
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

  // Sign in with username + password.
  //
  // Legacy fallback: accounts created before ADR-9 hashed `<word>:<imageId>`, a
  // password the user cannot restate under the new scheme. If the modern attempt
  // is rejected AND the caller supplied a legacy image, we retry with the old
  // derivation. Only the *rejection* path retries, so a correct modern password
  // never costs a second round trip, and a wrong one costs at most one.
  //
  // This is additive: it can only let in someone who knows the old word AND the
  // old image — exactly the pair that already worked.
  async function signIn(
    username: string, password: string, legacyImageId?: string,
  ): Promise<string | null> {
    if (!SUPABASE_ENABLED) return 'Supabase is not configured (see .env.example).'
    const email = toAccountEmail(username)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) return null

    if (legacyImageId) {
      const { error: legacyErr } = await supabase.auth.signInWithPassword({
        email, password: legacyPassword(password, legacyImageId),
      })
      if (!legacyErr) {
        log.debug('auth', 'signed in via legacy credential scheme')
        return null
      }
    }

    log.warn('auth', 'sign-in failed')  // no username, no password, in logs
    return friendlyAuthError(error.message)
  }

  async function signUp(
    { inviteCode, username, password }: SignUpInput,
  ): Promise<{ userId: string | null; error: string | null }> {
    if (!SUPABASE_ENABLED)
      return { userId: null, error: 'Supabase is not configured (see .env.example).' }

    // 1. Pre-validate the invite code so we don't create orphan auth users.
    //    This is a courtesy check only — redeem_invite (step 3) is the atomic
    //    gate that actually enforces single use.
    const { data: valid, error: vErr } = await supabase.rpc('validate_invite', { invite: inviteCode })
    if (vErr) {
      log.error('auth', 'validate_invite RPC failed', vErr.message)
      return { userId: null, error: 'Could not verify the invite code — try again.' }
    }
    if (!valid) return { userId: null, error: 'This invite has already been used.' }

    // 2. Create the auth account.
    const { data, error } = await supabase.auth.signUp({ email: toAccountEmail(username), password })
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

    // 3. Burn the invite code server-side. This is THE single-use gate: the
    //    UPDATE inside redeem_invite matches `used_by is null`, so if two people
    //    scan the same QR at once exactly one UPDATE finds a row and the other
    //    gets false. It also stamps the code onto the profile, so the admin can
    //    see which invite produced which account.
    const { data: redeemed, error: rErr } = await supabase.rpc('redeem_invite', { invite: inviteCode })
    if (rErr || !redeemed) {
      log.error('auth', 'redeem_invite failed for new account', rErr?.message ?? 'code not redeemable')
      // The auth account now exists but holds no redeemed invite, so it will
      // never be approved — it is inert, not a backdoor. Still, say so plainly.
      return {
        userId: null,
        error:  'That invite was already claimed by someone else. Ask the administrator for a new one.',
      }
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
    username:        user?.email ? toDisplayHandle(user.email) : null,
    approved,
    signIn,
    signUp,
    signOut,
    refreshApproval,
  }
}

// ─── Invite service ───────────────────────────────────────────────────────────
// The only module that talks to the invite RPCs (lookup / mint / revoke / list).
// Same boundary discipline as store/storage.ts: callers get typed results and a
// friendly error string, never a PostgrestError and never raw SQL state.
//
// Every function here is a thin wrapper over a SECURITY DEFINER function in
// db/schema/50_invites.sql. The security lives there — admin gating, single-use redemption,
// what a spent code may disclose. This file must not re-implement any of it, and
// must not be trusted to: a browser is not a policy enforcement point.

import { supabase, SUPABASE_ENABLED } from '../lib/supabase'
import { log } from '../lib/log'
import { buildInviteUrl } from './inviteLink'
import type { MemberStatus } from '../types'

// ── Claim-side ────────────────────────────────────────────────────────────────

// Mirrors lookup_invite()'s `status`.
//   'claimed' — the QR still opens the site, but can no longer create an account.
//   'expired' — past its lifetime. As unusable as 'invalid'; a separate status
//               only so the UI can explain *why* rather than say "not valid".
export type InviteStatus = 'open' | 'claimed' | 'expired' | 'invalid' | 'unavailable'

const SERVER_STATUSES = new Set<string>(['open', 'claimed', 'expired'])

export interface InviteLookup {
  status: InviteStatus
  // Present only for an 'open' invite — the name the admin typed when minting.
  inviteeName: string | null

  // The calendar this invite leads into, when it is a CALENDAR invite (ADR-12).
  // Both null on a SITE invite, which creates an account and nothing more.
  //
  // The distinction drives the claim screen: a calendar invite says "Anna, join
  // Five-a-side", a site invite just says "Anna, welcome". Disclosed only for a
  // live invite — a spent or expired code says nothing about where it led.
  calendarId:   string | null
  calendarName: string | null
}

const UNAVAILABLE: InviteLookup = {
  status: 'unavailable', inviteeName: null, calendarId: null, calendarName: null,
}

// Ask the server what this code is. Called on page load when #invite= is present.
//
// 'unavailable' (rather than 'invalid') is returned when we could not ask — no
// backend configured, or the RPC failed. The distinction is deliberate: telling
// someone their invite is INVALID when the network merely hiccuped would send
// them back to the admin for a fresh QR they never needed.
export async function lookupInvite(code: string): Promise<InviteLookup> {
  if (!SUPABASE_ENABLED) return UNAVAILABLE

  const { data, error } = await supabase.rpc('lookup_invite', { invite: code })
  if (error) {
    log.error('invite', 'lookup_invite failed', error.message)   // never log the code
    return UNAVAILABLE
  }

  // The function returns a one-row table.
  const row = (data as {
    status: string
    invitee_name:  string | null
    calendar_id:   string | null
    calendar_name: string | null
  }[] | null)?.[0]
  if (!row) return UNAVAILABLE

  // Anything the server doesn't recognise collapses to 'invalid' — fail closed.
  const status: InviteStatus =
    SERVER_STATUSES.has(row.status) ? (row.status as InviteStatus) : 'invalid'

  return {
    status,
    inviteeName:  row.invitee_name  ?? null,
    calendarId:   row.calendar_id   ?? null,
    calendarName: row.calendar_name ?? null,
  }
}

// ── Admin-side ────────────────────────────────────────────────────────────────

export interface InviteRecord {
  // null unless the invite is still live — the server withholds the code of a
  // spent, expired or revoked invite, since it can never be used again.
  code:        string | null
  inviteeName: string | null
  active:      boolean
  claimed:     boolean
  expired:     boolean
  createdAt:   string
  expiresAt:   string | null     // null = never expires

  // The claim, when there is one. This is the admin confirmation step: a claimed
  // invite whose `approved` is false is an account waiting on you.
  claimedBy:   string | null     // auth uid
  claimedName: string | null     // the username they chose
  claimedAt:   string | null
  approved:    boolean | null    // null when unclaimed
}

// An invite that has produced an account which is still waiting on the admin.
export function isAwaitingConfirmation(rec: InviteRecord): boolean {
  return rec.claimed && rec.approved === false
}

// Is the signed-in account an administrator? Drives whether the admin UI exists
// at all. This is a UI convenience only — mint/revoke/list each re-check
// is_admin() server-side, so faking this flag in the browser buys nothing.
export async function isAdmin(): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false
  const { data, error } = await supabase.rpc('is_admin')
  if (error) {
    log.warn('invite', 'is_admin check failed', error.message)
    return false
  }
  return data === true
}

// Create a named invite. Returns the fresh code, or an error message.
// `lifetimeHours` of null means the code never expires — an explicit opt-out
// from the safety default, never a fallback.
export async function mintInvite(
  inviteeName:   string,
  lifetimeHours: number | null,
): Promise<{ code: string | null; error: string | null }> {
  if (!SUPABASE_ENABLED) {
    return { code: null, error: 'Supabase is not configured (see .env.example).' }
  }

  const { data, error } = await supabase.rpc('mint_invite', {
    invitee: inviteeName, lifetime_hours: lifetimeHours,
  })
  if (error) {
    log.error('invite', 'mint_invite failed', error.message)
    return { code: null, error: friendlyInviteError(error.message) }
  }
  if (typeof data !== 'string' || data.length === 0) {
    return { code: null, error: 'The server did not return an invite code.' }
  }
  return { code: data, error: null }
}

export async function revokeInvite(code: string): Promise<string | null> {
  if (!SUPABASE_ENABLED) return 'Supabase is not configured.'
  const { error } = await supabase.rpc('revoke_invite', { invite: code })
  if (error) {
    log.error('invite', 'revoke_invite failed', error.message)
    return friendlyInviteError(error.message)
  }
  return null
}

export async function listInvites(): Promise<InviteRecord[]> {
  if (!SUPABASE_ENABLED) return []

  const { data, error } = await supabase.rpc('list_invites')
  if (error) {
    log.error('invite', 'list_invites failed', error.message)
    return []
  }

  return (data as {
    code: string | null; invitee_name: string | null
    active: boolean; claimed: boolean; expired: boolean
    created_at: string; expires_at: string | null
    claimed_by: string | null; claimed_name: string | null
    claimed_at: string | null; approved: boolean | null
  }[]).map(r => ({
    code:        r.code,
    inviteeName: r.invitee_name,
    active:      r.active,
    claimed:     r.claimed,
    expired:     r.expired,
    createdAt:   r.created_at,
    expiresAt:   r.expires_at,
    claimedBy:   r.claimed_by,
    claimedName: r.claimed_name,
    claimedAt:   r.claimed_at,
    approved:    r.approved,
  }))
}

// ═══ Calendar invites (ADR-12) ════════════════════════════════════════════════
// The same code mechanism, scoped to one calendar and minted by that calendar's
// OWNER rather than a site admin. Owning the calendar is the authority — an owner
// needs no site-admin rights to invite people into their own calendar.

// A freshly minted calendar invite: one code per person named.
export interface MintedInvite {
  code:        string
  inviteeName: string
  url:         string       // the QR payload, built by inviteLink.buildInviteUrl
}

// The invite roster for one calendar, as its owner sees it.
export interface CalendarInviteRecord {
  code:        string | null   // null once spent/expired/revoked — it has no further use
  inviteeName: string | null
  active:      boolean
  claimed:     boolean
  expired:     boolean
  createdAt:   string
  expiresAt:   string | null

  claimedBy:   string | null
  claimedName: string | null
  claimedAt:   string | null
  // The membership the claim produced. 'pending' means this person is waiting on
  // the owner — the confirmation step. null when the invite is unclaimed.
  joinedStatus: MemberStatus | null
}

// BULK MINT — the feature as asked for: name the people, get one QR each.
//
// One code PER NAME, never one code for the group. A shared code is a bearer
// token that admits whoever forwards it fastest, and single-use would then lock
// everyone else out with no explanation. Separate codes also mean revoking one
// person's invite leaves everyone else's working.
//
// Not capped at the calendar's free seats on purpose: an invite is not a seat
// (people ignore them, get rejected, let them expire). The cap is enforced at
// APPROVAL, where a seat is actually taken. The panel warns when you mint more
// than you have room for — a warning, not a refusal.
export async function mintCalendarInvites(
  calendarId:    string,
  inviteeNames:  string[],
  lifetimeHours: number | null,
): Promise<{ invites: MintedInvite[]; error: string | null }> {
  if (!SUPABASE_ENABLED) {
    return { invites: [], error: 'Supabase is not configured (see .env.example).' }
  }

  const { data, error } = await supabase.rpc('mint_calendar_invites', {
    cal_id: calendarId, invitees: inviteeNames, lifetime_hours: lifetimeHours,
  })
  if (error) {
    log.error('invite', 'mint_calendar_invites failed', error.message)
    return { invites: [], error: friendlyInviteError(error.message) }
  }

  const rows = (data as { code: string; invitee_name: string }[] | null) ?? []
  if (rows.length === 0) {
    return { invites: [], error: 'The server did not return any invite codes.' }
  }

  return {
    invites: rows.map(r => ({
      code:        r.code,
      inviteeName: r.invitee_name,
      url:         buildInviteUrl(r.code),
    })),
    error: null,
  }
}

// The invite roster for one calendar. Owner-only, enforced server-side.
export async function listCalendarInvites(
  calendarId: string,
): Promise<CalendarInviteRecord[]> {
  if (!SUPABASE_ENABLED) return []

  const { data, error } = await supabase.rpc('list_calendar_invites', {
    cal_id: calendarId,
  })
  if (error) {
    log.error('invite', `list_calendar_invites failed (cal=${calendarId})`, error.message)
    return []
  }

  return (data as {
    code: string | null; invitee_name: string | null
    active: boolean; claimed: boolean; expired: boolean
    created_at: string; expires_at: string | null
    claimed_by: string | null; claimed_name: string | null
    claimed_at: string | null; joined_status: string | null
  }[]).map(r => ({
    code:         r.code,
    inviteeName:  r.invitee_name,
    active:       r.active,
    claimed:      r.claimed,
    expired:      r.expired,
    createdAt:    r.created_at,
    expiresAt:    r.expires_at,
    claimedBy:    r.claimed_by,
    claimedName:  r.claimed_name,
    claimedAt:    r.claimed_at,
    // Fail closed on anything unrecognised: 'pending' grants nothing, 'approved'
    // grants everything, so an unreadable status must land on the former.
    joinedStatus: r.joined_status == null
      ? null
      : (r.joined_status === 'approved' ? 'approved' : 'pending'),
  }))
}

// Redeem a code for an account that ALREADY EXISTS — an existing user scanning a
// calendar QR. Joins them to the calendar as *pending*.
//
// The signup path (auth.signUp) redeems the code itself, as part of creating the
// account. This is the other half: the same one-scan flow for someone who already
// has an account and is merely being added to a new calendar.
export async function redeemInvite(code: string): Promise<string | null> {
  if (!SUPABASE_ENABLED) return 'Supabase is not configured.'

  const { data, error } = await supabase.rpc('redeem_invite', { invite: code })
  if (error) {
    log.error('invite', 'redeem_invite failed', error.message)
    return friendlyInviteError(error.message)
  }
  if (data !== true) {
    return 'That invite has already been used, or it has expired.'
  }
  return null
}

// ── Confirming a claim ────────────────────────────────────────────────────────
// These flip users.approved, which is the flag RLS has always gated on. They are
// the in-app equivalent of editing it in the Supabase Dashboard — not a new
// privilege, just a reachable one. Both re-check is_admin() server-side.

export async function approveClaim(userId: string): Promise<string | null> {
  if (!SUPABASE_ENABLED) return 'Supabase is not configured.'
  const { error } = await supabase.rpc('approve_claim', { user_id: userId })
  if (error) {
    log.error('invite', 'approve_claim failed', error.message)
    return friendlyInviteError(error.message)
  }
  return null
}

// `reopen` puts the invite back into play so the same person can be re-sent the
// SAME QR. Sharp edge: any existing photo of that code goes live again — which
// is why it is opt-in, and why the panel asks before doing it.
export async function rejectClaim(
  userId: string, reopen: boolean,
): Promise<string | null> {
  if (!SUPABASE_ENABLED) return 'Supabase is not configured.'
  const { error } = await supabase.rpc('reject_claim', { user_id: userId, reopen })
  if (error) {
    log.error('invite', 'reject_claim failed', error.message)
    return friendlyInviteError(error.message)
  }
  return null
}

// Postgres RAISE EXCEPTION text surfaces as the message. The messages the schema
// raises are already written for a human, so pass those through; generalize
// anything else rather than leaking SQL internals into the UI.
function friendlyInviteError(raw: string): string {
  if (/only the calendar owner/i.test(raw))
    return 'Only the calendar’s owner may do that.'
  if (/administrator/i.test(raw))                 return 'Only an administrator may do that.'
  if (/invitee name|invite lifetime/i.test(raw))  return raw
  if (/at least one person|at most 100/i.test(raw)) return raw
  return 'That did not work — try again.'
}

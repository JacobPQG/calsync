// ─── InvitePanel ViewModel ────────────────────────────────────────────────────
// The admin side, two jobs:
//
//   1. MINT — type a name, pick how long the QR stays valid, get a QR.
//   2. CONFIRM — when someone claims a QR, their account exists but is inert
//      (users.approved = false, which RLS has always gated on). The panel lists
//      those pending claims so the admin can Approve or Reject them without
//      opening the Supabase Dashboard. That is the confirmation step.
//
// Everything here is gated server-side by is_admin() inside the RPCs
// (db/schema/50_invites.sql). The `isAdmin` flag in useAppVM only decides whether to draw
// the panel — it is not a security boundary and must never be treated as one.

import { useState, useEffect, useCallback } from 'react'
import {
  mintInvite, listInvites, revokeInvite, approveClaim, rejectClaim,
  isAwaitingConfirmation, type InviteRecord,
} from './inviteService'
import { buildInviteUrl } from './inviteLink'
import { INVITE_LIFETIME_HOURS, INVITE_LIFETIME_OPTIONS } from '../lib/config'

export interface InvitePanelVM {
  name: string; setName: (v: string) => void
  canMint: boolean

  // How long a newly minted QR stays claimable. null = never expires.
  lifetimeHours: number | null; setLifetimeHours: (v: number | null) => void
  lifetimeOptions: typeof INVITE_LIFETIME_OPTIONS

  // The invite just minted — the QR to show right now.
  freshUrl:  string | null
  freshName: string | null

  // Claims waiting on the admin, split out of `invites` so the UI can lead with
  // them: an unconfirmed account is the one thing here that blocks someone.
  pending: InviteRecord[]
  invites: InviteRecord[]

  loading: boolean
  error:   string | null
  minting: boolean
  busyId:  string | null      // uid of the claim currently being approved/rejected

  mint:    (e: React.FormEvent) => Promise<void>
  revoke:  (code: string) => Promise<void>
  approve: (userId: string) => Promise<void>
  reject:  (userId: string, reopen: boolean) => Promise<void>

  showQr:  (rec: InviteRecord) => void
  copyUrl: (code: string) => Promise<void>
  copied:  string | null

  dismissFresh: () => void
}

const MIN_NAME  = 2
const COPIED_MS = 2000

export function useInvitePanelVM(): InvitePanelVM {
  const [name,      setName]      = useState('')
  const [lifetimeHours, setLifetimeHours] = useState<number | null>(INVITE_LIFETIME_HOURS)
  const [freshUrl,  setFreshUrl]  = useState<string | null>(null)
  const [freshName, setFreshName] = useState<string | null>(null)
  const [invites,   setInvites]   = useState<InviteRecord[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [minting,   setMinting]   = useState(false)
  const [busyId,    setBusyId]    = useState<string | null>(null)
  const [copied,    setCopied]    = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setInvites(await listInvites())
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function mint(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const clean = name.trim()
    if (clean.length < MIN_NAME) { setError('Enter the invitee’s name.'); return }

    setMinting(true)
    try {
      const { code, error: errMsg } = await mintInvite(clean, lifetimeHours)
      if (errMsg || !code) { setError(errMsg ?? 'Could not create the invite.'); return }

      setFreshUrl(buildInviteUrl(code))
      setFreshName(clean)
      setName('')
      await refresh()
    } finally {
      setMinting(false)
    }
  }

  async function revoke(code: string) {
    const errMsg = await revokeInvite(code)
    if (errMsg) { setError(errMsg); return }
    // If the revoked code is the one on screen, take the QR down with it.
    if (freshUrl?.includes(code)) { setFreshUrl(null); setFreshName(null) }
    await refresh()
  }

  async function approve(userId: string) {
    setError(null)
    setBusyId(userId)
    try {
      const errMsg = await approveClaim(userId)
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
      const errMsg = await rejectClaim(userId, reopen)
      if (errMsg) { setError(errMsg); return }
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function copyUrl(code: string) {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(code))
      setCopied(code)
      setTimeout(() => setCopied(null), COPIED_MS)
    } catch {
      setError('Could not copy — your browser blocked clipboard access.')
    }
  }

  return {
    name, setName,
    canMint: name.trim().length >= MIN_NAME,
    lifetimeHours, setLifetimeHours,
    lifetimeOptions: INVITE_LIFETIME_OPTIONS,
    freshUrl, freshName,
    pending: invites.filter(isAwaitingConfirmation),
    invites,
    loading, error, minting, busyId,
    mint, revoke, approve, reject,
    showQr: rec => {
      if (!rec.code) return          // spent/expired invites have no code to show
      setFreshUrl(buildInviteUrl(rec.code))
      setFreshName(rec.inviteeName)
    },
    copyUrl, copied,
    dismissFresh: () => { setFreshUrl(null); setFreshName(null) },
  }
}

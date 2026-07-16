// ─── Supabase connection status ───────────────────────────────────────────────
// Pings Supabase once on mount with a lightweight HEAD query so the header can
// show a live/local/error badge. Pure logic — the badge's colours/labels live
// in the view (App.view.tsx).
//
//   'local'      — env vars absent; app is in localStorage-only mode
//   'connecting' — ping in flight
//   'ok'         — Supabase is REACHABLE and the anon key is accepted
//   'error'      — configured but unreachable / anon key rejected
//
// What the badge actually claims is "the backend is reachable and our API
// credentials are valid" — nothing about the signed-in user's data access.
//
// So an RLS/permission response is NOT an error. The probe hits `users`, which
// is RLS-gated to `authenticated`; on mount the visitor is usually anonymous,
// so the row read is denied — and PostgREST's exact-count path surfaces that
// denial in `error`. The OLD code mapped that straight to 'error', painting the
// pill red on a perfectly healthy connection where login works fine.
//
// The connection is proven the moment the server RESPONDS AT ALL. Only two
// things are real failures: the request never completing (network/DNS — the
// caught path), or the anon key itself being rejected (a 401 / JWT error, which
// means the URL+key in the env are wrong). Everything else is 'ok'.

import { useState, useEffect } from 'react'
import { supabase, SUPABASE_ENABLED } from './supabase'
import { IS_DEMO } from '../demo/demoMode'

// 'demo' — the landing page's live demo: in-memory sample data, no backend at
// all, nothing saved. Distinct from 'local' so the badge never claims a
// visitor's clicking is being stored anywhere.
export type ConnStatus = 'local' | 'demo' | 'connecting' | 'ok' | 'error'

// A PostgREST error that means "the anon key/JWT is not accepted" — i.e. the
// credentials in the env are wrong, which the badge should flag. RLS row denials
// do NOT land here: they come back as an ordinary permission/empty result, not a
// bad-key rejection. Codes/status per PostgREST + GoTrue.
function isBadCredentialError(error: { code?: string; status?: number; message?: string }): boolean {
  if (error.status === 401) return true
  // PGRST301 = JWT invalid/expired; 42501 with no JWT context is plain RLS, so
  // we key off the auth-layer signals only.
  return error.code === 'PGRST301' || /jwt|api key|invalid.*token/i.test(error.message ?? '')
}

export function useConnectionStatus(): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>(
    IS_DEMO ? 'demo' : SUPABASE_ENABLED ? 'connecting' : 'local')
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    supabase.from('users').select('id', { head: true })
      .then(({ error }) => {
        // No error, or an RLS/permission error → the server answered, so we are
        // connected. Only a rejected anon key counts as a connection failure.
        setStatus(error && isBadCredentialError(error) ? 'error' : 'ok')
      })
      .catch(() => setStatus('error'))  // request never completed: network/DNS
  }, [])
  return status
}

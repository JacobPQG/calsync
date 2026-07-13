// ─── Supabase connection status ───────────────────────────────────────────────
// Pings Supabase once on mount with a lightweight HEAD query so the header can
// show a live/local/error badge. Pure logic — the badge's colours/labels live
// in the view (App.view.tsx).
//
//   'local'      — env vars absent; app is in localStorage-only mode
//   'connecting' — ping in flight
//   'ok'         — Supabase responded without error
//   'error'      — configured but unreachable / credentials wrong

import { useState, useEffect } from 'react'
import { supabase, SUPABASE_ENABLED } from './supabase'

export type ConnStatus = 'local' | 'connecting' | 'ok' | 'error'

export function useConnectionStatus(): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>(SUPABASE_ENABLED ? 'connecting' : 'local')
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    supabase.from('users').select('id', { count: 'exact', head: true })
      .then(({ error }) => setStatus(error ? 'error' : 'ok'))
      .catch(() => setStatus('error'))
  }, [])
  return status
}

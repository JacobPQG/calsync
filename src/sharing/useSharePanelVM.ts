// ─── SharePanel ViewModel ─────────────────────────────────────────────────────
// Logic for "who may see my availability": loads current grants and toggles
// them (each toggle is a row in `shares`; RLS then reveals/hides my events).

import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import * as storage from '../store/storage'
import type { User } from '../types'

export interface SharePanelVM {
  others:   User[]                 // approved members other than me
  loading:  boolean                // grantee list still loading
  isShared: (userId: string) => boolean
  busyId:   string | null          // toggle in flight
  toggle:   (userId: string) => Promise<void>
}

export function useSharePanelVM(myUserId: string): SharePanelVM {
  const users  = useStore(s => s.users)
  const others = users.filter(u => u.id !== myUserId)

  const [grantees, setGrantees] = useState<Set<string> | null>(null)  // null = loading
  const [busyId,   setBusyId]   = useState<string | null>(null)

  useEffect(() => {
    storage.loadMyGrantees(myUserId).then(ids => setGrantees(new Set(ids)))
  }, [myUserId])

  async function toggle(granteeId: string) {
    if (!grantees || busyId) return
    setBusyId(granteeId)
    const shared = grantees.has(granteeId)
    const ok = shared
      ? await storage.removeShare(myUserId, granteeId)
      : await storage.addShare(myUserId, granteeId)
    if (ok) {
      const next = new Set(grantees)
      if (shared) next.delete(granteeId)
      else        next.add(granteeId)
      setGrantees(next)
    }
    setBusyId(null)
  }

  return {
    others,
    loading:  grantees === null,
    isShared: (id) => grantees?.has(id) ?? false,
    busyId,
    toggle,
  }
}

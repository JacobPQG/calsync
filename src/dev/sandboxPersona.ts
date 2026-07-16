// ─── Sandbox persona ──────────────────────────────────────────────────────────
// WHO the sandbox signs you in as. Two positions:
//
//   'member' — the fixture's full account ("You"): owns a calendar, can create
//              more, sees Manage. The default, and the sandbox's behaviour
//              before this switch existed.
//   'guest'  — the fixture's guest (ADR-18), who joined a calendar through its
//              guest link without ever signing in. Selecting it reproduces the
//              whole guest experience: the "Guest · Sign out" header, the
//              permanent-sign-out warning, a home view scoped to the one joined
//              calendar, and no calendar creation.
//
// Kept separate from devMode.ts (which is the Live/Sandbox backend switch and
// deliberately nothing more) and from sandboxStore.ts, because auth/useAuth.ts
// imports THIS module statically to present the simulated guest session. It must
// therefore stay free of fixture data — persona ids are the only constants here,
// and the seeded users/calendars stay behind sandboxStore's guarded dynamic
// import (see devMode.ts).
//
// Same resolve-once-and-reload contract as devMode: consumers (sandboxStore's
// SANDBOX_ME, the auth session) read the persona at import time, so switching it
// reloads the page rather than mutating in place.

import { IS_SANDBOX } from './devMode'
import { saveActiveUserId } from '../store/storage'

export type SandboxPersona = 'member' | 'guest'

const KEY = 'calsync:sandbox:persona'

// Ids of the SEED_USERS (sandboxStore.ts) each persona is signed in as — keep
// in sync with that fixture.
export const SANDBOX_MEMBER_ID = 'sandbox-you'
export const SANDBOX_GUEST_ID  = 'sandbox-gus'

function readStored(): SandboxPersona {
  try {
    return localStorage.getItem(KEY) === 'guest' ? 'guest' : 'member'
  } catch {
    // Private browsing / storage disabled — the default persona, not an error.
    return 'member'
  }
}

// `IS_SANDBOX &&`-style gating: outside the sandbox this is pinned to 'member'
// and localStorage is never read.
export const SANDBOX_PERSONA: SandboxPersona = IS_SANDBOX ? readStored() : 'member'

export const SANDBOX_IS_GUEST: boolean = IS_SANDBOX && SANDBOX_PERSONA === 'guest'

// The user id the whole sandbox acts as — sandboxStore re-exports it as
// SANDBOX_ME, so calendars, membership and polls all follow the persona.
export const SANDBOX_USER_ID: string =
  SANDBOX_IS_GUEST ? SANDBOX_GUEST_ID : SANDBOX_MEMBER_ID

// Switch persona and reload — see the module header for why a reload.
export function setSandboxPersona(persona: SandboxPersona): void {
  if (!IS_SANDBOX) return
  try {
    localStorage.setItem(KEY, persona)
  } catch {
    // Without storage the choice cannot persist a reload; nothing useful to do.
  }
  // Who posts events must move in lock-step with whose session this is — every
  // switch path (the Dev panel, the guest persona's sign-out) lands here, so the
  // re-point lives here and not with any one caller. Synchronous; the reload
  // below cannot outrun it.
  saveActiveUserId(persona === 'guest' ? SANDBOX_GUEST_ID : SANDBOX_MEMBER_ID)
  window.location.reload()
}

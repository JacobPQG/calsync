// ─── Demo mode service ────────────────────────────────────────────────────────
// The PRODUCTION-SAFE cousin of dev/devMode.ts: the switch behind the public
// landing page (src/landing/). In demo mode the whole app runs against an
// IN-MEMORY fixture (demoWorld.ts / demoPolls.ts) — no Supabase, no
// localStorage, no persistence of any kind. Every interaction (a new event, a
// poll, a vote) is real UI over fake data; a reload discards all of it and the
// demo starts from its seed again. That ephemerality is the contract the
// landing page advertises, so do not "improve" it by persisting anything.
//
// HOW IT DIFFERS FROM THE SANDBOX
// --------------------------------
//   sandbox (dev/)  — local development only, double-gated so it is stripped
//                     from production bundles; persists to localStorage so a
//                     developer's clicking survives a reload.
//   demo (here)     — ships in the production bundle on purpose (it IS the
//                     landing page's product tour); in-memory so a visitor's
//                     clicking does NOT survive a reload.
//
// WHEN IS THE DEMO ACTIVE
// -----------------------
// Resolved ONCE at module load, like DEV_MODE — every service boundary
// (supabase client, storage, calendar/poll services) reads the flag at import
// time, so it must not change mid-session. Entering/leaving the demo reloads.
//
//   • Explicitly: the page was opened on <site>/#demo — the shareable link.
//   • Automatically: Supabase credentials are configured (a real deployment),
//     but nobody is signed in in this browser, the URL carries no other hash
//     payload (#invite= / #share=), and the visitor has not left the demo this
//     session. New visitors therefore land on the demo; account holders (a
//     Supabase session token is present) go straight to the app.
//
// SECURITY: nothing here grants anything. Demo mode REMOVES the backend
// (lib/supabase.ts forces SUPABASE_ENABLED false, exactly as the sandbox does)
// — it is the absence of Supabase, not a bypass of its rules.

import { IS_SANDBOX } from '../dev/devMode'
// The shareable landing-page URL fragment (<site>/#demo) lives in lib/config —
// dev/devMode.ts needs it too, and importing it from here would be a cycle.
import { DEMO_HASH } from '../lib/config'

// sessionStorage, deliberately not localStorage: leaving the demo should stick
// for this visit (no redirect loop after "Sign in"), but a fresh visit later
// should land on the demo again — it is the front door, not a one-time tour.
const OPTED_OUT_KEY = 'calsync:demo:optedOut'

// Same direct import.meta.env read as dev/devMode.ts, for the same reason: this
// is a mode-resolution module, not a component (components go through lib/config).
const HAS_CREDENTIALS: boolean = !!(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Is somebody signed in in this browser? supabase-js keeps its session under
// `sb-<project-ref>-auth-token`; the key is removed on sign-out. A HEURISTIC,
// not an auth check: if the pattern ever changes, a signed-in visitor merely
// lands on the demo once and leaves it with one click ("Sign in") — degraded,
// never wrong about any permission.
function hasSupabaseSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && /^sb-.+-auth-token$/.test(k)) return true
    }
  } catch { /* storage off — treat as signed out */ }
  return false
}

function optedOut(): boolean {
  try { return sessionStorage.getItem(OPTED_OUT_KEY) === 'true' } catch { return false }
}

function resolveDemo(): boolean {
  if (window.location.hash === DEMO_HASH) return true
  // Auto-entry only on a hash-less arrival: #invite= must reach the claim
  // screen and #share= the merge path, never the demo.
  return HAS_CREDENTIALS
    && window.location.hash === ''
    && !hasSupabaseSession()
    && !optedOut()
}

// The sandbox wins when both could apply (local dev with test mode): it is the
// developer's explicit backend choice, and the two fixtures must never mix.
// One exception, made on the sandbox's side (ADR-23): an explicit #demo
// arrival makes IS_SANDBOX yield for that page load — the dev panel's
// landing-page preview — so this resolves true. Either way exactly one of the
// two fixtures is active.
export const IS_DEMO: boolean = !IS_SANDBOX && resolveDemo()

// Leave the demo for the real app — the landing page's "Sign in" / "Open the
// app" action. The reload is the point, not a shortcut: every consumer resolved
// IS_DEMO at import time (see dev/devMode.setDevMode for the full argument).
export function exitDemo(): void {
  try { sessionStorage.setItem(OPTED_OUT_KEY, 'true') } catch { /* storage off */ }
  window.location.hash = ''
  window.location.reload()
}

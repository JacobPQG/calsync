// ─── Dev mode service ─────────────────────────────────────────────────────────
// Which backend does this browser talk to? A LOCAL DEVELOPMENT concern only.
//
//   'live'    — the real Supabase project named in .env.local. Every gate
//               (approval, admin, calendar membership, RLS) is enforced in
//               Postgres and behaves exactly as it will in production.
//
//   'sandbox' — no backend at all. Storage falls back to localStorage and the
//               app seeds itself with fake users, calendars and events so the UI
//               can be exercised instantly with zero database setup.
//
// WHY A HARD SWITCH, AND NOT AN "ACT AS ADMIN" FLAG
// -------------------------------------------------
// There is no client-side way to "pretend to be approved" against a real
// Supabase project. Approval, ownership and event visibility are enforced by RLS
// and SECURITY DEFINER functions in Postgres (see db/schema/); the browser is
// not a policy enforcement point and cannot overrule them. A flag that merely
// made the client BELIEVE it was approved would draw every button and then have
// every RPC refused by the server — worse than useless, because it would look
// like a bug in the app rather than the intended refusal.
//
// So the honest options are: be genuinely approved in the database (see
// docs/supabase.md — one UPDATE), or run with no database. This module is the
// switch between those two, and nothing more. It grants no privilege it does not
// already have; in 'live' mode it changes NOTHING about what the server permits.
//
// SAFETY
// ------
// Double-gated. `import.meta.env.DEV` is false in any production build, and
// VITE_TEST_MODE is set only by the start-*.bat launchers, never by deploy/CI.
// With either absent, DEV_TOOLS is false, the mode is pinned to 'live', and this
// module is inert — a shipped bundle cannot enter sandbox mode even if the
// localStorage key is present, because the getter never reads it.

export type DevMode = 'live' | 'sandbox'

// The single condition under which any of this is available at all.
//
// Written as a direct `import.meta.env` conjunction rather than via
// siteConfig.TEST_MODE so that Vite can STATICALLY FOLD it. In a production
// build `import.meta.env.DEV` is replaced with the literal `false`, this whole
// expression collapses to `false`, and every `if (DEV_TOOLS)` / `if (IS_SANDBOX)`
// branch below becomes dead code the minifier deletes — taking the sandbox
// fixture (fake users, calendars, events) out of the shipped bundle entirely.
//
// Going through another module's exported boolean would defeat that: the
// bundler would have to prove the re-export is constant across the whole graph,
// which it does not attempt. The duplication with siteConfig.TEST_MODE is
// deliberate and load-bearing — do not "clean it up" into an import.
export const DEV_TOOLS: boolean =
  import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === 'true'

// GUARDING A DYNAMIC import() OF THE FIXTURE
//
// Any `import('../dev/sandboxStore')` must be guarded by the literal expression
//
//     import.meta.env.DEV && IS_SANDBOX
//
// written INLINE at the call site — never by `IS_SANDBOX` alone, and never via a
// helper function.
//
// Why: `IS_SANDBOX` is an exported const. Vite folds `import.meta.env.DEV` to a
// literal inside THIS module, but an importing module sees only an opaque binding
// it cannot prove constant, so the bundler keeps the import() reachable and emits
// the fixture as a chunk — 6 kB of fake users shipped to production, unreachable
// but present. `import.meta.env.DEV` is textually substituted in EVERY module
// before bundling, so leading with it makes a production build see
// `if (false && …)`: dead code, the import() is eliminated, and the fixture is
// never emitted. The apparent redundancy is doing the work.

const KEY = 'calsync:devMode'

// Are real Supabase credentials even configured? Sandbox mode is the only option
// available without them, and is therefore the default in that case — otherwise
// a developer with no .env.local would be pinned to a 'live' mode that cannot
// connect to anything.
const HAS_CREDENTIALS: boolean = !!(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
)

function readStored(): DevMode | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'sandbox' || raw === 'live' ? raw : null
  } catch {
    // Private browsing / storage disabled. Not an error worth failing on: fall
    // back to the default rather than taking the app down over a dev toggle.
    return null
  }
}

// Resolved ONCE at module load, deliberately. Every consumer (the Supabase
// client, the storage adapter, the store) reads the backend choice at import
// time, so a value that could change mid-session would leave those consumers
// disagreeing about which backend they are talking to. Changing the mode
// therefore reloads the page — see setDevMode.
function resolveMode(): DevMode {
  if (!HAS_CREDENTIALS) return 'sandbox'       // nothing to be live against
  return readStored() ?? 'live'
}

// `DEV_TOOLS &&` leads, so that in a production build this folds to
// `false ? … : 'live'` → `'live'` and resolveMode() is never reached. Production
// is pinned to live mode and cannot be talked out of it.
export const DEV_MODE: DevMode = DEV_TOOLS ? resolveMode() : 'live'

export const IS_SANDBOX: boolean = DEV_TOOLS && DEV_MODE === 'sandbox'

// Switch backend and reload. The reload is the point, not a shortcut: the
// Supabase client, the storage adapter and the seeded store are all decided at
// import time, and mutating the mode without re-running them would leave the app
// half-connected to each backend.
export function setDevMode(mode: DevMode): void {
  if (!DEV_TOOLS) return
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // Nothing useful to do — without storage the choice cannot persist a reload.
  }
  window.location.reload()
}

// True when the user is in live mode but no credentials exist to be live with.
// The toggle uses this to explain why the option is unavailable.
export const LIVE_UNAVAILABLE: boolean = DEV_TOOLS && !HAS_CREDENTIALS

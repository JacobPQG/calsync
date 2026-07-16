// ─── Supabase client ──────────────────────────────────────────────────────────
// Single shared client instance used by both the storage adapter and the auth
// hook. Exported alongside a SUPABASE_ENABLED flag so every caller can check
// whether a backend is actually configured before using the client.
//
// To enable: copy .env.example → .env.local and fill in your project values.
// Without those env vars the app falls back to localStorage automatically.

import { createClient } from '@supabase/supabase-js'
import { IS_SANDBOX } from '../dev/devMode'
import { IS_DEMO } from '../demo/demoMode'

const url = import.meta.env.VITE_SUPABASE_URL  as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Read throughout the codebase to decide which storage/auth path to take.
//
// Sandbox mode (local dev only — see dev/devMode.ts) forces this false even when
// credentials ARE configured, which is what puts the whole app on the
// localStorage path: no client, no auth, no RLS, no server to refuse anything.
// It is not a bypass of Supabase's rules — it is the absence of Supabase.
//
// Demo mode (the public landing page — see demo/demoMode.ts) forces it false
// for the same reason, except its no-server data lives in memory, not
// localStorage: the boundaries (storage / calendarService / pollService) each
// branch to the demo fixture before their localStorage fallback.
export const SUPABASE_ENABLED = !!(url && key) && !IS_SANDBOX && !IS_DEMO

// The cast is safe because every caller guards with SUPABASE_ENABLED first.
// Using `null as unknown as …` rather than a conditional export keeps
// import syntax clean at call sites.
export const supabase = SUPABASE_ENABLED
  ? createClient(url!, key!)
  : (null as unknown as ReturnType<typeof createClient>)

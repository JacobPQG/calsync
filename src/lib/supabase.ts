// ─── Supabase client ──────────────────────────────────────────────────────────
// Single shared client instance used by both the storage adapter and the auth
// hook. Exported alongside a SUPABASE_ENABLED flag so every caller can check
// whether a backend is actually configured before using the client.
//
// To enable: copy .env.example → .env.local and fill in your project values.
// Without those env vars the app falls back to localStorage automatically.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL  as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Read throughout the codebase to decide which storage/auth path to take.
export const SUPABASE_ENABLED = !!(url && key)

// The cast is safe because every caller guards with SUPABASE_ENABLED first.
// Using `null as unknown as …` rather than a conditional export keeps
// import syntax clean at call sites.
export const supabase = SUPABASE_ENABLED
  ? createClient(url!, key!)
  : (null as unknown as ReturnType<typeof createClient>)

// ─── Site configuration ───────────────────────────────────────────────────────
// The app ships as one codebase with admin-selectable "site variants". The
// admin chooses which variant to deploy — and which optional elements are
// active — at build time via Vite env files:
//
//   npm run build            → classic CalSync   (.env / repo secrets only)
//   npm run build:sports     → sports variant    (.env.sports overlays .env)
//
// Flags live in .env.sports (or repository variables in CI), never in code,
// so activating/deactivating the leaderboard or challenges is a config edit +
// redeploy — no source change. Components import from here only; nothing else
// reads import.meta.env for these values.

export type SiteMode = 'classic' | 'sports'

function flag(name: string, fallback: boolean): boolean {
  const raw = import.meta.env[name] as string | undefined
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

export const SITE_MODE: SiteMode =
  (import.meta.env.VITE_SITE_MODE as string | undefined) === 'sports'
    ? 'sports'
    : 'classic'

// Test mode — enables the "fast user create" shortcut (name-only local personas,
// no password/image). Set VITE_TEST_MODE=true ONLY for local development; the
// start-*.bat launchers set it, deploy/CI never do. `import.meta.env.DEV` is an
// extra guard so a production bundle can never expose it even if the var leaks.
export const TEST_MODE: boolean =
  import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === 'true'

export const IS_SPORTS = SITE_MODE === 'sports'

// Displayed in the header and browser tab.
export const SITE_NAME: string =
  (import.meta.env.VITE_SITE_NAME as string | undefined)
  ?? (IS_SPORTS ? 'PlaySync' : 'CalSync')

// Optional site elements. Defaults: everything on in sports mode, off in
// classic — each individually overridable by the admin.
export const FEATURES = {
  /** Record match results on events and show them in the event detail. */
  scores:      flag('VITE_FEATURE_SCORES',      IS_SPORTS),
  /** Standings table (wins / draws / losses / points) + recent winners. */
  leaderboard: flag('VITE_FEATURE_LEADERBOARD', IS_SPORTS),
  /** Monthly activity challenges (most active, multi-sport). */
  challenges:  flag('VITE_FEATURE_CHALLENGES',  IS_SPORTS),
} as const

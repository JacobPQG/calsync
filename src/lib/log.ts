// ─── Logging service ──────────────────────────────────────────────────────────
// One tiny, deliberate logging boundary for the whole client.
//
// Rules (see docs/design-decisions.md):
//   • debug  — dev-only noise; compiled out of production builds.
//   • warn   — recoverable oddities (fallbacks taken, retries).
//   • error  — failures the user may notice; always emitted.
//   • NEVER log credentials, invite codes, event contents, or emails.
//     Log *what* failed and *which id* was involved, not payloads.
//
// Server-side logging is intentionally not duplicated here: Supabase already
// records auth events, API requests, and Postgres errors (Dashboard → Logs).

const IS_DEV = import.meta.env.DEV

function stamp(scope: string): string {
  return `[calsync:${scope}]`
}

export const log = {
  debug(scope: string, message: string, ...detail: unknown[]): void {
    if (IS_DEV) console.debug(stamp(scope), message, ...detail)
  },

  warn(scope: string, message: string, ...detail: unknown[]): void {
    console.warn(stamp(scope), message, ...detail)
  },

  error(scope: string, message: string, ...detail: unknown[]): void {
    console.error(stamp(scope), message, ...detail)
  },
}

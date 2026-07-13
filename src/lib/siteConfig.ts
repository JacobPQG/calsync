// ─── Site configuration ───────────────────────────────────────────────────────
// What is true of the whole DEPLOYMENT. Two values, and that is deliberate.
//
// There used to be a build-time "site variant" here (classic vs sports), selected
// with `npm run build:sports` and a .env.sports overlay, which decided globally
// whether the app had activities, scores, a leaderboard and challenges.
//
// It is gone. Those are now per-CALENDAR features, chosen by each calendar's
// owner in its Manage panel and stored on the calendar row (`calendars.features`,
// db/schema/10_tables.sql). One deployment serves both shapes, and a user can own
// a five-a-side calendar and a work calendar in the same session — which the
// build-time flag made impossible.
//
// Read them from the store (`useStore().features`), which holds the OPEN
// calendar's set. Do not reach for a global flag: there isn't one any more, and
// the whole point is that the answer depends on which calendar you are looking at.
// See types.ts (CalendarFeatures, isSportsCalendar) and ADR-14.

// Displayed in the header and browser tab.
export const SITE_NAME: string =
  (import.meta.env.VITE_SITE_NAME as string | undefined) ?? 'CalSync'

// Test mode — enables the in-app dev tools (the Sandbox/Live backend switch) and
// the fast user-create shortcut (name-only local personas, no password).
//
// Set VITE_TEST_MODE=true ONLY for local development; start.bat sets it, deploy/CI
// never do. `import.meta.env.DEV` is an extra guard so a production bundle can
// never expose it even if the var leaks into a build environment.
export const TEST_MODE: boolean =
  import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === 'true'
</content>
</invoke>

// ─── App configuration ────────────────────────────────────────────────────────
// Every value that could plausibly change lives here, sourced from Vite env
// vars with safe defaults. Components import from this module — never
// import.meta.env directly — so configuration stays in one place.

// Domain used to build synthetic account emails (<username>@<domain>).
// These addresses are never mailed; they only exist because Supabase Auth
// keys accounts by email. Use a domain you control (or the default).
export const ACCOUNT_EMAIL_DOMAIN: string =
  (import.meta.env.VITE_ACCOUNT_DOMAIN as string | undefined) ?? 'calsync.invalid'

// Username rules: 2–20 chars, lowercase letters / digits / hyphen,
// must start alphanumeric. Keep in sync with the signup form hint.
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,19}$/

// Minimum password length. Raised from the old 8-char "secret word" because the
// password is now the ONLY secret — the memory image became a public avatar and
// left the credential (ADR-9). Users are steered toward their password manager,
// so a longer minimum costs them nothing.
export const PASSWORD_MIN_LENGTH = 12

// URL fragment key carrying a QR invite: <site>/#invite=<code>
// The fragment (not the query string) is used deliberately: it is never sent to
// the server or written to its access logs, so the code stays out of them.
export const INVITE_HASH_KEY = 'invite'

// Invite codes are 24 hex chars (96 bits) as minted by mint_invite(). The bound
// is a sanity check on URL input, not a security control — the server decides.
export const INVITE_CODE_PATTERN = /^[a-f0-9]{16,64}$/

// How long a QR invite stays claimable. A QR is a bearer token — whoever scans
// it first gets the account — so it expires by default rather than lingering.
// The admin can override it per invite (see INVITE_LIFETIME_OPTIONS).
//
// Server-side default is the same 72h; this constant is what the mint form
// pre-selects. The server is the enforcement point either way.
export const INVITE_LIFETIME_HOURS: number =
  Number(import.meta.env.VITE_INVITE_LIFETIME_HOURS) || 72

// Lifetimes offered in the mint form. `null` = never expires — deliberately last
// and deliberately not the default: it is an opt-out from a safety default, so
// it must be chosen, never fallen into.
export const INVITE_LIFETIME_OPTIONS: { label: string; hours: number | null }[] = [
  { label: '1 hour',   hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '3 days',   hours: 72 },
  { label: '7 days',   hours: 168 },
  { label: 'Never',    hours: null },
]

// Hard cap on events accepted from a single .ics import.
export const MAX_ICAL_IMPORT = 200

// ── Calendars (ADR-12) ────────────────────────────────────────────────────────

// Seat count the "new calendar" form pre-selects. The owner decides how many
// people the calendar is for when they create it; this is only the starting
// number in the box. The cap is enforced server-side, at approval.
export const DEFAULT_CALENDAR_SEATS: number =
  Number(import.meta.env.VITE_DEFAULT_CALENDAR_SEATS) || 8

// Bounds on the seat cap, mirroring the CHECK constraint in schema.sql. Client
// bounds are a courtesy that gives an instant error message; the server is the
// enforcement point, and these two must agree or the UI will offer numbers the
// database then rejects.
export const MIN_CALENDAR_SEATS = 1
export const MAX_CALENDAR_SEATS = 500

// Most invites the bulk minter will send in one request. Mirrors the limit in
// mint_calendar_invites().
export const MAX_BULK_INVITES = 100

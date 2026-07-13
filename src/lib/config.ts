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

// Minimum length of the secret word / passphrase.
export const SECRET_WORD_MIN_LENGTH = 8

// Hard cap on events accepted from a single .ics import.
export const MAX_ICAL_IMPORT = 200

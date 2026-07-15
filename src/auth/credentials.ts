// ─── Credential derivation ────────────────────────────────────────────────────
// CalSync accounts are anonymous by default: no email, no phone, no real name.
// A login is
//
//     identifier  +  password
//
// where the identifier is EITHER a username OR, if the user prefers, their own
// email address. An email is never required — it is an option, not a step.
//
// Under the hood we always use Supabase Auth (bcrypt-hashed passwords, built-in
// brute-force rate limiting), which keys accounts by email. So:
//
//     "jake"           → email = jake@<ACCOUNT_EMAIL_DOMAIN>   (synthetic, never mailed)
//     "jake@gmail.com" → email = jake@gmail.com                (as typed)
//     password         = the password, as typed
//
// Only the username branch is constrained (it has to be splice-safe into an
// address). A real email is taken verbatim — see toAccountEmail.
//
// ── Why the password is now just the password (ADR-9) ────────────────────────
// It used to be `<secret word>:<image id>` — the "memory image" was a genuine
// second secret, never stored server-side and never shown before authentication.
// That worked only as long as the image stayed hidden.
//
// QR invites changed the requirement: the image the user picks at signup is now
// their AVATAR, drawn next to their events for everyone who can see them. An
// avatar is public by construction. Leaving it in the password would mean every
// account's password was half-disclosed on the calendar grid — so the image had
// to leave the credential entirely. It is now cosmetic: stored in users.data as
// `avatar`, freely changeable, with no effect on sign-in.
//
// The password absorbs that lost factor by being a real password: longer
// minimum, and typed into a proper `autocomplete` field so phone/browser
// password managers can generate and store a strong one (the whole point of
// letting it be saved). Accounts remain invite-gated and admin-approved, and
// Supabase still rate-limits attempts.
//
// LEGACY ACCOUNTS: anyone who signed up under the old scheme has a bcrypt hash
// of `word:imageId`. Their password is not recoverable and cannot be rewritten
// client-side, so sign-in falls back to the old derivation — see
// legacyPassword() and its single caller in useAuth.ts.

import { ACCOUNT_EMAIL_DOMAIN, USERNAME_PATTERN, PASSWORD_MIN_LENGTH } from '../lib/config'

// ── Avatars ───────────────────────────────────────────────────────────────────
// The picture a user picks at signup. PUBLIC — it is their icon in the UI.
//
// Ids are stable and are also the id space of the legacy memory-image secret, so
// existing ids must never be renumbered (legacyPassword() still derives from
// them). Appending is safe.
export interface Avatar { id: string; emoji: string; label: string }

export const AVATARS: Avatar[] = [
  { id: 'anchor',     emoji: '⚓',  label: 'Anchor'   },
  { id: 'cactus',     emoji: '🌵', label: 'Cactus'   },
  { id: 'lantern',    emoji: '🏮', label: 'Lantern'  },
  { id: 'whale',      emoji: '🐋', label: 'Whale'    },
  { id: 'acorn',      emoji: '🌰', label: 'Acorn'    },
  { id: 'kite',       emoji: '🪁', label: 'Kite'     },
  { id: 'mushroom',   emoji: '🍄', label: 'Mushroom' },
  { id: 'compass',    emoji: '🧭', label: 'Compass'  },
  { id: 'violin',     emoji: '🎻', label: 'Violin'   },
  { id: 'lighthouse', emoji: '🗼', label: 'Tower'    },
  { id: 'turtle',     emoji: '🐢', label: 'Turtle'   },
  { id: 'comet',      emoji: '☄️', label: 'Comet'    },
]

const AVATAR_BY_ID = new Map(AVATARS.map(a => [a.id, a]))

// The emoji to draw for a user. Falls back to null when the user has no avatar
// (every account created before ADR-9), so callers can render initials instead.
export function avatarEmoji(id: string | undefined): string | null {
  return id ? AVATAR_BY_ID.get(id)?.emoji ?? null : null
}

// ── Identifiers: username OR email ────────────────────────────────────────────
// An account is identified by ONE field, and the user decides what to put in it:
//
//   "jake"              → a username. Synthesized into jake@<ACCOUNT_EMAIL_DOMAIN>.
//   "jake@gmail.com"    → a real email. Used verbatim.
//
// An email is never REQUIRED — the anonymous username path is the default and is
// unchanged. But someone who would rather sign in with their own address may,
// and if they do we take it AS TYPED: no character rules, no length cap, no
// hyphens-only. Supabase does the RFC validation; re-implementing it here would
// only reject addresses that are in fact deliverable.
//
// The discriminator is deliberately just "@": it is the one character that
// cannot appear in a username, so the two spaces cannot collide.

export function isEmailAddress(identifier: string): boolean {
  return identifier.includes('@')
}

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeUsername(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase()
}

// Emails are lower-cased and trimmed for stable lookup (Supabase stores them
// folded, so "Jake@X.com" and "jake@x.com" must key the same account) — but the
// address is otherwise UNTOUCHED. Dots, plus-tags, sub-domains all survive.
export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase()
}

// Passwords are NOT normalized — they are compared byte-for-byte by bcrypt, and
// silently lower-casing one would throw away entropy the user chose to add.
// (The legacy secret word WAS normalized; legacyPassword preserves that.)

// ── Validation (returns a human-readable error or null) ──────────────────────

// Validate whichever kind of identifier this is. The username rules apply ONLY
// to usernames: an email is the user's own address and is not ours to police,
// so we check only that it is non-empty and has something either side of the @.
export function identifierError(identifier: string): string | null {
  if (isEmailAddress(identifier)) {
    const email = normalizeEmail(identifier)
    const [local, domain, ...rest] = email.split('@')
    if (rest.length > 0 || !local || !domain) return 'Enter a valid email address.'
    return null
  }
  return usernameError(identifier)
}

export function usernameError(name: string): string | null {
  if (!USERNAME_PATTERN.test(normalizeUsername(name))) {
    return 'Username: 2–20 characters, lowercase letters, digits or “-”, starting with a letter or digit.'
  }
  return null
}

export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters. Let your phone generate and save one.`
  }
  return null
}

// ── Derivation ────────────────────────────────────────────────────────────────

// The address Supabase Auth keys the account by. A real email is passed straight
// through; a username is turned into a synthetic address that is never mailed.
export function toAccountEmail(identifier: string): string {
  if (isEmailAddress(identifier)) return normalizeEmail(identifier)
  return `${normalizeUsername(identifier)}@${ACCOUNT_EMAIL_DOMAIN}`
}

// The handle to store in users.username and show in the UI. For a username that
// is the name itself; for an email it is the local part ("jake@gmail.com" →
// "jake"), so the address is never rendered next to someone's events — the
// account stays as anonymous to other members as a username-only one.
export function toDisplayHandle(identifier: string): string {
  return isEmailAddress(identifier)
    ? normalizeEmail(identifier).split('@')[0]
    : normalizeUsername(identifier)
}

// ── Legacy (pre-ADR-9) credential scheme ──────────────────────────────────────
// Accounts created before avatars were decoupled hash `<secret word>:<image id>`.
// Sign-in retries with this shape when the modern attempt is rejected, so those
// users can still get in by entering their old secret word and picking their old
// memory image. New accounts never use it.

function normalizeLegacySecretWord(word: string): string {
  return word.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function legacyPassword(secretWord: string, imageId: string): string {
  return `${normalizeLegacySecretWord(secretWord)}:${imageId}`
}

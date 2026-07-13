// ─── Credential derivation ────────────────────────────────────────────────────
// CalSync accounts are anonymous: no email, no phone, no real name. A login is
//
//     username  +  password
//
// Under the hood we still use Supabase Auth (bcrypt-hashed passwords, built-in
// brute-force rate limiting) by deriving a synthetic address:
//
//     email    = <username>@<ACCOUNT_EMAIL_DOMAIN>      (never mailed)
//     password = the password, as typed
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

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeUsername(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase()
}

// Passwords are NOT normalized — they are compared byte-for-byte by bcrypt, and
// silently lower-casing one would throw away entropy the user chose to add.
// (The legacy secret word WAS normalized; legacyPassword preserves that.)

// ── Validation (returns a human-readable error or null) ──────────────────────

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

export function toAccountEmail(username: string): string {
  return `${normalizeUsername(username)}@${ACCOUNT_EMAIL_DOMAIN}`
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

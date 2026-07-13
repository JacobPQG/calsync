// ─── Credential derivation ────────────────────────────────────────────────────
// CalSync accounts are anonymous: no email, no phone, no real name. A login is
//
//     username  +  secret word  +  memory image
//
// Under the hood we still use Supabase Auth (bcrypt-hashed passwords, built-in
// brute-force rate limiting) by deriving:
//
//     email    = <username>@<ACCOUNT_EMAIL_DOMAIN>      (never mailed)
//     password = <normalized secret word>:<image id>
//
// The chosen image is part of the password, so it is a real second secret —
// it is never stored server-side and never shown before authentication
// (showing it pre-auth would leak it to anyone typing a username).
//
// Honest entropy note: word+image is weaker than a random password. It is
// acceptable here ONLY because accounts are invite-gated and admin-approved,
// Supabase rate-limits password attempts, and usernames are not public.
// See docs/design-decisions.md for the full threat model.

import { ACCOUNT_EMAIL_DOMAIN, USERNAME_PATTERN, SECRET_WORD_MIN_LENGTH } from '../lib/config'

// The memory-image set. Ids are stable — NEVER reorder or renumber existing
// entries, or every derived password breaks. Only append.
export interface MemoryImage { id: string; emoji: string; label: string }

export const MEMORY_IMAGES: MemoryImage[] = [
  { id: 'anchor',   emoji: '⚓', label: 'Anchor'   },
  { id: 'cactus',   emoji: '🌵', label: 'Cactus'   },
  { id: 'lantern',  emoji: '🏮', label: 'Lantern'  },
  { id: 'whale',    emoji: '🐋', label: 'Whale'    },
  { id: 'acorn',    emoji: '🌰', label: 'Acorn'    },
  { id: 'kite',     emoji: '🪁', label: 'Kite'     },
  { id: 'mushroom', emoji: '🍄', label: 'Mushroom' },
  { id: 'compass',  emoji: '🧭', label: 'Compass'  },
  { id: 'violin',   emoji: '🎻', label: 'Violin'   },
  { id: 'lighthouse', emoji: '🗼', label: 'Tower'  },
  { id: 'turtle',   emoji: '🐢', label: 'Turtle'   },
  { id: 'comet',    emoji: '☄️', label: 'Comet'    },
]

// ── Normalization ─────────────────────────────────────────────────────────────
// Unicode-normalize and lowercase so "Blue Heron " and "blue heron" are the
// same memory. Internal whitespace is collapsed, not stripped — multi-word
// passphrases are encouraged.
export function normalizeSecretWord(word: string): string {
  return word.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeUsername(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase()
}

// ── Validation (returns a human-readable error or null) ──────────────────────

export function usernameError(name: string): string | null {
  if (!USERNAME_PATTERN.test(normalizeUsername(name))) {
    return 'Username: 2–20 characters, lowercase letters, digits or “-”, starting with a letter or digit.'
  }
  return null
}

export function secretWordError(word: string): string | null {
  if (normalizeSecretWord(word).length < SECRET_WORD_MIN_LENGTH) {
    return `Secret word must be at least ${SECRET_WORD_MIN_LENGTH} characters — a short phrase you'll remember works best.`
  }
  return null
}

// ── Derivation ────────────────────────────────────────────────────────────────

export function toAccountEmail(username: string): string {
  return `${normalizeUsername(username)}@${ACCOUNT_EMAIL_DOMAIN}`
}

export function derivePassword(secretWord: string, imageId: string): string {
  return `${normalizeSecretWord(secretWord)}:${imageId}`
}

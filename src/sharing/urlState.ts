// ─── URL State Sharing ────────────────────────────────────────────────────────
// Encodes the full calendar state (users + events) into the URL hash so the
// app can be shared as a static link with no server required.
//
// Encoding: JSON → UTF-8 → base64url (URL-safe, no padding) → #share=<token>
// The hash fragment is never sent to the server, so large payloads are fine.

import type { CalEvent, User } from '../types'

export interface ShareableState {
  users:  User[]
  events: CalEvent[]
}

// ── Encode ────────────────────────────────────────────────────────────────────

// btoa() only handles latin-1; encodeURIComponent+escape handles full UTF-8.
function utf8ToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach(b => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64UrlToUtf8(str: string): string {
  // Re-pad to a multiple of 4
  const padded = str + '=='.slice(0, (4 - (str.length % 4)) % 4)
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// Serialize state into a URL hash string (#share=…)
export function encodeState(users: User[], events: CalEvent[]): string {
  const state: ShareableState = { users, events }
  return '#share=' + utf8ToBase64Url(JSON.stringify(state))
}

// ── Decode ────────────────────────────────────────────────────────────────────

// Runtime shape validation — the TypeScript cast does nothing at runtime, so
// we must check the structure ourselves before accepting URL-provided data.
// This prevents a malformed share link from crashing the store or bypassing
// downstream safeUrl() checks (e.g. smuggling a non-string into an href).
function isValidSharedState(raw: unknown): raw is ShareableState {
  if (!raw || typeof raw !== 'object') return false
  const s = raw as Record<string, unknown>
  if (!Array.isArray(s.users) || !Array.isArray(s.events)) return false
  // Hard caps prevent a crafted link from flooding the store.
  if (s.users.length  > 50)  return false
  if (s.events.length > 500) return false

  return (
    s.users.every(u => {
      if (!u || typeof u !== 'object') return false
      const r = u as Record<string, unknown>
      return (
        typeof r.id    === 'string' && r.id.length    <= 128 &&
        typeof r.name  === 'string' && r.name.length  <= 100 &&
        typeof r.color === 'string' && r.color.length <=  20
      )
    }) &&
    s.events.every(e => {
      if (!e || typeof e !== 'object') return false
      const r = e as Record<string, unknown>
      return (
        typeof r.id     === 'string' && r.id.length     <= 128 &&
        typeof r.userId === 'string' && r.userId.length <= 128 &&
        typeof r.title  === 'string' && r.title.length  <= 200 &&
        typeof r.date   === 'string' && r.date.length   <=  20
      )
    })
  )
}

// Parse shared state from the current URL hash. Returns null if absent/corrupt/invalid.
export function decodeStateFromUrl(): ShareableState | null {
  try {
    const hash  = window.location.hash
    const match = hash.match(/^#share=(.+)$/)
    if (!match) return null
    const decoded = base64UrlToUtf8(match[1])
    // Reject payloads over 50 KB — prevents DoS via enormous share links.
    if (decoded.length > 50_000) return null
    const parsed = JSON.parse(decoded)
    // Reject anything that doesn't conform to the expected shape.
    if (!isValidSharedState(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

// ── Share helpers ─────────────────────────────────────────────────────────────

// Build a full shareable URL containing the encoded state.
export function buildShareUrl(users: User[], events: CalEvent[]): string {
  return window.location.href.split('#')[0] + encodeState(users, events)
}

// Copy the shareable URL to the clipboard. Returns true on success.
export async function copyShareUrl(users: User[], events: CalEvent[]): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(buildShareUrl(users, events))
    return true
  } catch {
    return false
  }
}

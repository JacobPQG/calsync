// ─── Invite links ─────────────────────────────────────────────────────────────
// Pure functions: build the URL a QR encodes, and read a code back out of the
// current URL. No I/O, no Supabase, no React — so this is the one place that
// defines the link format, and it is trivially testable.
//
// FORMAT
//     https://<site>/#invite=<code>
//
// The code rides in the HASH FRAGMENT, not the query string, because fragments
// are never transmitted to the server: the invite code stays out of GitHub
// Pages' access logs, out of any CDN in front of it, and out of the Referer
// header sent to third parties. The same reasoning already governs #share=
// (sharing/urlState.ts).
//
// The code is the ENTIRE payload. The invitee's name is deliberately NOT in the
// URL — it is stored against the code server-side and fetched by lookup_invite.
// Putting it in the link would let whoever holds the QR rewrite who it is for.

import { INVITE_HASH_KEY, INVITE_CODE_PATTERN } from '../lib/config'

// Build the URL a QR code should encode. `origin` defaults to the running app,
// so a QR minted on the deployed site points back at the deployed site.
export function buildInviteUrl(code: string, origin?: string): string {
  const base = (origin ?? window.location.href).split('#')[0]
  return `${base}#${INVITE_HASH_KEY}=${encodeURIComponent(code)}`
}

// Read an invite code out of a URL hash. Returns null when absent or malformed.
//
// Shape is validated before the value is used: the hash is attacker-controlled
// (anyone can hand you a link), so it is untrusted input like any other. This is
// a cheap filter to avoid round-tripping obvious junk to the server — the server
// remains the authority on whether a code is real.
export function readInviteCode(hash: string = window.location.hash): string | null {
  const match = hash.match(new RegExp(`[#&]${INVITE_HASH_KEY}=([^&]+)`))
  if (!match) return null

  let code: string
  try {
    code = decodeURIComponent(match[1])
  } catch {
    return null   // malformed percent-encoding
  }

  return INVITE_CODE_PATTERN.test(code) ? code : null
}

// Strip the invite fragment from the address bar without reloading the page.
//
// Called once the code has been claimed (or found spent). Two reasons, both
// real: a stale #invite= would make a refresh re-open the claim screen for an
// account that already exists, and a spent code has no business lingering in
// the URL the user might copy or screenshot.
export function clearInviteFromUrl(): void {
  const { pathname, search } = window.location
  window.history.replaceState(null, '', pathname + search)
}

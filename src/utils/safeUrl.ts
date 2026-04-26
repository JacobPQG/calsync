// ─── URL safety guard ─────────────────────────────────────────────────────────
// Prevents javascript: / data: / vbscript: URIs from reaching href attributes.
//
// Why: React does NOT block javascript: in href on its own (it only warns in
// development). An attacker can inject a malicious href via URL-shared state
// or an imported .ics file, and clicking the link would execute JavaScript.
//
// Rule: only http: and https: are allowed. Returns undefined for anything else
// so the caller can choose to hide the link entirely.

export function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') return url
  } catch {
    // URL constructor throws on relative URLs or malformed strings — discard them.
  }
  return undefined
}

// Validate a user-typed URL string; returns a human-readable error or null.
export function urlValidationError(url: string): string | null {
  if (!url) return null
  try {
    const { protocol } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') {
      return 'Only http:// and https:// links are allowed.'
    }
    return null
  } catch {
    return 'Not a valid URL (must start with https://).'
  }
}

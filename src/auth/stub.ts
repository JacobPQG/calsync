// ─── Authentication Stub ──────────────────────────────────────────────────────
// This file is a no-op placeholder designed so that adding real authentication
// later (Supabase, Clerk, NextAuth, etc.) requires NO changes to the UI layer.
//
// How to swap in real auth:
//   1. Replace this file with your provider's session hook.
//   2. The hook must still export `useAuthSession()` returning `AuthSession`.
//   3. The UI reads only `useAuthSession()` – it never imports provider code.
//
// The `isAuthenticated` flag is currently always false; the UI shows a "Sign in"
// button that calls `signIn()`. In local-only mode this shows an info alert.

export interface AuthSession {
  // True once the user has authenticated with a real provider.
  isAuthenticated: boolean

  // Email / display name from the provider; null in local mode.
  email: string | null
  displayName: string | null

  // Call these to trigger sign-in / sign-out with your chosen provider.
  signIn:  () => void
  signOut: () => void
}

// Hook consumed by App.tsx (and nowhere else).
export function useAuthSession(): AuthSession {
  return {
    isAuthenticated: false,
    email:           null,
    displayName:     null,

    signIn: () => {
      // Replace with:  supabase.auth.signIn()  /  clerk.openSignIn()  / etc.
      // The alert is intentionally informational, not a real UI; it will be
      // removed once a provider is wired up.
      alert(
        'Auth is not configured yet.\n\n' +
        'Users are identified locally via the user pills in the top bar. ' +
        'See src/auth/stub.ts to add a real sign-in provider.'
      )
    },

    signOut: () => {
      // Replace with your provider's sign-out call.
    },
  }
}

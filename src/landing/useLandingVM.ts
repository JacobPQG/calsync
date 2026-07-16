// ─── Landing ViewModel ────────────────────────────────────────────────────────
// Logic for the public landing page (rendered only in demo mode — see
// demo/demoMode.ts). Deliberately thin: the page is mostly copy, and the live
// demo embedded in it is the real App running on the demo fixture, which brings
// its own VM. What belongs here is the page's two actions.

import { SITE_NAME } from '../lib/siteConfig'
import { exitDemo } from '../demo/demoMode'

// Anchor the "See it in action" button scrolls to — on the demo frame's section
// in the view. An element id + scrollIntoView rather than an <a href="#…">,
// because the URL hash is load-bearing in this app (#demo IS the demo switch,
// #invite=/#share= carry payloads) and a navigation anchor must not touch it.
export const DEMO_SECTION_ID = 'landing-demo'

export interface LandingVM {
  siteName: string
  // Leave the demo for the real app (sign-in lives there). Reloads.
  openApp: () => void
  // Smooth-scroll to the embedded live demo.
  scrollToDemo: () => void
}

export function useLandingVM(): LandingVM {
  return {
    siteName: SITE_NAME,
    openApp:  exitDemo,
    scrollToDemo: () =>
      document.getElementById(DEMO_SECTION_ID)?.scrollIntoView({ behavior: 'smooth' }),
  }
}

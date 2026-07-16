// ─── Dev panel ViewModel ──────────────────────────────────────────────────────
// Logic for the local-development mode switch. Inert outside dev (DEV_TOOLS).

import { useState } from 'react'
import {
  DEV_TOOLS, DEV_MODE, IS_SANDBOX, LIVE_UNAVAILABLE, setDevMode, type DevMode,
} from './devMode'
import {
  SANDBOX_PERSONA, setSandboxPersona, type SandboxPersona,
} from './sandboxPersona'
import { useStore } from '../store/useStore'

export interface DevPanelVM {
  enabled:   boolean          // draw anything at all?
  mode:      DevMode
  isSandbox: boolean

  // Live mode needs real credentials in .env.local. Without them it is not an
  // option, and the panel says so rather than offering a switch that would
  // silently land the user back in sandbox.
  liveUnavailable: boolean

  open:    boolean
  setOpen: (v: boolean) => void

  // Switching backends reloads the page — see devMode.ts.
  switchTo: (mode: DevMode) => void

  // Throw the fixture away and rebuild it on the next load.
  reset: () => void

  // Who you are pretending to be in the sandbox. Switching this is how one
  // browser simulates several people: post as Ana, then as Ben, and watch the
  // overlap rules react. Live mode has no equivalent — you are whoever you
  // signed in as, and the server agrees.
  personas:     { id: string; name: string }[]
  activeUserId: string | null
  setActiveUser: (id: string) => void

  // Which ACCOUNT the sandbox is signed in as: the full member ("You") or the
  // guest (ADR-18), whose whole experience — header, scoping, refusals — the
  // app then reproduces. Deeper than "Act as" above, which only changes who
  // events are posted as; this changes who the session belongs to. Switching
  // reloads, same contract as the backend switch.
  persona:    SandboxPersona
  setPersona: (p: SandboxPersona) => void
}

export function useDevPanelVM(): DevPanelVM {
  const [open, setOpen] = useState(false)
  const { users, activeUserId, setActiveUser } = useStore()

  return {
    enabled:   DEV_TOOLS,
    mode:      DEV_MODE,
    isSandbox: IS_SANDBOX,
    liveUnavailable: LIVE_UNAVAILABLE,

    open, setOpen,

    switchTo: (mode) => {
      if (mode === DEV_MODE) { setOpen(false); return }
      setDevMode(mode)   // reloads
    },

    // The `import.meta.env.DEV &&` is load-bearing, not redundant: it is what
    // lets the bundler drop the fixture from the production build entirely.
    // See the note in dev/devMode.ts before touching it.
    reset: () => {
      if (!import.meta.env.DEV) return
      void Promise.all([
        import('./sandboxStore'),
        import('./sandboxPolls'),
      ]).then(([{ resetSandbox }, { resetSandboxPolls }]) => {
        resetSandbox()
        resetSandboxPolls()
        // The seeded users and events live in the ordinary localStorage keys, so
        // clearing the sandbox's own keys is not enough — the next load would
        // re-seed on top of the old people. Wipe those too.
        localStorage.removeItem('calsync:users')
        localStorage.removeItem('calsync:events')
        localStorage.removeItem('calsync:localIds')
        window.location.reload()
      })
    },

    personas: users.map(u => ({ id: u.id, name: u.name })),
    activeUserId,
    setActiveUser,

    persona: SANDBOX_PERSONA,
    setPersona: (p) => {
      if (p === SANDBOX_PERSONA) return
      setSandboxPersona(p)   // re-points the active user, then reloads
    },
  }
}

// ─── DevPanel View ────────────────────────────────────────────────────────────
// PURE VIEW. All logic is in useDevPanelVM.ts.
//
// A local-development control, drawn only when DEV_TOOLS is true (dev build +
// VITE_TEST_MODE, which only the start-*.bat launchers set). It never appears in
// a production bundle.
//
// Editing guide:
//   • Sizing/colours → STYLE below and CSS vars in src/index.css.
//   • Behavior → useDevPanelVM.ts. What the modes MEAN → dev/devMode.ts.

import { useDevPanelVM } from './useDevPanelVM'

const STYLE = {
  panelWidth: 320,  // px
} as const

export function DevPanel() {
  const vm = useDevPanelVM()
  if (!vm.enabled) return null

  const badge = vm.isSandbox
    ? { text: 'Sandbox', color: '#b45309' }
    : { text: 'Live',    color: '#7c3aed' }

  return (
    <>
      <button onClick={() => vm.setOpen(!vm.open)}
        className="flex items-center gap-1 rounded-full border text-xs shrink-0"
        style={{
          padding: '2px 8px', whiteSpace: 'nowrap', fontWeight: 600, fontSize: 10,
          borderColor: badge.color + '80', background: badge.color + '18',
          color: badge.color,
        }}
        title="Local development tools — not present in a production build">
        🛠 {badge.text}
      </button>

      {vm.open && (
        <>
          {/* Click-away. */}
          <div className="fixed inset-0 z-40" onClick={() => vm.setOpen(false)} />

          <div className="fixed z-50 rounded-xl flex flex-col gap-3 p-4"
            style={{
              top: 56, right: 12, width: STYLE.panelWidth,
              background: 'var(--bg-surface)',
              border: '0.5px solid var(--border)',
              boxShadow: 'var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.24))',
            }}>

            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                Dev tools
              </h3>
              <button onClick={() => vm.setOpen(false)} aria-label="Close"
                className="text-xl leading-none px-1" style={{ color: 'var(--text-muted)' }}>
                ×
              </button>
            </div>

            {/* ── Mode switch ───────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                Backend
              </span>

              <ModeOption
                active={!vm.isSandbox}
                disabled={vm.liveUnavailable}
                onClick={() => vm.switchTo('live')}
                title="Live — real Supabase"
                body={vm.liveUnavailable
                  ? 'Unavailable: no VITE_SUPABASE_URL / ANON_KEY in .env.local.'
                  : 'The real database. Approval, ownership and privacy are enforced by Postgres, exactly as in production. Your account must be approved — see docs/supabase.md.'} />

              <ModeOption
                active={vm.isSandbox}
                onClick={() => vm.switchTo('sandbox')}
                title="Sandbox — no backend"
                body="localStorage only, seeded with fake people and calendars. Everything is clickable with zero setup — but there is no server, so no invites, no approval queue, and no RLS. The security model is NOT exercised here." />
            </div>

            {/* ── Sandbox-only controls ─────────────────────────────────── */}
            {vm.isSandbox && (
              <>
                <div className="h-px" style={{ background: 'var(--border)' }} />

                {/* Whose SESSION this is — member or guest (ADR-18). */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    Signed in as
                  </span>

                  <ModeOption
                    active={vm.persona === 'member'}
                    onClick={() => vm.setPersona('member')}
                    title="Member — a full account"
                    body="“You”: owns Team planning, belongs to Five-a-side, can create calendars and manage members." />

                  <ModeOption
                    active={vm.persona === 'guest'}
                    onClick={() => vm.setPersona('guest')}
                    title="Guest — joined without signing in"
                    body="Gus came in through a guest link: one calendar only, no calendar creation, and signing out is permanent. Reproduces the whole guest experience." />
                </div>

                {/* A guest is exactly one person — the several-people trick
                    belongs to the member persona, so it hides here rather than
                    undermine the simulation. */}
                {vm.persona === 'member' && (
                  <>
                    <div className="h-px" style={{ background: 'var(--border)' }} />

                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                        Act as
                      </span>
                      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        Switch persona to simulate several people in one browser —
                        post as one, then another, and watch the overlap rules react.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {vm.personas.map(p => (
                          <button key={p.id} onClick={() => vm.setActiveUser(p.id)}
                            className="rounded-full border text-xs px-2.5 py-1"
                            style={p.id === vm.activeUserId
                              ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }
                              : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div className="h-px" style={{ background: 'var(--border)' }} />

                <button onClick={vm.reset}
                  className="btn-toolbar self-start"
                  title="Delete the seeded people, calendars and events, and rebuild them on reload">
                  ↺ Reset sandbox
                </button>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}

// ─── Mode option ──────────────────────────────────────────────────────────────

function ModeOption({ active, disabled, onClick, title, body }: {
  active:    boolean
  disabled?: boolean
  onClick:   () => void
  title:     string
  body:      string
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="text-left rounded-lg p-2.5 flex flex-col gap-1 border disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        background:  active ? 'var(--accent-bg)' : 'transparent',
      }}>
      <span className="text-xs font-semibold flex items-center gap-1.5"
        style={{ color: active ? 'var(--accent)' : 'var(--text)' }}>
        {active && <span aria-hidden="true">✓</span>}
        {title}
      </span>
      <span className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {body}
      </span>
    </button>
  )
}

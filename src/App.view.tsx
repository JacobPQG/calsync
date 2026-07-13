// ─── App View ─────────────────────────────────────────────────────────────────
// PURE VIEW. All logic is in useAppVM.ts (+ lib/useConnectionStatus.ts for the
// badge). This file is the app shell: top bar, panels, and body layout. Reshape
// freely.
//
// Editing guide:
//   • Header height, layout, which buttons appear where → STYLE / JSX below.
//   • Badge colours/labels → the maps below the STYLE block.
//   • Colours → CSS vars in src/index.css.
//   • Behavior (handlers, flags, theme) → useAppVM.ts.

import { MonthGrid }  from './calendar/MonthGrid'
import { DayView }    from './sidebar/DayView'
import { SharePanel } from './sharing/SharePanel'
import { AuthModal }  from './auth/AuthModal'
import { StatsPanel } from './sports/StatsPanel'
import { SUPABASE_ENABLED } from './lib/supabase'
import { useConnectionStatus, type ConnStatus } from './lib/useConnectionStatus'
import { useAppVM } from './useAppVM'

// ── Visual constants ──────────────────────────────────────────────────────────
const STYLE = {
  headerHeight: 48,     // px
  sidebarWidth: 'w-80', // Tailwind — desktop day sidebar
  avatarFont:   9,      // px — user-pill initials
} as const

// Connection-badge presentation (logic in useConnectionStatus).
const STATUS_LABEL: Record<ConnStatus, string> = {
  local:      'localStorage mode — no Supabase configured',
  connecting: 'Connecting to Supabase…',
  ok:         'Supabase connected',
  error:      'Supabase connection failed — check console',
}
const STATUS_COLOR: Record<ConnStatus, string> = {
  local: '#635f57', connecting: '#b45309', ok: '#16a34a', error: '#dc2626',
}
const STATUS_TEXT: Record<ConnStatus, string> = {
  local: 'Local', connecting: '…', ok: 'Live', error: 'Error',
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const vm = useAppVM()

  // Loading screen while initial data loads.
  if (vm.isLoading) {
    return (
      <div className="app-shell flex items-center justify-center gap-3"
        style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
        <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Loading calendar…</span>
      </div>
    )
  }

  const { auth } = vm

  return (
    <div className="app-shell flex flex-col" style={{ background: 'var(--bg-base)' }}>

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-3 shrink-0 overflow-x-auto"
        style={{
          height: STYLE.headerHeight, minHeight: STYLE.headerHeight,
          borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-xs)', scrollbarWidth: 'none',
        }}>
        <span className="font-semibold text-sm tracking-tight select-none shrink-0" style={{ color: 'var(--text)' }}>
          {vm.siteName}
        </span>

        <ConnectionBadge />

        <div className="h-4 w-px mx-0.5 shrink-0" style={{ background: 'var(--border)' }} />

        {/* User pills */}
        {vm.users.map(u => (
          <button key={u.id} onClick={() => vm.setActiveUser(u.id)}
            className="flex items-center gap-1.5 rounded-full text-xs border transition-all shrink-0"
            style={{
              padding: '3px 10px 3px 6px', whiteSpace: 'nowrap',
              ...(u.id === vm.activeUserId
                ? { borderColor: u.color, color: u.color, background: u.color + '18' }
                : { borderColor: 'var(--border)', color: 'var(--text-muted)' }),
            }}>
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
              style={{ background: u.color, fontSize: STYLE.avatarFont }}>
              {u.name[0].toUpperCase()}
            </span>
            {u.name}
          </button>
        ))}

        {/* Quick personas (local mode always; Supabase mode only in test mode). */}
        {vm.showAddPersonBtn && (
          <button onClick={() => vm.setShowUserPanel(!vm.showUserPanel)}
            className="flex items-center gap-1 rounded-full border border-dashed text-xs transition-colors shrink-0"
            style={{
              padding: '3px 10px', whiteSpace: 'nowrap',
              borderColor: vm.showUserPanel ? 'var(--accent)' : 'var(--border)',
              color:       vm.showUserPanel ? 'var(--accent)' : 'var(--text-muted)',
            }}
            title={vm.addPersonIsTest ? 'Test mode: add a local-only persona (not saved to the server)' : 'Add a person'}>
            + person{vm.addPersonIsTest ? ' (test)' : ''}
          </button>
        )}

        <div className="flex-1 shrink-0" style={{ minWidth: 8 }} />

        {vm.importFeedback && (
          <span className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0"
            style={{ background: 'var(--overlap-bg)', color: 'var(--overlap-text)', whiteSpace: 'nowrap' }}>
            ✓ {vm.importFeedback}
          </span>
        )}

        <input ref={vm.icalInputRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={vm.handleImportIcal} />

        <button className="btn-toolbar shrink-0" onClick={vm.triggerImport}
          disabled={!vm.activeUserId} title={vm.activeUserId ? 'Import a .ics file' : 'Select a user first'}>
          ↑ Import
        </button>

        <button className="btn-toolbar shrink-0" onClick={vm.exportIcal} title="Export as .ics">
          ↓ Export
        </button>

        {/* Leaderboard / challenges — admin-activated site elements */}
        {vm.showStatsButton && (
          <button className="btn-toolbar shrink-0" onClick={() => vm.setShowStatsPanel(true)} title="Leaderboard & challenges">
            🏆 Leaderboard
          </button>
        )}

        <button className="btn-toolbar shrink-0" onClick={vm.handleShare} disabled={!vm.activeUserId}
          title={vm.activeUserId ? 'Copy a link containing only your own availability' : 'Select a user first'}
          style={vm.shareCopied
            ? { borderColor: 'var(--overlap-text)', color: 'var(--overlap-text)', background: 'var(--overlap-bg)' }
            : {}}>
          {vm.shareCopied ? '✓ Copied!' : '↗ Share'}
        </button>

        {/* Theme toggle */}
        <button className="btn-nav shrink-0" onClick={vm.toggleTheme}
          title={vm.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {vm.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>

        {/* Sharing — who may see my availability (Supabase mode only) */}
        {SUPABASE_ENABLED && auth.isAuthenticated && auth.approved && (
          <button className="btn-toolbar shrink-0" onClick={() => vm.setShowSharePanel(true)}
            title="Choose who can see your availability">
            ⚲ Sharing
          </button>
        )}

        {/* Auth */}
        {auth.isAuthenticated ? (
          <button className="btn-toolbar ml-1 shrink-0" onClick={() => auth.signOut()}
            title={`Signed in as ${auth.username}`} style={{ whiteSpace: 'nowrap' }}>
            {auth.username} · Sign out
          </button>
        ) : (
          <button className="btn-toolbar ml-1 shrink-0" onClick={() => vm.setShowAuthModal(true)}
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)', whiteSpace: 'nowrap' }}>
            Sign in
          </button>
        )}
      </header>

      {/* ── Pending-approval banner ──────────────────────────────────────── */}
      {SUPABASE_ENABLED && auth.isAuthenticated && auth.approved === false && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs shrink-0"
          style={{ background: 'var(--warning-bg)', color: 'var(--warning)', borderBottom: '0.5px solid var(--border)' }}>
          <span aria-hidden="true">⏳</span>
          Your account is awaiting approval by the administrator. You can look
          around, but your calendar stays inactive until then.
        </div>
      )}

      {/* ── Fast user-create panel ───────────────────────────────────────── */}
      {vm.showUserPanel && (
        <div className="flex flex-col gap-1.5 px-4 py-2 shrink-0"
          style={{ background: 'var(--accent-bg)', borderBottom: '0.5px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <input className="field-input flex-1" style={{ padding: '6px 12px' }} placeholder="Name…"
              value={vm.newName} onChange={e => vm.setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && vm.createUser()} autoFocus />
            <button onClick={vm.createUser} disabled={!vm.canCreateUser}
              className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)' }}>
              Add
            </button>
            <button onClick={() => vm.setShowUserPanel(false)} aria-label="Close"
              className="text-xl leading-none px-1" style={{ color: 'var(--text-muted)' }}>×</button>
          </div>
          {vm.addPersonIsTest && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Test mode — this persona lives only in your browser and is never
              saved to the server. Use “Sign in” for a real account.
            </p>
          )}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Calendar — always visible */}
        <main className="flex-1 overflow-hidden min-w-0">
          <MonthGrid />
        </main>

        {/* Desktop sidebar (hidden on mobile) */}
        <aside className={`hidden lg:flex ${STYLE.sidebarWidth} shrink-0 flex-col overflow-hidden`}
          style={{ borderLeft: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}>
          <DayView />
        </aside>

        {/* Mobile full-screen day overlay */}
        {vm.selectedDate && (
          <div className="lg:hidden fixed inset-0 z-30 flex flex-col"
            style={{ background: 'var(--bg-surface)', paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="flex items-center gap-3 px-4 py-3 shrink-0"
              style={{ borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}>
              <button onClick={vm.clearSelected} className="text-sm font-medium flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                ← Calendar
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <DayView />
            </div>
          </div>
        )}
      </div>

      {/* ── Overlays ─────────────────────────────────────────────────────── */}
      {vm.showAuthModal && <AuthModal onClose={() => vm.setShowAuthModal(false)} />}
      {vm.showSharePanel && auth.userId && (
        <SharePanel myUserId={auth.userId} onClose={() => vm.setShowSharePanel(false)} />
      )}
      {vm.showStatsPanel && <StatsPanel onClose={() => vm.setShowStatsPanel(false)} />}
    </div>
  )
}

// ─── ConnectionBadge ──────────────────────────────────────────────────────────

function ConnectionBadge() {
  const status = useConnectionStatus()
  const color  = STATUS_COLOR[status]
  return (
    <div title={STATUS_LABEL[status]} className="flex items-center gap-1 shrink-0 select-none"
      style={{
        fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 999,
        border: `0.5px solid ${color}50`, background: color + '18', color,
        transition: 'all 0.3s', whiteSpace: 'nowrap',
      }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0,
        animation: status === 'connecting' ? 'pulse 1.2s ease-in-out infinite' : 'none',
      }} />
      {STATUS_TEXT[status]}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
      <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
      <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

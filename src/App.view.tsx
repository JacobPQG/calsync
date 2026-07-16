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

import type { ReactNode } from 'react'
import type { Calendar } from './types'
import { OVERVIEW_CALENDAR_ID } from './types'
import { MonthGrid }     from './calendar/MonthGrid'
import { DayView }       from './sidebar/DayView'
import { AuthModal }     from './auth/AuthModal'
import { StatsPanel }    from './sports/StatsPanel'
import { ClaimScreen }   from './invite/ClaimScreen'
import { InvitePanel }   from './invite/InvitePanel'
import { HomeView }      from './calendars/HomeView'
import { CalendarAdmin } from './calendars/CalendarAdmin'
import { LandingPage }   from './landing/LandingPage'
import { DevPanel }      from './dev/DevPanel'
import { avatarEmoji }   from './auth/credentials'
import { SUPABASE_ENABLED } from './lib/supabase'
import { useConnectionStatus, type ConnStatus } from './lib/useConnectionStatus'
import { useAppVM } from './useAppVM'

// ── Visual constants ──────────────────────────────────────────────────────────
const STYLE = {
  headerHeight:    48,     // px
  sidebarWidth:    'w-96', // Tailwind — desktop day panel (floats over the calendar)
  sidebarInset:    12,     // px — gap between the day panel and the viewport edges
  calendarMaxW:    1360,   // px — cap for the month grid column; below it the grid
                           //       fills the viewport, so calendar + cells scale
                           //       with the browser size
  avatarFont:      10,     // px — user-pill initials (accounts with no avatar)
  avatarEmojiFont: 12,     // px — user-pill avatar emoji
} as const

// Connection-badge presentation (logic in useConnectionStatus).
const STATUS_LABEL: Record<ConnStatus, string> = {
  local:      'localStorage mode — no Supabase configured',
  demo:       'Live demo — sample data, nothing is saved',
  connecting: 'Connecting to Supabase…',
  ok:         'Supabase connected',
  error:      'Supabase connection failed — check console',
}
const STATUS_COLOR: Record<ConnStatus, string> = {
  local: '#635f57', demo: '#7F77DD', connecting: '#b45309', ok: '#16a34a', error: '#dc2626',
}
const STATUS_TEXT: Record<ConnStatus, string> = {
  local: 'Local', demo: 'Demo', connecting: '…', ok: 'Live', error: 'Error',
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const vm = useAppVM()

  // Demo mode: the shell renders EMBEDDED in the landing page's demo frame, so
  // it must fill its container (.demo-embed) instead of the viewport
  // (.app-shell) — the landing page owns the viewport and scrolls.
  const shellClass = vm.isDemo ? 'demo-embed' : 'app-shell'
  const wrap = (shell: ReactNode) =>
    vm.isDemo ? <LandingPage app={shell} /> : <>{shell}</>

  // Loading screen while initial data loads. The claim screen is layered on top
  // of it: someone arriving from a QR has no data to wait for and should see the
  // invite immediately, not a spinner.
  if (vm.isLoading) {
    return wrap(
      <div className={`${shellClass} flex items-center justify-center gap-3`}
        style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
        <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Loading calendar…</span>
        {vm.showClaimScreen && <ClaimScreen onClose={vm.dismissClaimScreen} />}
      </div>
    )
  }

  const { auth } = vm

  // Is a calendar open? If not we are on the HOME view, and every toolbar action
  // that operates on a calendar's events (import, export, share, leaderboard)
  // has nothing to operate on — so it is not drawn.
  const inCalendar = vm.activeCalendarId !== null

  return wrap(
    <div className={`${shellClass} flex flex-col`} style={{ background: 'var(--bg-base)' }}>

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-3 shrink-0 overflow-x-auto"
        style={{
          height: STYLE.headerHeight, minHeight: STYLE.headerHeight,
          borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-xs)', scrollbarWidth: 'none',
        }}>
        {/* The site name doubles as the way home when a calendar is open. */}
        <button onClick={vm.goHome} disabled={!inCalendar}
          className="font-semibold text-sm tracking-tight select-none shrink-0 disabled:cursor-default"
          style={{ color: 'var(--text)' }}
          title={inCalendar ? 'Back to your calendars' : undefined}>
          {inCalendar ? `← ${vm.siteName}` : vm.siteName}
        </button>

        <ConnectionBadge />

        {/* Local dev only — renders nothing in a production build. */}
        <DevPanel />

        {/* Which calendar am I looking at — and the way to any other. A select
            rather than a label: two calendars are indistinguishable once you are
            inside one, they are the privacy boundary, and switching between them
            (or to the all-my-events overview) should not require the trip home. */}
        {inCalendar && (
          <CalendarSwitcher
            value={vm.isOverview ? OVERVIEW_CALENDAR_ID : vm.activeCalendarId!}
            calendars={vm.calendars}
            fallbackName={vm.activeCalendar?.name ?? null}
            onPick={id => id === OVERVIEW_CALENDAR_ID ? vm.openOverview() : vm.openCalendar(id)}
          />
        )}

        <div className="h-4 w-px mx-0.5 shrink-0" style={{ background: 'var(--border)' }} />

        {/* People only exist in the context of a calendar: a pill selects whose
            availability you are posting as, and on the home view there is no
            calendar to post into. Drawing them there also showed the whole SITE
            directory — every account, not the members of anything — which is both
            meaningless and more than the home view should say. */}
        {inCalendar && (
          <>
            {/* The icon is the avatar the user picked at signup; accounts that
                predate avatars fall back to their initial. */}
            {vm.users.map(u => {
              const emoji = avatarEmoji(u.avatar)
              return (
                <button key={u.id} onClick={() => vm.setActiveUser(u.id)}
                  className="flex items-center gap-1.5 rounded-full text-xs border transition-all shrink-0"
                  style={{
                    padding: '3px 10px 3px 6px', whiteSpace: 'nowrap',
                    ...(u.id === vm.activeUserId
                      ? { borderColor: u.color, color: u.color, background: u.color + '18' }
                      : { borderColor: 'var(--border)', color: 'var(--text-muted)' }),
                  }}>
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
                    style={{
                      background: emoji ? 'transparent' : u.color,
                      fontSize:   emoji ? STYLE.avatarEmojiFont : STYLE.avatarFont,
                    }}>
                    {emoji ?? u.name[0].toUpperCase()}
                  </span>
                  {u.name}
                </button>
              )
            })}

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
          </>
        )}

        <div className="flex-1 shrink-0" style={{ minWidth: 8 }} />

        {vm.importFeedback && (
          <span className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0"
            style={{ background: 'var(--overlap-bg)', color: 'var(--overlap-text)', whiteSpace: 'nowrap' }}>
            ✓ {vm.importFeedback}
          </span>
        )}

        <input ref={vm.icalInputRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={vm.handleImportIcal} />

        {/* These act on the OPEN calendar's events, so they only exist inside one.
            The writes (Import, Share) also stay off the OVERVIEW — it is a
            read-only aggregation with no single calendar for them to land in.
            Export remains: it only carries what the viewer can already see. */}
        {inCalendar && (
          <>
            {!vm.isOverview && (
              <button className="btn-toolbar shrink-0" onClick={vm.triggerImport}
                disabled={!vm.activeUserId} title={vm.activeUserId ? 'Import a .ics file' : 'Select a user first'}>
                ↑ Import
              </button>
            )}

            <button className="btn-toolbar shrink-0" onClick={vm.exportIcal} title="Export as .ics">
              ↓ Export
            </button>

            {/* Leaderboard / challenges — admin-activated site elements */}
            {vm.showStatsButton && (
              <button className="btn-toolbar shrink-0" onClick={() => vm.setShowStatsPanel(true)} title="Leaderboard & challenges">
                🏆 Leaderboard
              </button>
            )}

            {!vm.isOverview && (
              <button className="btn-toolbar shrink-0" onClick={vm.handleShare} disabled={!vm.activeUserId}
                title={vm.activeUserId ? 'Copy a link containing only your own availability' : 'Select a user first'}
                style={vm.shareCopied
                  ? { borderColor: 'var(--overlap-text)', color: 'var(--overlap-text)', background: 'var(--overlap-bg)' }
                  : {}}>
                {vm.shareCopied ? '✓ Copied!' : '↗ Share'}
              </button>
            )}
          </>
        )}

        {/* Theme toggle */}
        <button className="btn-nav shrink-0" onClick={vm.toggleTheme}
          title={vm.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {vm.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>

        {/* Manage the open calendar — members, invites, settings. Drawn only for
            a calendar you own; every RPC behind it re-checks ownership anyway. */}
        {inCalendar && vm.canAdminActive && (
          <button className="btn-toolbar shrink-0"
            onClick={() => vm.openAdmin(vm.activeCalendarId!)}
            title="Members, invites and settings for this calendar">
            ⚙ Manage
          </button>
        )}

        {/* SITE invites — site admins only (these create ACCOUNTS). Calendar
            invites are minted in a calendar's own Manage panel. */}
        {vm.isAdmin && (
          <button className="btn-toolbar shrink-0" onClick={() => vm.setShowInvitePanel(true)}
            title="Create a site invite (a new account)">
            ⊞ Invite
          </button>
        )}

        {/* Auth. A guest has no username (anonymous session) and no way back in
            after signing out — handleSignOut confirms that with them first.
            In DEMO mode there is no backend to authenticate against, so the
            button leaves the demo for the real app instead of opening the
            modal (demo/demoMode.ts). */}
        {auth.isAuthenticated ? (
          <button className="btn-toolbar ml-1 shrink-0" onClick={vm.handleSignOut}
            title={auth.isGuest
              ? 'You joined as a guest — signing out is permanent'
              : `Signed in as ${auth.username}`}
            style={{ whiteSpace: 'nowrap' }}>
            {auth.isGuest ? 'Guest' : auth.username} · Sign out
          </button>
        ) : (
          <button className="btn-toolbar ml-1 shrink-0"
            onClick={() => vm.isDemo ? vm.exitDemo() : vm.setShowAuthModal(true)}
            title={vm.isDemo ? 'Leave the demo and sign in to the real app' : undefined}
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)', whiteSpace: 'nowrap' }}>
            Sign in
          </button>
        )}
      </header>

      {/* ── Failed-write banner ──────────────────────────────────────────── */}
      {/* A rejected save was rolled back off the screen; this says why, so the
          event's disappearance never reads as a glitch. Dismissible. */}
      {vm.lastError && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs shrink-0"
          style={{ background: 'var(--danger-bg)', color: 'var(--danger)', borderBottom: '0.5px solid var(--danger-border)' }}>
          <span aria-hidden="true">⚠</span>
          <span className="flex-1">{vm.lastError}</span>
          <button onClick={vm.dismissError} aria-label="Dismiss error"
            className="text-base leading-none px-1" style={{ color: 'var(--danger)' }}>×</button>
        </div>
      )}

      {/* ── Pending-approval banner ──────────────────────────────────────── */}
      {/* Never for guests: they are unapproved BY DESIGN (ADR-18) and fully
          usable — "awaiting approval" would be both wrong and alarming. */}
      {SUPABASE_ENABLED && auth.isAuthenticated && auth.approved === false && !auth.isGuest && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs shrink-0"
          style={{ background: 'var(--warning-bg)', color: 'var(--warning)', borderBottom: '0.5px solid var(--border)' }}>
          <span aria-hidden="true">⏳</span>
          Your account is awaiting approval by the administrator. You can look
          around, but your calendar stays inactive until then.
        </div>
      )}

      {/* ── Fast user-create panel ───────────────────────────────────────── */}
      {/* Bound to the same `inCalendar` condition as the button that opens it —
          otherwise it survives the trip back to the home view, where the person
          it would create has no calendar to belong to. */}
      {inCalendar && vm.showUserPanel && (
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
      {/* Two routes, and only two: the HOME view (pick a calendar) and one open
          calendar. Everything else in the app is a modal over one of them. */}
      {!inCalendar ? (
        <HomeView onOpen={vm.openCalendar} onAdmin={vm.openAdmin}
          onOpenOverview={vm.openOverview} />
      ) : (
        <div className="relative flex-1 overflow-hidden">

          {/* The month grid: centered, top-aligned, same fixed column for EVERY
              calendar (overview included). Switching calendars therefore changes
              only the grid's contents, never its position — it reads as the
              calendar updating, not as navigation. The grid ignores the day
              panel below on purpose: the panel overlays instead of squeezing it,
              so the calendar does not jump when a day is picked. */}
          <main className="h-full overflow-y-auto">
            <div className="mx-auto h-full" style={{ maxWidth: STYLE.calendarMaxW }}>
              <MonthGrid />
            </div>
          </main>

          {/* Desktop day panel ("time selection"). Absolutely positioned on the
              right so it HOVERS OVER the calendar when the viewport is too
              narrow for both; on a wide screen it lands in the empty margin
              beside the centered grid and covers nothing. Inset from the top,
              right and bottom edges so it reads as a floating card rather than
              a full-height wall. Only exists while a day is selected — closed,
              the calendar has the whole stage. */}
          {vm.selectedDate && (
            <aside
              className={`hidden lg:flex ${STYLE.sidebarWidth} flex-col overflow-hidden absolute z-20`}
              style={{
                top: STYLE.sidebarInset, right: STYLE.sidebarInset, bottom: STYLE.sidebarInset,
                border: '0.5px solid var(--border)', borderRadius: 14,
                background: 'var(--bg-surface)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
              }}>
              <div className="flex justify-end px-2 pt-2 shrink-0">
                <button onClick={vm.clearSelected} aria-label="Close day panel"
                  className="text-lg leading-none px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--text-muted)' }}>
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <DayView />
              </div>
            </aside>
          )}

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
      )}

      {/* ── Overlays ─────────────────────────────────────────────────────── */}
      {vm.showAuthModal && <AuthModal onClose={() => vm.setShowAuthModal(false)} />}
      {vm.showStatsPanel && <StatsPanel onClose={() => vm.setShowStatsPanel(false)} />}
      {vm.showInvitePanel && <InvitePanel onClose={() => vm.setShowInvitePanel(false)} />}

      {/* A calendar's own admin panel: members, bulk QR invites, settings. */}
      {vm.adminCalendarId && (
        <CalendarAdmin
          calendarId={vm.adminCalendarId}
          onClose={vm.closeAdmin}
          // The calendar is gone — there is nothing left to be looking at.
          onDeleted={vm.goHome} />
      )}

      {/* Arrived from a QR invite. Rendered last so it sits above everything —
          someone scanning a code should land on the claim screen, not on a
          calendar with a modal somewhere behind it. */}
      {vm.showClaimScreen && <ClaimScreen onClose={vm.dismissClaimScreen} />}
    </div>
  )
}

// ─── CalendarSwitcher ─────────────────────────────────────────────────────────
// The header's calendar picker: the overview first, then the calendars you own,
// then the ones you were invited into — the same order as the home view. A
// pending membership is listed but not selectable: RLS would hand it an empty
// grid, which reads as "broken" rather than "waiting".

function CalendarSwitcher({ value, calendars, fallbackName, onPick }: {
  value:        string
  calendars:    Calendar[]
  // Name to show while the calendar list is still in flight (the open calendar
  // is then not in `calendars` yet, and a bare id would be gibberish).
  fallbackName: string | null
  onPick:       (id: string) => void
}) {
  const owned   = calendars.filter(c =>  c.isOwner)
  const joined  = calendars.filter(c => !c.isOwner)
  const inList  = value === OVERVIEW_CALENDAR_ID || calendars.some(c => c.id === value)

  return (
    <select
      className="shrink-0 text-xs font-medium rounded-lg cursor-pointer"
      style={{
        maxWidth: 200, padding: '3px 6px',
        background: 'var(--bg-subtle)', color: 'var(--text-2)',
        border: '0.5px solid var(--border)',
      }}
      value={inList ? value : ''}
      onChange={e => { if (e.target.value && e.target.value !== value) onPick(e.target.value) }}
      title="Switch calendar"
      aria-label="Switch calendar">
      {!inList && <option value="" disabled>{fallbackName ?? 'Loading…'}</option>}
      <option value={OVERVIEW_CALENDAR_ID}>👁 All my events</option>
      {owned.length > 0 && (
        <optgroup label="My calendars">
          {owned.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      )}
      {joined.length > 0 && (
        <optgroup label="Shared with me">
          {joined.map(c => (
            <option key={c.id} value={c.id} disabled={c.myStatus === 'pending'}>
              {c.name}{c.myStatus === 'pending' ? ' — awaiting approval' : ''}
            </option>
          ))}
        </optgroup>
      )}
    </select>
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

// ─── App.tsx ──────────────────────────────────────────────────────────────────
// Root component. Responsible for:
//   • Calling store.initialize() once on mount
//   • Loading screen while data is fetched
//   • Top bar: branding, user switcher, toolbar actions, theme toggle
//   • Auth modal (sign-in / sign-up)
//   • Body layout:
//       Desktop (≥ lg): calendar grid + day sidebar side-by-side
//       Mobile  (< lg): calendar full-width; day view as full-screen overlay
//                       when a date is selected

import { useState, useEffect, useRef } from 'react'
import { MonthGrid }              from './calendar/MonthGrid'
import { DayView }                from './sidebar/DayView'
import { useStore }               from './store/useStore'
import { copyShareUrl }           from './sharing/urlState'
import { downloadIcal, parseIcal } from './ical/icalUtils'
import { useAuthSession }         from './auth/useAuth'
import { AuthModal }              from './auth/AuthModal'

const MAX_ICAL_IMPORT = 200

export default function App() {
  const {
    users, events, activeUserId,
    setActiveUser, createUser, addEvent,
    isLoading, initialize,
    selectedDate, setSelectedDate,
  } = useStore()

  const auth = useAuthSession()

  const [newName,        setNewName]        = useState('')
  const [showUserPanel,  setShowUserPanel]  = useState(false)
  const [showAuthModal,  setShowAuthModal]  = useState(false)
  const [shareCopied,    setShareCopied]    = useState(false)
  const [importFeedback, setImportFeedback] = useState<string | null>(null)
  const [theme,          setTheme]          = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('calsync-theme') as 'dark' | 'light' | null) ?? 'dark'
  )

  const icalInputRef = useRef<HTMLInputElement>(null)

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => { initialize() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem('calsync-theme', theme)
  }, [theme])

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen gap-3"
        style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
        <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
          Loading calendar…
        </span>
      </div>
    )
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreateUser() {
    if (newName.trim().length < 2) return
    createUser(newName.trim())
    setNewName('')
    setShowUserPanel(false)
  }

  async function handleShare() {
    const ok = await copyShareUrl(users, events)
    if (ok) { setShareCopied(true); setTimeout(() => setShareCopied(false), 2200) }
  }

  function handleImportIcal(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeUserId) return
    const reader = new FileReader()
    reader.onload = ev => {
      const all       = parseIcal(ev.target?.result as string)
      const truncated = all.length > MAX_ICAL_IMPORT
      const parsed    = truncated ? all.slice(0, MAX_ICAL_IMPORT) : all
      parsed.forEach(p => addEvent({
        userId:      activeUserId,
        title:       p.title,
        description: p.description,
        tags:        p.tags,
        date:        p.date,
        startHour:   p.startHour,
        endHour:     p.endHour,
        location:    p.location ? { name: p.location } : undefined,
        eventUrl:    p.eventUrl,
        recurring:   { frequency: 'none' },
      }))
      const msg = truncated
        ? `Imported first ${MAX_ICAL_IMPORT} of ${all.length} events`
        : `Imported ${parsed.length} event${parsed.length !== 1 ? 's' : ''}`
      setImportFeedback(msg)
      setTimeout(() => setImportFeedback(null), 3000)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg-base)' }}>

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-2 px-3 shrink-0 overflow-x-auto"
        style={{
          height: '48px',
          minHeight: '48px',
          borderBottom: '0.5px solid var(--border)',
          background: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-xs)',
          scrollbarWidth: 'none',
        }}
      >
        <span className="font-semibold text-sm tracking-tight select-none shrink-0"
          style={{ color: 'var(--text)', marginRight: 4 }}>
          CalSync
        </span>

        <div className="h-4 w-px mx-0.5 shrink-0" style={{ background: 'var(--border)' }} />

        {/* User pills */}
        {users.map(u => (
          <button
            key={u.id}
            onClick={() => setActiveUser(u.id)}
            className="flex items-center gap-1.5 rounded-full text-xs border transition-all shrink-0"
            style={{
              padding: '3px 10px 3px 6px',
              whiteSpace: 'nowrap',
              ...(u.id === activeUserId
                ? { borderColor: u.color, color: u.color, background: u.color + '18' }
                : { borderColor: 'var(--border)', color: 'var(--text-muted)' }),
            }}
          >
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
              style={{ background: u.color, fontSize: 9 }}>
              {u.name[0].toUpperCase()}
            </span>
            {u.name}
          </button>
        ))}

        <button
          onClick={() => setShowUserPanel(v => !v)}
          className="flex items-center gap-1 rounded-full border border-dashed text-xs transition-colors shrink-0"
          style={{
            padding: '3px 10px',
            whiteSpace: 'nowrap',
            borderColor: showUserPanel ? 'var(--accent)' : 'var(--border)',
            color:       showUserPanel ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          + person
        </button>

        <div className="flex-1 shrink-0" style={{ minWidth: 8 }} />

        {importFeedback && (
          <span className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0"
            style={{ background: 'var(--overlap-bg)', color: 'var(--overlap-text)', whiteSpace: 'nowrap' }}>
            ✓ {importFeedback}
          </span>
        )}

        <input ref={icalInputRef} type="file" accept=".ics,text/calendar"
          className="hidden" onChange={handleImportIcal} />

        <button className="btn-toolbar shrink-0" onClick={() => icalInputRef.current?.click()}
          disabled={!activeUserId} title={activeUserId ? 'Import a .ics file' : 'Select a user first'}>
          ↑ Import
        </button>

        <button className="btn-toolbar shrink-0" onClick={() => downloadIcal(events, users)} title="Export as .ics">
          ↓ Export
        </button>

        <button
          className="btn-toolbar shrink-0"
          onClick={handleShare}
          title="Copy shareable URL"
          style={shareCopied ? { borderColor: '#16a34a', color: '#16a34a', background: 'var(--overlap-bg)' } : {}}
        >
          {shareCopied ? '✓ Copied!' : '↗ Share'}
        </button>

        {/* Theme toggle */}
        <button
          className="btn-nav shrink-0"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark'
            ? (
              // Sun icon
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4"/>
                <line x1="12" y1="2"     x2="12" y2="5"/>
                <line x1="12" y1="19"    x2="12" y2="22"/>
                <line x1="4.22" y1="4.22"  x2="6.34" y2="6.34"/>
                <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
                <line x1="2" y1="12"     x2="5" y2="12"/>
                <line x1="19" y1="12"    x2="22" y2="12"/>
                <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/>
                <line x1="17.66" y1="6.34"  x2="19.78" y2="4.22"/>
              </svg>
            )
            : (
              // Moon icon
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )
          }
        </button>

        {/* Auth */}
        {auth.isAuthenticated ? (
          <button
            className="btn-toolbar ml-1 shrink-0"
            onClick={() => auth.signOut()}
            title={`Signed in as ${auth.email}`}
            style={{ whiteSpace: 'nowrap' }}
          >
            {auth.email?.split('@')[0]} · Sign out
          </button>
        ) : (
          <button
            className="btn-toolbar ml-1 shrink-0"
            onClick={() => setShowAuthModal(true)}
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)', whiteSpace: 'nowrap' }}
          >
            Sign in
          </button>
        )}
      </header>

      {/* ── New local-user panel ─────────────────────────────────────────── */}
      {showUserPanel && (
        <div className="flex items-center gap-2 px-4 py-2 shrink-0"
          style={{ background: 'var(--accent-bg)', borderBottom: '0.5px solid #c7d2fe' }}>
          <input
            className="flex-1 text-sm rounded-lg px-3 py-1.5 border"
            style={{ borderColor: '#c7d2fe', background: '#fff' }}
            placeholder="Your name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateUser()}
            autoFocus
          />
          <button
            onClick={handleCreateUser}
            disabled={newName.trim().length < 2}
            className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            Join
          </button>
          <button onClick={() => setShowUserPanel(false)}
            className="text-xl leading-none px-1" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Calendar — always visible */}
        <main className="flex-1 overflow-hidden min-w-0">
          <MonthGrid />
        </main>

        {/* Desktop sidebar (hidden on mobile) */}
        <aside
          className="hidden lg:flex w-80 shrink-0 flex-col overflow-hidden"
          style={{ borderLeft: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <DayView />
        </aside>

        {/* Mobile full-screen day overlay — shown when a date is selected */}
        {selectedDate && (
          <div
            className="lg:hidden fixed inset-0 z-30 flex flex-col"
            style={{ background: 'var(--bg-surface)' }}
          >
            <div
              className="flex items-center gap-3 px-4 py-3 shrink-0"
              style={{ borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}
            >
              <button
                onClick={() => setSelectedDate(null)}
                className="text-sm font-medium flex items-center gap-1"
                style={{ color: 'var(--text-2)' }}
              >
                ← Calendar
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <DayView />
            </div>
          </div>
        )}
      </div>

      {/* ── Auth modal ───────────────────────────────────────────────────── */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}

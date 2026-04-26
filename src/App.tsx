// ─── App.tsx ──────────────────────────────────────────────────────────────────
// Root component. Responsible for:
//   • Calling store.initialize() once on mount (loads Supabase or localStorage)
//   • Rendering the loading screen while data is fetched
//   • Top bar: branding, user switcher, toolbar actions
//   • Auth modal (sign-in / sign-up)
//   • Body layout: calendar grid + day sidebar

import { useState, useEffect, useRef } from 'react'
import { MonthGrid }         from './calendar/MonthGrid'
import { DayView }           from './sidebar/DayView'
import { useStore }          from './store/useStore'
import { copyShareUrl }      from './sharing/urlState'
import { downloadIcal, parseIcal } from './ical/icalUtils'
import { useAuthSession }    from './auth/useAuth'
import { AuthModal }         from './auth/AuthModal'

export default function App() {
  const {
    users, events, activeUserId,
    setActiveUser, createUser, addEvent,
    isLoading, initialize,
  } = useStore()

  const auth = useAuthSession()

  const [newName,        setNewName]        = useState('')
  const [showUserPanel,  setShowUserPanel]  = useState(false)
  const [showAuthModal,  setShowAuthModal]  = useState(false)
  const [shareCopied,    setShareCopied]    = useState(false)
  const [importFeedback, setImportFeedback] = useState<string | null>(null)

  const icalInputRef = useRef<HTMLInputElement>(null)

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  // initialize() loads data from Supabase (or localStorage) and wires up
  // Realtime subscriptions. Called exactly once when the app mounts.
  useEffect(() => {
    initialize()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading screen ─────────────────────────────────────────────────────────
  // Shown while initialize() is running. In localStorage mode this is
  // virtually instant; in Supabase mode it takes one round-trip.
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-screen gap-3"
        style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}
      >
        <svg
          className="animate-spin"
          width="20" height="20" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
          Loading calendar…
        </span>
      </div>
    )
  }

  // ── User management ─────────────────────────────────────────────────────────

  function handleCreateUser() {
    if (newName.trim().length < 2) return
    createUser(newName.trim())
    setNewName('')
    setShowUserPanel(false)
  }

  // ── Sharing ─────────────────────────────────────────────────────────────────

  async function handleShare() {
    const ok = await copyShareUrl(users, events)
    if (ok) { setShareCopied(true); setTimeout(() => setShareCopied(false), 2200) }
  }

  // ── iCal ────────────────────────────────────────────────────────────────────

  function handleImportIcal(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeUserId) return
    const reader = new FileReader()
    reader.onload = ev => {
      const parsed = parseIcal(ev.target?.result as string)
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
      const msg = `Imported ${parsed.length} event${parsed.length !== 1 ? 's' : ''}`
      setImportFeedback(msg)
      setTimeout(() => setImportFeedback(null), 3000)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg-base)' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-2 px-4 shrink-0"
        style={{
          height: '48px',
          borderBottom: '0.5px solid var(--border)',
          background: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <span
          className="font-semibold text-sm tracking-tight select-none"
          style={{ color: 'var(--text)', marginRight: 4 }}
        >
          CalSync
        </span>

        <div className="h-4 w-px mx-0.5" style={{ background: 'var(--border)' }} />

        {/* User pills */}
        {users.map(u => (
          <button
            key={u.id}
            onClick={() => setActiveUser(u.id)}
            className="flex items-center gap-1.5 rounded-full text-xs border transition-all"
            style={{
              padding: '3px 10px 3px 6px',
              ...(u.id === activeUserId
                ? { borderColor: u.color, color: u.color, background: u.color + '18' }
                : { borderColor: 'var(--border)', color: 'var(--text-muted)' }),
            }}
          >
            <span
              className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
              style={{ background: u.color, fontSize: 9 }}
            >
              {u.name[0].toUpperCase()}
            </span>
            {u.name}
          </button>
        ))}

        {/* Add local person (no auth required) */}
        <button
          onClick={() => setShowUserPanel(v => !v)}
          className="flex items-center gap-1 rounded-full border border-dashed text-xs transition-colors"
          style={{
            padding: '3px 10px',
            borderColor: showUserPanel ? 'var(--accent)' : 'var(--border)',
            color:       showUserPanel ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          + person
        </button>

        <div className="flex-1" />

        {/* Import feedback toast */}
        {importFeedback && (
          <span
            className="text-xs px-2.5 py-1 rounded-md font-medium"
            style={{ background: 'var(--overlap-bg)', color: 'var(--overlap-text)' }}
          >
            ✓ {importFeedback}
          </span>
        )}

        <input
          ref={icalInputRef}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={handleImportIcal}
        />

        <button
          className="btn-toolbar"
          onClick={() => icalInputRef.current?.click()}
          disabled={!activeUserId}
          style={!activeUserId ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
          title={activeUserId ? 'Import a .ics file' : 'Select a user first'}
        >
          ↑ Import
        </button>

        <button className="btn-toolbar" onClick={() => downloadIcal(events, users)} title="Export as .ics">
          ↓ Export
        </button>

        <button
          className="btn-toolbar"
          onClick={handleShare}
          title="Copy shareable URL (full state encoded in the hash)"
          style={shareCopied ? { borderColor: '#16a34a', color: '#16a34a', background: 'var(--overlap-bg)' } : {}}
        >
          {shareCopied ? '✓ Copied!' : '↗ Share'}
        </button>

        {/* Auth button — shows user email when signed in */}
        {auth.isAuthenticated ? (
          <button
            className="btn-toolbar ml-1"
            onClick={() => auth.signOut()}
            title={`Signed in as ${auth.email}`}
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          >
            {auth.email?.split('@')[0]} · Sign out
          </button>
        ) : (
          <button
            className="btn-toolbar ml-1"
            onClick={() => setShowAuthModal(true)}
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }}
            title="Sign in with email/password to sync across devices"
          >
            Sign in
          </button>
        )}
      </header>

      {/* ── New local-user panel ─────────────────────────────────────────── */}
      {showUserPanel && (
        <div
          className="flex items-center gap-2 px-4 py-2 shrink-0"
          style={{ background: 'var(--accent-bg)', borderBottom: '0.5px solid #c7d2fe' }}
        >
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
          <button
            onClick={() => setShowUserPanel(false)}
            className="text-xl leading-none px-1"
            style={{ color: 'var(--text-muted)' }}
          >×</button>
        </div>
      )}

      {/* ── Body: calendar + sidebar ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          <MonthGrid />
        </main>
        <aside
          className="w-80 shrink-0 flex flex-col overflow-hidden"
          style={{ borderLeft: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <DayView />
        </aside>
      </div>

      {/* ── Auth modal ───────────────────────────────────────────────────── */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}

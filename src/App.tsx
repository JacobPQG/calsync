// ─── App.tsx ──────────────────────────────────────────────────────────────────
// Root component. Responsible for the outer shell only:
//   • Top bar (branding, user switcher, toolbar actions)
//   • New-user panel (inline, collapsible)
//   • Body layout: calendar grid + day sidebar
//
// Business logic (state mutations, recurrence, sharing) lives in:
//   store/useStore.ts  ·  sharing/urlState.ts  ·  ical/icalUtils.ts

import { useState, useRef } from 'react'
import { MonthGrid }         from './calendar/MonthGrid'
import { DayView }           from './sidebar/DayView'
import { useStore }          from './store/useStore'
import { copyShareUrl }      from './sharing/urlState'
import { downloadIcal, parseIcal } from './ical/icalUtils'
import { useAuthSession }    from './auth/stub'

export default function App() {
  const { users, events, activeUserId, setActiveUser, createUser, addEvent } = useStore()
  const auth = useAuthSession()

  const [newName,          setNewName]          = useState('')
  const [showUserPanel,    setShowUserPanel]    = useState(false)
  const [shareCopied,      setShareCopied]      = useState(false)
  const [importFeedback,   setImportFeedback]   = useState<string | null>(null)

  // Hidden <input type="file"> for iCal import – triggered by the toolbar button
  const icalInputRef = useRef<HTMLInputElement>(null)

  // ── User management ──────────────────────────────────────────────────────

  function handleCreateUser() {
    if (newName.trim().length < 2) return
    createUser(newName.trim())
    setNewName('')
    setShowUserPanel(false)
  }

  // ── Sharing ──────────────────────────────────────────────────────────────

  async function handleShare() {
    const ok = await copyShareUrl(users, events)
    if (ok) {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2200)
    }
  }

  // ── iCal export ──────────────────────────────────────────────────────────

  function handleExportIcal() {
    downloadIcal(events, users)
  }

  // ── iCal import ──────────────────────────────────────────────────────────
  // Reads a .ics file selected by the user. Each parsed VEVENT is added to
  // the currently active user's calendar.

  function handleImportIcal(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeUserId) return

    const reader = new FileReader()
    reader.onload = ev => {
      const text   = ev.target?.result as string
      const parsed = parseIcal(text)

      parsed.forEach(p => {
        addEvent({
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
        })
      })

      const msg = `Imported ${parsed.length} event${parsed.length !== 1 ? 's' : ''}`
      setImportFeedback(msg)
      setTimeout(() => setImportFeedback(null), 3000)
    }
    reader.readAsText(file)
    e.target.value = ''  // allow re-importing the same file
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg-base)' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-2 px-4 shrink-0"
        style={{
          height: '48px',
          borderBottom: '0.5px solid var(--border)',
          background: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        {/* Wordmark */}
        <span
          className="font-semibold text-sm tracking-tight select-none"
          style={{ color: 'var(--text)', marginRight: 4 }}
        >
          CalSync
        </span>

        <div className="h-4 w-px mx-0.5" style={{ background: 'var(--border)' }} />

        {/* User pills – click a pill to make that user "active" */}
        {users.map(u => (
          <button
            key={u.id}
            onClick={() => setActiveUser(u.id)}
            className="flex items-center gap-1.5 rounded-full text-xs border transition-all"
            style={{
              padding: '3px 10px 3px 6px',
              ...(u.id === activeUserId
                ? { borderColor: u.color, color: u.color, background: u.color + '18' }
                : { borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'transparent' }),
            }}
          >
            {/* Avatar circle with user initial */}
            <span
              className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold leading-none"
              style={{ background: u.color, fontSize: 9 }}
            >
              {u.name[0].toUpperCase()}
            </span>
            {u.name}
          </button>
        ))}

        {/* Add new person */}
        <button
          onClick={() => setShowUserPanel(v => !v)}
          className="flex items-center gap-1 rounded-full border border-dashed text-xs transition-colors"
          style={{
            padding: '3px 10px',
            borderColor: showUserPanel ? 'var(--accent)' : 'var(--border)',
            color: showUserPanel ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          + person
        </button>

        {/* Push toolbar buttons to the right */}
        <div className="flex-1" />

        {/* Import result toast */}
        {importFeedback && (
          <span
            className="text-xs px-2.5 py-1 rounded-md font-medium"
            style={{ background: 'var(--overlap-bg)', color: 'var(--overlap-text)' }}
          >
            ✓ {importFeedback}
          </span>
        )}

        {/* Hidden file input for iCal import */}
        <input
          ref={icalInputRef}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={handleImportIcal}
        />

        {/* Toolbar action buttons */}
        <button
          className="btn-toolbar"
          onClick={() => icalInputRef.current?.click()}
          title={activeUserId ? 'Import a .ics calendar file' : 'Select a user first to import'}
          disabled={!activeUserId}
          style={!activeUserId ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
        >
          ↑ Import
        </button>

        <button className="btn-toolbar" onClick={handleExportIcal} title="Export all events as .ics">
          ↓ Export
        </button>

        <button
          className="btn-toolbar"
          onClick={handleShare}
          title="Copy shareable link with all events encoded in the URL"
          style={
            shareCopied
              ? { borderColor: '#16a34a', color: '#16a34a', background: 'var(--overlap-bg)' }
              : {}
          }
        >
          {shareCopied ? '✓ Copied!' : '↗ Share'}
        </button>

        {/* Auth placeholder — see src/auth/stub.ts to wire up a real provider */}
        {!auth.isAuthenticated && (
          <button
            className="btn-toolbar ml-1"
            onClick={auth.signIn}
            title="Sign in (auth not yet configured — see src/auth/stub.ts)"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }}
          >
            Sign in
          </button>
        )}
      </header>

      {/* ── New-user inline panel ────────────────────────────────────────── */}
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
            className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40 transition-opacity"
            style={{ background: 'var(--accent)' }}
          >
            Join
          </button>
          <button
            onClick={() => setShowUserPanel(false)}
            className="text-xl leading-none px-1"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Body: calendar + day sidebar ────────────────────────────────── */}
      {/* The sidebar (w-80 = 320px) is always mounted; DayView renders a
          placeholder when no date is selected, so it always occupies its space. */}
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
    </div>
  )
}

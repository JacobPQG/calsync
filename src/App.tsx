// ─── App.tsx ──────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { MonthGrid } from './calendar/MonthGrid'
import { DayView } from './sidebar/DayView'
import { useStore } from './store/useStore'

export default function App() {
  const { users, activeUserId, setActiveUser, createUser } = useStore()
  const [newName, setNewName] = useState('')
  const [showUserPanel, setShowUserPanel] = useState(false)

  function handleCreateUser() {
    if (newName.trim().length < 2) return
    createUser(newName.trim())
    setNewName('')
    setShowUserPanel(false)
  }

  return (
    <div className="flex flex-col h-screen bg-background font-sans">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 h-12 border-b border-divider bg-surface shrink-0">
        <span className="font-medium text-sm flex-1 tracking-tight">CalSync</span>

        {/* User pills */}
        {users.map(u => (
          <button
            key={u.id}
            onClick={() => setActiveUser(u.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors ${
              u.id === activeUserId
                ? 'border-current font-medium'
                : 'border-divider text-muted'
            }`}
            style={u.id === activeUserId ? { borderColor: u.color, color: u.color } : {}}
          >
            <span
              className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] text-white font-bold"
              style={{ background: u.color }}
            >
              {u.name[0].toUpperCase()}
            </span>
            {u.name}
          </button>
        ))}

        <button
          onClick={() => setShowUserPanel(v => !v)}
          className="flex items-center gap-1 px-3 py-1 rounded-full border border-dashed border-divider text-xs text-muted hover:border-purple-400 hover:text-purple-600 transition-colors"
        >
          + person
        </button>
      </header>

      {/* New user panel */}
      {showUserPanel && (
        <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 border-b border-purple-100">
          <input
            className="flex-1 text-sm border border-divider rounded-lg px-3 py-1.5 bg-white"
            placeholder="Your name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateUser()}
            autoFocus
          />
          <button
            onClick={handleCreateUser}
            className="px-4 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-40"
            disabled={newName.trim().length < 2}
          >
            Join
          </button>
          <button onClick={() => setShowUserPanel(false)} className="text-muted text-lg leading-none px-1">×</button>
        </div>
      )}

      {/* Main layout: calendar + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          <MonthGrid />
        </main>
        <aside className="w-64 border-l border-divider overflow-hidden shrink-0">
          <DayView />
        </aside>
      </div>
    </div>
  )
}

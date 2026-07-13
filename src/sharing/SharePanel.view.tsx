// ─── SharePanel View ──────────────────────────────────────────────────────────
// PURE VIEW. Grant loading/toggling is in useSharePanelVM.ts. Reshape freely.
//
// Editing guide:
//   • Row layout, avatar size, badge look → STYLE / JSX below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior (which grants exist, toggling) → useSharePanelVM.ts.

import { useSharePanelVM } from './useSharePanelVM'

interface Props {
  myUserId: string
  onClose:  () => void
}

const STYLE = {
  maxWidth: 'max-w-sm',
} as const

export function SharePanel({ myUserId, onClose }: Props) {
  const vm = useSharePanelVM(myUserId)

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-card w-full ${STYLE.maxWidth} overflow-y-auto rounded-xl shadow-xl`}
        style={{ background: 'var(--bg-surface)' }}>

        {/* Header */}
        <div className="flex items-center px-5 py-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <div className="flex-1">
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Share my calendar</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Only people you toggle on can see your availability.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        {/* Body */}
        <div className="p-3">
          {vm.loading ? (
            <p className="text-xs px-2 py-3" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : vm.others.length === 0 ? (
            <p className="text-xs px-2 py-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              No other approved members yet. Once someone else joins, they'll
              appear here and you can choose to share your calendar with them.
            </p>
          ) : (
            <ul className="space-y-1">
              {vm.others.map(u => {
                const shared = vm.isShared(u.id)
                return (
                  <li key={u.id}>
                    <button type="button" onClick={() => vm.toggle(u.id)} disabled={vm.busyId === u.id}
                      aria-pressed={shared}
                      className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-50"
                      style={{ background: shared ? 'var(--accent-light)' : 'transparent' }}>
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                        style={{ background: u.color, fontSize: 10 }}>
                        {u.name[0].toUpperCase()}
                      </span>
                      <span className="flex-1 text-sm truncate" style={{ color: 'var(--text)' }}>{u.name}</span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full border shrink-0"
                        style={shared
                          ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }
                          : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                        {vm.busyId === u.id ? '…' : shared ? 'Shared' : 'Private'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

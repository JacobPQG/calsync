// ─── AuthModal View ───────────────────────────────────────────────────────────
// PURE VIEW. State/submit is in useAuthModalVM.ts. Reshape freely here.
//
// SIGN-IN ONLY: username + password. Accounts are created by claiming a QR
// invite (invite/ClaimScreen), so there is no sign-up tab and no invite-code
// field here — an invite is a link you follow, not a code you retype.
//
// Password managers: the <form> holds both a `username` and a
// `current-password` field, which is what lets the browser/phone offer to fill
// and save the credential.
//
// Editing guide:
//   • Field order, layout → STYLE / JSX below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior (validation, sign-in flow) → useAuthModalVM.ts.

import { SITE_NAME } from '../lib/siteConfig'
import { AVATARS }   from './credentials'
import { useAuthModalVM } from './useAuthModalVM'

interface Props {
  onClose: () => void
}

const STYLE = {
  maxWidth:  'max-w-sm',
  imageCols: 'grid-cols-6',   // legacy memory-image grid
  imageFont: 18,              // px
} as const

export function AuthModal({ onClose }: Props) {
  const vm = useAuthModalVM(onClose)

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-card w-full ${STYLE.maxWidth} overflow-y-auto rounded-xl shadow-xl`}
        style={{ background: 'var(--bg-surface)' }}>

        <div className="flex items-center px-5 py-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <h2 className="flex-1 font-semibold text-sm" style={{ color: 'var(--text)' }}>
            Sign in to {SITE_NAME}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        <form onSubmit={vm.submit} className="p-5 space-y-4">

          <div>
            <label className="field-label" htmlFor="auth-username">Username</label>
            <input id="auth-username" name="username" type="text" className="field-input"
              placeholder="e.g. bluejay"
              value={vm.username} onChange={e => vm.setUsername(e.target.value)}
              autoComplete="username" maxLength={20} required autoFocus />
          </div>

          <div>
            <label className="field-label" htmlFor="auth-password">Password</label>
            <input id="auth-password" name="password" type="password" className="field-input"
              placeholder="••••••••"
              value={vm.password} onChange={e => vm.setPassword(e.target.value)}
              autoComplete="current-password" required />
          </div>

          {/* Legacy accounts (pre-avatar). Collapsed by default — most people
              will never need it, and showing an image grid on a plain sign-in
              form invites everyone to think it's required. */}
          {!vm.showLegacy ? (
            <button type="button" onClick={() => vm.setShowLegacy(true)}
              className="text-xs underline" style={{ color: 'var(--text-muted)' }}>
              Older account with a memory image?
            </button>
          ) : (
            <div>
              <span className="field-label">Your memory image</span>
              <div className={`grid ${STYLE.imageCols} gap-1.5`} role="radiogroup" aria-label="Memory image">
                {AVATARS.map(img => {
                  const active = vm.legacyImageId === img.id
                  return (
                    <button key={img.id} type="button" role="radio" aria-checked={active} title={img.label}
                      onClick={() => vm.setLegacyImageId(img.id)}
                      className="flex items-center justify-center rounded-lg border transition-all"
                      style={{
                        aspectRatio: '1', fontSize: STYLE.imageFont,
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                        background:  active ? 'var(--accent-bg)' : 'var(--bg-subtle)',
                        boxShadow:   active ? '0 0 0 2px var(--accent-bg)' : 'none',
                      }}>
                      {img.emoji}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Only for accounts made before icons existed: enter your old secret
                word above and pick the image you chose back then.
              </p>
            </div>
          )}

          {vm.error && (
            <p className="text-xs rounded-lg px-3 py-2"
              style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {vm.error}
            </p>
          )}

          <button type="submit" disabled={vm.submitting}
            className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
            style={{ background: 'var(--accent)' }}>
            {vm.submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            New accounts are created from an invite link. Ask the administrator
            for your QR code.
          </p>
        </form>
      </div>
    </div>
  )
}

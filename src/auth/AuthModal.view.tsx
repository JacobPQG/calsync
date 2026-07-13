// ─── AuthModal View ───────────────────────────────────────────────────────────
// PURE VIEW. State/submit is in useAuthModalVM.ts. Reshape freely here.
//
// Anonymous sign-in / sign-up: username + secret word + memory image. Sign-up
// also needs an invite code and ends on a "pending approval" screen.
//
// Editing guide:
//   • Field order, image grid columns, layout → STYLE / JSX below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior (validation, sign-in/up flow) → useAuthModalVM.ts.

import { SITE_NAME } from '../lib/siteConfig'
import { MEMORY_IMAGES } from './credentials'
import { useAuthModalVM } from './useAuthModalVM'

interface Props {
  onClose: () => void
}

const STYLE = {
  maxWidth:   'max-w-sm',
  imageCols:  'grid-cols-6',   // memory-image grid columns
  imageFont:  18,              // px — emoji size in the grid
} as const

export function AuthModal({ onClose }: Props) {
  const vm = useAuthModalVM(onClose)

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-card w-full ${STYLE.maxWidth} overflow-y-auto rounded-xl shadow-xl`}
        style={{ background: 'var(--bg-surface)' }}>

        {/* Header */}
        <div className="flex items-center px-5 py-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <h2 className="flex-1 font-semibold text-sm" style={{ color: 'var(--text)' }}>
            {vm.mode === 'signin'  && `Sign in to ${SITE_NAME}`}
            {vm.mode === 'signup'  && 'Create an account'}
            {vm.mode === 'pending' && 'Account created'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        {vm.mode === 'pending'
          ? <PendingScreen username={vm.normalizedUsername} onClose={onClose} />
          : <AuthForm vm={vm} />}
      </div>
    </div>
  )
}

// ── Pending-approval confirmation ─────────────────────────────────────────────

function PendingScreen({ username, onClose }: { username: string; onClose: () => void }) {
  return (
    <div className="p-5 space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
        Your account <strong style={{ color: 'var(--text)' }}>{username}</strong> was created and
        your invite code was redeemed.
      </p>
      <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
        It now needs to be approved by the administrator. Until then you can
        sign in, but your calendar stays private and inactive.
      </p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Remember your <strong>secret word</strong> and <strong>memory image</strong> —
        there is no email recovery.
      </p>
      <button type="button" onClick={onClose}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
        Done
      </button>
    </div>
  )
}

// ── Sign-in / sign-up form ────────────────────────────────────────────────────

function AuthForm({ vm }: { vm: ReturnType<typeof useAuthModalVM> }) {
  const isSignup = vm.mode === 'signup'

  return (
    <form onSubmit={vm.submit} className="p-5 space-y-4">

      {isSignup && (
        <div>
          <label className="field-label" htmlFor="auth-invite">Invite code</label>
          <input id="auth-invite" type="text" className="field-input"
            placeholder="Code you received from the admin"
            value={vm.inviteCode} onChange={e => vm.setInviteCode(e.target.value)}
            autoComplete="off" required autoFocus />
        </div>
      )}

      <div>
        <label className="field-label" htmlFor="auth-username">Username</label>
        <input id="auth-username" type="text" className="field-input" placeholder="e.g. bluejay"
          value={vm.username} onChange={e => vm.setUsername(e.target.value)}
          autoComplete="username" maxLength={20} required autoFocus={!isSignup} />
      </div>

      <div>
        <label className="field-label" htmlFor="auth-word">Secret word</label>
        <input id="auth-word" type="password" className="field-input"
          placeholder={isSignup ? 'A phrase you will remember' : '••••••••'}
          value={vm.secretWord} onChange={e => vm.setSecretWord(e.target.value)}
          autoComplete={isSignup ? 'new-password' : 'current-password'} required minLength={8} />
      </div>

      {isSignup && (
        <div>
          <label className="field-label" htmlFor="auth-word2">Repeat secret word</label>
          <input id="auth-word2" type="password" className="field-input" placeholder="••••••••"
            value={vm.confirmWord} onChange={e => vm.setConfirmWord(e.target.value)}
            autoComplete="new-password" required minLength={8} />
        </div>
      )}

      {/* Memory image grid */}
      <div>
        <span className="field-label">{isSignup ? 'Pick your memory image' : 'Your memory image'}</span>
        <div className={`grid ${STYLE.imageCols} gap-1.5`} role="radiogroup" aria-label="Memory image">
          {MEMORY_IMAGES.map(img => {
            const active = vm.imageId === img.id
            return (
              <button key={img.id} type="button" role="radio" aria-checked={active} title={img.label}
                onClick={() => vm.setImageId(img.id)}
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
        {isSignup && (
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
            You'll need the same image every time you sign in. It's part of
            your secret — don't tell anyone which one you picked.
          </p>
        )}
      </div>

      {vm.error && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          {vm.error}
        </p>
      )}

      <button type="submit" disabled={vm.submitting}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ background: 'var(--accent)' }}>
        {vm.submitting
          ? (isSignup ? 'Creating account…' : 'Signing in…')
          : (isSignup ? 'Create account' : 'Sign in')}
      </button>

      <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        {isSignup ? 'Already have an account?' : 'Have an invite code?'}{' '}
        <button type="button" onClick={vm.switchMode} className="font-medium underline" style={{ color: 'var(--accent)' }}>
          {isSignup ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </form>
  )
}

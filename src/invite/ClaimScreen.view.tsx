// ─── ClaimScreen View ─────────────────────────────────────────────────────────
// PURE VIEW. Logic is in useClaimScreenVM.ts. Reshape freely here.
//
// What someone sees after scanning an invite QR. Four states, one per phase:
// open (claim it), claimed (sign in instead), invalid, done (pending approval).
//
// PASSWORD MANAGERS — the reason the markup is fussy about attributes:
//   • The <form> wraps BOTH username and password. A password manager will not
//     offer to save a credential it cannot see a username for.
//   • username field: autoComplete="username"
//   • password field: autoComplete="new-password" (signup) / "current-password"
//     (sign-in). This is what makes iOS/Android/Chrome offer "save password" and
//     Strong Password generation, i.e. "storable in the phone or browser".
//   • The username stays a real, visible input even though it is pre-filled —
//     a hidden one is ignored by most managers.
//
// Editing guide:
//   • Layout, avatar grid columns → STYLE / JSX below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior → useClaimScreenVM.ts.

import { SITE_NAME } from '../lib/siteConfig'
import { AVATARS }   from '../auth/credentials'
import { PASSWORD_MIN_LENGTH } from '../lib/config'
import { useClaimScreenVM, useClaimSignIn } from './useClaimScreenVM'

interface Props {
  onClose: () => void
}

const STYLE = {
  maxWidth:   'max-w-sm',
  avatarCols: 'grid-cols-6',
  avatarFont: 20,          // px — emoji size in the picker
} as const

export function ClaimScreen({ onClose }: Props) {
  const vm = useClaimScreenVM(onClose)

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className={`modal-card w-full ${STYLE.maxWidth} overflow-y-auto rounded-xl shadow-xl`}
        style={{ background: 'var(--bg-surface)' }}>

        <div className="flex items-center px-5 py-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <h2 className="flex-1 font-semibold text-sm" style={{ color: 'var(--text)' }}>
            {/* A calendar invite names the calendar; a site invite names the site. */}
            {vm.phase === 'open'    && (vm.calendarName
              ? (vm.isGuestLink ? `Join ${vm.calendarName}` : `You're invited to ${vm.calendarName}`)
              : `You're invited to ${SITE_NAME}`)}
            {vm.phase === 'claimed' && `Sign in to ${SITE_NAME}`}
            {vm.phase === 'expired' && 'Invite expired'}
            {vm.phase === 'done'    && (
              vm.isGuestLink ? 'You’re in' :
              vm.joinOnly    ? 'Request sent'   : 'Account created')}
            {(vm.phase === 'invalid' || vm.phase === 'unavailable' || vm.phase === 'loading') && SITE_NAME}
          </h2>
          <button type="button" onClick={vm.dismiss} aria-label="Close"
            className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        {vm.phase === 'loading'     && <Message text="Checking your invite…" />}
        {/* A guest link renders its own form: name + icon, no password (ADR-18).
            Already signed in + a calendar invite → nothing to create, just join. */}
        {vm.phase === 'open'        && (
          vm.isGuestLink ? <GuestForm vm={vm} /> :
          vm.joinOnly    ? <JoinForm vm={vm} />  : <ClaimForm vm={vm} />)}
        {vm.phase === 'claimed'     && <ClaimedScreen onDone={vm.dismiss} />}
        {vm.phase === 'done'        && <DoneScreen vm={vm} onDone={vm.dismiss} />}
        {vm.phase === 'expired'     && (
          <Message text="This invite has expired. Ask the administrator to send you a new QR code — it only takes them a moment."
            onDone={vm.dismiss} />
        )}
        {vm.phase === 'invalid'     && (
          <Message text="This invite link is not valid — it may have been revoked. Ask the administrator for a new one."
            onDone={vm.dismiss} />
        )}
        {vm.phase === 'unavailable' && (
          <Message text="Could not reach the server to check this invite. Check your connection and reload."
            onDone={vm.dismiss} />
        )}
      </div>
    </div>
  )
}

// ── Claim (the invite is open) ────────────────────────────────────────────────

function ClaimForm({ vm }: { vm: ReturnType<typeof useClaimScreenVM> }) {
  return (
    <form onSubmit={vm.submit} className="p-5 space-y-4">

      {vm.inviteeName && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Hi <strong style={{ color: 'var(--text)' }}>{vm.inviteeName}</strong> — this invite is
          for you
          {vm.calendarName && <>, and it adds you to <strong style={{ color: 'var(--text)' }}>{vm.calendarName}</strong></>}.
          {' '}Choose a password and an icon, and you're in.
        </p>
      )}

      <div>
        <label className="field-label" htmlFor="claim-username">Username or email</label>
        {/* No maxLength: it would silently truncate an email address as it is
            typed. Length is validated on submit, per identifier kind. */}
        <input id="claim-username" name="username" type="text" className="field-input"
          value={vm.username} onChange={e => vm.setUsername(e.target.value)}
          autoComplete="username" required />
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
          Filled in from your invite — change it if you like. No email is needed;
          use one only if you would rather sign in with it.
        </p>
      </div>

      <div>
        <label className="field-label" htmlFor="claim-password">Password</label>
        <input id="claim-password" name="password" type="password" className="field-input"
          placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
          value={vm.password} onChange={e => vm.setPassword(e.target.value)}
          autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required autoFocus />
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
          Let your phone or browser generate and save it — there is no email
          recovery, so a saved password is the safest kind.
        </p>
      </div>

      {/* Avatar — the user's icon. Public, and NOT part of the password (ADR-9). */}
      <div>
        <span className="field-label">Pick your icon</span>
        <div className={`grid ${STYLE.avatarCols} gap-1.5`} role="radiogroup" aria-label="Your icon">
          {AVATARS.map(a => {
            const active = vm.avatarId === a.id
            return (
              <button key={a.id} type="button" role="radio" aria-checked={active} title={a.label}
                onClick={() => vm.setAvatarId(a.id)}
                className="flex items-center justify-center rounded-lg border transition-all"
                style={{
                  aspectRatio: '1', fontSize: STYLE.avatarFont,
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                  background:  active ? 'var(--accent-bg)' : 'var(--bg-subtle)',
                  boxShadow:   active ? '0 0 0 2px var(--accent-bg)' : 'none',
                }}>
                {a.emoji}
              </button>
            )
          })}
        </div>
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
          This is how others will see you. You can change it later.
        </p>
      </div>

      {vm.error && <ErrorNote text={vm.error} />}

      <button type="submit" disabled={vm.submitting}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ background: 'var(--accent)' }}>
        {vm.submitting ? 'Creating your account…' : 'Create my account'}
      </button>
    </form>
  )
}

// ── Guest join (the calendar's shared group link, ADR-18) ─────────────────────
// The Doodle form: a name and an icon, nothing to remember. No password fields
// and no autocomplete plumbing on purpose — there is no credential to save.

function GuestForm({ vm }: { vm: ReturnType<typeof useClaimScreenVM> }) {
  if (vm.guestBlocked) {
    return (
      <div className="p-5 space-y-4">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
          This is <strong style={{ color: 'var(--text)' }}>{vm.calendarName ?? 'a calendar'}</strong>'s
          shared guest link, and you already have a full account — guest links
          only create temporary guest access.
        </p>
        <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          Ask the calendar's owner to send you a personal invite instead — it
          joins your existing account to the calendar.
        </p>
        <button type="button" onClick={vm.dismiss}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
          OK
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={vm.submitGuest} className="p-5 space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
        You've been invited to join{' '}
        <strong style={{ color: 'var(--text)' }}>{vm.calendarName ?? 'this calendar'}</strong> as
        a guest. Type your name, pick an icon, and you're in — no password, no
        account.
      </p>

      <div>
        <label className="field-label" htmlFor="guest-name">Your name</label>
        <input id="guest-name" name="name" type="text" className="field-input"
          placeholder="How the group knows you" maxLength={60}
          value={vm.guestName} onChange={e => vm.setGuestName(e.target.value)}
          autoComplete="off" required autoFocus />
      </div>

      <div>
        <span className="field-label">Pick your icon</span>
        <div className={`grid ${STYLE.avatarCols} gap-1.5`} role="radiogroup" aria-label="Your icon">
          {AVATARS.map(a => {
            const active = vm.avatarId === a.id
            return (
              <button key={a.id} type="button" role="radio" aria-checked={active} title={a.label}
                onClick={() => vm.setAvatarId(a.id)}
                className="flex items-center justify-center rounded-lg border transition-all"
                style={{
                  aspectRatio: '1', fontSize: STYLE.avatarFont,
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                  background:  active ? 'var(--accent-bg)' : 'var(--bg-subtle)',
                  boxShadow:   active ? '0 0 0 2px var(--accent-bg)' : 'none',
                }}>
                {a.emoji}
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
        Guest access lives in <strong>this browser only</strong> — you can't sign
        in from another device, and the calendar's owner can remove guests at any
        time. Keep coming back from this same phone or computer.
      </p>

      {vm.error && <ErrorNote text={vm.error} />}

      <button type="submit" disabled={vm.submitting}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ background: 'var(--accent)' }}>
        {vm.submitting ? 'Joining…' : `Join ${vm.calendarName ?? 'this calendar'}`}
      </button>
    </form>
  )
}

// ── Join (already signed in, calendar invite) ─────────────────────────────────
// The other half of "one QR does both". The scanner already has an account, so
// there is nothing to create — only a membership to request. One tap, no form.

function JoinForm({ vm }: { vm: ReturnType<typeof useClaimScreenVM> }) {
  return (
    <div className="p-5 space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
        You've been invited to{' '}
        <strong style={{ color: 'var(--text)' }}>{vm.calendarName}</strong>
        {vm.inviteeName && <> as <strong style={{ color: 'var(--text)' }}>{vm.inviteeName}</strong></>}.
      </p>
      <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
        You're already signed in, so there's nothing to set up. The calendar's
        owner will be asked to confirm you.
      </p>

      {vm.error && <ErrorNote text={vm.error} />}

      <button type="button" onClick={vm.join} disabled={vm.submitting}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ background: 'var(--accent)' }}>
        {vm.submitting ? 'Joining…' : `Join ${vm.calendarName ?? 'this calendar'}`}
      </button>
    </div>
  )
}

// ── Claimed: the QR already made its account — sign in instead ────────────────

function ClaimedScreen({ onDone }: { onDone: () => void }) {
  const vm = useClaimSignIn(onDone)

  return (
    <form onSubmit={vm.submit} className="p-5 space-y-4">
      <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
        This invite has already been used to create an account. Sign in below —
        or, if it wasn't you, ask the administrator for a new invite.
      </p>

      <div>
        <label className="field-label" htmlFor="claimed-username">Username or email</label>
        <input id="claimed-username" name="username" type="text" className="field-input"
          value={vm.username} onChange={e => vm.setUsername(e.target.value)}
          autoComplete="username" required autoFocus />
      </div>

      <div>
        <label className="field-label" htmlFor="claimed-password">Password</label>
        <input id="claimed-password" name="password" type="password" className="field-input"
          placeholder="••••••••" value={vm.password} onChange={e => vm.setPassword(e.target.value)}
          autoComplete="current-password" required />
      </div>

      {vm.error && <ErrorNote text={vm.error} />}

      <button type="submit" disabled={vm.submitting}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ background: 'var(--accent)' }}>
        {vm.submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

// ── Done: awaiting approval ───────────────────────────────────────────────────
// Two shapes, because there are two things that can be waiting:
//
//   joinOnly  — an existing account asked to join a calendar. The CALENDAR'S
//               OWNER confirms them. Nothing was created; there is no password to
//               warn them about.
//   otherwise — an account was created. Whoever gates it (the site admin for the
//               site, the owner for the calendar) confirms them, and the password
//               warning matters because there is no email recovery.

function DoneScreen({ vm, onDone }: {
  vm: ReturnType<typeof useClaimScreenVM>
  onDone: () => void
}) {
  // Guest joins are live immediately — no approval to wait for, and no password
  // to warn about. The calendar is already open behind this dialog.
  if (vm.isGuestLink) {
    return (
      <div className="p-5 space-y-4">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
          You've joined{' '}
          <strong style={{ color: 'var(--text)' }}>{vm.calendarName ?? 'the calendar'}</strong> as
          a guest. You can add your availability and see the group's shared
          events right away.
        </p>
        <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          Come back any time from this same browser — your guest access lives
          here and nowhere else.
        </p>
        <button type="button" onClick={onDone}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
          Open the calendar
        </button>
      </div>
    )
  }

  if (vm.joinOnly) {
    return (
      <div className="p-5 space-y-4">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Your request to join{' '}
          <strong style={{ color: 'var(--text)' }}>{vm.calendarName}</strong> has been sent,
          and the invite is now used up.
        </p>
        <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          The calendar's owner needs to confirm you. Until they do, it will show
          on your home screen as pending — you won't see anyone's events in it yet.
        </p>
        <button type="button" onClick={onDone}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
        Your account is created and your invite is now used up.
      </p>
      <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
        {vm.calendarName
          ? <>It needs to be approved before you can use it, and {vm.calendarName}'s
              owner needs to confirm you. Until then you can sign in, but you
              won't see anyone's events.</>
          : <>It needs to be approved by the administrator. Until then you can sign
              in, but your calendar stays private and inactive.</>}
      </p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Make sure your password is saved — there is no email recovery.
      </p>
      <button type="button" onClick={onDone}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
        Done
      </button>
    </div>
  )
}

// ── Small shared bits ─────────────────────────────────────────────────────────

function Message({ text, onDone }: { text: string; onDone?: () => void }) {
  return (
    <div className="p-5 space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{text}</p>
      {onDone && (
        <button type="button" onClick={onDone}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
          Continue to {SITE_NAME}
        </button>
      )}
    </div>
  )
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="text-xs rounded-lg px-3 py-2"
      style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
      {text}
    </p>
  )
}

// ─── InvitePanel View ─────────────────────────────────────────────────────────
// PURE VIEW. Logic is in useInvitePanelVM.ts. Reshape freely here.
//
// Admin only (the button that opens it is gated on isAdmin — and every RPC it
// calls re-checks server-side). Two sections:
//
//   • Waiting for you — claims that produced an account which is still inert.
//     Listed FIRST and always, because it is the only thing here that blocks a
//     real person from using the app.
//   • Invites — mint a QR, and the roster of everything sent.
//
// Editing guide:
//   • Layout, QR size, list density → STYLE / JSX below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior → useInvitePanelVM.ts.

import { QrCode } from './QrCode.view'
import { useInvitePanelVM } from './useInvitePanelVM'
import type { InviteRecord } from './inviteService'

interface Props {
  onClose: () => void
}

const STYLE = {
  maxWidth: 'max-w-md',
  qrSize:   200,   // px
} as const

type VM = ReturnType<typeof useInvitePanelVM>

export function InvitePanel({ onClose }: Props) {
  const vm = useInvitePanelVM()

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-card w-full ${STYLE.maxWidth} overflow-y-auto rounded-xl shadow-xl`}
        style={{ background: 'var(--bg-surface)', maxHeight: '90vh' }}>

        <div className="flex items-center px-5 py-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <h2 className="flex-1 font-semibold text-sm" style={{ color: 'var(--text)' }}>Invites</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        <div className="p-5 space-y-5">

          {vm.error && (
            <p className="text-xs rounded-lg px-3 py-2"
              style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {vm.error}
            </p>
          )}

          {/* ── Waiting for you ───────────────────────────────────────────── */}
          {vm.pending.length > 0 && (
            <div className="space-y-2">
              <span className="field-label">
                Waiting for you ({vm.pending.length})
              </span>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                These people claimed their invite. Their accounts exist but can't
                see or publish anything until you approve them.
              </p>
              {vm.pending.map(rec => (
                <PendingRow key={rec.claimedBy!} rec={rec} vm={vm} />
              ))}
            </div>
          )}

          {/* ── Mint ──────────────────────────────────────────────────────── */}
          <form onSubmit={vm.mint} className="space-y-2">
            <label className="field-label" htmlFor="invite-name">Invite someone</label>
            <div className="flex items-center gap-2">
              <input id="invite-name" type="text" className="field-input flex-1"
                placeholder="Their name — e.g. Anna"
                value={vm.name} onChange={e => vm.setName(e.target.value)}
                maxLength={60} autoComplete="off" autoFocus />
              <button type="submit" disabled={!vm.canMint || vm.minting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 shrink-0"
                style={{ background: 'var(--accent)' }}>
                {vm.minting ? 'Creating…' : 'Create QR'}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs shrink-0" htmlFor="invite-life"
                style={{ color: 'var(--text-muted)' }}>
                Valid for
              </label>
              <select id="invite-life" className="field-input flex-1"
                value={vm.lifetimeHours ?? 'never'}
                onChange={e => vm.setLifetimeHours(
                  e.target.value === 'never' ? null : Number(e.target.value),
                )}>
                {vm.lifetimeOptions.map(o => (
                  <option key={o.label} value={o.hours ?? 'never'}>{o.label}</option>
                ))}
              </select>
            </div>

            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              They scan it, choose a password and an icon, and then wait for your
              approval. The QR works exactly once — after that it only opens the
              site — and it stops working when it expires.
            </p>
          </form>

          {/* ── The QR itself ─────────────────────────────────────────────── */}
          {vm.freshUrl && (
            <div className="flex flex-col items-center gap-3 rounded-xl p-4"
              style={{ background: 'var(--bg-subtle)', border: '0.5px solid var(--border)' }}>
              {vm.freshName && (
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  Invite for {vm.freshName}
                </p>
              )}
              <QrCode value={vm.freshUrl} size={STYLE.qrSize}
                filename={`invite-${(vm.freshName ?? 'calsync').toLowerCase().replace(/\s+/g, '-')}`} />
              <p className="text-[11px] text-center break-all" style={{ color: 'var(--text-muted)' }}>
                {vm.freshUrl}
              </p>
              <button type="button" onClick={vm.dismissFresh}
                className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Hide
              </button>
            </div>
          )}

          {/* ── Existing invites ──────────────────────────────────────────── */}
          <div className="space-y-2">
            <span className="field-label">Sent invites</span>

            {vm.loading && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
            )}

            {!vm.loading && vm.invites.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No invites yet.
              </p>
            )}

            {vm.invites.map(rec => (
              <InviteRow key={(rec.code ?? rec.claimedBy ?? '') + rec.createdAt} rec={rec} vm={vm} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── A claim awaiting confirmation ─────────────────────────────────────────────

function PendingRow({ rec, vm }: { rec: InviteRecord; vm: VM }) {
  const uid  = rec.claimedBy!
  const busy = vm.busyId === uid

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: 'var(--warning-bg)', border: '0.5px solid var(--border)' }}>

      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: 'var(--text)' }}>
          {rec.inviteeName ?? '(unnamed)'}
        </p>
        <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
          signed up as {rec.claimedName ?? '—'}
        </p>
      </div>

      <button type="button" disabled={busy} onClick={() => vm.approve(uid)}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 shrink-0"
        style={{ background: 'var(--accent)' }}>
        {busy ? '…' : 'Approve'}
      </button>

      {/* Reject denies the account. Reopening the invite as well is offered, but
          only behind a confirm: it brings every existing photo of that QR back to
          life. Declining the prompt still rejects — the safe half always happens,
          and the sharp half is the one that needs the extra "yes" (ADR-11). */}
      <button type="button" disabled={busy}
        onClick={() => vm.reject(uid, window.confirm(
          `Reject ${rec.inviteeName ?? 'this account'}.\n\n` +
          'OK: also reopen their invite, so the SAME QR works again — including ' +
          'any copy of it that is already out there.\n\n' +
          'Cancel: just reject. The invite stays used; send a new QR instead.',
        ))}
        className="btn-toolbar shrink-0" style={{ color: 'var(--danger)' }}
        title="Deny this account access">
        Reject
      </button>
    </div>
  )
}

// ── One row of the invite roster ──────────────────────────────────────────────

function InviteRow({ rec, vm }: { rec: InviteRecord; vm: VM }) {
  const { label, color } = statusOf(rec)

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: 'var(--bg-subtle)', border: '0.5px solid var(--border)' }}>

      <div className="flex-1 min-w-0">
        <span className="text-sm truncate block" style={{ color: 'var(--text)' }}>
          {rec.inviteeName ?? '(unnamed)'}
        </span>
        {rec.code && rec.expiresAt && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            expires {new Date(rec.expiresAt).toLocaleString()}
          </span>
        )}
      </div>

      <span className="text-[11px] font-semibold shrink-0" style={{ color }}>
        {label}
      </span>

      {/* A code is returned only while the invite is still live, so its presence
          is exactly the condition under which these actions mean anything. */}
      {rec.code && (
        <>
          <button type="button" onClick={() => vm.showQr(rec)}
            className="btn-toolbar shrink-0" title="Show the QR again">QR</button>
          <button type="button" onClick={() => vm.copyUrl(rec.code!)}
            className="btn-toolbar shrink-0" title="Copy the invite link">
            {vm.copied === rec.code ? '✓' : 'Copy'}
          </button>
          <button type="button" onClick={() => vm.revoke(rec.code!)}
            className="btn-toolbar shrink-0" title="Revoke this invite"
            style={{ color: 'var(--danger)' }}>Revoke</button>
        </>
      )}
    </div>
  )
}

// Claimed-and-approved is the end state; claimed-and-not is the one that needs
// the admin. Expiry and revocation only matter for an invite nobody claimed.
function statusOf(rec: InviteRecord): { label: string; color: string } {
  if (rec.claimed) {
    return rec.approved
      ? { label: 'Approved', color: 'var(--overlap-text)' }
      : { label: 'Awaiting you', color: 'var(--warning)' }
  }
  if (!rec.active) return { label: 'Revoked', color: 'var(--text-muted)' }
  if (rec.expired) return { label: 'Expired', color: 'var(--text-muted)' }
  return { label: 'Open', color: 'var(--accent)' }
}

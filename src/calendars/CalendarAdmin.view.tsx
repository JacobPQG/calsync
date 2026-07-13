// ─── CalendarAdmin View ───────────────────────────────────────────────────────
// PURE VIEW. All logic is in useCalendarAdminVM.ts. The owner's panel for one
// calendar: pending approvals, bulk QR invites, the member roster, and settings.
//
// It leads with the PENDING queue on purpose — those are people blocked, waiting
// on the owner. Everything else here can wait; they cannot.
//
// Editing guide:
//   • Sizes/spacing/QR size → STYLE below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior → useCalendarAdminVM.ts.

import type { CalendarMember } from '../types'
import { QrCode } from '../invite/QrCode'
import { avatarEmoji } from '../auth/credentials'
import { useCalendarAdminVM } from './useCalendarAdminVM'
import { MIN_CALENDAR_SEATS, MAX_CALENDAR_SEATS } from '../lib/config'

const STYLE = {
  panelWidth: 560,   // px — the modal column
  qrSize:     150,   // px — one QR per invitee in the bulk grid
  qrMinW:     170,   // px — before the QR grid wraps
} as const

interface Props {
  calendarId: string
  onClose:    () => void
  // The calendar no longer exists — the caller must navigate away, since staying
  // on the admin panel of a deleted calendar is a dead screen.
  onDeleted:  () => void
}

export function CalendarAdmin({ calendarId, onClose, onDeleted }: Props) {
  const vm = useCalendarAdminVM(calendarId)

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto py-8 px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div className="w-full rounded-2xl flex flex-col gap-5 p-5"
        style={{
          maxWidth: STYLE.panelWidth,
          background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
        }}>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text)' }}>
              {vm.calendar?.name ?? 'Calendar'}
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {vm.seatsUsed}
              {vm.calendar?.maxMembers != null && ` of ${vm.calendar.maxMembers}`}
              {' '}seat{vm.seatsUsed === 1 ? '' : 's'} taken
              {vm.isFull && ' · full'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="text-2xl leading-none px-1" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        {vm.error && (
          <div className="text-xs px-3 py-2 rounded-lg"
            style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {vm.error}
          </div>
        )}

        {vm.loading && <Muted>Loading…</Muted>}

        {/* ── 1. Waiting for you ───────────────────────────────────────── */}
        {/* The confirmation step. An invite gets someone to the door; this is
            what lets them through it. Until then their membership grants nothing
            — RLS returns them no one else's events. */}
        {vm.pending.length > 0 && (
          <Section title={`Waiting for your approval (${vm.pending.length})`}>
            {vm.isFull && (
              <div className="text-xs px-3 py-2 rounded-lg"
                style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
                This calendar is full. Raise the limit in Settings, or remove
                someone, before you can approve anyone else.
              </div>
            )}
            <div className="flex flex-col gap-2">
              {vm.pending.map(m => (
                <div key={m.userId}
                  className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{
                    background: 'var(--warning-bg)',
                    opacity: vm.busyId === m.userId ? 0.5 : 1,
                  }}>
                  <MemberIdentity m={m} />
                  <div className="flex-1" />
                  <button className="btn-toolbar" disabled={vm.busyId === m.userId || vm.isFull}
                    onClick={() => vm.approve(m.userId)}
                    style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                    title={vm.isFull ? 'The calendar is full' : 'Let them in'}>
                    ✓ Approve
                  </button>
                  <button className="btn-toolbar" disabled={vm.busyId === m.userId}
                    onClick={() => vm.reject(m.userId, false)}
                    title="Remove them. Their account is untouched — only this calendar.">
                    Reject
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── 2. Invite people ─────────────────────────────────────────── */}
        <Section title="Invite people">
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            One name per line. Each person gets their <strong>own</strong> single-use
            QR — send them the right one. A code can create exactly one account, and
            once claimed it only ever opens the site as a sign-in link.
          </p>

          <textarea className="field-input" rows={4}
            placeholder={'Anna\nBen\nChloé'}
            value={vm.names} onChange={e => vm.setNames(e.target.value)} />

          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
              Valid for
              <select className="field-input" style={{ padding: '4px 8px' }}
                value={String(vm.lifetimeHours)}
                onChange={e => vm.setLifetimeHours(
                  e.target.value === 'null' ? null : Number(e.target.value))}>
                {vm.lifetimeOptions.map(o => (
                  <option key={o.label} value={String(o.hours)}>{o.label}</option>
                ))}
              </select>
            </label>

            <div className="flex-1" />

            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {vm.nameList.length} invite{vm.nameList.length === 1 ? '' : 's'}
            </span>
            <button className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
              disabled={!vm.canMint || vm.minting} onClick={vm.mint}>
              {vm.minting ? 'Creating…' : 'Create QR invites'}
            </button>
          </div>

          {/* A warning, not a refusal: invites get ignored, rejected and expire,
              so an invite is not a seat. The cap bites at approval. */}
          {vm.overSeats && (
            <p className="text-[11px]" style={{ color: 'var(--warning)' }}>
              ⚠ That is more invites than you have free seats ({vm.seatsFree} left).
              You can still send them — but you will not be able to approve
              everyone unless you raise the limit.
            </p>
          )}
        </Section>

        {/* ── The freshly minted batch ─────────────────────────────────── */}
        {vm.fresh.length > 0 && (
          <Section title={`${vm.fresh.length} QR invite${vm.fresh.length === 1 ? '' : 's'} — send each to the right person`}>
            <div className="grid"
              style={{
                gap: 12,
                gridTemplateColumns: `repeat(auto-fill, minmax(${STYLE.qrMinW}px, 1fr))`,
              }}>
              {vm.fresh.map(inv => (
                <div key={inv.code} className="flex flex-col items-center gap-1.5 rounded-xl p-3"
                  style={{ background: 'var(--bg-subtle)', border: '0.5px solid var(--border)' }}>
                  <span className="text-xs font-semibold truncate max-w-full"
                    style={{ color: 'var(--text)' }} title={inv.inviteeName}>
                    {inv.inviteeName}
                  </span>
                  <QrCode value={inv.url} size={STYLE.qrSize}
                    filename={`invite-${inv.inviteeName}`} />
                  <button className="btn-toolbar" onClick={() => vm.copyUrl(inv.code)}
                    style={vm.copied === inv.code
                      ? { borderColor: 'var(--overlap-text)', color: 'var(--overlap-text)' }
                      : {}}>
                    {vm.copied === inv.code ? '✓ Copied' : 'Copy link'}
                  </button>
                </div>
              ))}
            </div>
            <button className="btn-toolbar self-start" onClick={vm.dismissFresh}>
              Done — hide these
            </button>
          </Section>
        )}

        {/* ── 3. Members ───────────────────────────────────────────────── */}
        <Section title={`Members (${vm.members.length})`}>
          <div className="flex flex-col gap-1">
            {vm.members.map(m => (
              <div key={m.userId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                style={{ opacity: vm.busyId === m.userId ? 0.5 : 1 }}>
                <MemberIdentity m={m} />
                {m.isOwner && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                    owner
                  </span>
                )}
                <div className="flex-1" />
                {/* The owner cannot be removed from their own calendar — it would
                    leave a calendar whose admin cannot read it. */}
                {!m.isOwner && (
                  <button className="btn-toolbar" disabled={vm.busyId === m.userId}
                    onClick={() => vm.reject(m.userId, false)}
                    title="Remove from this calendar. Their account is untouched.">
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* ── 4. Sent invites ──────────────────────────────────────────── */}
        {vm.invites.length > 0 && (
          <Section title="Sent invites">
            <div className="flex flex-col gap-1">
              {vm.invites.map(inv => (
                <div key={inv.code ?? `${inv.inviteeName}-${inv.createdAt}`}
                  className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg"
                  style={{ color: 'var(--text-2)' }}>
                  <span className="truncate">{inv.inviteeName ?? '—'}</span>
                  <InviteState inv={inv} />
                  <div className="flex-1" />
                  {/* Only a LIVE invite has a code — the server withholds the
                      value of spent/expired/revoked ones, so there is nothing to
                      show or copy. */}
                  {inv.code && (
                    <>
                      <button className="btn-toolbar" onClick={() => vm.copyUrl(inv.code!)}>
                        {vm.copied === inv.code ? '✓' : 'Copy'}
                      </button>
                      <button className="btn-toolbar" onClick={() => vm.revoke(inv.code!)}
                        title="Kill this QR — it can no longer create an account">
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── 5. Settings ──────────────────────────────────────────────── */}
        <Section title="Settings">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Name</span>
            <input className="field-input" maxLength={60}
              value={vm.name} onChange={e => vm.setName(e.target.value)} />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
              Member limit
            </span>
            <div className="flex items-center gap-3">
              <input type="number" className="field-input" style={{ width: 90 }}
                min={MIN_CALENDAR_SEATS} max={MAX_CALENDAR_SEATS}
                disabled={vm.seats === null}
                value={vm.seats ?? ''}
                onChange={e => {
                  const n = Number(e.target.value)
                  vm.setSeats(Number.isFinite(n) && n > 0 ? n : null)
                }} />
              <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={vm.seats === null}
                  onChange={e => vm.setSeats(e.target.checked ? null : vm.seatsUsed)} />
                No limit
              </label>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Cannot be set below the {vm.seatsUsed} member{vm.seatsUsed === 1 ? '' : 's'}
              {' '}already in this calendar.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
              disabled={!vm.canSave || vm.saving} onClick={vm.save}>
              {vm.saving ? 'Saving…' : 'Save'}
            </button>

            <div className="flex-1" />

            {/* Deletion cascades: members, events, invites, all of it. Confirm. */}
            {vm.confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: 'var(--danger)' }}>
                  Delete everything?
                </span>
                <button className="btn-toolbar" disabled={vm.deleting}
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                  onClick={async () => { if (await vm.remove()) onDeleted() }}>
                  {vm.deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button className="btn-toolbar" onClick={() => vm.setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn-toolbar" onClick={() => vm.setConfirmDelete(true)}
                style={{ color: 'var(--danger)' }}
                title="Delete this calendar and every event in it">
                Delete calendar
              </button>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function MemberIdentity({ m }: { m: CalendarMember }) {
  const emoji = avatarEmoji(m.avatar ?? undefined)
  // `invitedAs` is the name the owner typed on the invite; `name` is what the
  // person called themselves. Showing both is how the owner recognises who this
  // actually is — "signed up as ben-t, invited as Ben".
  const shown = m.name ?? m.username ?? m.userId.slice(0, 8)
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={{ background: emoji ? 'transparent' : 'var(--bg-subtle)', fontSize: 13 }}>
        {emoji ?? shown[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="text-xs truncate" style={{ color: 'var(--text)' }}>
        {shown}
        {m.invitedAs && m.invitedAs !== shown && (
          <span style={{ color: 'var(--text-muted)' }}> · invited as {m.invitedAs}</span>
        )}
      </span>
    </div>
  )
}

function InviteState({ inv }: { inv: { claimed: boolean; expired: boolean; active: boolean; joinedStatus: string | null } }) {
  const [label, color] =
    !inv.active                        ? ['revoked',  'var(--text-muted)'] :
    inv.claimed && inv.joinedStatus === 'pending'  ? ['claimed — awaiting you', 'var(--warning)'] :
    inv.claimed                        ? ['joined',   'var(--overlap-text)'] :
    inv.expired                        ? ['expired',  'var(--text-muted)'] :
                                         ['unclaimed','var(--text-muted)']
  return <span className="text-[10px] shrink-0" style={{ color }}>· {label}</span>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 pt-4"
      style={{ borderTop: '0.5px solid var(--border)' }}>
      <h3 className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{title}</h3>
      {children}
    </section>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{children}</p>
}

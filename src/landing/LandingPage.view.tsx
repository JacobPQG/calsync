// ─── Landing page View ────────────────────────────────────────────────────────
// PURE VIEW. Logic in useLandingVM.ts. The public front door for new users and
// potential clients, rendered only in demo mode (demo/demoMode.ts): marketing
// copy wrapped around `app` — the REAL application shell, running live on the
// in-memory demo fixture. The page owns the viewport and scrolls; the app fills
// the fixed-height demo frame (.demo-embed in index.css).
//
// Everything inside the frame is genuinely interactive and genuinely ephemeral:
// events and polls the visitor creates live in memory and vanish on reload.
// The copy below says so — keep the promise and the implementation together.

import type { ReactNode } from 'react'
import { useLandingVM, DEMO_SECTION_ID } from './useLandingVM'

// ── Visual constants ──────────────────────────────────────────────────────────
const STYLE = {
  pageMaxW:     1120,                          // px — copy column cap
  heroPadTop:   72,                            // px
  heroPadBot:   40,                            // px
  sectionGap:   88,                            // px — vertical rhythm between sections
  frameHeight:  'clamp(560px, 82vh, 880px)',   // the embedded app's stage
  frameRadius:  16,                            // px
  cardRadius:   14,                            // px
  cardMinW:     280,                           // px — feature card grid floor
} as const

// Feature cards — copy only, no logic. Each names a real capability of the app
// the visitor just tried (or is about to).
const FEATURES: { icon: string; title: string; body: string }[] = [
  {
    icon: '🔒',
    title: 'Private by default',
    body: 'Events are anonymous until someone else is free at the same time — '
        + 'others see only a hint that something exists. When two schedules '
        + 'genuinely coincide, both sides are revealed to each other. Mark an '
        + 'event public and it is simply visible, with your name on it.',
  },
  {
    icon: '📅',
    title: 'One grid for the whole group',
    body: 'Everyone posts their availability into a shared month view. Overlaps '
        + 'light up, each day opens into an hour-by-hour panel, and the calendar '
        + 'updates live as members add their plans.',
  },
  {
    icon: '🗳️',
    title: 'Time polls',
    body: 'Propose a few candidate slots and let the group vote yes / maybe / no '
        + '— then close the poll and turn the winning slot into a real event in '
        + 'one step. Try it: there is an open poll in the demo above.',
  },
  {
    icon: '🎟️',
    title: 'Invite-only, owner-approved',
    body: 'Calendars are joined by personal QR invites — named, single-use, '
        + 'expiring — and every join is confirmed by the calendar owner before '
        + 'anything is shared. For casual groups, one rotating guest link admits '
        + 'passwordless guests into a single calendar.',
  },
  {
    icon: '🏆',
    title: 'Sports mode, per calendar',
    body: 'Any calendar can switch on activities, recorded match results, '
        + 'standings and monthly challenges. The demo’s "Five-a-side" '
        + 'calendar has them on — switch to it in the header and open the '
        + 'leaderboard.',
  },
  {
    icon: '📤',
    title: 'Plays well with your calendar',
    body: 'Import events from any .ics file, export a calendar back out, or '
        + 'copy a share link that carries your own availability and nothing '
        + 'else. Exports respect event privacy — hidden events stay hidden.',
  },
]

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Get invited',
    body: 'Scan the QR your organizer sends you — it creates your account and asks to join their calendar in one step.' },
  { n: '2', title: 'Get approved',
    body: 'The calendar’s owner confirms you in. Until then, nothing is shared in either direction.' },
  { n: '3', title: 'Share when you’re free',
    body: 'Post availability, keep it anonymous or make it public, vote in polls — and see the times that work for everyone.' },
]

// ─── LandingPage ──────────────────────────────────────────────────────────────

export function LandingPage({ app }: { app: ReactNode }) {
  const vm = useLandingVM()

  return (
    <div className="app-shell overflow-y-auto"
      style={{ background: 'var(--bg-base)', color: 'var(--text)' }}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto px-6 text-center"
        style={{ maxWidth: STYLE.pageMaxW, paddingTop: STYLE.heroPadTop, paddingBottom: STYLE.heroPadBot }}>
        <p className="inline-block text-xs font-semibold rounded-full px-3 py-1 mb-5"
          style={{ color: 'var(--accent)', background: 'var(--accent-bg)', border: '0.5px solid var(--accent)' }}>
          Live demo below — no sign-up needed
        </p>
        <h1 className="font-bold tracking-tight"
          style={{ fontSize: 'clamp(32px, 5vw, 52px)', lineHeight: 1.1 }}>
          Find the times that work<br />— together.
        </h1>
        <p className="mx-auto mt-5 text-base leading-relaxed"
          style={{ maxWidth: 640, color: 'var(--text-2)' }}>
          {vm.siteName} is a private, invite-only availability calendar for
          teams, clubs and groups of friends. Everyone shares when they are
          free — without revealing what they are doing, unless they want to.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8 flex-wrap">
          <button onClick={vm.scrollToDemo}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'var(--accent)' }}>
            Try it — right on this page ↓
          </button>
          <button onClick={vm.openApp}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold"
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)', background: 'var(--bg-surface)' }}>
            Sign in →
          </button>
        </div>
      </header>

      {/* ── The live demo ────────────────────────────────────────────────── */}
      <section id={DEMO_SECTION_ID} className="mx-auto px-4"
        style={{ maxWidth: STYLE.pageMaxW + 120 }}>
        <div className="text-center mb-4 px-2">
          <h2 className="text-xl font-semibold tracking-tight">
            This is the app itself — not a video
          </h2>
          <p className="mt-2 text-sm mx-auto" style={{ maxWidth: 620, color: 'var(--text-muted)' }}>
            Click a day, add an event, vote in the team-dinner poll or create
            your own, switch to the Five-a-side calendar and open the
            leaderboard. It is all sample data kept on this page only —
            <strong style={{ color: 'var(--text-2)' }}> nothing is saved</strong>,
            and reloading starts the demo fresh.
          </p>
        </div>
        <div className="overflow-hidden"
          style={{
            height: STYLE.frameHeight,
            borderRadius: STYLE.frameRadius,
            border: '1px solid var(--border)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
            background: 'var(--bg-base)',
          }}>
          {app}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="mx-auto px-6" style={{ maxWidth: STYLE.pageMaxW, marginTop: STYLE.sectionGap }}>
        <h2 className="text-xl font-semibold tracking-tight text-center mb-8">
          What you just tried
        </h2>
        <div className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${STYLE.cardMinW}px, 1fr))` }}>
          {FEATURES.map(f => (
            <div key={f.title} className="p-5"
              style={{
                borderRadius: STYLE.cardRadius,
                border: '0.5px solid var(--border)',
                background: 'var(--bg-surface)',
              }}>
              <div className="text-2xl mb-2" aria-hidden="true">{f.icon}</div>
              <h3 className="text-sm font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="mx-auto px-6" style={{ maxWidth: STYLE.pageMaxW, marginTop: STYLE.sectionGap }}>
        <h2 className="text-xl font-semibold tracking-tight text-center mb-8">
          How it works for real
        </h2>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {STEPS.map(s => (
            <div key={s.n} className="p-5 text-center">
              <div className="mx-auto mb-3 flex items-center justify-center font-bold text-white"
                style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)' }}>
                {s.n}
              </div>
              <h3 className="text-sm font-semibold mb-1.5">{s.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="mx-auto px-6 text-center safe-bottom"
        style={{ maxWidth: STYLE.pageMaxW, marginTop: STYLE.sectionGap, paddingBottom: 72 }}>
        <h2 className="text-2xl font-bold tracking-tight">Ready to plan for real?</h2>
        <p className="mx-auto mt-3 text-sm leading-relaxed" style={{ maxWidth: 560, color: 'var(--text-2)' }}>
          Accounts are created by invitation — scan the QR code your organizer
          sent you, or sign in if you already have an account.
        </p>
        <button onClick={vm.openApp}
          className="mt-6 px-6 py-3 rounded-lg text-sm font-semibold text-white"
          style={{ background: 'var(--accent)' }}>
          Open {vm.siteName} →
        </button>
        <p className="mt-10 text-xs" style={{ color: 'var(--text-muted)' }}>
          {vm.siteName} · The demo above resets every time this page loads.
        </p>
      </section>
    </div>
  )
}

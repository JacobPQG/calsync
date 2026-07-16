// ─── App ViewModel ────────────────────────────────────────────────────────────
// All root-level logic: store wiring, auth session, theme, panel toggles, and
// the toolbar handlers (create user, share link, iCal import). The view
// (App.view.tsx) is pure layout + markup that binds to this.
//
// Feature/mode flags are surfaced here so the view has a single source for
// "should this button show" decisions.

import { useState, useEffect, useRef } from 'react'
import type { User, CalEvent, Calendar } from './types'
import { NO_FEATURES, isOverviewCalendar } from './types'
import { useStore }                    from './store/useStore'
import { listCalendars }               from './calendars/calendarService'
import { IS_SANDBOX }                  from './dev/devMode'
import { IS_DEMO, exitDemo }           from './demo/demoMode'
import { DEMO_TEAM_CAL }               from './demo/demoWorld'
import { useAuthSession, type AuthSession } from './auth/useAuth'
import { copyShareUrl }                from './sharing/urlState'
import { downloadIcal, parseIcal }     from './ical/icalUtils'
import { visibleEvents }               from './engine/visibility'
import { SUPABASE_ENABLED }            from './lib/supabase'
import { MAX_ICAL_IMPORT }             from './lib/config'
import { SITE_NAME, TEST_MODE }        from './lib/siteConfig'
import { readInviteCode }              from './invite/inviteLink'
import { isAdmin as fetchIsAdmin }     from './invite/inviteService'

type Theme = 'dark' | 'light'
const THEME_KEY = 'calsync-theme'

// Copy-feedback + import-feedback timings (ms).
const COPIED_MS = 2200
const IMPORT_MS = 3000

export interface AppVM {
  // Data the header renders.
  siteName:     string
  users:        User[]
  events:       CalEvent[]
  activeUserId: string | null
  isLoading:    boolean
  auth:         AuthSession

  // ── Calendar routing (ADR-12) ─────────────────────────────────────────────
  // null = the HOME view (pick a calendar). Otherwise the calendar being viewed.
  // This is the app's only route: everything else is a modal over one of the two.
  activeCalendarId: string | null
  activeCalendar:   Calendar | null
  openCalendar:     (calendarId: string) => void
  goHome:           () => void
  // The OVERVIEW: every event I am part of, across all my calendars, in one
  // read-only grid. `isOverview` is what the view gates the write affordances
  // (import, share, add) on while it is open.
  isOverview:       boolean
  openOverview:     () => void
  // Every calendar I belong to — the header switcher renders from this so the
  // user can jump between calendars (and the overview) without going home.
  calendars:        Calendar[]
  // Do I own the calendar that is open? Decides whether the Manage button is
  // drawn. A UI convenience ONLY: every calendar RPC re-checks owns_calendar()
  // server-side, so a user who forces this true gains nothing.
  canAdminActive:   boolean
  adminCalendarId:  string | null
  openAdmin:        (calendarId: string) => void
  closeAdmin:       () => void

  // Which optional UI shows (mode/feature flags).
  showStatsButton:  boolean
  showAddPersonBtn: boolean
  addPersonIsTest:  boolean       // Supabase mode + test mode → local-only persona

  // Demo mode (the public landing page — see demo/demoMode.ts). When true the
  // shell is rendered EMBEDDED inside landing/LandingPage, and "Sign in" leaves
  // the demo for the real app instead of opening the auth modal (there is no
  // backend to authenticate against in here).
  isDemo:   boolean
  exitDemo: () => void

  // Sign out, with a confirmation when the session is a GUEST's (ADR-18): a
  // guest session exists only in this browser and has no way back in, so
  // signing out is leaving for good. The view binds the button to this, never
  // to auth.signOut directly.
  handleSignOut: () => Promise<void>

  // Invites. `showClaimScreen` is true when the page was opened from a QR link
  // (#invite=…); the claim screen then decides for itself whether that code is
  // still claimable. `isAdmin` gates the mint panel — UI convenience only, the
  // RPCs re-check server-side.
  showClaimScreen: boolean; dismissClaimScreen: () => void
  isAdmin:         boolean
  showInvitePanel: boolean; setShowInvitePanel: (v: boolean) => void

  // The most recent failed write (rolled back), or null. Rendered by the shell
  // as a dismissible banner so a rejected save never disappears silently.
  lastError:    string | null
  dismissError: () => void

  // Theme.
  theme:       Theme
  toggleTheme: () => void

  // Selected day (for the mobile overlay).
  selectedDate:    string | null
  clearSelected:   () => void

  // Panels. (There is no share panel any more — calendar MEMBERSHIP is the
  // sharing grant now, managed in the calendar's admin panel. See ADR-12.)
  showUserPanel:   boolean; setShowUserPanel:   (v: boolean) => void
  showAuthModal:   boolean; setShowAuthModal:   (v: boolean) => void
  showStatsPanel:  boolean; setShowStatsPanel:  (v: boolean) => void

  // Fast user-create.
  newName:        string; setNewName: (v: string) => void
  canCreateUser:  boolean
  createUser:     () => void
  setActiveUser:  (id: string) => void

  // Toolbar actions.
  shareCopied:    boolean
  handleShare:    () => Promise<void>
  importFeedback: string | null
  icalInputRef:   React.RefObject<HTMLInputElement | null>
  triggerImport:  () => void
  handleImportIcal: (e: React.ChangeEvent<HTMLInputElement>) => void
  exportIcal:     () => void
}

export function useAppVM(): AppVM {
  const {
    users, events, activeUserId,
    setActiveUser, createUser, createTestUser, addEvent,
    isLoading, initialize,
    selectedDate, setSelectedDate,
    activeCalendarId, openCalendar, openOverview,
    features, setFeatures, setCalendars,
    lastError, dismissError,
  } = useStore()

  const auth = useAuthSession()

  const [newName,        setNewName]        = useState('')
  const [showUserPanel,  setShowUserPanel]  = useState(false)
  const [showAuthModal,  setShowAuthModal]  = useState(false)
  const [showStatsPanel, setShowStatsPanel] = useState(false)
  const [shareCopied,    setShareCopied]    = useState(false)
  const [importFeedback, setImportFeedback] = useState<string | null>(null)
  const [adminCalendarId, setAdminCalendarId] = useState<string | null>(null)
  const [myCalendars,     setMyCalendars]     = useState<Calendar[]>([])
  const [theme,          setTheme]          = useState<Theme>(() =>
    (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'dark')

  // Read the invite code once, at mount, from the URL the user arrived on.
  // Lazy initializer (not a plain call) so a later re-render — including the one
  // that fires after the code is stripped from the address bar — cannot flip
  // this back and forth mid-flow.
  const [hasInviteLink, setHasInviteLink] = useState(() => readInviteCode() !== null)
  const [isAdmin,         setIsAdmin]         = useState(false)
  const [showInvitePanel, setShowInvitePanel] = useState(false)

  const icalInputRef = useRef<HTMLInputElement>(null)

  // Bootstrap: load data once, set the tab title.
  useEffect(() => { initialize() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.title = SITE_NAME }, [])

  // Is the signed-in account an admin? Re-checked whenever the session changes,
  // and cleared on sign-out so the panel cannot linger for the next user of the
  // browser. Purely decides whether the button is drawn; mint/list/revoke each
  // enforce is_admin() in Postgres.
  useEffect(() => {
    if (!SUPABASE_ENABLED || !auth.isAuthenticated) {
      setIsAdmin(false)
      setShowInvitePanel(false)
      return
    }
    let cancelled = false
    fetchIsAdmin().then(ok => { if (!cancelled) setIsAdmin(ok) })
    return () => { cancelled = true }
  }, [auth.isAuthenticated, auth.userId])

  // The calendars I belong to. Held here (as well as in the home view's own VM)
  // because the header needs to know whether the OPEN calendar is one I own, to
  // decide whether to draw "Manage". Cleared on sign-out so the next user of this
  // browser inherits nothing.
  //
  // Re-fetched when a calendar is opened or the admin panel closes: both are
  // moments when membership, seats, or the pending queue may just have changed.
  useEffect(() => {
    // The sandbox and the demo have calendars too (fixtures) — listCalendars
    // resolves them without auth, so they take the same path.
    // canParticipate = approved OR guest (ADR-18): a guest's list is the one
    // calendar their guest link joined, which the server scopes for us.
    const fixture = (import.meta.env.DEV && IS_SANDBOX) || IS_DEMO
    if (!fixture && (!SUPABASE_ENABLED || !auth.isAuthenticated || !auth.canParticipate)) {
      setMyCalendars([])
      return
    }
    let cancelled = false
    listCalendars().then(cs => { if (!cancelled) setMyCalendars(cs) })
    return () => { cancelled = true }
  }, [auth.isAuthenticated, auth.userId, auth.canParticipate, activeCalendarId, adminCalendarId])

  // Mirror the list into the store, where deep consumers (the event detail
  // resolving an event's source-calendar name) read it from. Pushed rather than
  // fetched there for the usual import-cycle reason — see useStore.calendars.
  useEffect(() => { setCalendars(myCalendars) }, [myCalendars, setCalendars])

  // The OVERVIEW is the default landing: as soon as the calendar list arrives
  // and the user belongs to at least one readable calendar, open it — the user
  // starts on their own all-my-events calendar and switches to a sub-calendar
  // from there. ONCE per page load (the ref): "go home" must stay reachable,
  // and this effect re-runs on every list refresh.
  const autoOpenedOverview = useRef(false)
  useEffect(() => {
    if (autoOpenedOverview.current || activeCalendarId !== null) return
    const readable = myCalendars.filter(c => c.myStatus === 'approved')
    if (readable.length === 0) return
    autoOpenedOverview.current = true
    // The landing demo opens straight into a real calendar instead: the
    // overview is read-only, and the demo's whole point is that the visitor
    // can add an event and vote in the poll the moment the page paints.
    if (IS_DEMO) { openCalendar(DEMO_TEAM_CAL); return }
    openOverview(readable.map(c => c.id))
  }, [myCalendars, activeCalendarId, openCalendar, openOverview])

  // Apply theme to <html> and persist it.
  useEffect(() => {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else                   document.documentElement.removeAttribute('data-theme')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // Fast create: local-only persona in Supabase mode, normal persona otherwise.
  function handleCreateUser() {
    if (newName.trim().length < 2) return
    if (SUPABASE_ENABLED) createTestUser(newName.trim())
    else                  createUser(newName.trim())
    setNewName('')
    setShowUserPanel(false)
  }

  // A guest signing out cannot sign back in — the anonymous session in this
  // browser IS the account (ADR-18). Confirm before burning that bridge; their
  // membership and events survive on the server for the owner to see/remove.
  async function handleSignOut() {
    if (auth.isGuest) {
      const sure = window.confirm(
        'You joined as a guest, so there is no way to sign back in — ' +
        'signing out ends your access from this browser for good. Sign out anyway?')
      if (!sure) return
    }
    await auth.signOut()
    openCalendar(null)   // whatever was open belonged to the signed-out account
  }

  // Share link contains ONLY the active user's own data — never anyone else's.
  async function handleShare() {
    if (!activeUserId) return
    const ok = await copyShareUrl(
      users.filter(u => u.id === activeUserId),
      events.filter(e => e.userId === activeUserId),
    )
    if (ok) { setShareCopied(true); setTimeout(() => setShareCopied(false), COPIED_MS) }
  }

  function handleImportIcal(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeUserId) return
    const reader = new FileReader()
    reader.onload = ev => {
      const all       = parseIcal(ev.target?.result as string)
      const truncated = all.length > MAX_ICAL_IMPORT
      const parsed    = truncated ? all.slice(0, MAX_ICAL_IMPORT) : all
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
      const msg = truncated
        ? `Imported first ${MAX_ICAL_IMPORT} of ${all.length} events`
        : `Imported ${parsed.length} event${parsed.length !== 1 ? 's' : ''}`
      setImportFeedback(msg)
      setTimeout(() => setImportFeedback(null), IMPORT_MS)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // The calendar being viewed, as the server described it (name, seats, features,
  // whether I own it). Null on the home view, and null for a beat after opening
  // one while the list is in flight — which is why the Manage button is derived
  // from it rather than from anything the client could assert on its own.
  // Also null in the OVERVIEW, which is no calendar row at all — so Manage and
  // the feature-driven buttons stay away without a special case.
  const activeCalendar =
    myCalendars.find(c => c.id === activeCalendarId) ?? null

  // Open the overview over the calendars I can actually read: the ones where my
  // membership is approved (a pending one would only contribute zero rows, but
  // there is no reason to even ask). The list is re-fetched rather than taken
  // from state so the very first click — before the effect above has landed —
  // still opens a complete overview.
  async function handleOpenOverview() {
    const cs = await listCalendars()
    setMyCalendars(cs)
    await openOverview(cs.filter(c => c.myStatus === 'approved').map(c => c.id))
  }

  // Publish the open calendar's features into the store, which is where every
  // consumer (event form, day view, stats panel) reads them from. Pushed from
  // here rather than fetched inside openCalendar because the store importing
  // calendarService would close an import cycle — and this VM is already holding
  // the calendar list the features come from.
  //
  // Falls back to all-off whenever there is no calendar or the list has not
  // landed yet, so a feature is never drawn on the strength of stale state.
  const activeFeatures = activeCalendar?.features ?? NO_FEATURES
  useEffect(() => {
    setFeatures(activeFeatures)
  }, [
    activeFeatures.scores, activeFeatures.leaderboard, activeFeatures.challenges,
    setFeatures,
  ])

  return {
    siteName: SITE_NAME,
    users, events, activeUserId, isLoading, auth,

    activeCalendarId,
    activeCalendar,
    openCalendar: (id: string) => { openCalendar(id) },
    // Leaving a calendar also closes its admin panel — it belongs to that
    // calendar, and would otherwise linger over the home view.
    goHome: () => { setAdminCalendarId(null); openCalendar(null) },
    isOverview: isOverviewCalendar(activeCalendarId),
    openOverview: () => { handleOpenOverview() },
    calendars: myCalendars,
    canAdminActive: activeCalendar?.isOwner === true,
    adminCalendarId,
    openAdmin:  (id: string) => setAdminCalendarId(id),
    closeAdmin: () => setAdminCalendarId(null),

    // Drawn only for a calendar whose owner turned one of these on — so the
    // button follows the calendar you are in, not the build you deployed.
    showStatsButton:  features.leaderboard || features.challenges,
    // Never for a guest (ADR-18): they are exactly one person on exactly one
    // calendar, and extra personas would not survive contact with the server.
    showAddPersonBtn: (!SUPABASE_ENABLED || TEST_MODE) && !auth.isGuest,
    addPersonIsTest:  SUPABASE_ENABLED,

    isDemo: IS_DEMO,
    exitDemo,

    handleSignOut,

    showClaimScreen:    hasInviteLink,
    dismissClaimScreen: () => setHasInviteLink(false),
    isAdmin,
    showInvitePanel, setShowInvitePanel,

    lastError, dismissError,

    theme,
    toggleTheme: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')),

    selectedDate,
    clearSelected: () => setSelectedDate(null),

    showUserPanel,  setShowUserPanel,
    showAuthModal,  setShowAuthModal,
    showStatsPanel, setShowStatsPanel,

    newName, setNewName,
    canCreateUser: newName.trim().length >= 2,
    createUser: handleCreateUser,
    setActiveUser,

    shareCopied,
    handleShare,
    importFeedback,
    icalInputRef,
    triggerImport: () => icalInputRef.current?.click(),
    handleImportIcal,
    // The .ics leaves the app, so it may carry only what this user can already
    // see — other people's unmatched anonymous events stay out of the file.
    exportIcal: () => downloadIcal(visibleEvents(events, activeUserId), users),
  }
}

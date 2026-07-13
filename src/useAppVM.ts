// ─── App ViewModel ────────────────────────────────────────────────────────────
// All root-level logic: store wiring, auth session, theme, panel toggles, and
// the toolbar handlers (create user, share link, iCal import). The view
// (App.view.tsx) is pure layout + markup that binds to this.
//
// Feature/mode flags are surfaced here so the view has a single source for
// "should this button show" decisions.

import { useState, useEffect, useRef } from 'react'
import type { User, CalEvent } from './types'
import { useStore }                    from './store/useStore'
import { useAuthSession, type AuthSession } from './auth/useAuth'
import { copyShareUrl }                from './sharing/urlState'
import { downloadIcal, parseIcal }     from './ical/icalUtils'
import { SUPABASE_ENABLED }            from './lib/supabase'
import { MAX_ICAL_IMPORT }             from './lib/config'
import { SITE_NAME, FEATURES, TEST_MODE } from './lib/siteConfig'

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

  // Which optional UI shows (mode/feature flags).
  showStatsButton:  boolean
  showAddPersonBtn: boolean
  addPersonIsTest:  boolean       // Supabase mode + test mode → local-only persona

  // Theme.
  theme:       Theme
  toggleTheme: () => void

  // Selected day (for the mobile overlay).
  selectedDate:    string | null
  clearSelected:   () => void

  // Panels.
  showUserPanel:   boolean; setShowUserPanel:   (v: boolean) => void
  showAuthModal:   boolean; setShowAuthModal:   (v: boolean) => void
  showSharePanel:  boolean; setShowSharePanel:  (v: boolean) => void
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
  } = useStore()

  const auth = useAuthSession()

  const [newName,        setNewName]        = useState('')
  const [showUserPanel,  setShowUserPanel]  = useState(false)
  const [showAuthModal,  setShowAuthModal]  = useState(false)
  const [showSharePanel, setShowSharePanel] = useState(false)
  const [showStatsPanel, setShowStatsPanel] = useState(false)
  const [shareCopied,    setShareCopied]    = useState(false)
  const [importFeedback, setImportFeedback] = useState<string | null>(null)
  const [theme,          setTheme]          = useState<Theme>(() =>
    (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'dark')

  const icalInputRef = useRef<HTMLInputElement>(null)

  // Bootstrap: load data once, set the tab title.
  useEffect(() => { initialize() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.title = SITE_NAME }, [])

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

  return {
    siteName: SITE_NAME,
    users, events, activeUserId, isLoading, auth,

    showStatsButton:  FEATURES.leaderboard || FEATURES.challenges,
    showAddPersonBtn: !SUPABASE_ENABLED || TEST_MODE,
    addPersonIsTest:  SUPABASE_ENABLED,

    theme,
    toggleTheme: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')),

    selectedDate,
    clearSelected: () => setSelectedDate(null),

    showUserPanel,  setShowUserPanel,
    showAuthModal,  setShowAuthModal,
    showSharePanel, setShowSharePanel,
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
    exportIcal: () => downloadIcal(events, users),
  }
}

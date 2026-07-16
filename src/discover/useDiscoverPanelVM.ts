// ─── DiscoverPanel ViewModel ──────────────────────────────────────────────────
// All state and handlers for the Discover overlay: settings editing, running a
// suggestion search, the AI copy/paste flows, the weekend-trip scan, and
// turning an accepted suggestion/deal into a real event via the store's normal
// addEvent path (which is where calendar scoping and RLS apply — this VM never
// talks to a backend itself).

import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { isOverviewCalendar } from '../types'
import type {
  DiscoverySettings, DiscoverySourceId, EventSuggestion,
  TravelSettings, WeekendDeal,
} from './types'
import { EVENT_CATEGORIES } from './types'
import {
  loadDiscoverySettings, saveDiscoverySettings,
  loadTravelSettings, saveTravelSettings,
  loadCachedSuggestions, saveCachedSuggestions,
  addDismissed, loadQuotes,
} from './settings'
import { runDiscovery, searchWindow, mergeSuggestions, suggestionToEventDraft } from './discoveryService'
import { DISCOVERY_SOURCES } from './sources'
import type { DiscoveryQuery } from './sources/types'
import { buildCombinedEventPrompt, parseSuggestionsText } from './sources/aiPrompt'
import {
  buildCandidates, buildDeals, scanPrices, tripToEventDraft,
  buildTravelPrompt, parseTravelQuotesText, recordManualQuote,
} from './travel/travelService'
import { googleFlightsUrl, bookingUrl } from './travel/links'
import { amadeusUnavailableReason } from './travel/amadeus'
import { DISCOVER_MAX_MONTHS_AHEAD } from '../lib/config'

export type DiscoverTab = 'events' | 'trips' | 'settings'

const COPIED_MS = 2000

export interface DiscoverPanelVM {
  tab: DiscoverTab; setTab: (t: DiscoverTab) => void

  // Whether accepting can create an event right now (a real calendar is open
  // and a user is active). The panel stays browsable either way.
  canAccept: boolean
  acceptHint: string | null

  // ── Settings ────────────────────────────────────────────────────────────
  settings: DiscoverySettings
  updateSettings: (patch: Partial<DiscoverySettings>) => void
  addLocation: (city: string, countryCode: string) => void
  removeLocation: (index: number) => void
  toggleCategory: (id: string) => void
  toggleSource: (id: DiscoverySourceId) => void
  categories: typeof EVENT_CATEGORIES
  sourceOptions: { id: string; label: string; unavailable: string | null }[]
  maxMonthsAhead: number

  travel: TravelSettings
  updateTravel: (patch: Partial<TravelSettings>) => void

  // ── Event suggestions ───────────────────────────────────────────────────
  suggestions: EventSuggestion[]
  searching: boolean
  searchErrors: Record<string, string>
  canSearch: boolean
  runSearch: () => Promise<void>
  accept: (s: EventSuggestion) => void
  dismiss: (s: EventSuggestion) => void
  acceptedIds: Set<string>

  // AI copy/paste (events)
  copyEventPrompt: () => Promise<void>
  eventPromptCopied: boolean
  pasteOpen: boolean; setPasteOpen: (v: boolean) => void
  pasteText: string; setPasteText: (v: string) => void
  importPaste: () => void
  pasteError: string | null

  // ── Weekend trips ───────────────────────────────────────────────────────
  deals: WeekendDeal[]
  onlyBudget: boolean; setOnlyBudget: (v: boolean) => void
  scanUnavailable: string | null
  scanning: boolean
  scanProgress: string | null
  scanError: string | null
  runScan: () => Promise<void>
  flightsUrl: (d: WeekendDeal) => string
  hotelUrl: (d: WeekendDeal) => string
  recordPrice: (candidateId: string, flight: string, hotel: string) => void
  addTrip: (d: WeekendDeal) => void
  addedTripIds: Set<string>

  // AI copy/paste (trip prices)
  copyTravelPrompt: () => Promise<void>
  travelPromptCopied: boolean
  travelPasteOpen: boolean; setTravelPasteOpen: (v: boolean) => void
  travelPasteText: string; setTravelPasteText: (v: string) => void
  importTravelPaste: () => void
  travelPasteError: string | null
}

export function useDiscoverPanelVM(): DiscoverPanelVM {
  const { addEvent, activeUserId, activeCalendarId } = useStore()

  const [tab, setTab] = useState<DiscoverTab>('events')

  // Settings state, seeded from localStorage and written back on every change —
  // the panel can be closed at any moment, so there is no separate "save".
  const [settings, setSettings] = useState<DiscoverySettings>(loadDiscoverySettings)
  const [travel,   setTravel]   = useState<TravelSettings>(loadTravelSettings)

  const [suggestions,  setSuggestions]  = useState<EventSuggestion[]>(loadCachedSuggestions)
  const [searching,    setSearching]    = useState(false)
  const [searchErrors, setSearchErrors] = useState<Record<string, string>>({})
  const [acceptedIds,  setAcceptedIds]  = useState<Set<string>>(new Set())

  const [eventPromptCopied, setEventPromptCopied] = useState(false)
  const [pasteOpen,  setPasteOpen]  = useState(false)
  const [pasteText,  setPasteText]  = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  const [quotes,       setQuotes]       = useState(loadQuotes)
  const [onlyBudget,   setOnlyBudget]   = useState(false)
  const [scanning,     setScanning]     = useState(false)
  const [scanProgress, setScanProgress] = useState<string | null>(null)
  const [scanError,    setScanError]    = useState<string | null>(null)
  const [addedTripIds, setAddedTripIds] = useState<Set<string>>(new Set())

  const [travelPromptCopied, setTravelPromptCopied] = useState(false)
  const [travelPasteOpen,  setTravelPasteOpen]  = useState(false)
  const [travelPasteText,  setTravelPasteText]  = useState('')
  const [travelPasteError, setTravelPasteError] = useState<string | null>(null)

  // ── Accept gating ──────────────────────────────────────────────────────────
  // Events land in the OPEN calendar via the store, which refuses on the home
  // view and in the overview — mirror that here so the button explains itself
  // instead of silently discarding.
  const inRealCalendar = activeCalendarId !== null && !isOverviewCalendar(activeCalendarId)
  const canAccept = inRealCalendar && activeUserId !== null
  const acceptHint = canAccept ? null
    : !inRealCalendar
      ? 'Open a calendar (not the overview) to add suggestions to it.'
      : 'Select who you are (a user pill) to add suggestions.'

  // ── Settings mutation, persisted on every change ───────────────────────────

  function updateSettings(patch: Partial<DiscoverySettings>) {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveDiscoverySettings(next)
      return next
    })
  }

  function updateTravel(patch: Partial<TravelSettings>) {
    setTravel(prev => {
      const next = { ...prev, ...patch }
      saveTravelSettings(next)
      return next
    })
  }

  // ── Event search ───────────────────────────────────────────────────────────

  // The paste flow needs a query too; location is a formality there (parsing
  // is window+granularity based), so the first watched city stands in.
  const promptQuery: DiscoveryQuery = useMemo(() => ({
    location: settings.locations[0] ?? { city: '' },
    ...searchWindow(settings.monthsAhead),
    settings,
  }), [settings])

  async function runSearch() {
    setSearching(true)
    setSearchErrors({})
    try {
      const { suggestions: found, errors } = await runDiscovery(settings)
      setSuggestions(found)
      setSearchErrors(errors)
    } finally {
      setSearching(false)
    }
  }

  function accept(s: EventSuggestion) {
    if (!canAccept || !activeUserId) return
    addEvent(suggestionToEventDraft(s, activeUserId))
    setAcceptedIds(prev => new Set(prev).add(s.id))
  }

  function dismiss(s: EventSuggestion) {
    addDismissed(s.id)
    setSuggestions(prev => {
      const next = prev.filter(x => x.id !== s.id)
      saveCachedSuggestions(next)
      return next
    })
  }

  async function copyToClipboard(text: string, onDone: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text)
      onDone(true)
      setTimeout(() => onDone(false), COPIED_MS)
    } catch {
      // Clipboard blocked — the textarea path below still works.
    }
  }

  function importPaste() {
    setPasteError(null)
    const { suggestions: found, error } = parseSuggestionsText(pasteText, promptQuery, 'ai-paste')
    if (error) { setPasteError(error); return }
    if (found.length === 0) { setPasteError('No usable events in that reply.'); return }
    setSuggestions(prev => {
      const next = mergeSuggestions([...prev, ...found])
      saveCachedSuggestions(next)
      return next
    })
    setPasteText('')
    setPasteOpen(false)
  }

  // ── Weekend trips ──────────────────────────────────────────────────────────

  const candidates = useMemo(() => buildCandidates(travel), [travel])
  const allDeals   = useMemo(() => buildDeals(candidates, quotes, travel), [candidates, quotes, travel])
  const deals      = onlyBudget ? allDeals.filter(d => d.withinBudget) : allDeals

  async function runScan() {
    setScanning(true)
    setScanError(null)
    setScanProgress(null)
    try {
      const { quotes: updated, error } = await scanPrices(
        travel, candidates, quotes,
        (done, total) => setScanProgress(`${done} / ${total} weekends priced…`))
      setQuotes(updated)
      setScanError(error)
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }

  function recordPrice(candidateId: string, flight: string, hotel: string) {
    const f = Number(flight)
    const h = Number(hotel)
    const flightPrice = Number.isFinite(f) && f > 0 ? f : undefined
    const hotelPrice  = Number.isFinite(h) && h > 0 ? h : undefined
    if (flightPrice === undefined && hotelPrice === undefined) return
    setQuotes(recordManualQuote(candidateId, flightPrice, hotelPrice, travel.currency))
  }

  function addTrip(d: WeekendDeal) {
    if (!canAccept || !activeUserId) return
    addEvent(tripToEventDraft(d, travel, activeUserId))
    setAddedTripIds(prev => new Set(prev).add(d.candidate.id))
  }

  function importTravelPaste() {
    setTravelPasteError(null)
    const { quotes: updated, error } =
      parseTravelQuotesText(travelPasteText, candidates, travel.currency)
    if (error) { setTravelPasteError(error); return }
    setQuotes(updated)
    setTravelPasteText('')
    setTravelPasteOpen(false)
  }

  return {
    tab, setTab,
    canAccept, acceptHint,

    settings, updateSettings,
    addLocation: (city, countryCode) => {
      const clean = city.trim()
      if (!clean) return
      updateSettings({
        locations: [...settings.locations,
          { city: clean, countryCode: countryCode.trim().toUpperCase() || undefined }],
      })
    },
    removeLocation: i =>
      updateSettings({ locations: settings.locations.filter((_, x) => x !== i) }),
    toggleCategory: id => updateSettings({
      categories: settings.categories.includes(id)
        ? settings.categories.filter(c => c !== id)
        : [...settings.categories, id],
    }),
    toggleSource: id => updateSettings({
      sources: settings.sources.includes(id)
        ? settings.sources.filter(s => s !== id)
        : [...settings.sources, id],
    }),
    categories: EVENT_CATEGORIES,
    sourceOptions: DISCOVERY_SOURCES.map(s => ({
      id: s.id, label: s.label, unavailable: s.unavailableReason(),
    })),
    maxMonthsAhead: DISCOVER_MAX_MONTHS_AHEAD,

    travel, updateTravel,

    suggestions, searching, searchErrors,
    canSearch: settings.locations.length > 0 && settings.sources.length > 0 && !searching,
    runSearch, accept, dismiss, acceptedIds,

    copyEventPrompt: () => copyToClipboard(buildCombinedEventPrompt(promptQuery), setEventPromptCopied),
    eventPromptCopied,
    pasteOpen, setPasteOpen, pasteText, setPasteText, importPaste, pasteError,

    deals, onlyBudget, setOnlyBudget,
    scanUnavailable: amadeusUnavailableReason(),
    scanning, scanProgress, scanError, runScan,
    flightsUrl: d => googleFlightsUrl(d.candidate, travel),
    hotelUrl:   d => bookingUrl(d.candidate, travel),
    recordPrice, addTrip, addedTripIds,

    copyTravelPrompt: () =>
      copyToClipboard(buildTravelPrompt(travel, candidates), setTravelPromptCopied),
    travelPromptCopied,
    travelPasteOpen, setTravelPasteOpen,
    travelPasteText, setTravelPasteText,
    importTravelPaste, travelPasteError,
  }
}

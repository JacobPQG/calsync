// ─── DiscoverPanel View ───────────────────────────────────────────────────────
// PURE VIEW. All logic lives in useDiscoverPanelVM.ts. Reshape freely.
//
// Full-screen overlay (same shell as StatsPanel) with three tabs:
//   Events   — suggested events for the watched places; accept → real event.
//   Trips    — every candidate weekend to the watched cities, with prices and
//              the budget verdict; add → a public multi-day event.
//   Settings — places, window, categories, sources; trip watch parameters.
//
// Editing guide:
//   • Layout, spacing, chips, cards → STYLE / JSX below.
//   • Colours → CSS vars in src/index.css.
//   • Behavior (search, accept, scan, paste parsing) → useDiscoverPanelVM.ts.

import { useState } from 'react'
import type { EventSuggestion, WeekendDeal } from './types'
import { EVENT_CATEGORIES } from './types'
import { useDiscoverPanelVM, type DiscoverPanelVM } from './useDiscoverPanelVM'

interface Props {
  onClose: () => void
}

const STYLE = {
  contentMaxWidth: 'max-w-3xl',
  cardPad:         '10px 14px',   // suggestion / deal cards
  promptBoxRows:   6,             // paste textarea height
  fieldW:          90,            // px — small numeric inputs in settings
} as const

const TAB_LABEL: Record<string, string> = {
  events:   '✨ Events',
  trips:    '✈ Weekend trips',
  settings: '⚙ Search settings',
}

// ─── DiscoverPanel ────────────────────────────────────────────────────────────

export function DiscoverPanel({ onClose }: Props) {
  const vm = useDiscoverPanelVM()

  return (
    <div className="fixed inset-0 z-40 flex flex-col"
      style={{ background: 'var(--bg-base)', paddingTop: 'env(safe-area-inset-top)' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0 overflow-x-auto"
        style={{ borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface)', scrollbarWidth: 'none' }}>
        <button onClick={onClose} className="text-sm font-medium flex items-center gap-1 shrink-0" style={{ color: 'var(--text-2)' }}>
          ← Calendar
        </button>
        <div className="flex-1" />
        {(['events', 'trips', 'settings'] as const).map(t => (
          <button key={t} onClick={() => vm.setTab(t)}
            className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors shrink-0"
            style={vm.tab === t
              ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }
              : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto safe-bottom">
        <div className={`${STYLE.contentMaxWidth} mx-auto p-4 sm:p-6`}>
          {vm.tab === 'events'   && <EventsTab vm={vm} />}
          {vm.tab === 'trips'    && <TripsTab vm={vm} />}
          {vm.tab === 'settings' && <SettingsTab vm={vm} />}
        </div>
      </div>
    </div>
  )
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2 select-none" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h3>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed rounded-lg px-4 py-6 text-center"
      style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '0.5px solid var(--border)' }}>
      {children}
    </p>
  )
}

function Chip({ active, onClick, label, title }: {
  active: boolean; onClick: () => void; label: string; title?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors"
      style={active
        ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-bg)' }
        : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
      {label}
    </button>
  )
}

function WarnNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs rounded-lg px-3 py-2"
      style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
      {children}
    </p>
  )
}

// A copy-prompt + paste-reply pair — the zero-key AI path, shared by both tabs.
function PastePanel({ open, setOpen, copied, onCopy, text, setText, onImport, error, what }: {
  open: boolean; setOpen: (v: boolean) => void
  copied: boolean; onCopy: () => void
  text: string; setText: (v: string) => void
  onImport: () => void; error: string | null
  what: string
}) {
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        No API key needed: copy the prompt, run it in any free AI chat you already
        use (Copilot in your browser, Gemini, ChatGPT), then paste its JSON reply
        back here. AI answers are <strong>estimates — verify before relying on them</strong>.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-toolbar" onClick={onCopy}>
          {copied ? '✓ Copied!' : `⧉ Copy ${what} prompt`}
        </button>
        <button className="btn-toolbar" onClick={() => setOpen(!open)}>
          {open ? 'Hide paste box' : '↧ Paste AI reply'}
        </button>
      </div>
      {open && (
        <div className="space-y-2">
          <textarea
            className="field-input w-full font-mono text-xs"
            rows={STYLE.promptBoxRows}
            placeholder='Paste the JSON reply here, e.g. [{"title": …}]'
            value={text}
            onChange={e => setText(e.target.value)} />
          {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
          <button className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
            disabled={!text.trim()} onClick={onImport}>
            Import
          </button>
        </div>
      )}
    </div>
  )
}

// ── Events tab ────────────────────────────────────────────────────────────────

function EventsTab({ vm }: { vm: DiscoverPanelVM }) {
  const noPlaces = vm.settings.locations.length === 0

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
          disabled={!vm.canSearch} onClick={vm.runSearch}
          title={noPlaces ? 'Add a place in Search settings first' : 'Search the enabled sources'}>
          {vm.searching ? 'Searching…' : '🔎 Search events'}
        </button>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {noPlaces
            ? 'Add a city under “Search settings” to begin.'
            : `${vm.settings.locations.map(l => l.city).join(', ')} · next ${vm.settings.monthsAhead} month${vm.settings.monthsAhead > 1 ? 's' : ''}${vm.settings.granularity === 'weekend' ? ' · weekends only' : ''}`}
        </span>
      </div>

      {/* Per-source failures — one bad key must not read as “no events exist”. */}
      {Object.entries(vm.searchErrors).map(([src, msg]) => (
        <WarnNote key={src}>{src}: {msg}</WarnNote>
      ))}

      {vm.acceptHint && <WarnNote>{vm.acceptHint}</WarnNote>}

      <PastePanel
        open={vm.pasteOpen} setOpen={vm.setPasteOpen}
        copied={vm.eventPromptCopied} onCopy={vm.copyEventPrompt}
        text={vm.pasteText} setText={vm.setPasteText}
        onImport={vm.importPaste} error={vm.pasteError}
        what="event-search" />

      {/* Results */}
      <section>
        <SectionTitle>Suggestions</SectionTitle>
        {vm.suggestions.length === 0 ? (
          <EmptyNote>
            Nothing yet — run a search, or use the AI prompt above and paste the
            reply. Accepted events land in the open calendar as public events.
          </EmptyNote>
        ) : (
          <ul className="space-y-2">
            {vm.suggestions.map(s => (
              <SuggestionCard key={s.id} s={s}
                accepted={vm.acceptedIds.has(s.id)}
                canAccept={vm.canAccept}
                onAccept={() => vm.accept(s)}
                onDismiss={() => vm.dismiss(s)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SuggestionCard({ s, accepted, canAccept, onAccept, onDismiss }: {
  s: EventSuggestion; accepted: boolean; canAccept: boolean
  onAccept: () => void; onDismiss: () => void
}) {
  const cat = EVENT_CATEGORIES.find(c => c.id === s.category)
  return (
    <li className="rounded-lg" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)', padding: STYLE.cardPad }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
              {cat ? `${cat.emoji} ` : ''}{s.title}
            </span>
            {/* Provenance badge: a listing is a fact, an AI suggestion is a guess. */}
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={s.verified
                ? { background: 'var(--overlap-bg)', color: 'var(--overlap-text)' }
                : { background: 'var(--warning-bg)', color: 'var(--warning)' }}>
              {s.verified ? 'listed' : 'AI · unverified'}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
            {s.date} · {s.startHour}:00–{s.endHour}:00
            {s.venue ? ` · ${s.venue}` : ''}{s.city ? ` · ${s.city}` : ''}
          </p>
          {s.description && (
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{s.description}</p>
          )}
          {s.url && (
            <a href={s.url} target="_blank" rel="noopener noreferrer"
              className="text-xs underline" style={{ color: 'var(--accent)' }}>
              Event page ↗
            </a>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button className="btn-toolbar" disabled={!canAccept || accepted} onClick={onAccept}
            style={accepted ? { borderColor: 'var(--overlap-text)', color: 'var(--overlap-text)' } : {}}>
            {accepted ? '✓ Added' : '+ Add'}
          </button>
          {!accepted && (
            <button className="btn-toolbar" onClick={onDismiss} title="Hide this suggestion for good">
              × Dismiss
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

// ── Trips tab ─────────────────────────────────────────────────────────────────

function TripsTab({ vm }: { vm: DiscoverPanelVM }) {
  const unconfigured = !vm.travel.origin || vm.travel.destinations.length === 0

  return (
    <div className="space-y-6">
      {unconfigured ? (
        <EmptyNote>
          Set a home airport and at least one destination under “Search settings”
          — every candidate weekend in the window then shows up here with links
          and prices.
        </EmptyNote>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-4 py-1.5 text-sm rounded-lg text-white font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
              disabled={vm.scanning || vm.scanUnavailable !== null} onClick={vm.runScan}
              title={vm.scanUnavailable ?? 'Fetch indicative prices for the next unpriced weekends'}>
              {vm.scanning ? (vm.scanProgress ?? 'Scanning…') : '⇣ Scan prices (Amadeus)'}
            </button>
            <Chip active={vm.onlyBudget} onClick={() => vm.setOnlyBudget(!vm.onlyBudget)}
              label={`Only ≤ ${vm.travel.maxTotal} ${vm.travel.currency}`} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {vm.travel.origin} → {vm.travel.destinations.join(', ')} · next {vm.travel.monthsAhead} months
            </span>
          </div>

          {vm.scanUnavailable && <WarnNote>{vm.scanUnavailable}</WarnNote>}
          {vm.scanError && <WarnNote>Price scan stopped: {vm.scanError}</WarnNote>}
          {vm.acceptHint && <WarnNote>{vm.acceptHint}</WarnNote>}

          <PastePanel
            open={vm.travelPasteOpen} setOpen={vm.setTravelPasteOpen}
            copied={vm.travelPromptCopied} onCopy={vm.copyTravelPrompt}
            text={vm.travelPasteText} setText={vm.setTravelPasteText}
            onImport={vm.importTravelPaste} error={vm.travelPasteError}
            what="price-estimate" />

          <section>
            <SectionTitle>Candidate weekends</SectionTitle>
            {vm.deals.length === 0 ? (
              <EmptyNote>No weekends match the current filter.</EmptyNote>
            ) : (
              <ul className="space-y-2">
                {vm.deals.map(d => (
                  <DealCard key={d.candidate.id} d={d} vm={vm} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function DealCard({ d, vm }: { d: WeekendDeal; vm: DiscoverPanelVM }) {
  const [flight, setFlight] = useState('')
  const [hotel,  setHotel]  = useState('')
  const [editing, setEditing] = useState(false)
  const added = vm.addedTripIds.has(d.candidate.id)
  const q = d.quote

  return (
    <li className="rounded-lg" style={{
      background: 'var(--bg-surface)', padding: STYLE.cardPad,
      border: `0.5px solid ${d.withinBudget ? 'var(--overlap-text)' : 'var(--border)'}`,
    }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              ✈ {d.candidate.destination} · {d.candidate.departDate} → {d.candidate.returnDate}
            </span>
            {d.total !== null && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={d.withinBudget
                  ? { background: 'var(--overlap-bg)', color: 'var(--overlap-text)' }
                  : { background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                ~{d.total} {q?.currency}{d.withinBudget ? ' · deal!' : ''}
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
            {q ? (
              <>
                {q.flightPrice !== undefined && <>flight ~{q.flightPrice} {q.currency}{q.airline ? ` (${q.airline})` : ''}</>}
                {q.flightPrice !== undefined && q.hotelPrice !== undefined && ' · '}
                {q.hotelPrice !== undefined && <>hotel ~{q.hotelPrice} {q.currency}{q.hotel ? ` (${q.hotel})` : ''}</>}
                {' · '}
                <span style={{ color: 'var(--text-muted)' }}>
                  {q.source === 'amadeus' ? 'Amadeus, indicative' : q.source === 'ai-paste' ? 'AI estimate' : 'entered by you'}
                </span>
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>no price yet — scan, ask the AI, or check the links and record it</span>
            )}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs">
            <a href={vm.flightsUrl(d)} target="_blank" rel="noopener noreferrer"
              className="underline" style={{ color: 'var(--accent)' }}>Google Flights ↗</a>
            <a href={vm.hotelUrl(d)} target="_blank" rel="noopener noreferrer"
              className="underline" style={{ color: 'var(--accent)' }}>Booking.com ↗</a>
            <button className="underline" style={{ color: 'var(--text-muted)' }}
              onClick={() => setEditing(!editing)}>
              {editing ? 'cancel' : 'record price'}
            </button>
          </div>
          {editing && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <input className="field-input text-xs" style={{ width: STYLE.fieldW }}
                placeholder="flight" inputMode="decimal"
                value={flight} onChange={e => setFlight(e.target.value)} />
              <input className="field-input text-xs" style={{ width: STYLE.fieldW }}
                placeholder="hotel" inputMode="decimal"
                value={hotel} onChange={e => setHotel(e.target.value)} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{vm.travel.currency}</span>
              <button className="btn-toolbar"
                onClick={() => { vm.recordPrice(d.candidate.id, flight, hotel); setEditing(false); setFlight(''); setHotel('') }}>
                Save
              </button>
            </div>
          )}
        </div>
        <button className="btn-toolbar shrink-0" disabled={!vm.canAccept || added}
          onClick={() => vm.addTrip(d)}
          style={added ? { borderColor: 'var(--overlap-text)', color: 'var(--overlap-text)' } : {}}
          title="Add this trip to the open calendar as a public event">
          {added ? '✓ Added' : '+ Add trip'}
        </button>
      </div>
    </li>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ vm }: { vm: DiscoverPanelVM }) {
  const [city,    setCity]    = useState('')
  const [country, setCountry] = useState('')
  const [dest,    setDest]    = useState('')

  const addLocation = () => { vm.addLocation(city, country); setCity(''); setCountry('') }
  const addDest = () => {
    const code = dest.trim().toUpperCase()
    if (code) vm.updateTravel({ destinations: [...vm.travel.destinations, code] })
    setDest('')
  }

  return (
    <div className="space-y-8">
      {/* ── Event discovery ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionTitle>Event discovery</SectionTitle>

        {/* Places */}
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--text-2)' }}>Places to watch</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {vm.settings.locations.map((l, i) => (
              <Chip key={`${l.city}-${i}`} active label={`${l.city}${l.countryCode ? ` (${l.countryCode})` : ''} ×`}
                onClick={() => vm.removeLocation(i)} title="Remove" />
            ))}
            {vm.settings.locations.length === 0 && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>none yet</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="field-input text-sm" placeholder="City (e.g. Berlin)"
              value={city} onChange={e => setCity(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addLocation()} />
            <input className="field-input text-sm" style={{ width: 70 }} placeholder="DE"
              maxLength={2} value={country} onChange={e => setCountry(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addLocation()}
              title="Country code (optional, narrows API results)" />
            <button className="btn-toolbar" onClick={addLocation} disabled={!city.trim()}>+ Add place</button>
          </div>
        </div>

        {/* Window */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="text-xs flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
            Look ahead
            <input type="number" min={1} max={vm.maxMonthsAhead}
              className="field-input text-sm" style={{ width: STYLE.fieldW }}
              value={vm.settings.monthsAhead}
              onChange={e => vm.updateSettings({
                monthsAhead: Math.min(Math.max(1, Number(e.target.value) || 1), vm.maxMonthsAhead),
              })} />
            months
          </label>
          <div className="flex gap-1.5">
            <Chip active={vm.settings.granularity === 'day'}
              onClick={() => vm.updateSettings({ granularity: 'day' })} label="Every day" />
            <Chip active={vm.settings.granularity === 'weekend'}
              onClick={() => vm.updateSettings({ granularity: 'weekend' })} label="Weekends only" />
          </div>
        </div>

        {/* Categories */}
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--text-2)' }}>
            Kinds of events <span style={{ color: 'var(--text-muted)' }}>(none selected = everything)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {vm.categories.map(c => (
              <Chip key={c.id} active={vm.settings.categories.includes(c.id)}
                onClick={() => vm.toggleCategory(c.id)} label={`${c.emoji} ${c.label}`} />
            ))}
          </div>
        </div>

        {/* Sources */}
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--text-2)' }}>Sources</p>
          <div className="space-y-1.5">
            {vm.sourceOptions.map(s => (
              <label key={s.id} className="flex items-start gap-2 text-xs cursor-pointer"
                style={{ color: s.unavailable ? 'var(--text-muted)' : 'var(--text-2)' }}>
                <input type="checkbox" className="mt-0.5"
                  checked={vm.settings.sources.includes(s.id as never)}
                  disabled={!!s.unavailable}
                  onChange={() => vm.toggleSource(s.id as never)} />
                <span>
                  {s.label}
                  {s.unavailable && <em className="block" style={{ color: 'var(--text-muted)' }}>{s.unavailable}</em>}
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* ── Weekend trips ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionTitle>Weekend-trip watch</SectionTitle>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="text-xs flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
            From (IATA)
            <input className="field-input text-sm uppercase" style={{ width: STYLE.fieldW }}
              placeholder="BER" maxLength={3}
              value={vm.travel.origin}
              onChange={e => vm.updateTravel({ origin: e.target.value.toUpperCase() })} />
          </label>
          <label className="text-xs flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
            Budget ≤
            <input type="number" min={0} className="field-input text-sm" style={{ width: STYLE.fieldW }}
              value={vm.travel.maxTotal}
              onChange={e => vm.updateTravel({ maxTotal: Math.max(0, Number(e.target.value) || 0) })} />
            {vm.travel.currency} (flight + hotel)
          </label>
          <label className="text-xs flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
            Look ahead
            <input type="number" min={1} max={vm.maxMonthsAhead}
              className="field-input text-sm" style={{ width: STYLE.fieldW }}
              value={vm.travel.monthsAhead}
              onChange={e => vm.updateTravel({
                monthsAhead: Math.min(Math.max(1, Number(e.target.value) || 1), vm.maxMonthsAhead),
              })} />
            months
          </label>
          <label className="text-xs flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
            Nights
            <input type="number" min={1} max={7} className="field-input text-sm" style={{ width: STYLE.fieldW }}
              value={vm.travel.nights}
              onChange={e => vm.updateTravel({ nights: Math.min(Math.max(1, Number(e.target.value) || 1), 7) })} />
          </label>
        </div>

        {/* Destinations */}
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--text-2)' }}>Destinations (IATA city codes)</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {vm.travel.destinations.map((code, i) => (
              <Chip key={`${code}-${i}`} active label={`${code} ×`}
                onClick={() => vm.updateTravel({
                  destinations: vm.travel.destinations.filter((_, x) => x !== i),
                })} title="Remove" />
            ))}
            {vm.travel.destinations.length === 0 && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>none yet</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input className="field-input text-sm uppercase" style={{ width: 110 }}
              placeholder="BCN" maxLength={3}
              value={dest} onChange={e => setDest(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addDest()} />
            <button className="btn-toolbar" onClick={addDest} disabled={!dest.trim()}>+ Add destination</button>
          </div>
        </div>

        {/* Preferences */}
        <div className="flex flex-wrap gap-4">
          <label className="text-xs flex flex-col gap-1" style={{ color: 'var(--text-2)' }}>
            Preferred hotels (comma-separated, optional)
            <input className="field-input text-sm" style={{ minWidth: 240 }}
              placeholder="Motel One, Premier Inn"
              value={vm.travel.hotels.join(', ')}
              onChange={e => vm.updateTravel({
                hotels: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })} />
          </label>
          <label className="text-xs flex flex-col gap-1" style={{ color: 'var(--text-2)' }}>
            Preferred airlines / flight sources (optional)
            <input className="field-input text-sm" style={{ minWidth: 240 }}
              placeholder="Ryanair, easyJet"
              value={vm.travel.airlines.join(', ')}
              onChange={e => vm.updateTravel({
                airlines: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })} />
          </label>
        </div>

        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Prices come from the Amadeus test API (indicative), from an AI estimate
          you paste in, or from you reading the real number off Google Flights /
          Booking.com via the links — the links are always the ground truth.
          Settings live only in this browser.
        </p>
      </section>
    </div>
  )
}

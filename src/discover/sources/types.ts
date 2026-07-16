// ─── Discover: source adapter contract ────────────────────────────────────────
// Every place suggestions can come from implements this one interface, and
// discoveryService.ts is the only orchestrator. Adding a source = one new file
// here + one registry entry in index.ts — no UI or service change.

import type { DiscoveryLocation, DiscoverySettings, EventSuggestion } from '../types'

// One concrete search: one location over the settings' window/categories.
// The service fans a search out into these (settings × locations).
export interface DiscoveryQuery {
  location: DiscoveryLocation
  fromDate: string   // YYYY-MM-DD, inclusive
  toDate:   string   // YYYY-MM-DD, inclusive
  settings: DiscoverySettings
}

export interface DiscoverySource {
  id:    string
  label: string
  // Why the source cannot run right now (usually a missing API key), or null
  // if it can. The UI shows the reason instead of a dead checkbox.
  unavailableReason(): string | null
  // Fetch suggestions for one query. Throws on transport/API errors; the
  // service catches per-source so one failing source never sinks the rest.
  search(query: DiscoveryQuery): Promise<EventSuggestion[]>
}

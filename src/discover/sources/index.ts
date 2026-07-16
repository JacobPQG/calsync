// ─── Discover: source registry ────────────────────────────────────────────────
// The single list of event sources. discoveryService iterates this; the
// settings UI renders its labels/availability. Add a source here and nowhere
// else.

import type { DiscoverySource } from './types'
import type { DiscoverySourceId } from '../types'
import { ticketmasterSource } from './ticketmaster'
import { geminiSource }       from './gemini'
import { aiPasteSource }      from './aiPrompt'

export const DISCOVERY_SOURCES: DiscoverySource[] = [
  ticketmasterSource,
  geminiSource,
  aiPasteSource,
]

export function sourceById(id: DiscoverySourceId): DiscoverySource | undefined {
  return DISCOVERY_SOURCES.find(s => s.id === id)
}

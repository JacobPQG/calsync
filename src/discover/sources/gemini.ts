// ─── Discover: Gemini source ──────────────────────────────────────────────────
// The one-click version of the AI path: the same prompt the 'ai-paste' source
// hands to the user is sent to the Google Gemini API directly. Gemini's free
// tier serves this use (a handful of requests per search) at no cost, and the
// API is CORS-enabled, so a static SPA can call it without a server.
//
// The key is a personal free-tier key, supplied by the deployer via env — like
// every VITE_ var it ends up readable in the bundle, which is acceptable ONLY
// for a free-tier key whose worst-case abuse is exhausting its own quota. Do
// not put a paid/production key here; that would need a server-side proxy.
//
// Output is AI text, not a listing: parsed and validated exactly like a pasted
// reply, and marked verified:false throughout.

import type { DiscoveryQuery, DiscoverySource } from './types'
import type { EventSuggestion } from '../types'
import { buildEventPrompt, parseSuggestionsText } from './aiPrompt'
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_API_BASE } from '../../lib/config'

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  error?: { message?: string }
}

// One prompt → one completion. Exported for travel/travelService.ts, which
// sends its own (price-estimation) prompt through the same endpoint.
export async function geminiComplete(prompt: string): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })
  const json = await res.json() as GeminiResponse
  if (!res.ok) throw new Error(json.error?.message ?? `Gemini responded ${res.status}`)
  const text = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('')
  if (!text) throw new Error('Gemini returned an empty completion.')
  return text
}

export const geminiSource: DiscoverySource = {
  id: 'gemini',
  label: 'Gemini AI (free tier — suggestions, unverified)',

  unavailableReason: () =>
    GEMINI_API_KEY ? null : 'Set VITE_GEMINI_API_KEY (free at aistudio.google.com) to enable.',

  async search(query: DiscoveryQuery): Promise<EventSuggestion[]> {
    const text = await geminiComplete(buildEventPrompt(query))
    const { suggestions, error } = parseSuggestionsText(text, query, 'gemini')
    if (error && suggestions.length === 0) throw new Error(error)
    return suggestions
  },
}

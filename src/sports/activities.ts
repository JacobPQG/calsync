// ─── Activity catalog (sports variant) ────────────────────────────────────────
// The fixed set of activities the sports site is about. Events store the
// activity `id`; label/emoji are presentation-only and safe to reword.
// To add an activity, extend this list — nothing else needs to change.

export interface Activity {
  id: string
  label: string
  emoji: string
}

export const ACTIVITIES: Activity[] = [
  { id: 'football', label: 'Football', emoji: '⚽' },
  { id: 'padel',    label: 'Padel',    emoji: '🏓' },
  { id: 'tennis',   label: 'Tennis',   emoji: '🎾' },
  { id: 'run',      label: 'Run',      emoji: '🏃' },
  { id: 'swim',     label: 'Swim',     emoji: '🏊' },
  { id: 'sailing',  label: 'Sailing',  emoji: '⛵' },
  { id: 'hiking',   label: 'Hiking',   emoji: '🥾' },
  { id: 'travel',   label: 'Travel',   emoji: '✈️' },
  { id: 'other',    label: 'Other',    emoji: '🎯' },
]

const BY_ID = new Map(ACTIVITIES.map(a => [a.id, a]))

export function activityById(id: string | undefined): Activity | null {
  return id ? BY_ID.get(id) ?? null : null
}

// Compact "⚽ Football" label; falls back to the raw id for unknown values.
export function activityLabel(id: string | undefined): string | null {
  if (!id) return null
  const a = BY_ID.get(id)
  return a ? `${a.emoji} ${a.label}` : id
}

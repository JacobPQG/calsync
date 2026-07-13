// ─── Time option model ────────────────────────────────────────────────────────
// Shared, presentation-free helpers for the half-hour time grid used by the
// event form. Kept out of the view so both the picker and any future consumer
// (import, quick-add) agree on the same increments and labels.

/** Minutes between selectable times. */
export const STEP_HOURS = 0.5

/** Boundary between the AM (morning) and PM (evening) columns. */
export const MERIDIEM_SPLIT = 12

export interface TimeOption {
  value: number    // hours as a float, e.g. 13.5 = 1:30 PM
  label: string
}

export function formatHour(h: number): string {
  if (h === 24) return 'Midnight'
  const hour = Math.floor(h)
  const min  = h % 1 !== 0 ? ':30' : ':00'
  if (hour === 0)  return `12${min} AM`
  if (hour === 12) return `12${min} PM`
  return hour < 12 ? `${hour}${min} AM` : `${hour - 12}${min} PM`
}

/** Half-hour options across [from, to), e.g. buildOptions(0, 24) → 0 … 23.5. */
export function buildOptions(from: number, to: number): TimeOption[] {
  const out: TimeOption[] = []
  for (let h = from; h < to; h += STEP_HOURS) out.push({ value: h, label: formatHour(h) })
  return out
}

/**
 * Split options into the two parallel columns the picker renders side by side.
 * Anything at or past midnight (24) belongs with the evening column.
 */
export function splitByMeridiem(options: TimeOption[]): { am: TimeOption[]; pm: TimeOption[] } {
  return {
    am: options.filter(o => o.value < MERIDIEM_SPLIT),
    pm: options.filter(o => o.value >= MERIDIEM_SPLIT),
  }
}

// ─── TimePicker ViewModel ─────────────────────────────────────────────────────
// Popover state (open/close, outside-click, Escape) and the two parallel
// option columns. The view is pure markup bound to what's returned here.

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildOptions, formatHour, splitByMeridiem, type TimeOption } from './timeOptions'

export interface TimePickerParams {
  value:    number
  onChange: (v: number) => void
  /** Inclusive lower bound; options at or below it are omitted. */
  min?:     number
  /** Exclusive upper bound of the generated range. */
  max?:     number
}

export interface TimePickerVM {
  open:     boolean
  setOpen:  (v: boolean) => void
  toggle:   () => void
  label:    string                 // formatted current value, shown on the trigger
  amOptions: TimeOption[]          // left column  — 12 AM … 11:30 AM
  pmOptions: TimeOption[]          // right column — 12 PM … midnight
  isSelected: (v: number) => boolean
  select:   (v: number) => void
  rootRef:  React.RefObject<HTMLDivElement | null>
}

export function useTimePickerVM(
  { value, onChange, min, max = 24 }: TimePickerParams,
): TimePickerVM {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const { amOptions, pmOptions } = useMemo(() => {
    const all = buildOptions(0, max).filter(o => min === undefined || o.value > min)
    // `max` is exclusive for the range walk, but an end-time picker needs the
    // closing boundary itself (e.g. midnight) as a choosable option.
    if (max === 24 && (min === undefined || 24 > min)) {
      all.push({ value: 24, label: formatHour(24) })
    }
    const { am, pm } = splitByMeridiem(all)
    return { amOptions: am, pmOptions: pm }
  }, [min, max])

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return {
    open,
    setOpen,
    toggle: () => setOpen(o => !o),
    label:  formatHour(value),
    amOptions,
    pmOptions,
    isSelected: v => v === value,
    select: v => { onChange(v); setOpen(false) },
    rootRef,
  }
}

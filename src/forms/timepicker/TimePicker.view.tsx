// ─── TimePicker View ──────────────────────────────────────────────────────────
// PURE VIEW. Popover state lives in useTimePickerVM.ts; the option model lives
// in timeOptions.ts.
//
// Editing guide:
//   • Column widths / panel height / spacing → STYLE below.
//   • Which times appear                     → timeOptions.ts.
//   • Open/close behaviour                   → useTimePickerVM.ts.
//   • Colours                                → CSS vars in src/index.css.

import { useTimePickerVM, type TimePickerParams } from './useTimePickerVM'
import type { TimeOption } from './timeOptions'

interface Props extends TimePickerParams {
  /** Accessible name for the trigger, e.g. "From" / "To". */
  ariaLabel: string
}

// ── Visual constants ──────────────────────────────────────────────────────────
const STYLE = {
  panelWidth:  260,   // holds two option columns side by side
  panelHeight: 244,   // scrolls past this
  columnGap:   8,
} as const

const COLUMNS = [
  { key: 'am', heading: 'Morning' },
  { key: 'pm', heading: 'Evening' },
] as const

function optionStyle(selected: boolean): React.CSSProperties {
  return {
    width: '100%', textAlign: 'left',
    padding: '5px 8px', borderRadius: 6,
    fontSize: 12.5, fontWeight: selected ? 600 : 400,
    background: selected ? 'var(--accent-bg)' : 'transparent',
    color: selected ? 'var(--accent)' : 'var(--text-2)',
    cursor: 'pointer', transition: 'background .1s, color .1s',
  }
}

// ─── TimePicker ───────────────────────────────────────────────────────────────

export function TimePicker({ ariaLabel, ...params }: Props) {
  const vm = useTimePickerVM(params)
  const columns: Record<'am' | 'pm', TimeOption[]> = { am: vm.amOptions, pm: vm.pmOptions }

  return (
    <div ref={vm.rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={vm.toggle}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={vm.open}
        className="field-input flex items-center justify-between"
        style={{ textAlign: 'left', cursor: 'pointer' }}
      >
        <span>{vm.label}</span>
        <span aria-hidden style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 8 }}>▾</span>
      </button>

      {vm.open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="rounded-lg shadow-xl"
          style={{
            position: 'absolute', zIndex: 10, top: 'calc(100% + 4px)', left: 0,
            width: STYLE.panelWidth,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: STYLE.panelHeight,
            overflowY: 'auto',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: STYLE.columnGap,
            padding: 8,
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-strong)',
            boxShadow: 'var(--shadow-xl)',
          }}
        >
          {COLUMNS.map(col => (
            <div key={col.key}>
              <div className="field-label" style={{ padding: '0 8px' }}>{col.heading}</div>
              {columns[col.key].length === 0 ? (
                <p style={{ padding: '5px 8px', fontSize: 12, color: 'var(--text-muted)' }}>—</p>
              ) : (
                columns[col.key].map(o => (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={vm.isSelected(o.value)}
                    onClick={() => vm.select(o.value)}
                    style={optionStyle(vm.isSelected(o.value))}
                  >
                    {o.label}
                  </button>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

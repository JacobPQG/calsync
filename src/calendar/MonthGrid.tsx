// ─── MonthGrid (MVVM entry point) ─────────────────────────────────────────────
// This component is split MVVM-style:
//   • useMonthGridVM.ts   — logic (state, date math, handlers). No JSX.
//   • MonthGrid.view.tsx  — pure view (JSX + STYLE block). Reshape freely here.
// This file just re-exports the view so import paths stay stable.

export { MonthGrid } from './MonthGrid.view'

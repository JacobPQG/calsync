// ─── App (MVVM entry point) ───────────────────────────────────────────────────
//   • useAppVM.ts   — logic (store wiring, auth, theme, handlers, flags).
//   • App.view.tsx  — pure view (app shell: top bar, panels, layout).
// main.jsx imports the default export from here, so keep it re-exported.

export { default } from './App.view'

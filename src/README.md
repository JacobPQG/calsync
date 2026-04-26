# CalSync

Collaborative availability calendar. Static app, no backend, deploy free to GitHub Pages.

## Quick start

```bash
npm create vite@latest calsync -- --template react
cd calsync
npm install zustand date-fns
npm install -D tailwindcss postcss autoprefixer gh-pages
npx tailwindcss init -p
```

Copy all files from this scaffold into `src/`.

## Deploy to GitHub Pages

In `package.json`, add:
```json
"homepage": "https://YOUR_USERNAME.github.io/calsync",
"scripts": {
  "predeploy": "npm run build",
  "deploy": "gh-pages -d dist"
}
```

Then: `npm run deploy` — done. Share the URL.

## Project structure

```
src/
  types.ts          — shared data types
  store/
    useStore.ts     — Zustand global store
    storage.ts      — localStorage adapter (swap for Supabase here)
  engine/
    recurrence.ts   — expand recurring events into date instances
    overlap.ts      — detect multi-user coincidence per day
  calendar/
    MonthGrid.tsx
    DayCell.tsx
  sidebar/
    DayView.tsx
    HourTimeline.tsx
    EventCard.tsx
  forms/
    EventForm.tsx
    UserForm.tsx
  App.tsx
  main.tsx
```

## Extension points

- **Backend**: swap `storage.ts` adapter → Supabase, Firebase, or PocketBase
- **Auth**: add a real auth provider without touching UI components
- **iCal**: add import/export in a `utils/ical.ts` module
- **Sharing**: encode selected events as URL params for link-based sharing
- **Notifications**: add a service worker for reminders

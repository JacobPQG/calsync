import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// App.jsx is the legacy Vite template stub; App.tsx is the real application.
// Vite resolves .jsx before .tsx in its default extension order, so we must be
// explicit about the .tsx extension here.
import App from './App.tsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

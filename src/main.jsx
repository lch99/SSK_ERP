import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './global.css'
import { DEMO } from './api.js'

// Client demo: every page load starts at Setup, so the walk-through always
// begins at the welcome screen. Remove this once the ERP is in real use.
if (DEMO) window.history.replaceState(null, '', '#/setup')

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)

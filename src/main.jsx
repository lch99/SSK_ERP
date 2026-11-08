import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './global.css'
import { DEMO } from './api.js'
import { isInstalled } from './erp/install.jsx'

// Client demo: every page load in the browser starts at Setup, so the walk-through
// always begins at the welcome screen. Opened as an app from the home screen it starts
// at the dashboard instead. Remove this once the ERP is in real use.
if (DEMO && !isInstalled()) window.history.replaceState(null, '', '#/setup')

// Opens like an app on phones: the ERP's own files are kept on the device (public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}) })
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)

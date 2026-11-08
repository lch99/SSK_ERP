// Keeps the ERP's own files on the phone, so it opens like an app: at once, and
// even on a weak line. The page itself is always asked for fresh first (an
// update shows on the next open); the built files, whose names change with
// every update, are kept once fetched. Records from the server (/api) are
// never kept here.
const SHELL = 'ssk-shell-v1'
const FILES = 'ssk-files-v1'
const KEEP_FILES = 80

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['./', './manifest.webmanifest', './icons/icon-192.png'])).catch(() => {}))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== FILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

// The oldest kept files go once there are more than KEEP_FILES (old updates' leftovers).
async function trim() {
  const c = await caches.open(FILES)
  const keys = await c.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - KEEP_FILES)).map(k => c.delete(k)))
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return

  // The page: fresh when online, the kept copy when not.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put('./', copy)); trim() }
        return res
      })
      .catch(() => caches.match('./', { cacheName: SHELL }).then(r => r || Response.error())))
    return
  }

  // Built files and icons: kept once fetched.
  if (/\/(assets|icons)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(FILES).then(c => c.put(req, copy)) }
      return res
    })))
  }
})

import { useEffect, useState } from 'react'

// Listing photo previews. Every uploaded photo is shrunk in the browser to a
// small, soft preview (PREVIEW_PX on its long side, WebP or JPEG at 60%):
// about 20–40 KB instead of several MB, which is all the ERP's cards, album
// and website preview need. A photo in a listing's photoSet points at its
// preview by `preview` key. The demo keeps the previews in IndexedDB, because
// localStorage is already half full with the records; going live, the server
// makes the same preview on upload and lists send only its URL.
export const PREVIEW_PX = 480
const QUALITY = 0.6

export async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, PREVIEW_PX / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * k))
  canvas.height = Math.max(1, Math.round(bmp.height * k))
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const as = type => new Promise(ok => canvas.toBlob(ok, type, QUALITY))
  // Safari can't write WebP and hands back a PNG instead: use JPEG there.
  const webp = await as('image/webp')
  return webp?.type === 'image/webp' ? webp : as('image/jpeg')
}

// ── Storage: IndexedDB, with this visit's object URLs cached in memory (also
// the fallback when IndexedDB is unavailable, e.g. some private windows). ──
const urls = new Map()
const STORE = 'previews'
let opened
const db = () => (opened ||= new Promise((ok, fail) => {
  const req = indexedDB.open('ssk-photos', 1)
  req.onupgradeneeded = () => req.result.createObjectStore(STORE)
  req.onsuccess = () => ok(req.result)
  req.onerror = () => fail(req.error)
}))
const run = async (mode, fn) => {
  const t = (await db()).transaction(STORE, mode)
  const req = fn(t.objectStore(STORE))
  return new Promise((ok, fail) => { t.oncomplete = () => ok(req?.result); t.onerror = t.onabort = () => fail(t.error) })
}

// Shrinks the files and stores their previews; returns one key per file.
export async function savePreviews(files) {
  const keys = []
  for (const file of files) {
    const blob = await shrinkPhoto(file)
    const key = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    urls.set(key, URL.createObjectURL(blob))
    await run('readwrite', s => s.put(blob, key)).catch(() => {})
    keys.push(key)
  }
  return keys
}

async function previewUrl(key) {
  if (!urls.has(key)) {
    const blob = await run('readonly', s => s.get(key)).catch(() => null)
    if (blob) urls.set(key, URL.createObjectURL(blob))
  }
  return urls.get(key) || null
}

// Once a visit: drop stored previews no listing points at any more (deleted
// photos or listings, reset sample data).
let pruned = false
export function prunePreviews(listings) {
  if (pruned) return
  pruned = true
  const keep = new Set(listings.flatMap(l => (l.photoSet || []).map(p => p.preview).filter(Boolean)))
  run('readonly', s => s.getAllKeys())
    .then(keys => Promise.all(keys.filter(k => !keep.has(k)).map(k => run('readwrite', s => s.delete(k)))))
    .catch(() => {})
}

// The image to show for `src`: a File just picked (shown at once, before it is
// shrunk) or a stored preview key. Null while loading or when there is none.
export function usePhoto(src) {
  const [url, setUrl] = useState(() => (typeof src === 'string' ? urls.get(src) || null : null))
  useEffect(() => {
    if (!src) { setUrl(null); return }
    if (typeof src !== 'string') {
      const u = URL.createObjectURL(src)
      setUrl(u)
      return () => URL.revokeObjectURL(u)
    }
    let live = true
    previewUrl(src).then(u => { if (live) setUrl(u) })
    return () => { live = false }
  }, [src])
  return url
}

// The cover of a listing (or the first published photo with a preview).
export const coverOf = photos => {
  const shown = photos.filter(p => p.published !== false && (p.preview || p.file))
  return shown.find(p => p.cover) || shown[0] || null
}

// A photo filling its box, cropped to fit; renders `fallback` until it loads.
export function Photo({ src, alt = '', fallback = null, style }) {
  const url = usePhoto(src)
  if (!url) return fallback
  return <img src={url} alt={alt} loading="lazy" decoding="async" draggable={false}
    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', ...style }} />
}

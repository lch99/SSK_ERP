import { useEffect, useState } from 'react'

// True when the element is narrower than `px`. Tables switch to stacked cards
// below that, instead of scrolling sideways. Measures the element itself, so it
// follows the real space (sidebar, window size, zoom), not just the screen.
// Returns a callback ref, so it works even if the element appears later.
export function useNarrow(px) {
  const [el, setEl] = useState(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (!el) return
    const measure = () => setNarrow(el.clientWidth < px)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, px])
  return [setEl, narrow]
}

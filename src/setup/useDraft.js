import { useState } from 'react'

// Local editable copy of one slice of the saved setup. It resets whenever the
// saved slice changes (e.g. after Save), and leaves other sections' drafts alone.
export function useDraft(saved) {
  const json = JSON.stringify(saved)
  const [base, setBase] = useState(json)
  const [draft, setDraft] = useState(saved)
  if (json !== base) {
    setBase(json)
    setDraft(saved)
  }
  return [draft, setDraft, JSON.stringify(draft) !== json, () => setDraft(JSON.parse(json))]
}

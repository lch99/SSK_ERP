import { fileId, fileLabel } from '../../shared/files.js'
import { DEMO, openFile } from '../api.js'
import { C } from '../styles.js'
import { useFeedback } from './feedback.jsx'

// A file kept on a record, by its name. An upload on the server opens in a new tab
// (for whoever may see the record); the demo, and old files not copied yet, show the name only.
export function FileName({ value, empty = '—', style }) {
  const fb = useFeedback()
  if (!value) return <span style={{ color: C.muted, ...style }}>{empty}</span>
  const name = fileLabel(value)
  if (DEMO || fileId(value) == null) return <span style={style} title={name}>{name}</span>
  return (
    <a href="#" title={`Open ${name}`} style={{ color: C.primaryDark, fontWeight: 600, textDecoration: 'none', overflowWrap: 'anywhere', ...style }}
      onClick={e => { e.preventDefault(); e.stopPropagation(); openFile(value).catch(fb.error) }}>{name}</a>
  )
}

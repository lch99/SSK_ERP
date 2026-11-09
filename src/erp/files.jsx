import { fileId, fileLabel } from '../../shared/files.js'
import { DEMO, openFile } from '../api.js'
import { C } from '../styles.js'
import { useFeedback } from './feedback.jsx'

// The old ERP's file server: records from it point there until `legacy:copy-files` copies their files.
const OLD_FILE = /^https?:\/\/storage\.subsaleking\.com\//i

// A file kept on a record, by its name. An upload on the server opens in a new tab
// (for whoever may see the record); an old file not copied yet opens from the old file
// server, as the old ERP opened it; the demo shows the name only.
export function FileName({ value, empty = '—', style }) {
  const fb = useFeedback()
  if (!value) return <span style={{ color: C.muted, ...style }}>{empty}</span>
  const name = fileLabel(value)
  const link = { color: C.primaryDark, fontWeight: 600, textDecoration: 'none', overflowWrap: 'anywhere', ...style }
  if (OLD_FILE.test(String(value))) {
    return <a href={String(value).replace(/^http:/i, 'https:')} target="_blank" rel="noreferrer noopener" title={`Open ${name} (on the old ERP's file server)`} style={link}
      onClick={e => e.stopPropagation()}>{name}</a>
  }
  if (DEMO || fileId(value) == null) return <span style={style} title={name}>{name}</span>
  return (
    <a href="#" title={`Open ${name}`} style={link}
      onClick={e => { e.preventDefault(); e.stopPropagation(); openFile(value).catch(fb.error) }}>{name}</a>
  )
}

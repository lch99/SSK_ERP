// The old ERP's rich-text box saved descriptions as HTML ("<p>- Tenure: Freehold</p><p>&nbsp;</p>…").
// The new ERP writes plain text, so a page shows either as plain lines: paragraphs and <br> become line
// breaks, other tags go, entities are decoded and runs of blank lines close up. Plain text comes back as it is.
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', times: '×', copy: '©', reg: '®', trade: '™' };

const looksHtml = s => /<\/?[a-z][^>]*>|&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s);

export function htmlToText(value) {
  if (value == null) return value;
  const s = String(value);
  if (!looksHtml(s)) return s;
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(p|div|h[1-6]|tr|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/ /g, ' ')
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

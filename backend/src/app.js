// The API as an Express app (index.js starts it; the tests run it on a spare port).
require('dotenv').config();
// Business days and times are Malaysia's and Singapore's (both UTC+8) wherever the
// server runs, even on a host set to UTC: the ERP's actions read the clock
// (shared/erpActions.js), as db/days.js does. APP_TZ changes it.
process.env.TZ = process.env.APP_TZ || 'Asia/Kuala_Lumpur';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./db/connection');
const { alert, whereOf } = require('./ops/alerts');
const { setupRouter, branchesRouter } = require('./routes/setup');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const accessRouter = require('./routes/access');
const erpRouter = require('./routes/erp');
const filesRouter = require('./routes/files');
const accountsRouter = require('./routes/accounts');
const appV1Router = require('./appV1');
const publicRouter = require('./public');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5175').split(',').map(s => s.trim()).filter(Boolean);

// Which proxies to believe about the client's IP (for the login rate limit).
// Default: only one on this machine (Vite in dev, nginx on the same server).
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
// Images and files may be shown by other sites (www.subsaleking.com shows listing and agent photos from this
// API's address; the ERP's thumbnails too, when it runs on another): helmet's default would block them. The
// data itself stays guarded by CORS and sign-in.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: allowedOrigins }));
// Uploads: the body is the file itself (routes/files.js), so before the JSON parser.
app.use('/api/files', filesRouter);
// The old phone app's addresses (appV1/: the same replies the old API gave), with their own body limits.
app.use('/v1', appV1Router);
// Setup takes the whole agent list at once (up to 5,000 rows); everything else stays small.
app.use('/api/setup', express.json({ limit: '10mb' }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await db.raw('select 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unreachable' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/setup', setupRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/users', usersRouter);
app.use('/api/access', accessRouter);
app.use('/api/erp', erpRouter);
app.use('/api/accounts', accountsRouter);
// What the website reads (public fields only; no sign-in but for saved listings).
app.use('/api/public', publicRouter);
// An address under /api that the API doesn't have: a refusal in JSON like every other (Express's own is a web page).
app.use('/api', (req, res) => res.status(404).json({ error: 'The server does not have that address. Reload the page: the ERP may have been updated.' }));

// The ERP's pages too, when this server is the only one (staging): WEB_DIR is the built frontend
// (`VITE_USE_SERVER=true npm run build` in the project root → dist/). Its files under assets/ have
// their content's hash in the name, so they keep for a year; the page and the service worker never do,
// so a new release reaches everyone on their next visit. Without WEB_DIR, nginx (or another host)
// serves the pages and passes /api and /v1 here.
if (process.env.WEB_DIR) {
  const path = require('path');
  const web = path.resolve(__dirname, '..', process.env.WEB_DIR);
  app.use(express.static(web, {
    index: 'index.html',
    setHeaders: (res, file) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'),
  }));
}

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too much to send at once.' });
  // The sender's mistake (JSON that doesn't read, a request cut off, an unknown charset): a 4xx, not told.
  const status = Number(err.status || err.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ error: status === 400 ? 'That request could not be read.' : 'That request was refused.' });
  console.error(err);
  // The method and the address's shape (ids and names as :x), never the request's data.
  alert(err, whereOf(req));
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;

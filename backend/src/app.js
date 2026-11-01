// The API as an Express app (index.js starts it; the tests run it on a spare port).
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./db/connection');
const { setupRouter, branchesRouter } = require('./routes/setup');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const accessRouter = require('./routes/access');
const erpRouter = require('./routes/erp');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5175').split(',').map(s => s.trim()).filter(Boolean);

// Which proxies to believe about the client's IP (for the login rate limit).
// Default: only one on this machine (Vite in dev, nginx on the same server).
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: allowedOrigins }));
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

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too much to send at once.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;

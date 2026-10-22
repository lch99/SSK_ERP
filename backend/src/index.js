require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./db/connection');
const { setupRouter, branchesRouter } = require('./routes/setup');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');

const app = express();
const PORT = Number(process.env.PORT) || 3002;
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5175').split(',').map(s => s.trim()).filter(Boolean);

// Which proxies to believe about the client's IP (for the login rate limit).
// Default: only one on this machine (Vite in dev, nginx on the same server).
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: allowedOrigins }));
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

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => console.log(`SSK ERP API on :${PORT}`));

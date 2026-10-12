'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const logger = require('./utils/logger');
const store = require('./store');
const kv = require('./kv');
const apiRoutes = require('./routes/api');
const baileys = require('./baileys');
const { startSock } = require('./whatsapp');

/** Middleware API key (opsional). Aktif hanya bila API_KEY diisi di .env. */
function requireKey(req, res, next) {
  if (!config.apiKey) return next();
  const given = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || String(req.query.key || '');
  const a = Buffer.from(given);
  const b = Buffer.from(config.apiKey);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  return res.status(401).json({ error: 'API key salah atau belum diisi.' });
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // di belakang Nginx / Cloudflare / proxy panel

  // Header Private Network Access untuk dashboard HTTPS yang memanggil backend lokal.
  app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Private-Network', 'true'); next(); });
  app.use(cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-API-Key'],
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, app: 'safety-your-whatsapp', connected: Boolean(store.getStatus().connected), node: process.versions.node, baileys: baileys.state(), uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
  });
  app.get('/api', (req, res) => res.json({
    ok: true,
    name: 'Safety Your WhatsApp',
    endpoints: ['/api/health', '/api/status', '/api/stats', '/api/riwayat', '/api/features', '/api/pair', '/api/report'],
    auth: config.apiKey ? 'X-API-Key wajib' : 'terbuka',
  }));
  app.use('/api', requireKey, apiRoutes);

  // Dashboard disajikan langsung oleh server ini, jadi cukup buka http://IP-atau-domain:PORT
  if (config.frontendDir) {
    app.use(express.static(config.frontendDir, { index: 'index.html', maxAge: 0 }));
  } else {
    app.get('/', (req, res) => res.json({ ok: true, name: 'Safety Your WhatsApp', api: '/api', dashboard: 'folder frontend tidak ditemukan' }));
  }
  return app;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

function resumeSession() {
  // Reconnect otomatis hanya jika creds.json memang sudah terdaftar; session parsial bisa memicu 401.
  const credsPath = path.join(process.env.SESSION_DIR || './data/session', 'creds.json');
  if (!fs.existsSync(credsPath)) return;
  try {
    if (JSON.parse(fs.readFileSync(credsPath, 'utf8')).registered === true) {
      startSock().catch((e) => logger.error('Gagal reconnect session lama: ' + e.message));
    } else {
      logger.info('Session belum terdaftar. Menunggu pairing code dari dashboard.');
    }
  } catch (_) {
    logger.warn('creds.json tidak valid; pairing akan dimulai dari dashboard.');
  }
}

function start() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.sessionDir, { recursive: true });
  store.setStatus({ connected: false, pairingCode: null, error: null });

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    logger.info(`Server berjalan di ${config.host}:${config.port}`);
    logger.info(`Lokal   : http://127.0.0.1:${config.port}`);
    lanAddresses().forEach((ip) => logger.info(`Jaringan: http://${ip}:${config.port}`));
    logger.info(config.frontendDir ? 'Dashboard aktif di alamat yang sama dengan API.' : 'Folder frontend tidak ditemukan: hanya API yang aktif.');
    if (!config.apiKey) logger.warn('API_KEY belum diisi. Bila server dibuka ke internet, isi API_KEY di .env agar dashboard tidak bisa diakses sembarang orang.');
    logger.info('Bot belum otomatis connect — pairing dipicu lewat dashboard.');
  });
  server.on('error', (e) => {
    logger.error(e.code === 'EADDRINUSE' ? `Port ${config.port} sedang dipakai proses lain. Ubah PORT di .env.` : `Server gagal start: ${e.message}`);
    process.exit(1);
  });

  const stop = () => { try { kv.flush(); } catch (_) {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('unhandledRejection', (e) => logger.warn('unhandledRejection: ' + (e?.message || e)));
  process.on('uncaughtException', (e) => logger.error('uncaughtException: ' + (e?.stack || e)));

  // Muat Baileys dulu. Bila gagal (versi Node lama, paket tidak terpasang), server dan dashboard TETAP hidup
  // dan penyebabnya tampil di dashboard serta /api/health, bukan crash berulang.
  baileys.load().then(() => {
    logger.info(`Baileys ${baileys.version()} dimuat (Node ${process.versions.node}).`);
    resumeSession();
  }).catch((e) => {
    logger.error('BAILEYS GAGAL DIMUAT: ' + e.message);
    store.setStatus({ connected: false, pairingCode: null, error: e.message });
  });
  return server;
}

module.exports = { createApp, start };

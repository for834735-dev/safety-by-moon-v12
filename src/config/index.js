'use strict';
/**
 * Konfigurasi terpusat. Semua nilai dibaca dari environment (.env atau variabel panel).
 * Modul lain cukup `require('../config')` — jangan baca process.env tersebar di banyak tempat.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'on', 'ya', 'yes'].includes(String(v).toLowerCase()));
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

function findFrontendDir() {
  const cands = [process.env.FRONTEND_DIR, path.join(ROOT, 'public'), path.join(ROOT, '..', 'frontend')].filter(Boolean);
  return cands.find((d) => fs.existsSync(path.join(d, 'index.html'))) || null;
}

module.exports = {
  ROOT,
  // Panel Pterodactyl memakai SERVER_PORT, hosting lain memakai PORT.
  port: int(process.env.PORT || process.env.SERVER_PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  apiKey: process.env.API_KEY || '',
  frontendDir: findFrontendDir(),
  sessionDir: process.env.SESSION_DIR || path.join(ROOT, 'data', 'session'),
  dataDir: path.join(ROOT, 'data'),
  download: {
    // Mode bawaan semua downloader: 'audio' (hanya lagu/suara) atau 'video'.
    defaultMode: (process.env.DEFAULT_DL_MODE || 'audio').toLowerCase() === 'video' ? 'video' : 'audio',
    maxMb: int(process.env.MAX_DL_MB, 80),
    audioAsDocMb: int(process.env.AUDIO_DOC_MB, 15),
    providers: (process.env.DL_PROVIDERS || 'ytdlp,cobalt,tikwm').split(',').map((s) => s.trim()).filter(Boolean),
    ytdlpPath: process.env.YTDLP_PATH || '',
    cookies: process.env.YTDLP_COOKIES || '',
    cobaltUrl: (process.env.COBALT_API_URL || '').replace(/\/$/, ''),
    cobaltKey: process.env.COBALT_API_KEY || '',
    timeoutSec: int(process.env.DL_TIMEOUT_SEC, 180),
  },
  fontFile: process.env.FONT_FILE || '',
  bool,
  int,
};

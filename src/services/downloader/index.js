'use strict';
/**
 * Downloader terpadu.
 *   download(url, { mode: 'audio' | 'video', quality })  → { file, dir, title, ext, mode, provider }
 *   search(query, opts)                                   → sama, dari pencarian YouTube
 * Bawaan mode = audio (lagu saja). Penyedia dicoba berurutan sesuai DL_PROVIDERS.
 */
const fs = require('fs');
const config = require('../../config');
const platforms = require('./platforms');

const PROVIDERS = { ytdlp: require('./ytdlp'), cobalt: require('./cobalt'), tikwm: require('./tikwm') };

function order(url) {
  const list = config.download.providers.map((n) => PROVIDERS[n]).filter((p) => p && p.available());
  // TikTok lebih andal lewat tikwm, jadi dahulukan.
  if (/tiktok\.com/i.test(url)) list.sort((a, b) => (b.name === 'tikwm') - (a.name === 'tikwm'));
  return list;
}

async function download(url, opts = {}) {
  const mode = opts.mode || config.download.defaultMode;
  const list = order(url);
  if (!list.length) throw new Error('Belum ada penyedia unduhan. Jalankan "python server.py --setup" (yt-dlp) atau isi COBALT_API_URL di .env.');
  const errors = [];
  for (const p of list) {
    try { return { ...(await p.fetchMedia(url, { ...opts, mode })), provider: p.name }; } catch (e) { errors.push(`${p.name}: ${e.message}`); }
  }
  throw new Error('Semua penyedia gagal → ' + errors.join(' | '));
}

async function search(query, opts = {}) {
  if (!PROVIDERS.ytdlp.available()) throw new Error('Pencarian lagu butuh yt-dlp. Jalankan: python server.py --setup');
  return { ...(await PROVIDERS.ytdlp.fetchMedia('ytsearch1:' + query, { mode: 'audio', ...opts })), provider: 'ytdlp' };
}

/** Info singkat (judul, durasi, kanal) tanpa mengunduh. */
async function info(url) {
  if (!PROVIDERS.ytdlp.available()) throw new Error('Butuh yt-dlp');
  const out = await PROVIDERS.ytdlp.run(['--no-playlist', '--no-warnings', '-j', url], 60);
  const j = JSON.parse(out.split('\n').filter(Boolean)[0]);
  return { title: j.title, uploader: j.uploader, duration: j.duration, views: j.view_count, likes: j.like_count, date: j.upload_date, thumb: j.thumbnail, id: j.id };
}

const cleanup = (res) => { try { if (res?.dir) fs.rmSync(res.dir, { recursive: true, force: true }); } catch (_) {} };
const status = () => Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, p.available()]));

module.exports = { download, search, info, cleanup, status, ...platforms };

'use strict';
/** Provider cadangan: instance Cobalt (API). Aktif bila COBALT_API_URL diisi. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../config');

const available = () => Boolean(config.download.cobaltUrl);

async function fetchMedia(url, { mode = 'audio', quality = '720' } = {}) {
  const c = config.download;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (c.cobaltKey) headers.Authorization = 'Api-Key ' + c.cobaltKey;
  const r = await fetch(c.cobaltUrl + '/', {
    method: 'POST', headers,
    body: JSON.stringify({ url, videoQuality: quality, downloadMode: mode === 'audio' ? 'audio' : 'auto', audioFormat: 'mp3' }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.status === 'error') throw new Error('Cobalt: ' + (j.error?.code || 'gagal'));
  const link = ['redirect', 'tunnel'].includes(j.status) ? j.url : j.status === 'picker' ? j.picker?.[0]?.url : null;
  if (!link) throw new Error('Respon Cobalt tidak dikenali');
  const res = await fetch(link);
  if (!res.ok) throw new Error('Unduhan Cobalt HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > c.maxMb * 1048576) throw new Error(`File lebih dari ${c.maxMb} MB`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-dl-'));
  const ext = mode === 'audio' ? 'mp3' : 'mp4';
  const file = path.join(dir, `media.${ext}`);
  fs.writeFileSync(file, buf);
  return { file, dir, title: j.filename || 'media', duration: 0, ext, mode };
}

module.exports = { name: 'cobalt', available, fetchMedia };

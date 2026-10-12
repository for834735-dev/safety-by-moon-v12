'use strict';
/** Provider khusus TikTok (tanpa API key). Memberi video tanpa watermark dan audio aslinya. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../config');

const available = () => true;

async function fetchMedia(url, { mode = 'audio' } = {}) {
  if (!/tiktok\.com/i.test(url)) throw new Error('tikwm hanya untuk TikTok');
  const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json();
  if (j.code !== 0 || !j.data) throw new Error('TikTok: ' + (j.msg || 'gagal mengambil data'));
  const link = mode === 'audio' ? j.data.music : (j.data.hdplay || j.data.play);
  if (!link) throw new Error('TikTok: tautan media kosong');
  const res = await fetch(link.startsWith('http') ? link : 'https://www.tikwm.com' + link);
  if (!res.ok) throw new Error('Unduhan TikTok HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > config.download.maxMb * 1048576) throw new Error(`File lebih dari ${config.download.maxMb} MB`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-dl-'));
  const ext = mode === 'audio' ? 'mp3' : 'mp4';
  const file = path.join(dir, `media.${ext}`);
  fs.writeFileSync(file, buf);
  return { file, dir, title: j.data.title || 'TikTok', duration: j.data.duration || 0, ext, mode };
}

module.exports = { name: 'tikwm', available, fetchMedia };

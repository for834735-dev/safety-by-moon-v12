'use strict';
/**
 * Kategori 7 — Foto & Gambar (10 fitur)
 * hd · putar · filter · crop · watermark · meme · pasfoto · palet · toimg · ubahformat
 */
const H = require('./helpers');
const { S, say } = require('../ui/style');
const { fontFamily } = require('../ui/fonts');

const IMG = ['imageMessage'];
const IMG_STICKER = ['imageMessage', 'stickerMessage'];
const NEED = 'Kirim atau reply sebuah gambar dengan command ini.';

// q (1–100) → skala kualitas JPEG ffmpeg (2 terbaik … 31 terburuk)
const jpgQ = (q) => H.clamp(Math.round(31 - (q / 100) * 29), 2, 31);

// ---------- HD / peningkatan kualitas foto ----------
const HD_PRESETS = {
  ringan: { skala: 2, q: 80, tajam: 3, denoise: 1, kontras: 0, terang: 0, warna: 0 },
  normal: { skala: 2, q: 90, tajam: 4, denoise: 2, kontras: 0, terang: 0, warna: 0 },
  max: { skala: 4, q: 95, tajam: 6, denoise: 2, kontras: 1, terang: 0, warna: 1 },
  teks: { skala: 3, q: 95, tajam: 7, denoise: 0, kontras: 2, terang: 0, warna: 0 },
  potret: { skala: 2, q: 92, tajam: 3, denoise: 3, kontras: 0, terang: 0, warna: 1 },
};
const HD_HELP = [
  `${S.dot} Preset : ringan · normal · max · teks · potret`,
  `${S.dot} skala  : 1–4  (contoh 3x atau skala=3)`,
  `${S.dot} q      : kualitas 1–100`,
  `${S.dot} tajam  : ketajaman 0–10`,
  `${S.dot} denoise: pengurang bintik 0–10`,
  `${S.dot} kontras / terang / warna : −5 sampai 5`,
  `${S.dot} Format : jpg · png · webp   |   dok = kirim sebagai file`,
  '',
  'Contoh:',
  '.hd max',
  '.hd 3x q=95 tajam=6 png dok',
  '.hd skala=2 denoise=5 warna=2',
].join('\n');

function hdOptions(args) {
  const { kv, flags } = H.parseArgs(args);
  const preset = HD_PRESETS[flags.find((f) => HD_PRESETS[f])] || HD_PRESETS.normal;
  const o = { ...preset };
  o.skala = H.numOr(kv.skala, o.skala, 1, 4);
  o.q = H.numOr(kv.q ?? kv.kualitas, o.q, 1, 100);
  o.tajam = H.numOr(kv.tajam, o.tajam, 0, 10);
  o.denoise = H.numOr(kv.denoise, o.denoise, 0, 10);
  o.kontras = H.numOr(kv.kontras, o.kontras, -5, 5);
  o.terang = H.numOr(kv.terang, o.terang, -5, 5);
  o.warna = H.numOr(kv.warna, o.warna, -5, 5);
  o.format = ['png', 'webp', 'jpg'].find((f) => flags.includes(f) || flags.includes(f === 'jpg' ? 'jpeg' : f)) || 'jpg';
  o.dok = flags.includes('dok') || flags.includes('file') || o.format === 'png' || o.skala >= 3;
  return o;
}

function hdFilter(o) {
  const f = [];
  if (o.denoise > 0) f.push(`hqdn3d=${o.denoise}:${(o.denoise * 0.75).toFixed(2)}:${o.denoise * 2}:${(o.denoise * 1.5).toFixed(2)}`);
  if (o.skala > 1) f.push(`scale=w='min(iw*${o.skala},4096)':h='min(ih*${o.skala},4096)':force_original_aspect_ratio=decrease:flags=lanczos`);
  f.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  if (o.tajam > 0) f.push(`unsharp=5:5:${(o.tajam * 0.25).toFixed(2)}:5:5:0`);
  if (o.kontras || o.terang || o.warna) f.push(`eq=contrast=${(1 + o.kontras * 0.1).toFixed(2)}:brightness=${(o.terang * 0.04).toFixed(2)}:saturation=${(1 + o.warna * 0.12).toFixed(2)}`);
  return f.join(',');
}
const encArgs = (fmt, q) => (fmt === 'png' ? ['-compression_level', '6'] : fmt === 'webp' ? ['-c:v', 'libwebp', '-quality', String(Math.round(q))] : ['-q:v', String(jpgQ(q))]);

// ---------- filter sederhana ----------
const FILTERS = {
  hitamputih: 'hue=s=0', bw: 'hue=s=0',
  sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
  blur: 'boxblur=8:2', invert: 'negate',
  vivid: 'eq=saturation=1.6:contrast=1.1', pudar: 'eq=saturation=0.6:brightness=0.06',
  dingin: 'colorbalance=bs=.25:bm=.12:rs=-.12', hangat: 'colorbalance=rs=.22:bs=-.18',
  tajam: 'unsharp=7:7:1.5:7:7:0', pixel: 'scale=iw/24:-2,scale=iw*24:ih*24:flags=neighbor',
  vignette: 'vignette=PI/4', cerah: 'eq=brightness=0.12:contrast=1.08',
};

// ---------- rasio crop ----------
function parseRatio(s = '') {
  const presets = { kotak: '1:1', potret: '4:5', lanskap: '16:9', story: '9:16', ktp: '85.6:54' };
  const m = String(presets[s] || s).match(/^(\d+(?:\.\d+)?)[:x/](\d+(?:\.\d+)?)$/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}

// ---------- kanvas ----------
async function loadCanvasImage(buf) {
  const { loadImage } = require('@napi-rs/canvas');
  return loadImage(buf);
}
function coverDraw(ctx, img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r; const sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
function fitFont(ctx, text, maxW, start, weight = 'bold') {
  let size = start;
  do { ctx.font = `${weight} ${size}px ${fontFamily()}`; size -= 2; } while (ctx.measureText(text).width > maxW && size > 12);
  return size + 2;
}

const commands = {
  hd: {
    help: 'Foto HD dengan kualitas bisa diatur: .hd [preset] [3x] [q=95] [tajam=6] [png] [dok]', alias: ['hdr', 'jernih', 'upscale'],
    run: async (c) => {
      if (['bantuan', 'help', '?'].includes(c.args[0])) return c.reply(`${S.brand}\n${S.line}\nPENGATURAN FOTO HD\n${HD_HELP}`);
      const m = H.need(c, IMG, 'Kirim/reply foto dengan .hd. Ketik .hd bantuan untuk semua pengaturan.');
      const o = hdOptions(c.args);
      await c.reply(say('wait', `Memproses foto HD (${o.skala}x, kualitas ${o.q}, ketajaman ${o.tajam})...`));
      const inBuf = await H.downloadMedia(m);
      const out = await H.ffmpeg(inBuf, 'jpg', o.format, ['-vf', hdFilter(o), ...encArgs(o.format, o.q)]);
      const cap = `${S.ok} Foto HD selesai\n${S.dot} ${o.skala}x · q${o.q} · tajam ${o.tajam} · denoise ${o.denoise} · ${o.format.toUpperCase()}\n${S.dot} ${(inBuf.length / 1024).toFixed(0)} KB ${S.arrow} ${(out.length / 1024).toFixed(0)} KB`;
      return H.sendImage(c, out, { caption: cap, asDoc: o.dok, ext: o.format, name: 'foto-hd' });
    },
  },
  putar: {
    help: 'Putar/balik gambar: .putar <90|180|270|mirror|flip>', alias: ['rotate'],
    run: async (c) => {
      const a = (c.args[0] || '90').toLowerCase();
      const vf = { 90: 'transpose=1', 270: 'transpose=2', 180: 'hflip,vflip', mirror: 'hflip', flip: 'vflip' }[a];
      if (!vf) return c.reply('Format: .putar <90|180|270|mirror|flip> (reply gambar)');
      const m = H.need(c, IMG, NEED);
      const out = await H.ffmpeg(await H.downloadMedia(m), 'jpg', 'jpg', ['-vf', vf, '-q:v', '2']);
      return H.sendImage(c, out, { caption: say('ok', `Diputar: ${a}`) });
    },
  },
  filter: {
    help: 'Filter gambar: .filter <hitamputih|sepia|blur|invert|vivid|pudar|dingin|hangat|tajam|pixel|vignette|cerah>', alias: ['efek'],
    run: async (c) => {
      const k = (c.args[0] || '').toLowerCase();
      if (!FILTERS[k]) return c.reply(`${S.warn} Pilih filter:\n${[...new Set(Object.keys(FILTERS).filter((x) => x !== 'bw'))].map((x) => S.dot + ' ' + x).join('\n')}\n\nContoh: .filter sepia (reply gambar)`);
      const m = H.need(c, IMG, NEED);
      const out = await H.ffmpeg(await H.downloadMedia(m), 'jpg', 'jpg', ['-vf', FILTERS[k], '-q:v', '2']);
      return H.sendImage(c, out, { caption: say('ok', `Filter ${k}`) });
    },
  },
  crop: {
    help: 'Potong gambar ke rasio: .crop <1:1|4:5|16:9|9:16|kotak|story|L:T>', alias: ['potonggambar'],
    run: async (c) => {
      const r = parseRatio((c.args[0] || '').toLowerCase());
      if (!r) return c.reply('Format: .crop <rasio>\nContoh: .crop 1:1 · .crop 16:9 · .crop story (reply gambar)');
      const m = H.need(c, IMG, NEED);
      const [w, h] = r;
      const vf = `crop='if(gte(iw/ih,${w}/${h}),ih*${w}/${h},iw)':'if(gte(iw/ih,${w}/${h}),ih,iw*${h}/${w})'`;
      const out = await H.ffmpeg(await H.downloadMedia(m), 'jpg', 'jpg', ['-vf', vf, '-q:v', '2']);
      return H.sendImage(c, out, { caption: say('ok', `Dipotong rasio ${c.args[0]}`) });
    },
  },
  watermark: {
    help: 'Tempel teks watermark: .watermark <teks> [pojok|tengah|bawah] [alpha=10-100]', alias: ['wm'],
    run: async (c) => {
      const { kv, flags } = H.parseArgs(c.args);
      const pos = flags.find((f) => ['pojok', 'tengah', 'bawah', 'atas'].includes(f)) || 'pojok';
      const text = c.args.filter((a) => !/^[a-z]+[=:]/i.test(a) && !['pojok', 'tengah', 'bawah', 'atas'].includes(a.toLowerCase())).join(' ').trim();
      if (!text) return c.reply('Format: .watermark <teks> [pojok|tengah|bawah|atas] [alpha=60] (reply gambar)');
      const m = H.need(c, IMG, NEED);
      const { createCanvas } = require('@napi-rs/canvas');
      const img = await loadCanvasImage(await H.downloadMedia(m));
      const cv = createCanvas(img.width, img.height); const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const size = fitFont(ctx, text, img.width * 0.6, Math.max(18, Math.round(img.width / 14)));
      ctx.globalAlpha = H.numOr(kv.alpha, 60, 10, 100) / 100;
      ctx.textBaseline = 'middle';
      const pad = size * 0.8;
      let x = img.width - pad; let y = img.height - pad; ctx.textAlign = 'right';
      if (pos === 'tengah') { x = img.width / 2; y = img.height / 2; ctx.textAlign = 'center'; }
      if (pos === 'bawah') { x = img.width / 2; y = img.height - pad; ctx.textAlign = 'center'; }
      if (pos === 'atas') { x = img.width / 2; y = pad; ctx.textAlign = 'center'; }
      ctx.lineWidth = Math.max(2, size / 9); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = '#ffffff';
      ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
      return H.sendImage(c, cv.toBuffer('image/jpeg', 92), { caption: say('ok', 'Watermark ditambahkan') });
    },
  },
  meme: {
    help: 'Buat meme: .meme teks atas | teks bawah (reply gambar)', alias: ['memegen'],
    run: async (c) => {
      const [top, bottom = ''] = c.rest.split('|').map((x) => x.trim());
      if (!top && !bottom) return c.reply('Format: .meme teks atas | teks bawah (reply gambar)');
      const m = H.need(c, IMG, NEED);
      const { createCanvas } = require('@napi-rs/canvas');
      const img = await loadCanvasImage(await H.downloadMedia(m));
      const cv = createCanvas(img.width, img.height); const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
      const draw = (t, y, base) => {
        if (!t) return;
        const up = t.toUpperCase();
        const size = fitFont(ctx, up, img.width * 0.92, Math.round(img.width / 9));
        ctx.lineWidth = Math.max(3, size / 7); ctx.textBaseline = base;
        ctx.strokeText(up, img.width / 2, y); ctx.fillText(up, img.width / 2, y);
      };
      draw(top, img.height * 0.03, 'top');
      draw(bottom, img.height * 0.97, 'bottom');
      return H.sendImage(c, cv.toBuffer('image/jpeg', 92), { caption: say('ok', 'Meme jadi') });
    },
  },
  pasfoto: {
    help: 'Lembar pas foto siap cetak 4R: .pasfoto <2x3|3x4|4x6> [jumlah]', alias: ['pasphoto'],
    run: async (c) => {
      const size = (c.args[0] || '3x4').toLowerCase();
      const dims = { '2x3': [2, 3], '3x4': [3, 4], '4x6': [4, 6] }[size];
      if (!dims) return c.reply('Format: .pasfoto <2x3|3x4|4x6> [jumlah] (reply foto wajah)\nHasil: lembar 4R (10×15 cm, 300 dpi) siap cetak.');
      const m = H.need(c, IMG, 'Kirim/reply foto dengan .pasfoto 3x4');
      const { createCanvas } = require('@napi-rs/canvas');
      const img = await loadCanvasImage(await H.downloadMedia(m));
      const dpc = 300 / 2.54; // piksel per cm
      const pw = Math.round(dims[0] * dpc); const ph = Math.round(dims[1] * dpc);
      const W = 1205; const Hh = 1795; const gap = 24; const margin = 40;
      const cols = Math.max(1, Math.floor((W - margin * 2 + gap) / (pw + gap)));
      const rows = Math.max(1, Math.floor((Hh - margin * 2 + gap) / (ph + gap)));
      const total = H.clamp(parseInt(c.args[1], 10) || cols * rows, 1, cols * rows);
      const cv = createCanvas(W, Hh); const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, Hh);
      const gridW = cols * pw + (cols - 1) * gap;
      const ox = Math.round((W - gridW) / 2);
      for (let i = 0; i < total; i++) {
        const x = ox + (i % cols) * (pw + gap); const y = margin + Math.floor(i / cols) * (ph + gap);
        coverDraw(ctx, img, x, y, pw, ph);
        ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
      }
      return H.sendImage(c, cv.toBuffer('image/jpeg', 98), { asDoc: true, name: `pasfoto-${size}`, caption: say('ok', `Lembar pas foto ${size} cm · ${total} lembar · ukuran cetak 4R`) });
    },
  },
  palet: {
    help: 'Ambil warna dominan gambar: .palet [jumlah 3-10]', alias: ['warna', 'colors'],
    run: async (c) => {
      const m = H.need(c, IMG, NEED);
      const n = H.clamp(parseInt(c.args[0], 10) || 6, 3, 10);
      const { createCanvas } = require('@napi-rs/canvas');
      const img = await loadCanvasImage(await H.downloadMedia(m));
      const sw = 64; const sh = Math.max(1, Math.round(64 * img.height / img.width));
      const t = createCanvas(sw, sh); const tc = t.getContext('2d'); tc.drawImage(img, 0, 0, sw, sh);
      const d = tc.getImageData(0, 0, sw, sh).data; const bins = new Map();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const k = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`;
        const b = bins.get(k) || { c: 0, r: 0, g: 0, b: 0 }; b.c++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2]; bins.set(k, b);
      }
      const cols = [];
      for (const b of [...bins.values()].sort((x, y) => y.c - x.c)) {
        const rgb = [Math.round(b.r / b.c), Math.round(b.g / b.c), Math.round(b.b / b.c)];
        if (cols.every((o) => Math.hypot(o.rgb[0] - rgb[0], o.rgb[1] - rgb[1], o.rgb[2] - rgb[2]) > 48)) cols.push({ rgb, c: b.c });
        if (cols.length >= n) break;
      }
      const total = cols.reduce((s, x) => s + x.c, 0) || 1;
      const hex = (r) => '#' + r.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      const cv = createCanvas(cols.length * 120, 140); const ctx = cv.getContext('2d');
      cols.forEach((x, i) => { ctx.fillStyle = hex(x.rgb); ctx.fillRect(i * 120, 0, 120, 140); });
      const lines = cols.map((x) => `${S.dot} ${hex(x.rgb)}  rgb(${x.rgb.join(', ')})  ${Math.round((x.c / total) * 100)}%`);
      return H.sendImage(c, cv.toBuffer('image/png'), { ext: 'png', caption: `${S.ok} Warna dominan\n${lines.join('\n')}` });
    },
  },
  toimg: {
    help: 'Stiker jadi gambar: reply stiker + .toimg', alias: ['stikerkegambar', 'toimage'],
    run: async (c) => {
      const m = H.need(c, ['stickerMessage'], 'Reply sebuah stiker dengan .toimg');
      if (m.node.isAnimated) throw new Error('Stiker animasi tidak bisa dijadikan gambar diam. Gunakan .togif.');
      const out = await H.ffmpeg(await H.downloadMedia(m), 'webp', 'png', ['-frames:v', '1']);
      return H.sendImage(c, out, { ext: 'png', caption: say('ok', 'Stiker dikonversi ke PNG') });
    },
  },
  ubahformat: {
    help: 'Ubah format gambar: .ubahformat <png|jpg|webp> [kualitas]', alias: ['convertimg', 'formatgambar'],
    run: async (c) => {
      const f = (c.args[0] || '').toLowerCase().replace('jpeg', 'jpg');
      if (!['png', 'jpg', 'webp'].includes(f)) return c.reply('Format: .ubahformat <png|jpg|webp> [kualitas 1-100] (reply gambar/stiker)');
      const q = H.numOr(c.args[1], 92, 1, 100);
      const m = H.need(c, IMG_STICKER, NEED);
      const out = await H.ffmpeg(await H.downloadMedia(m), 'jpg', f, [...encArgs(f, q)]);
      return H.sendImage(c, out, { ext: f, asDoc: true, name: 'hasil', caption: say('ok', `Dikonversi ke ${f.toUpperCase()} (${(out.length / 1024).toFixed(0)} KB)`) });
    },
  },
};

module.exports = { commands, hdOptions, hdFilter, parseRatio };

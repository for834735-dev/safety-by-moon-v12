'use strict';
/**
 * Kategori 9 — Teks & Kode (10 fitur)
 * font · case · hitungkata · rapikan · morse · base64 · hash · json · slug · enkripsi(+dekripsi)
 */
const crypto = require('crypto');
const H = require('./helpers');
const { S, say } = require('../ui/style');

const inputText = (c, from = 0) => (c.args.slice(from).join(' ') || H.quotedText(c.msg)).trim();

// ---------- gaya huruf Unicode (bukan emoji) ----------
const range = (up, lo, dg) => (ch) => {
  const c = ch.codePointAt(0);
  if (c >= 65 && c <= 90) return String.fromCodePoint(up + c - 65);
  if (c >= 97 && c <= 122) return String.fromCodePoint(lo + c - 97);
  if (dg && c >= 48 && c <= 57) return String.fromCodePoint(dg + c - 48);
  return ch;
};
const withHoles = (fn, holes) => (ch) => holes[ch] || fn(ch);
const SMALLCAPS = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ';
const FONTS = [
  ['tebal', 'Sans Tebal', range(0x1d5d4, 0x1d5ee, 0x1d7ec)],
  ['miring', 'Sans Miring', range(0x1d608, 0x1d622)],
  ['tebalmiring', 'Sans Tebal Miring', range(0x1d63c, 0x1d656, 0x1d7ec)],
  ['serif', 'Serif Tebal', range(0x1d400, 0x1d41a, 0x1d7ce)],
  ['serifmiring', 'Serif Miring', withHoles(range(0x1d434, 0x1d44e), { h: 'ℎ' })],
  ['mono', 'Monospace', range(0x1d670, 0x1d68a, 0x1d7f6)],
  ['tulis', 'Tulisan Tangan', withHoles(range(0x1d49c, 0x1d4b6), { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' })],
  ['tulistebal', 'Tulisan Tebal', range(0x1d4d0, 0x1d4ea)],
  ['ganda', 'Garis Ganda', withHoles(range(0x1d538, 0x1d552, 0x1d7d8), { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' })],
  ['bulat', 'Dalam Lingkaran', (ch) => { const c = ch.codePointAt(0); if (c >= 65 && c <= 90) return String.fromCodePoint(0x24b6 + c - 65); if (c >= 97 && c <= 122) return String.fromCodePoint(0x24d0 + c - 97); if (c >= 49 && c <= 57) return String.fromCodePoint(0x2460 + c - 49); if (c === 48) return '⓪'; return ch; }],
  ['lebar', 'Lebar Penuh', (ch) => { const c = ch.codePointAt(0); return c >= 33 && c <= 126 ? String.fromCodePoint(c + 0xfee0) : c === 32 ? '\u3000' : ch; }],
  ['kapitalkecil', 'Kapital Kecil', (ch) => { const c = ch.toLowerCase().codePointAt(0); return c >= 97 && c <= 122 ? SMALLCAPS[c - 97] : ch; }],
];
const applyFont = (fn, text) => [...text].map(fn).join('');

// ---------- morse ----------
const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '@': '.--.-.', '-': '-....-', ':': '---...' };
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
const toMorse = (t) => t.toLowerCase().split('').map((ch) => (ch === ' ' ? '/' : MORSE[ch] || '')).filter(Boolean).join(' ');
const fromMorse = (t) => t.trim().split(/\s*\/\s*/).map((w) => w.split(/\s+/).map((x) => UNMORSE[x] || '?').join('')).join(' ');

// ---------- enkripsi AES-256-GCM ----------
const PREFIX = 'SY1.';
function encrypt(pass, text) {
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const ci = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([ci.update(text, 'utf8'), ci.final()]);
  return PREFIX + Buffer.concat([salt, iv, ci.getAuthTag(), data]).toString('base64url');
}
function decrypt(pass, code) {
  const raw = Buffer.from(code.replace(PREFIX, ''), 'base64url');
  if (raw.length < 45) throw new Error('Kode terlalu pendek / rusak.');
  const key = crypto.scryptSync(pass, raw.subarray(0, 16), 32);
  const de = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(16, 28));
  de.setAuthTag(raw.subarray(28, 44));
  try { return Buffer.concat([de.update(raw.subarray(44)), de.final()]).toString('utf8'); } catch { throw new Error('Sandi salah atau kode rusak.'); }
}

// ---------- case ----------
const words = (t) => t.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const CASES = {
  besar: (t) => t.toUpperCase(), kecil: (t) => t.toLowerCase(),
  judul: (t) => t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()),
  kalimat: (t) => t.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()),
  tukar: (t) => [...t].map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join(''),
  camel: (t) => words(t).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(''),
  snake: (t) => words(t).map((w) => w.toLowerCase()).join('_'),
  kebab: (t) => words(t).map((w) => w.toLowerCase()).join('-'),
};

const STOP = new Set('yang dan di ke dari untuk dengan pada ini itu atau juga akan sudah tidak ada saya kamu dia kita mereka adalah dalam oleh karena sebagai bisa agar jika the a an of to in is and'.split(' '));

const commands = {
  font: {
    help: 'Ubah gaya huruf: .font <nomor|nama> <teks>  (.font untuk daftar)', alias: ['gayahuruf', 'fancy'],
    run: (c) => {
      const pick = (c.args[0] || '').toLowerCase();
      const idx = /^\d+$/.test(pick) ? parseInt(pick, 10) - 1 : FONTS.findIndex((f) => f[0] === pick);
      if (!FONTS[idx]) {
        const sample = 'Safety 120';
        return c.reply(`${S.brand}\n${S.line}\nGAYA HURUF\n${FONTS.map((f, i) => `${String(i + 1).padStart(2, '0')}. ${applyFont(f[2], sample)}   ${S.dot} ${f[0]}`).join('\n')}\n\nPakai: .font 1 teks kamu\nAtau : .font tebal teks kamu\nKetik: .font semua teks kamu → semua gaya sekaligus`);
      }
      const t = inputText(c, 1); if (!t) return c.reply('Tulis teksnya: .font 1 halo dunia');
      return c.reply(applyFont(FONTS[idx][2], t));
    },
  },
  case: {
    help: 'Ubah huruf besar/kecil: .case <besar|kecil|judul|kalimat|tukar|camel|snake|kebab> <teks>', alias: ['huruf'],
    run: (c) => {
      const k = (c.args[0] || '').toLowerCase(); const t = inputText(c, 1);
      if (!CASES[k] || !t) return c.reply(`Format: .case <jenis> <teks>\nJenis: ${Object.keys(CASES).join(' · ')}`);
      return c.reply(CASES[k](t));
    },
  },
  hitungkata: {
    help: 'Hitung kata, karakter, kalimat & waktu baca: .hitungkata <teks> (atau reply)', alias: ['jumlahkata', 'wordcount'],
    run: (c) => {
      const t = inputText(c); if (!t) return c.reply('Format: .hitungkata <teks> — atau reply sebuah pesan dengan .hitungkata');
      const w = t.split(/\s+/).filter(Boolean);
      const freq = {};
      w.forEach((x) => { const k = x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); if (k.length > 2 && !STOP.has(k)) freq[k] = (freq[k] || 0) + 1; });
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v})`).join(', ');
      const sec = Math.ceil((w.length / 200) * 60);
      return c.reply([`${S.ok} Statistik teks`, `${S.dot} Karakter   : ${t.length} (tanpa spasi ${t.replace(/\s/g, '').length})`, `${S.dot} Kata       : ${w.length}`, `${S.dot} Kalimat    : ${(t.match(/[.!?]+(\s|$)/g) || [t]).length}`, `${S.dot} Paragraf   : ${t.split(/\n\s*\n/).filter(Boolean).length}`, `${S.dot} Waktu baca : ${sec < 60 ? sec + ' detik' : Math.ceil(sec / 60) + ' menit'}`, top && `${S.dot} Sering     : ${top}`].filter(Boolean).join('\n'));
    },
  },
  rapikan: {
    help: 'Rapikan teks berantakan: .rapikan <teks> [unik] [nomor]', alias: ['bersihkan', 'clean'],
    run: (c) => {
      const flags = c.args.filter((a) => ['unik', 'nomor'].includes(a.toLowerCase())).map((a) => a.toLowerCase());
      const t = (c.rest.replace(/^(unik|nomor)(\s+(unik|nomor))?\s*/i, '') || H.quotedText(c.msg)).trim();
      if (!t) return c.reply('Format: .rapikan <teks> [unik] [nomor]\nunik = hapus baris ganda · nomor = beri nomor urut');
      let lines = t.replace(/[\u200B-\u200D\uFEFF]/g, '').split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim());
      lines = lines.filter((l, i) => l || (lines[i - 1] && lines[i + 1] !== undefined));
      if (flags.includes('unik')) { const seen = new Set(); lines = lines.filter((l) => !l || (!seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))); }
      if (flags.includes('nomor')) { let n = 0; lines = lines.map((l) => (l ? `${++n}. ${l}` : l)); }
      return c.reply(lines.join('\n').trim());
    },
  },
  morse: {
    help: 'Teks ⇄ kode Morse: .morse <teks atau kode>', alias: ['sandi'],
    run: (c) => {
      const t = inputText(c); if (!t) return c.reply('Format: .morse <teks> atau .morse .... .. (kode)');
      return c.reply(/^[.\-/\s]+$/.test(t) ? `${S.arrow} ${fromMorse(t)}` : `${S.arrow} ${toMorse(t)}`);
    },
  },
  base64: {
    help: 'Encode/decode Base64: .base64 <enc|dec> <teks>', alias: ['b64'],
    run: (c) => {
      const m = (c.args[0] || '').toLowerCase(); const t = inputText(c, 1);
      if (!['enc', 'dec', 'encode', 'decode'].includes(m) || !t) return c.reply('Format: .base64 enc halo  ·  .base64 dec aGFsbw==');
      if (m.startsWith('enc')) return c.reply(Buffer.from(t, 'utf8').toString('base64'));
      if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(t.replace(/\s/g, ''))) throw new Error('Bukan Base64 yang valid.');
      return c.reply(Buffer.from(t.replace(/\s/g, ''), 'base64').toString('utf8'));
    },
  },
  hash: {
    help: 'Hash teks: .hash <md5|sha1|sha256|sha512> <teks>', alias: ['checksum'],
    run: (c) => {
      const a = (c.args[0] || '').toLowerCase(); const t = inputText(c, 1);
      if (!['md5', 'sha1', 'sha256', 'sha512'].includes(a) || !t) return c.reply('Format: .hash sha256 teks kamu');
      return c.reply(`${S.ok} ${a.toUpperCase()}\n${crypto.createHash(a).update(t).digest('hex')}`);
    },
  },
  json: {
    help: 'Validasi & rapikan JSON: .json <kode json>', alias: ['jsonfmt'],
    run: (c) => {
      const t = inputText(c); if (!t) return c.reply('Format: .json {"a":1} — atau reply pesan berisi JSON');
      try { return c.reply('```' + JSON.stringify(JSON.parse(t), null, 2).slice(0, 3500) + '```'); } catch (e) {
        return c.reply(`${S.no} JSON tidak valid\n${e.message}`);
      }
    },
  },
  slug: {
    help: 'Buat slug URL dari judul: .slug <judul>', alias: ['permalink'],
    run: (c) => {
      const t = inputText(c); if (!t) return c.reply('Format: .slug Judul Artikel Saya');
      return c.reply(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
    },
  },
  enkripsi: {
    help: 'Sandikan teks dengan AES-256: .enkripsi <sandi> <teks>  ·  .dekripsi <sandi> <kode>', alias: ['dekripsi', 'encrypt', 'decrypt'],
    run: (c) => {
      const dec = ['dekripsi', 'decrypt'].includes(c.cmd);
      const pass = c.args[0]; const t = inputText(c, 1);
      if (!pass || !t) return c.reply(`Format:\n.enkripsi <sandi> <teks>\n.dekripsi <sandi> <kode>\n${S.warn} Hapus pesan setelah dipakai, sandi terlihat di chat.`);
      if (dec) return c.reply(`${S.ok} ${decrypt(pass, t.startsWith(PREFIX) ? t : PREFIX + t)}`);
      return c.reply(`${S.ok} Terenkripsi (AES-256-GCM)\n${encrypt(pass, t)}`);
    },
  },
};

// `.font semua <teks>` ditangani di sini agar tetap satu command.
const orig = commands.font.run;
commands.font.run = (c) => {
  if ((c.args[0] || '').toLowerCase() === 'semua') {
    const t = inputText(c, 1); if (!t) return c.reply('Format: .font semua <teks>');
    return c.reply(FONTS.map((f) => applyFont(f[2], t)).join('\n'));
  }
  return orig(c);
};

module.exports = { commands, FONTS, applyFont, toMorse, fromMorse, encrypt, decrypt, CASES };

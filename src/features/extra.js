'use strict';
/**
 * Kategori 15 — Grup Plus (11 fitur)
 * add · tagall · tagadmin · poll · afk · linkgrup · setnama · undi · antiasing · ssweb · brat
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const kv = require('../kv');
const H = require('./helpers');
const { S, ICON, head, row, foot } = require('../ui/style');

const AB = { group: true, admin: true, botadmin: true };
const A = { group: true, admin: true };
const CFG = () => kv.ns('extra', { afk: {}, antiasing: {} });
const keyOf = (jid) => H.phoneOf(jid) || H.num(jid);
const ago = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} detik`;
  if (s < 3600) return `${Math.round(s / 60)} menit`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam ${Math.round((s % 3600) / 60)} menit`;
  return `${Math.floor(s / 86400)} hari`;
};
const mentionLine = (jids) => jids.map((j) => `${S.arrow} @${H.num(j)}`).join('\n');

async function members(sock, gid) {
  const md = await sock.groupMetadata(gid);
  H.learnParticipants(md.participants);
  return md;
}

// ---------- .add ----------
const ADD_STATUS = {
  200: ['ok', 'berhasil ditambahkan'],
  409: ['dot', 'sudah ada di grup'],
  408: ['warn', 'baru saja keluar (tunggu dulu)'],
  401: ['no', 'memblokir bot'],
  403: ['wait', 'privasi grup aktif, undangan dikirim ke chat pribadinya'],
  500: ['no', 'grup penuh / gagal'],
};

async function addOne(c, digits, inviteCode, subject) {
  const jid = digits + '@s.whatsapp.net';
  let real = jid;
  try {
    const r = await c.sock.onWhatsApp(jid);
    const x = Array.isArray(r) ? r[0] : null;
    if (!x?.exists) return { digits, tag: 'no', text: 'tidak terdaftar di WhatsApp' };
    if (x.jid) real = x.jid;
  } catch (_) { /* lanjut saja, biar server yang menolak */ }
  let res;
  try { res = await c.sock.groupParticipantsUpdate(c.from, [real], 'add'); } catch (e) { return { digits, tag: 'no', text: 'gagal: ' + e.message }; }
  const st = String(res?.[0]?.status || '');
  const [tag, text] = ADD_STATUS[st] || ['warn', `status ${st || 'tidak diketahui'}`];
  if (st === '403' && inviteCode) {
    const ok = await H.safeSend(c.sock, real, { text: `${S.top}${S.bar} ${ICON.group} UNDANGAN GRUP\n${S.mid} Kamu diundang masuk grup *${subject}*\n${S.mid} Tap link untuk bergabung:\n${S.mid} https://chat.whatsapp.com/${inviteCode}\n${S.end}${S.bar.repeat(14)}` });
    if (!ok) return { digits, tag: 'warn', text: 'privasi aktif & undangan gagal dikirim' };
  }
  return { digits, tag, text };
}

// ---------- .brat ----------
const FONT_CANDIDATES = [
  process.env.FONT_FILE_BOLD, process.env.FONT_FILE,
  '/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', '/system/fonts/Roboto-Regular.ttf', '/system/fonts/DroidSans.ttf',
  '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans.ttf',
];
const findFont = () => FONT_CANDIDATES.find((f) => f && fs.existsSync(f));
const BRAT = { hijau: ['0x8ACF00', 'black'], putih: ['white', 'black'], hitam: ['black', 'white'], pink: ['0xFFB6D9', 'black'] };

function wrap(text, size, widthPx = 464) {
  const perLine = Math.max(4, Math.floor(widthPx / (size * 0.56)));
  const lines = []; let cur = '';
  for (const w of text.split(/\s+/)) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= perLine) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
    while (cur.length > perLine) { lines.push(cur.slice(0, perLine)); cur = cur.slice(perLine); }
  }
  if (cur) lines.push(cur);
  return lines;
}
function layout(text) {
  for (let size = 150; size >= 28; size -= 4) {
    const lines = wrap(text, size);
    if (lines.length * size * 1.08 <= 464) return { size, lines };
  }
  return { size: 28, lines: wrap(text, 28).slice(0, 14) };
}
function renderBrat(text, theme) {
  const font = findFont();
  if (!font) return Promise.reject(new Error('Font sistem tidak ditemukan. Isi FONT_FILE di .env.'));
  const [bg, fg] = BRAT[theme] || BRAT.hijau;
  const { size, lines } = layout(text);
  const tf = path.join(os.tmpdir(), `brat-${Date.now()}-${H.rnd(1000, 9999)}.txt`);
  const out = tf.replace('.txt', '.png');
  fs.writeFileSync(tf, lines.join('\n'));
  const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  const vf = `drawtext=fontfile='${esc(font)}':textfile='${esc(tf)}':fontsize=${size}:fontcolor=${fg}:x=24:y=20:line_spacing=${Math.round(-size * 0.06)},gblur=sigma=1.3`;
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${bg}:s=512x512:d=1`, '-vf', vf, '-frames:v', '1', out], { timeout: 20000 }, (err, _o, se) => {
      try {
        if (err) return reject(new Error(err.code === 'ENOENT' ? 'ffmpeg belum terpasang.' : 'ffmpeg gagal: ' + String(se).slice(-150)));
        resolve(fs.readFileSync(out));
      } finally { fs.rmSync(tf, { force: true }); fs.rmSync(out, { force: true }); }
    });
  });
}

// ---------- commands ----------
const commands = {
  add: {
    help: 'Tambah member otomatis (maks 15 nomor): .add 0812xxxx, 62857xxxx', ...AB, alias: ['tambah', 'invite'],
    run: async (c) => {
      const { parseNumbers } = require('./intel');
      let list = parseNumbers(c.rest, 15);
      if (!list.length) list = parseNumbers(H.quotedText(c.msg), 15);
      if (!list.length) return c.reply(`${S.warn} Sertakan nomornya.\nContoh:\n${S.arrow} .add 0812-3456-7890\n${S.arrow} .add 62812xxxx, 62857xxxx\n_Atau reply pesan yang berisi nomor._`);
      const md = await members(c.sock, c.from);
      let code = null;
      try { code = await c.sock.groupInviteCode(c.from); } catch (_) { /* tanpa undangan */ }
      await c.reply(`${S.wait} Menambahkan ${list.length} nomor ke *${md.subject}*...`);
      const results = [];
      for (const d of list) {
        results.push(await addOne(c, d, code, md.subject));
        if (list.length > 1) await H.sleep(H.rnd(1800, 3200)); // jeda acak supaya tidak dianggap spam
      }
      H.clearGroupCache(c.from);
      const okN = results.filter((r) => r.tag === 'ok').length;
      const lines = results.map((r) => `${S[r.tag] || S.dot} +${r.digits}  ${r.text}`);
      return c.reply([head(ICON.group, 'Hasil Add'), ...lines.map(row), row(`Berhasil: ${okN}/${results.length}`), foot()].join('\n'));
    },
  },
  tagall: {
    help: 'Tag semua member: .tagall [pesan]', ...A, alias: ['everyone'],
    run: async (c) => {
      const md = await members(c.sock, c.from);
      const jids = md.participants.map(H.partJid).filter(Boolean);
      const note = c.rest ? `${c.rest}\n\n` : '';
      for (let i = 0; i < jids.length; i += 80) {
        const part = jids.slice(i, i + 80);
        const text = `${i === 0 ? `${S.top}${S.bar} ${ICON.group} PANGGILAN SEMUA (${jids.length})\n${S.end}${S.bar.repeat(14)}\n${note}` : ''}${mentionLine(part)}`;
        await c.sock.sendMessage(c.from, { text, mentions: part }, i === 0 ? { quoted: c.msg } : undefined);
        if (i + 80 < jids.length) await H.sleep(1500);
      }
    },
  },
  tagadmin: {
    help: 'Panggil semua admin grup: .tagadmin [pesan]', group: true, alias: ['admins'],
    run: async (c) => {
      const md = await members(c.sock, c.from);
      const jids = md.participants.filter((p) => p.admin).map(H.partJid).filter(Boolean);
      if (!jids.length) return c.reply('Tidak ada admin terdeteksi.');
      return c.say(`${S.top}${S.bar} ${ICON.security} PANGGILAN ADMIN\n${S.end}${S.bar.repeat(14)}\n${c.rest ? c.rest + '\n\n' : ''}${mentionLine(jids)}`, jids);
    },
  },
  poll: {
    help: 'Buat polling: .poll Pertanyaan | opsi 1 | opsi 2 [| opsi 3...]  (tambah --multi untuk boleh pilih banyak)', group: true, alias: ['polling', 'vote'],
    run: async (c) => {
      const multi = /--multi\b/i.test(c.rest);
      const parts = c.rest.replace(/--multi\b/i, '').split('|').map((x) => x.trim()).filter(Boolean);
      if (parts.length < 3) return c.reply(`${S.warn} Format: .poll Pertanyaan | opsi 1 | opsi 2\nContoh: .poll Kumpul jam berapa? | 19.00 | 20.00 | 21.00`);
      const [name, ...values] = parts;
      return c.sock.sendMessage(c.from, { poll: { name: name.slice(0, 250), values: values.slice(0, 12).map((v) => v.slice(0, 100)), selectableCount: multi ? 0 : 1 } });
    },
  },
  afk: {
    help: 'Tandai dirimu sedang tidak aktif: .afk [alasan]', group: true,
    run: (c) => {
      const cfg = CFG(); cfg.afk[keyOf(c.sender)] = { since: Date.now(), reason: (c.rest || 'tanpa alasan').slice(0, 120), name: c.msg.pushName || '' };
      kv.save();
      return c.say(`${S.ok} @${H.num(c.sender)} sekarang AFK.\n${S.dot} Alasan: ${cfg.afk[keyOf(c.sender)].reason}\n_Bot akan memberi tahu bila ada yang menyebutmu. AFK berakhir otomatis saat kamu chat lagi._`, [c.sender]);
    },
  },
  linkgrup: {
    help: 'Ambil link undangan grup: .linkgrup  |  .linkgrup reset (buat link baru)', ...AB, alias: ['linkgc'],
    run: async (c) => {
      if ((c.args[0] || '').toLowerCase() === 'reset') {
        const code = await c.sock.groupRevokeInvite(c.from);
        return c.reply(`${S.ok} Link lama dicabut.\n${S.arrow} Link baru: https://chat.whatsapp.com/${code}`);
      }
      const code = await c.sock.groupInviteCode(c.from);
      return c.reply(`${S.arrow} Link grup:\nhttps://chat.whatsapp.com/${code}\n_Ketik .linkgrup reset untuk mencabut & membuat link baru._`);
    },
  },
  setnama: {
    help: 'Ganti nama grup: .setnama Nama Baru', ...AB, alias: ['namagrup'],
    run: async (c) => {
      const n = c.rest.trim();
      if (!n) return c.reply('Format: .setnama Nama Baru');
      if (n.length > 100) return c.reply('Nama grup maksimal 100 karakter.');
      await c.sock.groupUpdateSubject(c.from, n);
      return c.reply(`${S.ok} Nama grup diganti menjadi *${n}*.`);
    },
  },
  undi: {
    help: 'Acak pemenang: .undi [jumlah]  |  .undi a, b, c (dari daftar sendiri)', group: true, alias: ['giveaway', 'acak'],
    run: async (c) => {
      if (c.rest.includes(',')) {
        const items = c.rest.split(',').map((x) => x.trim()).filter(Boolean);
        if (items.length < 2) return c.reply('Isi minimal 2 pilihan, pisahkan dengan koma.');
        return c.reply(`${S.ok} Terpilih: *${H.pick(items)}*\n_dari ${items.length} pilihan_`);
      }
      const n = H.numOr(c.args[0], 1, 1, 10);
      const md = await members(c.sock, c.from);
      const me = H.num(c.sock.user?.id || '');
      const pool = md.participants.map(H.partJid).filter((j) => j && H.num(j) !== me);
      if (!pool.length) return c.reply('Tidak ada peserta.');
      const win = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
      return c.say(`${S.top}${S.bar} ${ICON.fun} PEMENANG UNDIAN\n${S.end}${S.bar.repeat(14)}\n${mentionLine(win)}\n\n_dari ${pool.length} peserta_`, win);
    },
  },
  antiasing: {
    help: 'Tolak otomatis nomor luar negeri yang masuk: .antiasing on|off  |  .antiasing kode 62,60', ...AB, alias: ['antifake'],
    run: (c) => {
      const cfg = CFG(); const cur = cfg.antiasing[c.from] || { on: false, cc: ['62'] };
      const a = (c.args[0] || '').toLowerCase();
      if (a === 'kode') {
        const cc = (c.args[1] || '').split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean).slice(0, 10);
        if (!cc.length) return c.reply('Format: .antiasing kode 62,60');
        cur.cc = cc;
      } else if (a) {
        const v = H.onoff(a); if (v === null || v === undefined) return c.reply('Gunakan: .antiasing on | off | kode 62,60');
        cur.on = v;
      } else return c.reply(`${S.dot} Status: ${cur.on ? 'AKTIF' : 'mati'}\n${S.dot} Kode negara diizinkan: +${cur.cc.join(', +')}\n${S.arrow} .antiasing on|off\n${S.arrow} .antiasing kode 62,60`);
      cfg.antiasing[c.from] = cur; kv.save();
      return c.reply(`${S.ok} Anti nomor asing: ${cur.on ? 'AKTIF' : 'mati'} (izin: +${cur.cc.join(', +')})`);
    },
  },
  ssweb: {
    help: 'Tangkapan layar website: .ssweb <alamat>', alias: ['ss', 'screenshot'],
    run: async (c) => {
      if (!c.args[0]) return c.reply('Format: .ssweb google.com');
      let url = c.args[0]; if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      let host; try { host = new URL(url).hostname; } catch { return c.reply('Alamat tidak valid.'); }
      await H.assertPublicHost(host);
      await c.reply(`${S.wait} Mengambil tangkapan layar ${host}...`);
      const sources = [
        `https://image.thum.io/get/width/1280/crop/800/noanimate/${url}`,
        `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=1280&h=800`,
      ];
      for (const src of sources) {
        try {
          const buf = await H.getBuffer(src, { timeout: 30000 });
          if (buf.length > 8000) return c.sock.sendMessage(c.from, { image: buf, caption: `${S.arrow} ${url}` }, { quoted: c.msg });
        } catch (_) { /* coba sumber berikutnya */ }
      }
      return c.reply(`${S.warn} Gagal mengambil tangkapan layar. Coba lagi sebentar.`);
    },
  },
  brat: {
    help: 'Stiker teks gaya brat: .brat teks  |  .brat putih|hitam|pink teks', alias: ['bratstiker'],
    run: async (c) => {
      let t = c.rest || H.quotedText(c.msg); let theme = 'hijau';
      const w = t.split(/\s+/)[0]?.toLowerCase();
      if (BRAT[w] && t.split(/\s+/).length > 1) { theme = w; t = t.slice(w.length).trim(); }
      t = t.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!t) return c.reply('Format: .brat teks kamu\nContoh: .brat aku bukan bot');
      if (t.length > 180) return c.reply('Teks maksimal 180 karakter.');
      const png = await renderBrat(t, theme);
      const { makeStickerFromBuffer } = require('./sticker');
      const webp = await makeStickerFromBuffer(png, { pack: 'Brat', author: 'Safety Your WhatsApp', quality: 80 });
      return c.sock.sendMessage(c.from, { sticker: webp }, { quoted: c.msg });
    },
  },
};

// ---------- AFK (pasif) ----------
async function onMessage(c) {
  if (!c.isGroup || c.msg.key.fromMe) return false;
  const cfg = CFG(); const afk = cfg.afk;
  if (!Object.keys(afk).length) return false;
  const me = keyOf(c.sender);
  if (afk[me] && !/^\.afk\b/i.test(c.text)) {
    const x = afk[me]; delete afk[me]; kv.save();
    await c.say(`${S.ok} @${H.num(c.sender)} kembali dari AFK setelah ${ago(Date.now() - x.since)}.`, [c.sender]);
  }
  const ci = H.ctxInfo(c.msg);
  const hit = new Set([...(ci.mentionedJid || []), ...(ci.participant && ci.quotedMessage ? [ci.participant] : [])]);
  const lines = []; const tags = [];
  for (const j of hit) { const x = afk[keyOf(j)]; if (x && keyOf(j) !== me) { lines.push(`${S.dot} @${H.num(j)} AFK ${ago(Date.now() - x.since)} lalu — ${x.reason}`); tags.push(j); } }
  if (lines.length) await c.say(`${S.wait} Yang kamu tag sedang AFK:\n${lines.join('\n')}`, tags);
  return false;
}

// ---------- antiasing (saat ada yang masuk grup) ----------
/** Mengembalikan daftar peserta yang tersisa (yang tidak ditendang) untuk diteruskan ke welcome. */
async function onParticipants(sock, u) {
  const rule = CFG().antiasing[u.id];
  if (u.action !== 'add' || !rule?.on) return u.participants;
  const botNum = H.num(sock.user?.id || '');
  if (u.author && H.num(u.author) === botNum) return u.participants; // sengaja ditambah lewat .add
  const keep = []; const kicked = [];
  for (const p of u.participants || []) {
    const jid = H.partJid(p);
    const alt = typeof p === 'object' ? p.phoneNumber : null;
    const n = (alt && H.num(alt)) || (H.isLid(jid) ? H.phoneOf(jid) : H.num(jid));
    if (!n || n === H.ownerNum() || rule.cc.some((cc) => n.startsWith(cc))) { keep.push(p); continue; } // tidak bisa dipastikan = biarkan
    kicked.push({ p, jid, n });
  }
  if (kicked.length) {
    try {
      await sock.groupParticipantsUpdate(u.id, kicked.map((k) => k.jid), 'remove');
      H.clearGroupCache(u.id);
      await H.safeSend(sock, u.id, { text: `${S.lock} ${kicked.length} nomor luar negeri dikeluarkan otomatis (+${kicked.map((k) => k.n.slice(0, 3)).join(', +')}...).\n_Izin hanya kode +${rule.cc.join(', +')}_` });
    } catch (e) { keep.push(...kicked.map((k) => k.p)); H.log.warn('antiasing: ' + e.message); }
  }
  return keep;
}

module.exports = { commands, onMessage, onParticipants, renderBrat };

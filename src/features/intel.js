'use strict';
/**
 * Kategori 12 — Intel Nomor & Akun (khusus admin / owner), 6 fitur
 * lacak · operator · cekmassal · bio · cekbisnis · anggota
 *
 * Semua data berasal dari sumber yang memang terlihat publik: pola nomor (negara/operator) dan profil WhatsApp
 * yang bisa dilihat siapa pun (foto, bio, profil bisnis), plus nama profil yang pernah terlihat oleh bot.
 * Posisi/lokasi nyata seseorang TIDAK bisa diambil dari WhatsApp ataupun dari nomornya.
 */
const H = require('./helpers');
const numinfo = require('../services/numberinfo');
const { S, ICON, head, row, foot, say } = require('../ui/style');

const A = { admin: true };
const NOTE_LOC = `${S.warn} Lokasi nyata tidak bisa dilacak. "Wilayah" hanya berasal dari pola penomoran.`;
const dt = (t) => (t ? new Intl.DateTimeFormat('id-ID', { timeZone: H.TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(Number(t) > 1e12 ? Number(t) : Number(t) * 1000)) : null);
const box = (title, lines) => [head(ICON.net, title), ...lines.filter(Boolean).map(row), foot()].join('\n');
const kvl = (k, v, pad = 10) => (v === null || v === undefined || v === '' ? null : `${S.dot} ${k.padEnd(pad)}: ${v}`);

/** Menentukan target: @tag eksplisit, nomor yang diketik, pesan yang di-reply, atau lawan chat di chat pribadi. */
function target(c, from = 0) {
  const ci = H.ctxInfo(c.msg);
  const ment = ci.mentionedJid?.[0];
  if (ment) return { jid: ment, digits: H.phoneOf(ment) };
  const raw = c.args.slice(from).join(' ');
  const m = raw.match(/\+?\d[\d\s().-]{6,}\d/);
  if (m) { const d = numinfo.normalize(m[0]); if (d) return { jid: d + '@s.whatsapp.net', digits: d }; }
  if (ci.participant && ci.quotedMessage) return { jid: ci.participant, digits: H.phoneOf(ci.participant) };
  if (!c.isGroup) return { jid: c.from, digits: H.phoneOf(c.from) };
  return null;
}
const USAGE = 'Sebutkan target: ketik nomornya, @tag orangnya, atau reply pesannya.\nContoh: .lacak 0812-3456-7890';

/** Banyak nomor dari teks bebas. */
function parseNumbers(text, max) {
  const chunks = String(text).split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const ch of chunks) {
    const toks = ch.split(/\s+/);
    const multi = toks.length > 1 && toks.every((t) => t.replace(/\D/g, '').length >= 8);
    for (const part of multi ? toks : [ch]) { const d = numinfo.normalize(part); if (d && !out.includes(d)) out.push(d); }
  }
  return out.slice(0, max);
}

async function lookup(sock, t) {
  const r = { exists: null, jid: t.jid };
  if (t.digits) {
    try {
      const res = await sock.onWhatsApp(t.digits + '@s.whatsapp.net');
      const x = Array.isArray(res) ? res[0] : null;
      r.exists = Boolean(x?.exists); if (x?.jid) r.jid = x.jid;
    } catch (e) { r.err = e.message; }
  } else r.exists = true;
  return r;
}
async function getStatus(sock, jid) {
  try {
    const res = await sock.fetchStatus(jid);
    const x = Array.isArray(res) ? res[0] : res;
    const st = x?.status;
    const text = typeof st === 'string' ? st : st?.status;
    return { text: text || null, at: (typeof st === 'object' && st?.setAt) || x?.setAt || null };
  } catch { return null; }
}
async function getBusiness(sock, jid) { try { return (await sock.getBusinessProfile(jid)) || null; } catch { return null; } }

async function roleIn(c, t) {
  if (!c.isGroup) return null;
  try {
    const { md } = await H.groupInfo(c.sock, c.from);
    const ids = [t.digits, H.num(t.jid)].filter(Boolean);
    const p = md.participants.find((x) => H.partIds(x).some((i) => ids.includes(i)));
    if (!p) return 'bukan anggota grup ini';
    return p.admin === 'superadmin' ? 'pembuat grup (superadmin)' : p.admin ? 'admin grup' : 'anggota biasa';
  } catch { return null; }
}

const commands = {
  lacak: {
    help: 'Profil lengkap nomor, operator, bio & bisnis: .lacak <nomor|@tag|reply>', alias: ['lacaknomor', 'track', 'cekorang'], ...A,
    run: async (c) => {
      const t = target(c); if (!t) return c.reply(USAGE);
      const W = require('./welcome');
      const info = t.digits ? numinfo.analyze(t.digits) : null;
      if (info && !info.valid) return c.reply(say('no', info.reason));
      await c.reply(say('wait', 'Menelusuri nomor...'));
      const lk = await lookup(c.sock, t);
      let pic = null; let st = null; let biz = null;
      if (lk.exists) {
        [pic, st, biz] = await Promise.all([W.fetchAvatar(c.sock, [lk.jid, t.jid]), getStatus(c.sock, lk.jid), getBusiness(c.sock, lk.jid)]);
      }
      const role = lk.exists ? await roleIn(c, t) : null;
      const name = H.nameOf(lk.jid) || H.nameOf(t.jid);
      const lines = [
        kvl('Nomor', info ? info.display : 'disembunyikan WhatsApp (ID anonim / LID)'),
        info?.country && kvl('Negara', `${info.country.name} (${info.country.iso}) · ${info.country.tz}`),
        info && kvl('Jenis', info.type),
        info?.operator && kvl('Operator', `${info.operator}${info.brand ? ' (' + info.brand + ')' : ''}${info.prefix ? ' · prefix ' + info.prefix : ''}`),
        info?.region && kvl('Wilayah', info.region),
        kvl('WhatsApp', lk.exists === null ? 'tidak bisa dicek' : lk.exists ? `${S.ok} terdaftar` : `${S.no} tidak terdaftar`),
        lk.exists && kvl('Nama', name || 'belum pernah terlihat oleh bot'),
        lk.exists && kvl('Foto', pic ? 'ada' : 'tidak ada / disembunyikan'),
        lk.exists && kvl('Bio', st?.text ? `"${st.text.slice(0, 120)}"${st.at ? ' (' + dt(st.at) + ')' : ''}` : 'kosong / disembunyikan'),
        lk.exists && kvl('Bisnis', biz ? `ya${biz.category ? ' · ' + biz.category : ''}` : 'bukan akun bisnis'),
        role && kvl('Di grup ini', role),
        info?.note && kvl('Catatan', info.note),
      ];
      const caption = `${box('Lacak nomor', lines)}\n${NOTE_LOC}`;
      if (pic) return c.sock.sendMessage(c.from, { image: pic, caption }, { quoted: c.msg });
      return c.reply(caption);
    },
  },

  operator: {
    help: 'Operator & negara dari pola nomor (tanpa menghubungi WhatsApp): .operator <nomor...>', alias: ['provider', 'carrier'], ...A,
    run: (c) => {
      const nums = parseNumbers(c.rest || H.quotedText(c.msg), 15);
      if (!nums.length) return c.reply('Format: .operator <nomor>\nBisa banyak sekaligus, pisahkan koma/baris baru (maks 15).\nContoh: .operator 0812xxxxxxx, 0857xxxxxxx');
      const lines = nums.map((d) => {
        const a = numinfo.analyze(d);
        const tail = a.operator ? `${a.operator}${a.brand ? ' · ' + a.brand : ''}` : a.region || (a.country ? a.country.name : 'tidak dikenal');
        return `${S.arrow} ${a.display}\n   ${tail}${a.country && a.operator ? ' · ' + a.country.iso : ''}`;
      });
      return c.reply(`${S.ok} Operator (${nums.length} nomor)\n${lines.join('\n')}\n\n${S.warn} Berdasarkan prefix; nomor yang sudah pindah operator bisa berbeda.`);
    },
  },

  cekmassal: {
    help: 'Cek banyak nomor sekaligus apakah terdaftar WhatsApp (maks 20): .cekmassal <nomor...>', alias: ['bulkcek', 'cekbanyak'], ...A,
    run: async (c) => {
      const nums = parseNumbers(c.rest || H.quotedText(c.msg), 20);
      if (!nums.length) return c.reply('Format: .cekmassal <nomor1>, <nomor2>, ...\nMaksimal 20 nomor sekali jalan.');
      const wait = cooldown.get(c.from) || 0;
      if (Date.now() < wait) return c.reply(say('wait', `Tunggu ${Math.ceil((wait - Date.now()) / 1000)} detik lagi (dibatasi agar akun bot tidak kena limit).`));
      cooldown.set(c.from, Date.now() + 20000);
      await c.reply(say('wait', `Memeriksa ${nums.length} nomor...`));
      const res = await c.sock.onWhatsApp(...nums.map((d) => d + '@s.whatsapp.net'));
      const got = new Map((res || []).map((x) => [H.num(x.jid), Boolean(x.exists)]));
      let yes = 0;
      const lines = nums.map((d) => {
        const ok = got.get(d) === true; if (ok) yes++;
        const a = numinfo.analyze(d);
        return `${ok ? S.ok : S.no} ${a.display}${a.operator ? ' · ' + a.operator : ''}`;
      });
      return c.reply(`${S.ok} Hasil: ${yes} terdaftar, ${nums.length - yes} tidak\n${lines.join('\n')}`);
    },
  },

  bio: {
    help: 'Bio/status WhatsApp seseorang beserta tanggal diubah: .bio <nomor|@tag|reply>', alias: ['status_wa', 'about'], ...A,
    run: async (c) => {
      const t = target(c); if (!t) return c.reply(USAGE);
      const lk = await lookup(c.sock, t);
      if (lk.exists === false) return c.reply(say('no', 'Nomor itu tidak terdaftar di WhatsApp.'));
      const st = await getStatus(c.sock, lk.jid);
      if (!st?.text) return c.reply(say('warn', 'Bio kosong, atau pemiliknya menyembunyikannya dari kontak/orang tak dikenal.'));
      return c.reply(`${S.ok} Bio ${t.digits ? '+' + t.digits : ''}\n"${st.text}"${st.at ? `\n${S.dot} diubah ${dt(st.at)}` : ''}`);
    },
  },

  cekbisnis: {
    help: 'Profil akun WhatsApp Business: .cekbisnis <nomor|@tag|reply>', alias: ['bisnis', 'bizinfo'], ...A,
    run: async (c) => {
      const t = target(c); if (!t) return c.reply(USAGE);
      const lk = await lookup(c.sock, t);
      if (lk.exists === false) return c.reply(say('no', 'Nomor itu tidak terdaftar di WhatsApp.'));
      const b = await getBusiness(c.sock, lk.jid);
      if (!b) return c.reply(say('warn', 'Bukan akun WhatsApp Business (atau profil bisnisnya tidak dibuka).'));
      const web = [].concat(b.website || []).filter(Boolean).join(', ');
      return c.reply(box('Profil bisnis', [kvl('Nomor', t.digits ? '+' + t.digits : null), kvl('Nama', H.nameOf(lk.jid)), kvl('Kategori', b.category), kvl('Deskripsi', b.description && b.description.slice(0, 200)), kvl('Email', b.email), kvl('Website', web), kvl('Alamat', b.address)]));
    },
  },

  anggota: {
    help: 'Kartu anggota grup: peran, jumlah pesan, terakhir aktif, peringatan: .anggota [@tag|reply]', alias: ['member', 'infomember', 'kartuanggota'], group: true, ...A,
    run: async (c) => {
      const W = require('./welcome');
      const { gs } = require('./group');
      const t = target(c) || { jid: c.sender, digits: H.phoneOf(c.sender) };
      const g = gs(c.from);
      const key = H.num(t.jid);
      const act = g.act[key] || g.act[t.digits];
      const role = await roleIn(c, t);
      const info = t.digits ? numinfo.analyze(t.digits) : null;
      const warns = g.warns[key] || g.warns[t.digits] || 0;
      const flags = [g.muted.includes(key) || g.muted.includes(t.digits) ? 'dibisukan' : null, g.banned.includes(key) || g.banned.includes(t.digits) ? 'masuk daftar ban' : null].filter(Boolean);
      const lines = [
        kvl('Nama', H.nameOf(t.jid) || 'belum pernah terlihat'),
        kvl('Nomor', info ? info.display : 'disembunyikan WhatsApp'),
        info?.operator && kvl('Operator', info.operator),
        kvl('Peran', role),
        kvl('Pesan', act ? `${act.n.toLocaleString('id-ID')} sejak bot memantau` : 'belum ada data'),
        kvl('Terakhir', act?.t ? new Intl.DateTimeFormat('id-ID', { timeZone: H.TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(act.t)).replace(/\./g, ':') : null),
        kvl('Peringatan', `${warns}/3`),
        flags.length && kvl('Status', flags.join(', ')),
      ];
      const caption = box('Kartu anggota', lines);
      const pic = await W.fetchAvatar(c.sock, [t.jid]);
      if (pic) return c.sock.sendMessage(c.from, { image: pic, caption }, { quoted: c.msg });
      return c.reply(caption);
    },
  },
};
const cooldown = new Map();

module.exports = { commands, target, parseNumbers };

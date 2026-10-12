'use strict';
/**
 * Kartu welcome / farewell / bot-aktif bergambar. Mengambil foto profil orangnya (bila tidak
 * disembunyikan), lalu membuat kartu lewat ui/cards. Selalu ada fallback: kegagalan di sini
 * tidak boleh menghalangi pesan teks sapaan.
 */
const H = require('./helpers');
const cards = require('../ui/cards');
const numinfo = require('../services/numberinfo');

const ZONE = { 'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' };

function clock(now = new Date()) {
  const tz = H.TZ;
  const date = new Intl.DateTimeFormat('id-ID', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }).format(now).replace(/\./g, '');
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const hour = parseInt(hm.slice(0, 2), 10);
  return { date, time: `${hm} ${ZONE[tz] || ''}`.trim(), hour };
}
function greeting(hour = clock().hour) {
  if (hour >= 4 && hour < 11) return 'Selamat pagi';
  if (hour >= 11 && hour < 15) return 'Selamat siang';
  if (hour >= 15 && hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/** Unduh foto profil pertama yang tersedia dari daftar jid (nomor/LID). null bila disembunyikan. */
async function fetchAvatar(sock, jids = []) {
  for (const jid of [...new Set(jids.filter(Boolean))]) {
    for (const kind of ['image', 'preview']) {
      try {
        const url = await sock.profilePictureUrl(jid, kind, 8000);
        if (!url) continue;
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
        try {
          const res = await fetch(url, { signal: ctl.signal });
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 100 && buf.length < 6 * 1048576) return buf;
        } finally { clearTimeout(t); }
      } catch (_) { /* tidak ada foto / privasi */ }
    }
  }
  return null;
}

/** Nama tampilan: nama profil bila pernah terlihat, kalau tidak nomor, kalau tidak "Anggota Baru". */
function displayName(jid, fallback = 'Anggota Baru') {
  const n = H.nameOf(jid);
  if (n) return n;
  const pn = H.phoneOf(jid);
  if (pn) { const a = numinfo.analyze(pn); return a.valid ? a.display : '+' + pn; }
  return fallback;
}

/**
 * @param {object} o { kind, jid, alt:[jid], name?, group, count, theme, avatar?:Buffer }
 */
async function buildCard(sock, o) {
  const c = clock();
  const avatar = o.avatar !== undefined ? o.avatar : await fetchAvatar(sock, [o.jid, ...(o.alt || [])]);
  return cards.render({
    kind: o.kind || 'welcome', name: o.name || displayName(o.jid), group: o.group, count: o.count,
    avatar, theme: o.theme, greet: greeting(c.hour), date: c.date, time: c.time, tag: o.tag,
  });
}

/** Kirim kartu + caption. Jatuh ke teks biasa bila gambar gagal dibuat. */
async function sendCard(sock, gid, o, caption, mentions = []) {
  try {
    const image = await buildCard(sock, o);
    return await sock.sendMessage(gid, { image, caption, mentions });
  } catch (e) {
    H.log.warn('Kartu gagal dibuat, kirim teks saja: ' + e.message);
    return H.safeSend(sock, gid, { text: caption, mentions });
  }
}

// kompatibilitas dengan kode lama
const generateWelcomeImage = ({ name, groupName }) => cards.render({ kind: 'welcome', name, group: groupName, avatar: null, greet: greeting(), ...clock() });

module.exports = { buildCard, sendCard, fetchAvatar, displayName, greeting, clock, generateWelcomeImage, THEME_KEYS: cards.THEME_KEYS, THEMES: cards.THEMES };

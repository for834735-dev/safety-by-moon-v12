'use strict';
/**
 * Animasi menu: SATU video GIF (assets/menu.mp4, bulan sabit emas) dengan teks menu sebagai caption,
 * jadi animasi dan teks menyatu dalam satu pesan (tanpa stiker, tanpa pesan terpisah).
 * Atur lewat .env  MENU_ANIM = on | off   (bawaan: on)
 * Aset dibuat ulang dengan: python3 scripts/make-menu-anim.py  (gambar sumber: assets/menu-art.png)
 */
const fs = require('fs');
const path = require('path');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
let cache;
const video = () => { if (cache === undefined) { try { cache = fs.readFileSync(path.join(ASSETS, 'menu.mp4')); } catch { cache = null; } } return cache; };
const off = () => ['off', 'mati', 'false', '0'].includes(String(process.env.MENU_ANIM || 'on').toLowerCase());
const MAX_CAPTION = 3000;

/** Kirim menu utama sebagai satu video GIF + caption. true bila terkirim, false bila harus jatuh ke teks biasa. */
async function sendMenu(sock, jid, quoted, text) {
  if (off()) return false;
  const gif = video();
  if (!gif) return false;
  const send = (caption) => sock.sendMessage(jid, { video: gif, gifPlayback: true, mimetype: 'video/mp4', caption }, { quoted });
  try { await send(text.length > MAX_CAPTION ? text.slice(0, MAX_CAPTION - 1) + '…' : text); return true; }
  catch (_) { /* gagal kirim media: jatuh ke teks biasa */ }
  return false;
}
module.exports = { sendMenu };

const fs = require('fs');
const path = require('path');
const kv = require('../kv');
const store = require('../store');
const H = require('./helpers');

const S = () => kv.ns('security', { antidelete: true, callmode: 'spam', safeUntil: 0, calls: {} });
const cache = new Map(); // id pesan -> info (untuk anti-delete)
const attackTimes = [];

// ---------- deteksi link phishing (heuristik lokal) ----------
const BAD_TLD = /\.(tk|ml|ga|cf|gq|top|xyz|click|buzz|icu|cyou|monster|rest|loan|zip|mov)$/;
const BRANDS = {
  whatsapp: ['whatsapp.com', 'wa.me', 'whatsapp.net'], gopay: ['gopay.co.id', 'gojek.com'], dana: ['dana.id'],
  ovo: ['ovo.id'], shopee: ['shopee.co.id', 'shopee.com'], tokopedia: ['tokopedia.com'], bca: ['bca.co.id'],
  bri: ['bri.co.id'], bni: ['bni.co.id'], mandiri: ['bankmandiri.co.id'], instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'], tiktok: ['tiktok.com'], google: ['google.com'], paypal: ['paypal.com'],
  netflix: ['netflix.com'], telegram: ['telegram.org', 't.me'],
};
function analyzeUrl(u) {
  let url;
  try { url = new URL(/^https?:/i.test(u) ? u : 'http://' + u); } catch { return []; }
  const h = url.hostname.toLowerCase();
  const tokens = h.split(/[.-]/);
  const r = [];
  if (h.includes('xn--')) r.push('domain punycode (bisa menyamar jadi domain lain)');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) r.push('memakai alamat IP langsung');
  if (url.username) r.push('ada tanda @ untuk menyamarkan tujuan');
  if (BAD_TLD.test(h)) r.push('TLD yang sering dipakai penipuan');
  for (const [b, doms] of Object.entries(BRANDS)) {
    const hit = tokens.some((t) => t === b || (b.length >= 5 && t.startsWith(b)));
    if (hit && !doms.some((d) => h === d || h.endsWith('.' + d))) r.push(`mengaku "${b}" tapi bukan domain resminya`);
  }
  if (r.length && /(login|verif|secure|update|klaim|hadiah|gratis|promo)/i.test(url.pathname + url.search)) r.push('kata pancingan (login/klaim/hadiah)');
  if (/\.apk$/i.test(url.pathname)) r.push('mengarah ke file APK');
  return r;
}
function findPhishing(text = '') {
  const urls = text.match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
  for (const u of urls.slice(0, 5)) {
    const reasons = analyzeUrl(u);
    if (reasons.length) return { url: u, reasons };
  }
  return null;
}

const labelOf = (m) =>
  m.imageMessage ? '[gambar]' : m.videoMessage ? '[video]' : m.stickerMessage ? '[stiker]' :
  m.audioMessage ? '[audio/VN]' : m.documentMessage ? '[dokumen]' : m.contactMessage ? '[kontak]' : '[pesan]';

// ---------- passive hooks ----------
async function onMessage(ctx) {
  const { msg, sock, from, sender, text } = ctx;
  const pm = msg.message?.protocolMessage;

  // anti-delete: pesan dihapus pengirim -> kabari owner
  if (pm && (pm.type === 0 || pm.type === 'REVOKE')) {
    const info = cache.get(pm.key?.id);
    if (info && S().antidelete && !ctx.isOwner) {
      let where = 'chat pribadi';
      if (H.isGroupJid(info.from)) where = 'grup ' + (await H.groupInfo(sock, info.from).then((g) => g.md.subject).catch(() => info.from));
      await H.notifyOwner(sock, `*Pesan dihapus*\nDari: wa.me/${H.num(info.sender)}\nDi: ${where}\nIsi: ${info.text}`);
    }
    return true;
  }
  if (!msg.message) return true;

  cache.set(msg.key.id, { from, sender, text: text || labelOf(H.unwrap(msg.message)) });
  if (cache.size > 3000) cache.delete(cache.keys().next().value);

  // Mode Aman: abaikan semua non-owner
  if (S().safeUntil > Date.now() && !ctx.isOwner) return true;

  // link phishing
  if (text && !ctx.isOwner) {
    const bad = findPhishing(text);
    if (bad) {
      let removed = false;
      if (ctx.isGroup && !(await ctx.isAdminSender()) && (await H.botIsAdmin(sock, from))) {
        removed = Boolean(await H.safeSend(sock, from, { delete: msg.key }));
      }
      await ctx.say(`△ *Link mencurigakan* dari @${H.num(sender)}${removed ? ' (pesan dihapus)' : ''}\n${bad.reasons.map((x) => '• ' + x).join('\n')}\nJangan klik/isi data apa pun.`, [sender]);
      store.addHistoryEntry({ time: new Date().toISOString(), from: sender, type: 'Phishing', detail: bad.reasons[0], reported: false });
      store.incrementStat('detected');
      return removed;
    }
  }
  return false;
}

async function onDetected(sock, from, check) {
  const now = Date.now();
  attackTimes.push(now);
  while (attackTimes.length && now - attackTimes[0] > 60000) attackTimes.shift();
  const s = S();
  let extra = '';
  if (attackTimes.length >= 3 && s.safeUntil < now) {
    s.safeUntil = now + 10 * 60000;
    kv.save();
    extra = '\n *MODE AMAN* aktif 10 menit (pesan non-owner diabaikan).';
  }
  await H.notifyOwner(sock, `*Serangan terdeteksi*\nJenis: ${check.type}\nDetail: ${check.reason}\nDari: wa.me/${H.num(from)}${extra}\n\nKetik .lapor ${H.num(from)} untuk draf laporan.`);
}

// spam call: telepon ke-N dari nomor yang sama dalam 10 menit ditolak (+ blokir jika AUTO_BLOCK)
async function onCall(sock, calls) {
  const s = S();
  if (s.callmode === 'off') return;
  for (const c of calls) {
    if (c.status !== 'offer') continue;
    const id = H.num(c.from);
    if (id === H.ownerNum() || H.phoneOf(c.callerPn || c.from) === H.ownerNum()) continue;
    const arr = ((s.calls[id] ||= []).filter((t) => Date.now() - t < 600000));
    arr.push(Date.now());
    s.calls[id] = arr;
    kv.save();
    if (s.callmode === 'all' || arr.length >= 3) {
      try { await sock.rejectCall(c.id, c.from); } catch (_) {}
      if (arr.length >= 3) {
        store.addHistoryEntry({ time: new Date().toISOString(), from: c.from, type: 'Spam Call', detail: `${arr.length} panggilan/10 menit`, reported: false });
        store.incrementStat('detected');
        if (process.env.AUTO_BLOCK === 'true') {
          try { await sock.updateBlockStatus(c.from, 'block'); store.incrementStat('blocked'); } catch (_) {}
        }
        await H.notifyOwner(sock, `Spam call dari wa.me/${id} (${arr.length}x/10 menit) ditolak.`);
      }
    }
  }
}

// ---------- commands ----------
const backupDir = () => H.ensureDir(path.join(H.DATA, 'backup'));

const commands = {
  antidelete: {
    help: 'Anti delete: kabari owner saat pesan dihapus', owner: true,
    run: (c) => {
      const v = H.onoff(c.args[0]); const s = S();
      if (v === null) return c.reply(`Anti delete: ${s.antidelete ? 'ON' : 'OFF'}\nPakai .antidelete on/off`);
      s.antidelete = v; kv.save(); return c.reply(`Anti delete ${v ? 'ON ✓' : 'OFF ✕'}`);
    },
  },
  amanmode: {
    help: 'Mode Aman: .amanmode on [menit] / off / status', owner: true,
    run: (c) => {
      const s = S(); const a = (c.args[0] || 'status').toLowerCase();
      if (a === 'on') { s.safeUntil = Date.now() + (parseInt(c.args[1], 10) || 10) * 60000; kv.save(); return c.reply('Mode Aman ON'); }
      if (a === 'off') { s.safeUntil = 0; kv.save(); return c.reply('Mode Aman OFF'); }
      const left = Math.ceil((s.safeUntil - Date.now()) / 60000);
      return c.reply(left > 0 ? `Mode Aman aktif, sisa ${left} menit` : 'Mode Aman tidak aktif');
    },
  },
  riwayat: {
    help: 'Riwayat serangan: .riwayat [nomor]', owner: true,
    run: (c) => {
      const n = (c.args[0] || '').replace(/\D/g, '');
      const h = store.getHistory().filter((x) => !n || String(x.from).includes(n)).slice(0, 10);
      if (!h.length) return c.reply('Belum ada riwayat' + (n ? 'untuk nomor itu.' : '.'));
      return c.reply(h.map((x) => `• ${x.time.slice(0, 16).replace('T', ' ')} | ${x.type} | wa.me/${H.num(x.from)}\n  ${x.detail}${x.reported ? ' ✓dilapor' : ''}`).join('\n'));
    },
  },
  cekurl: {
    help: 'Cek link phishing: .cekurl <link>',
    run: (c) => {
      const u = c.args[0]; if (!u) return c.reply('Format: .cekurl <link>');
      const r = analyzeUrl(u);
      return c.reply(r.length ? `△ Mencurigakan:\n${r.map((x) => '• ' + x).join('\n')}` : '✓ Tidak ada ciri phishing yang umum. Tetap waspada, ini bukan jaminan aman.');
    },
  },
  callmode: {
    help: 'Tolak telepon: .callmode spam|all|off', owner: true,
    run: (c) => {
      const s = S(); const a = (c.args[0] || '').toLowerCase();
      if (!['spam', 'all', 'off'].includes(a)) return c.reply(`Mode sekarang: ${s.callmode}\nPilih: spam (tolak yg berulang), all, off`);
      s.callmode = a; kv.save(); return c.reply('Mode telepon: ' + a);
    },
  },
  simpan: {
    help: 'Backup chat penting: reply pesan + .simpan', owner: true,
    run: async (c) => {
      const ci = H.ctxInfo(c.msg);
      if (!ci.quotedMessage) return c.reply('Reply pesan yang mau disimpan dengan .simpan');
      const entry = { time: new Date().toISOString(), from: ci.participant || c.from, text: H.quotedText(c.msg) };
      const media = H.findMedia(c.msg);
      if (media) {
        const buf = await H.downloadMedia(media);
        const f = `${Date.now()}.${media.type.replace('Message', '')}`;
        fs.writeFileSync(path.join(H.ensureDir(path.join(backupDir(), 'media')), f), buf);
        entry.file = f;
      }
      fs.appendFileSync(path.join(backupDir(), 'important.jsonl'), JSON.stringify(entry) + '\n');
      return c.reply('Tersimpan di backup.');
    },
  },
  backup: {
    help: 'Kirim file backup chat penting', owner: true,
    run: async (c) => {
      const f = path.join(backupDir(), 'important.jsonl');
      if (!fs.existsSync(f)) return c.reply('Belum ada yang disimpan (.simpan).');
      return c.sock.sendMessage(c.from, { document: fs.readFileSync(f), mimetype: 'application/json', fileName: 'backup-penting.jsonl' }, { quoted: c.msg });
    },
  },
  lapor: {
    help: 'Draf laporan: .lapor <nomor> [alasan]', owner: true,
    run: async (c) => {
      const n = (c.args[0] || '').replace(/\D/g, '');
      if (!n) return c.reply('Format: .lapor <nomor> [alasan]');
      const { sendReport } = require('../whatsapp');
      await sendReport({ targetJid: H.toJid(n), reason: c.args.slice(1).join(' ') || 'Terdeteksi virtex/bug' });
      store.markReported(H.toJid(n)); store.incrementStat('reported');
      return c.reply('Draf laporan dikirim ke WhatsApp owner.');
    },
  },
};

module.exports = { commands, onMessage, onDetected, onCall, analyzeUrl, findPhishing };

const fs = require('fs');
const path = require('path');
const kv = require('../kv');
const H = require('./helpers');

const B = () => kv.ns('biz', {
  rules: [], catalog: [], promos: [], optin: [], followups: [], orders: [], testi: [], labels: {}, cmds: {},
  off: { on: false, start: '09:00', end: '21:00', text: 'Halo kak  saat ini kami di luar jam operasional. Pesan kakak sudah masuk dan akan kami balas saat buka ya!' },
  autoPhoto: false, autoTesti: false, promoAuto: { at: '', last: '', i: 0 }, recap: {}, offSent: {}, nextOrder: 1,
});
const needOwner = (c) => { if (!c.isOwner) throw new Error('Khusus owner.'); };
const rupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const parts = (s) => s.split('|').map((x) => x.trim());
const TESTI_RE = /(makasih|terima ?kasih|thanks)/i;
const TESTI_RE2 = /(barang|pesanan|paket|order|produk).*(sampai|diterima|bagus|mantap|sesuai)|(mantap|recommended|puas|amanah|bagus)/i;

function catalogText(b) {
  return b.catalog.length
    ? b.catalog.map((p, i) => `${i + 1}. *${p.name}* — ${isNaN(p.price) ? p.price : rupiah(p.price)}${p.desc ? '\n   ' + p.desc : ''}`).join('\n')
    : '(katalog masih kosong)';
}

async function onMessage(ctx) {
  const { msg, text, isGroup, isOwner, sender } = ctx;
  if (isOwner) return false;
  const b = B();
  const id = H.num(sender);
  const m = H.unwrap(msg.message || {});

  if (!isGroup) {
    const today = H.nowParts().date;
    const day = (b.recap[today] ||= { msgs: 0, who: {}, orders: 0 });
    day.msgs++; day.who[id] = (day.who[id] || 0) + 1;
    const ks = Object.keys(b.recap); if (ks.length > 14) delete b.recap[ks.sort()[0]];
    kv.save();

    if (b.autoPhoto && m.imageMessage) {
      try {
        const buf = await H.downloadMedia({ target: { key: msg.key, message: m } });
        fs.writeFileSync(path.join(H.ensureDir(path.join(H.DATA, 'customer-photos', id)), `${Date.now()}.jpg`), buf);
      } catch (_) {}
    }
    if (b.autoTesti && text && TESTI_RE.test(text) && TESTI_RE2.test(text)) {
      b.testi.push({ from: id, text: text.slice(0, 500), at: new Date().toISOString() }); kv.save();
    }
    if (b.off.on && text && !text.startsWith('.') && !H.inHours(b.off.start, b.off.end, H.nowParts().hm)
      && Date.now() - (b.offSent[id] || 0) > 6 * 3600e3) {
      b.offSent[id] = Date.now(); kv.save();
      await ctx.reply(b.off.text);
      return true;
    }
    if (text && !text.startsWith('.')) {
      const low = text.toLowerCase();
      const r = b.rules.find((x) => low.includes(x.k));
      if (r) { await ctx.reply(r.v.replace(/\{nomor\}/g, id)); return true; }
    }
  }
  return false;
}

function customCommand(name, ctx) {
  const v = B().cmds[name];
  return v ? v.replace(/\{nomor\}/g, H.num(ctx.sender)).replace(/\{katalog\}/g, catalogText(B())) : null;
}

async function broadcast(sock, text) {
  const list = B().optin.slice(0, 200); let ok = 0;
  for (const n of list) {
    if (await H.safeSend(sock, H.toJid(n), { text: text + '\n\n_Balas .optout untuk berhenti menerima pesan._' })) ok++;
    await H.sleep(H.rnd(3000, 6000)); // jeda acak biar aman dari limit
  }
  return ok;
}

function recapText(date) {
  const d = B().recap[date];
  if (!d) return `Rekap ${date}: belum ada chat pelanggan.`;
  const top = Object.entries(d.who).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => `• wa.me/${n} (${v})`).join('\n');
  return `*Rekap ${date}*\nPesan masuk: ${d.msgs}\nPelanggan unik: ${Object.keys(d.who).length}\nOrder baru: ${d.orders}\n\nTeraktif:\n${top}`;
}

async function tick(sock, now, newMin) {
  const b = B();
  const due = b.followups.filter((f) => f.at <= Date.now());
  if (due.length) {
    b.followups = b.followups.filter((f) => f.at > Date.now()); kv.save();
    for (const f of due) await H.notifyOwner(sock, `*Follow-up* wa.me/${f.n}\n${f.note}`);
  }
  if (!newMin) return;
  if (now.hm === '21:00' && b.recap.__last !== now.date) { b.recap.__last = now.date; kv.save(); await H.notifyOwner(sock, recapText(now.date)); }
  if (b.promoAuto.at && b.promoAuto.at === now.hm && b.promoAuto.last !== now.date && b.promos.length && b.optin.length) {
    b.promoAuto.last = now.date;
    const p = b.promos[b.promoAuto.i % b.promos.length]; b.promoAuto.i++; kv.save();
    broadcast(sock, p.replace(/\{katalog\}/g, catalogText(b))).catch(() => {});
    await H.notifyOwner(sock, `Promo otomatis dikirim ke ${b.optin.length} kontak opt-in.`);
  }
}

const commands = {
  autoreply: {
    help: 'Balasan otomatis kata kunci: .autoreply add kata | balasan / del kata / list', owner: true,
    run: (c) => {
      const b = B(); const a = (c.args[0] || 'list').toLowerCase(); const body = c.rest.slice(a.length).trim();
      if (a === 'add') { const [k, v] = parts(body); if (!k || !v) return c.reply('Format: .autoreply add harga | Harga ada di katalog kak…'); b.rules = b.rules.filter((r) => r.k !== k.toLowerCase()); b.rules.push({ k: k.toLowerCase(), v }); kv.save(); return c.reply(`✓ Kata "${k}" akan dibalas otomatis (chat pribadi).`); }
      if (a === 'del') { b.rules = b.rules.filter((r) => r.k !== body.toLowerCase()); kv.save(); return c.reply('Dihapus.'); }
      return c.reply(b.rules.length ? b.rules.map((r) => `• ${r.k} → ${r.v.slice(0, 50)}`).join('\n') : 'Belum ada aturan.');
    },
  },
  katalog: {
    help: 'Katalog produk: .katalog | (owner) add nama | harga | deskripsi / del <no>', alias: ['produk'],
    run: async (c) => {
      const b = B(); const a = (c.args[0] || '').toLowerCase(); const body = c.rest.slice(a.length).trim();
      if (a === 'add') { needOwner(c); const [name, price, desc] = parts(body); if (!name || !price) return c.reply('Format: .katalog add Kaos Polos | 75000 | Bahan cotton 30s'); b.catalog.push({ name, price: /^\d+$/.test(price) ? Number(price) : price, desc: desc || '' }); kv.save(); return c.reply('✓ Produk ditambah.'); }
      if (a === 'del') { needOwner(c); b.catalog.splice((parseInt(body, 10) || 0) - 1, 1); kv.save(); return c.reply('Produk dihapus.'); }
      return c.reply('*Katalog*\n\n' + catalogText(b) + '\n\nPesan: .order <no> [jumlah] [catatan]');
    },
  },
  promo: {
    help: 'Template promo: .promo add teks / list / del n / kirim n / auto HH:MM|off', owner: true,
    run: async (c) => {
      const b = B(); const a = (c.args[0] || 'list').toLowerCase(); const body = c.rest.slice(a.length).trim();
      if (a === 'add') { if (!body) return c.reply('Format: .promo add Diskon 20% hari ini! {katalog}'); b.promos.push(body); kv.save(); return c.reply(`✓ Template #${b.promos.length} disimpan. {katalog} otomatis diganti daftar produk.`); }
      if (a === 'del') { b.promos.splice((parseInt(body, 10) || 0) - 1, 1); kv.save(); return c.reply('Dihapus.'); }
      if (a === 'kirim') {
        const p = b.promos[(parseInt(body, 10) || 0) - 1]; if (!p) return c.reply('Nomor template tidak ada.');
        if (!b.optin.length) return c.reply('Belum ada kontak opt-in (pelanggan ketik .optin).');
        broadcast(c.sock, p.replace(/\{katalog\}/g, catalogText(b))).then((n) => c.reply(`Terkirim ke ${n} kontak.`)).catch(() => {});
        return c.reply(`Mengirim ke ${b.optin.length} kontak opt-in (dengan jeda acak)…`);
      }
      if (a === 'auto') {
        if (body === 'off') { b.promoAuto.at = ''; kv.save(); return c.reply('Promo otomatis OFF'); }
        if (!H.validHM(body)) return c.reply('Format: .promo auto 10:00 | off'); b.promoAuto.at = body; kv.save();
        return c.reply(`Promo otomatis tiap hari ${body}, bergilir antar template.`);
      }
      return c.reply(b.promos.length ? b.promos.map((p, i) => `${i + 1}. ${p.slice(0, 70)}`).join('\n') : 'Belum ada template.');
    },
  },
  optin: {
    help: 'Pelanggan setuju menerima broadcast (chat pribadi)',
    run: (c) => { if (c.isGroup) return c.reply('Kirim .optin lewat chat pribadi ya.'); const b = B(); const id = H.num(c.sender); if (!b.optin.includes(id)) b.optin.push(id); kv.save(); return c.reply('✓ Kamu akan menerima info promo. Ketik .optout untuk berhenti.'); },
  },
  optout: {
    help: 'Berhenti menerima broadcast',
    run: (c) => { const b = B(); b.optin = b.optin.filter((x) => x !== H.num(c.sender)); kv.save(); return c.reply('Oke, kamu tidak akan menerima broadcast lagi.'); },
  },
  broadcast: {
    help: 'Kirim ke kontak opt-in: .broadcast <teks>', owner: true,
    run: (c) => {
      const b = B(); if (!c.rest) return c.reply('Format: .broadcast <teks>'); if (!b.optin.length) return c.reply('Belum ada kontak opt-in.');
      broadcast(c.sock, c.rest).then((n) => c.reply(`Selesai: ${n}/${b.optin.length} terkirim.`)).catch(() => {});
      return c.reply(`Mengirim ke ${b.optin.length} kontak opt-in…`);
    },
  },
  followup: {
    help: 'Pengingat follow-up: .followup <nomor> <2j|1h|30m> <catatan> / list', owner: true,
    run: (c) => {
      const b = B();
      if ((c.args[0] || 'list') === 'list') return c.reply(b.followups.length ? b.followups.map((f, i) => `${i + 1}. wa.me/${f.n} — ${new Date(f.at).toLocaleString('id-ID', { timeZone: H.TZ })} — ${f.note}`).join('\n') : 'Tidak ada follow-up.');
      const ms = H.parseDur(c.args[1]); const n = c.args[0].replace(/\D/g, '');
      if (!n || !ms) return c.reply('Format: .followup 62812xxxx 2j tanya kabar pesanan');
      b.followups.push({ n, at: Date.now() + ms, note: c.args.slice(2).join(' ') || 'Follow up' }); kv.save();
      return c.reply('Oke, aku ingatkan.');
    },
  },
  order: {
    help: 'Menu order: .order (lihat) / .order <no> [jumlah] [catatan]',
    run: async (c) => {
      const b = B(); const idx = parseInt(c.args[0], 10);
      if (!idx) return c.reply('*Menu order*\n\n' + catalogText(b) + '\n\nContoh: .order 1 2 tanpa gula');
      const p = b.catalog[idx - 1]; if (!p) return c.reply('Nomor produk tidak ada. Lihat .katalog');
      const qty = /^\d+$/.test(c.args[1] || '') ? parseInt(c.args[1], 10) : 1;
      const note = c.args.slice(/^\d+$/.test(c.args[1] || '') ? 2 : 1).join(' ');
      const o = { id: b.nextOrder++, n: H.num(c.sender), name: p.name, qty, note, status: 'baru', total: isNaN(p.price) ? null : p.price * qty, at: new Date().toISOString() };
      b.orders.push(o);
      const day = (b.recap[H.nowParts().date] ||= { msgs: 0, who: {}, orders: 0 }); day.orders++;
      kv.save();
      await H.notifyOwner(c.sock, `*Order #${o.id}*\nwa.me/${o.n}\n${o.qty}x ${o.name}${o.total ? ' = ' + rupiah(o.total) : ''}${note ? '\nCatatan: ' + note : ''}`);
      return c.reply(`✓ Order #${o.id} diterima!\n${o.qty}x ${o.name}${o.total ? '\nTotal: ' + rupiah(o.total) : ''}\nAdmin akan segera menghubungi kamu.`);
    },
  },
  orders: {
    help: 'Daftar order: .orders [status] | .orders set <id> proses|selesai', owner: true,
    run: async (c) => {
      const b = B();
      if ((c.args[0] || '') === 'set') {
        const o = b.orders.find((x) => x.id === parseInt(c.args[1], 10)); const st = (c.args[2] || '').toLowerCase();
        if (!o || !['baru', 'proses', 'selesai', 'batal'].includes(st)) return c.reply('Format: .orders set <id> baru|proses|selesai|batal');
        o.status = st; kv.save(); await H.safeSend(c.sock, H.toJid(o.n), { text: `Order #${o.id} (${o.name}) sekarang: *${st}*` });
        return c.reply('Status diperbarui & pelanggan diberi tahu.');
      }
      const list = b.orders.filter((o) => !c.args[0] || o.status === c.args[0]).slice(-15);
      return c.reply(list.length ? list.map((o) => `#${o.id} [${o.status}] wa.me/${o.n} — ${o.qty}x ${o.name}`).join('\n') : 'Tidak ada order.');
    },
  },
  rekap: {
    help: 'Rekap chat hari ini (otomatis jam 21:00)', owner: true,
    run: (c) => c.reply(recapText(H.nowParts().date)),
  },
  addcmd: {
    help: 'Buat command sendiri: .addcmd nama | balasan  ({nomor} {katalog})', owner: true,
    run: (c) => {
      const [n, v] = parts(c.rest); if (!n || !v) return c.reply('Format: .addcmd jam | Buka jam 9-21 kak');
      B().cmds[n.toLowerCase().replace(/^\./, '')] = v; kv.save(); return c.reply(`✓ Command .${n.toLowerCase()} dibuat.`);
    },
  },
  delcmd: {
    help: 'Hapus command buatan: .delcmd nama', owner: true,
    run: (c) => { delete B().cmds[(c.args[0] || '').toLowerCase()]; kv.save(); return c.reply('Dihapus.'); },
  },
  cmds: {
    help: 'Daftar command buatan sendiri',
    run: (c) => { const k = Object.keys(B().cmds); return c.reply(k.length ? k.map((x) => '.' + x).join('\n') : 'Belum ada command buatan.'); },
  },
  jamkerja: {
    help: 'Balasan luar jam operasional: .jamkerja on 09:00 21:00 / off / pesan <teks>', owner: true,
    run: (c) => {
      const o = B().off; const a = (c.args[0] || '').toLowerCase();
      if (a === 'on') { if (H.validHM(c.args[1]) && H.validHM(c.args[2])) { o.start = c.args[1]; o.end = c.args[2]; } o.on = true; kv.save(); return c.reply(`✓ Aktif. Buka ${o.start}–${o.end} (${H.TZ}).`); }
      if (a === 'off') { o.on = false; kv.save(); return c.reply('Dimatikan.'); }
      if (a === 'pesan') { o.text = c.rest.replace(/^pesan\s*/i, ''); kv.save(); return c.reply('Pesan disimpan.'); }
      return c.reply(`Status: ${o.on ? 'ON' : 'OFF'} (${o.start}–${o.end})\nPesan: ${o.text}`);
    },
  },
  testi: {
    help: 'Simpan testimoni: reply pesan + .testi', owner: true,
    run: (c) => {
      const t = H.quotedText(c.msg); if (!t) return c.reply('Reply pesan testimoni dengan .testi');
      B().testi.push({ from: H.num(H.ctxInfo(c.msg).participant || ''), text: t.slice(0, 500), at: new Date().toISOString() }); kv.save();
      return c.reply('Testimoni disimpan.');
    },
  },
  testimoni: {
    help: 'Lihat testimoni tersimpan',  owner: true,
    run: (c) => { const t = B().testi.slice(-10); return c.reply(t.length ? t.map((x, i) => `${i + 1}. "${x.text}" — wa.me/${x.from}`).join('\n\n') : 'Belum ada testimoni.'); },
  },
  autotesti: {
    help: 'Simpan testimoni otomatis dari chat pelanggan on/off', owner: true,
    run: (c) => { const v = H.onoff(c.args[0]); const b = B(); if (v === null) return c.reply('Auto testimoni: ' + (b.autoTesti ? 'ON' : 'OFF')); b.autoTesti = v; kv.save(); return c.reply('Auto testimoni ' + (v ? 'ON' : 'OFF')); },
  },
  autofoto: {
    help: 'Simpan foto kiriman pelanggan (chat pribadi) on/off', owner: true,
    run: (c) => { const v = H.onoff(c.args[0]); const b = B(); if (v === null) return c.reply('Auto simpan foto: ' + (b.autoPhoto ? 'ON' : 'OFF')); b.autoPhoto = v; kv.save(); return c.reply('Auto simpan foto ' + (v ? 'ON (folder data/customer-photos)' : 'OFF')); },
  },
  label: {
    help: 'Label chat: .label baru|proses|selesai <nomor> | .labels [status]', owner: true, alias: ['labels'],
    run: (c) => {
      const b = B(); const ST = ['baru', 'proses', 'selesai'];
      if (c.cmd === 'labels' || !ST.includes((c.args[0] || '').toLowerCase())) {
        const f = (c.args[0] || '').toLowerCase();
        const l = Object.entries(b.labels).filter(([, v]) => !f || v === f);
        return c.reply(l.length ? l.map(([n, v]) => `• wa.me/${n} — ${v}`).join('\n') : 'Belum ada label. Pakai .label proses 62812xxxx');
      }
      const n = (c.args[1] || '').replace(/\D/g, ''); if (!n) return c.reply('Sertakan nomor: .label proses 62812xxxx');
      b.labels[n] = c.args[0].toLowerCase(); kv.save(); return c.reply(`wa.me/${n} → ${b.labels[n]}`);
    },
  },
};

module.exports = { commands, onMessage, customCommand, tick, recapText };

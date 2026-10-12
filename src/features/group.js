const kv = require('../kv');
const H = require('./helpers');
const { containsLink } = require('./antilink');

const G = () => kv.ns('groups', {});
const CFG = () => kv.ns('gcfg', { bad: [] });
function gs(gid) {
  const all = G();
  const g = (all[gid] ||= {});
  const d = {
    welcome: true, welcomeText: '', farewell: false, farewellText: '', antilink: 'off', badword: false,
    antisticker: false, antibot: false, muted: [], banned: [], warns: {}, openAt: '', closeAt: '', act: {}, daily: {},
    welcomeTheme: 'otomatis', welcomeCard: true, farewellCard: true, rules: '', since: 0,
  };
  for (const k of Object.keys(d)) if (!(k in g)) g[k] = d[k];
  return g;
}

const DEFAULT_BAD = ['anjing', 'anjir', 'babi', 'bangsat', 'bajingan', 'kontol', 'memek', 'ngentot', 'goblok', 'tolol', 'jancok', 'asu', 'kampret', 'brengsek', 'sialan', 'pepek', 'tai'];
const norm = (t) => t.toLowerCase().replace(/[0@]/g, 'o').replace(/[1!]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/(.)\1+/g, '$1');
function hasBad(text) {
  const set = new Set([...DEFAULT_BAD, ...CFG().bad].map((w) => norm(w)));
  return norm(text).split(/[^a-z]+/).some((t) => set.has(t));
}

const flood = new Map(); // gid|id -> timestamps
function burst(key, windowMs, limit) {
  const now = Date.now();
  const arr = (flood.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  flood.set(key, arr);
  return arr.length > limit;
}
const sessions = new Map(); // absen

function warn(ctx, g, id, why) {
  g.warns[id] = (g.warns[id] || 0) + 1;
  kv.save();
  return g.warns[id];
}

async function onMessage(ctx) {
  if (!ctx.isGroup) return false;
  const { sock, msg, from, sender, text } = ctx;
  const g = gs(from);
  const id = H.num(sender);

  if (!g.since) g.since = Date.now();
  const a = (g.act[id] ||= { n: 0, t: 0 });
  a.n++; a.t = Date.now();
  const today = H.nowParts().date;
  g.daily[today] = (g.daily[today] || 0) + 1;
  const days = Object.keys(g.daily);
  if (days.length > 35) delete g.daily[days.sort()[0]];
  kv.save();

  if (ctx.isOwner || (await ctx.isAdminSender())) return false;
  if (!(await H.botIsAdmin(sock, from))) return false;

  const del = () => H.safeSend(sock, from, { delete: msg.key });
  const kick = () => sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
  const m = H.unwrap(msg.message || {});

  if (g.muted.includes(id)) { await del(); return true; }

  if (g.antilink !== 'off' && text && containsLink(text)) {
    await del();
    if (g.antilink === 'kick') { await ctx.say(`⊘ @${id} dikeluarkan: kirim link.`, [sender]); await kick(); }
    else await ctx.say(`⊘ @${id} dilarang kirim link di sini.`, [sender]);
    return true;
  }
  if (g.badword && text && hasBad(text)) {
    await del();
    const n = warn(ctx, g, id);
    if (n >= 3) { g.warns[id] = 0; await ctx.say(`⊘ @${id} dikeluarkan (3x kata kasar).`, [sender]); await kick(); }
    else await ctx.say(`△ @${id} jaga bahasa ya. Peringatan ${n}/3.`, [sender]);
    return true;
  }
  if (g.antisticker && m.stickerMessage && burst(`s|${from}|${id}`, 10000, 4)) {
    await del();
    if (burst(`sw|${from}|${id}`, 60000, 2)) await ctx.say(`△ @${id} jangan spam stiker.`, [sender]);
    return true;
  }
  if (g.antibot && (String(msg.key.id).startsWith('BAE5') || burst(`b|${from}|${id}`, 5000, 8))) {
    await ctx.say(`@${id} terdeteksi bot/flood, dikeluarkan.`, [sender]);
    await del(); await kick();
    return true;
  }
  return false;
}

const DEFAULT_WELCOME = 'Halo @{user}, selamat datang di *{group}*!\n{greet}, kamu anggota ke-{count}. Baca aturan grup (.rules) dan ketik .menu untuk bantuan bot.';
const DEFAULT_FAREWELL = 'Sampai jumpa @{user}. Terima kasih sudah pernah bersama kami di *{group}*.';

function fillTemplate(t, v) {
  return String(t).replace(/\{user\}/g, v.user).replace(/\{group\}/g, v.group).replace(/\{count\}/g, v.count)
    .replace(/\{greet\}/g, v.greet).replace(/\{time\}/g, v.time).replace(/\{date\}/g, v.date);
}

async function onParticipants(sock, u) {
  const W = require('./welcome');
  const g = gs(u.id);
  let subject = 'grup'; let count = 0;
  try { const md = await sock.groupMetadata(u.id); subject = md.subject; count = md.participants.length; H.learnParticipants(md.participants); } catch (_) { /* tanpa metadata */ }
  H.clearGroupCache(u.id);
  const clk = W.clock();
  for (const p of u.participants || []) {
    const jid = H.partJid(p);
    if (!jid) continue;
    const alt = typeof p === 'object' ? [p.phoneNumber, p.jid, p.lid].filter(Boolean) : [];
    const id = H.num(jid);
    const vars = { user: id, group: subject, count: String(count || ''), greet: W.greeting(clk.hour), time: clk.time, date: clk.date };
    const ids = H.partIds(p);

    if (u.action === 'add') {
      if (g.banned.some((x) => ids.includes(x))) {
        await sock.groupParticipantsUpdate(u.id, [jid], 'remove').catch(() => {});
        await H.safeSend(sock, u.id, { text: `⊘ @${id} masuk daftar ban, dikeluarkan.`, mentions: [jid] });
        continue;
      }
      if (!g.welcome) continue;
      const caption = fillTemplate(g.welcomeText || DEFAULT_WELCOME, vars);
      if (g.welcomeCard === false) { await H.safeSend(sock, u.id, { text: caption, mentions: [jid] }); continue; }
      await W.sendCard(sock, u.id, { kind: 'welcome', jid, alt, group: subject, count, theme: g.welcomeTheme }, caption, [jid]);
    } else if (u.action === 'remove' && g.farewell) {
      const caption = fillTemplate(g.farewellText || DEFAULT_FAREWELL, vars);
      if (g.farewellCard === false) { await H.safeSend(sock, u.id, { text: caption, mentions: [jid] }); continue; }
      await W.sendCard(sock, u.id, { kind: 'farewell', jid, alt, group: subject, count, theme: g.welcomeTheme }, caption, [jid]);
    }
  }
}

async function tick(sock, now, newMin) {
  if (!newMin) return;
  const all = G();
  for (const [gid, g] of Object.entries(all)) {
    if (!gid.endsWith('@g.us') || require('./gate').isBlocked(gid)) continue;
    try {
      if (g.closeAt && g.closeAt === now.hm) { await sock.groupSettingUpdate(gid, 'announcement'); await H.safeSend(sock, gid, { text: '⊘ Grup ditutup sesuai jadwal.' }); }
      if (g.openAt && g.openAt === now.hm) { await sock.groupSettingUpdate(gid, 'not_announcement'); await H.safeSend(sock, gid, { text: '○ Grup dibuka sesuai jadwal.' }); }
    } catch (_) {}
  }
}

// ---------- commands ----------
const A = { group: true, admin: true };
const AB = { group: true, admin: true, botadmin: true };
const toggle = (key, label) => (c) => {
  const v = H.onoff(c.args[0]); const g = gs(c.from);
  if (v === null) return c.reply(`${label}: ${g[key] ? 'ON' : 'OFF'}\nPakai .${c.cmd} on/off`);
  g[key] = v; kv.save(); return c.reply(`${label} ${v ? 'ON ✓' : 'OFF ✕'}`);
};
const safeTargets = async (c) => {
  const { admins } = await H.groupInfo(c.sock, c.from);
  return H.mentions(c.msg).filter((j) => !admins.has(H.num(j)) && !admins.has(H.phoneOf(j)) && H.phoneOf(j) !== H.ownerNum() && H.num(j) !== H.num(c.sock.user?.id));
};

const commands = {
  welcome: {
    help: 'Kartu sambutan dengan foto profil: .welcome on|off|text|tema|kartu|tes', ...A,
    run: async (c) => {
      const W = require('./welcome');
      const g = gs(c.from); const sub = (c.args[0] || '').toLowerCase();
      if (sub === 'text') {
        const t = c.rest.replace(/^text\s*/i, '');
        if (!t) return c.reply(`Teks sekarang:\n${g.welcomeText || DEFAULT_WELCOME}\n\nPakai: .welcome text <teks>\nVariabel: {user} {group} {count} {greet} {time} {date}\nKetik .welcome text reset untuk mengembalikan bawaan.`);
        g.welcomeText = t.toLowerCase() === 'reset' ? '' : t; kv.save(); return c.reply('✓ Teks welcome disimpan.');
      }
      if (sub === 'tema') {
        const t = (c.args[1] || '').toLowerCase();
        if (!W.THEME_KEYS.includes(t)) return c.reply(`Tema sekarang: ${g.welcomeTheme}\nPilihan: ${W.THEME_KEYS.join(' · ')}\n"otomatis" mengambil warna dari foto profil anggota.\nContoh: .welcome tema aurora`);
        g.welcomeTheme = t; kv.save(); return c.reply(`✓ Tema kartu: ${t}`);
      }
      if (sub === 'kartu') {
        const v = H.onoff(c.args[1]); if (v === null) return c.reply(`Kartu gambar: ${g.welcomeCard !== false ? 'ON' : 'OFF'}\nPakai: .welcome kartu on/off`);
        g.welcomeCard = v; kv.save(); return c.reply(`✓ Kartu gambar ${v ? 'ON' : 'OFF'}`);
      }
      if (sub === 'tes' || sub === 'test') {
        let subject = 'grup ini'; let count = 0;
        try { const md = (await H.groupInfo(c.sock, c.from)).md; subject = md.subject; count = md.participants.length; } catch (_) { /* abaikan */ }
        const clk = W.clock();
        const caption = fillTemplate(g.welcomeText || DEFAULT_WELCOME, { user: H.num(c.sender), group: subject, count: String(count), greet: W.greeting(clk.hour), time: clk.time, date: clk.date });
        return W.sendCard(c.sock, c.from, { kind: 'welcome', jid: c.sender, alt: [c.msg.key.participantAlt], group: subject, count, theme: g.welcomeTheme }, caption, [c.sender]);
      }
      return toggle('welcome', 'Welcome')(c);
    },
  },
  farewell: {
    help: 'Pesan saat anggota keluar: .farewell on|off|text|kartu|tes', ...A,
    run: async (c) => {
      const W = require('./welcome');
      const g = gs(c.from); const sub = (c.args[0] || '').toLowerCase();
      if (sub === 'text') {
        const t = c.rest.replace(/^text\s*/i, '');
        if (!t) return c.reply(`Teks sekarang:\n${g.farewellText || DEFAULT_FAREWELL}\n\nPakai: .farewell text <teks>  (reset untuk bawaan)`);
        g.farewellText = t.toLowerCase() === 'reset' ? '' : t; kv.save(); return c.reply('✓ Teks farewell disimpan.');
      }
      if (sub === 'kartu') {
        const v = H.onoff(c.args[1]); if (v === null) return c.reply(`Kartu gambar: ${g.farewellCard !== false ? 'ON' : 'OFF'}\nPakai: .farewell kartu on/off`);
        g.farewellCard = v; kv.save(); return c.reply(`✓ Kartu gambar ${v ? 'ON' : 'OFF'}`);
      }
      if (sub === 'tes' || sub === 'test') {
        let subject = 'grup ini'; let count = 0;
        try { const md = (await H.groupInfo(c.sock, c.from)).md; subject = md.subject; count = md.participants.length; } catch (_) { /* abaikan */ }
        const clk = W.clock();
        const caption = fillTemplate(g.farewellText || DEFAULT_FAREWELL, { user: H.num(c.sender), group: subject, count: String(count), greet: W.greeting(clk.hour), time: clk.time, date: clk.date });
        return W.sendCard(c.sock, c.from, { kind: 'farewell', jid: c.sender, alt: [c.msg.key.participantAlt], group: subject, count, theme: g.welcomeTheme }, caption, [c.sender]);
      }
      return toggle('farewell', 'Farewell')(c);
    },
  },
  antilink: {
    help: 'Anti link: .antilink off|on|kick', ...AB,
    run: (c) => {
      const a = (c.args[0] || '').toLowerCase(); const g = gs(c.from);
      if (!['off', 'on', 'kick'].includes(a)) return c.reply(`Anti link: ${g.antilink}\nPilih: off / on (hapus) / kick (hapus + keluarkan)`);
      g.antilink = a; kv.save(); return c.reply('Anti link: ' + a);
    },
  },
  badword: { help: 'Filter kata kasar on/off (3 warn = kick)', ...AB, run: toggle('badword', 'Filter kata kasar') },
  kata: {
    help: 'Kelola kata terlarang: .kata add|del|list <kata>', group: true, admin: true,
    run: (c) => {
      const cfg = CFG(); const [a, w] = [(c.args[0] || '').toLowerCase(), (c.args[1] || '').toLowerCase()];
      if (a === 'add' && w) { if (!cfg.bad.includes(w)) cfg.bad.push(w); kv.save(); return c.reply('Ditambah: ' + w); }
      if (a === 'del' && w) { cfg.bad = cfg.bad.filter((x) => x !== w); kv.save(); return c.reply('Dihapus: ' + w); }
      return c.reply('Kata tambahan: ' + (cfg.bad.join(', ') || '(kosong)'));
    },
  },
  antisticker: { help: 'Anti spam stiker on/off', ...AB, run: toggle('antisticker', 'Anti spam stiker') },
  antibot: { help: 'Proteksi dari bot lain/flood on/off', ...AB, run: toggle('antibot', 'Anti bot') },
  mute: {
    help: 'Bungkam member (pesannya dihapus): .mute @user', ...AB,
    run: async (c) => {
      const t = await safeTargets(c); if (!t.length) return c.reply('Tag/reply member yang mau di-mute.');
      const g = gs(c.from); t.forEach((j) => { if (!g.muted.includes(H.num(j))) g.muted.push(H.num(j)); }); kv.save();
      return c.say('Di-mute: ' + t.map((j) => '@' + H.num(j)).join(' '), t);
    },
  },
  unmute: {
    help: 'Buka bungkam: .unmute @user', ...A,
    run: (c) => {
      const t = H.mentions(c.msg); const g = gs(c.from);
      g.muted = g.muted.filter((x) => !t.map(H.num).includes(x)); kv.save();
      return c.say('Unmute: ' + (t.map((j) => '@' + H.num(j)).join(' ') || '-'), t);
    },
  },
  kick: {
    help: 'Keluarkan member: .kick @user', ...AB,
    run: async (c) => {
      const t = await safeTargets(c); if (!t.length) return c.reply('Tag/reply member yang mau dikeluarkan.');
      await c.sock.groupParticipantsUpdate(c.from, t, 'remove'); H.clearGroupCache(c.from);
      return c.reply(`${t.length} member dikeluarkan.`);
    },
  },
  ban: {
    help: 'Ban permanen (auto-kick kalau masuk lagi): .ban @user', ...AB,
    run: async (c) => {
      const t = await safeTargets(c); if (!t.length) return c.reply('Tag/reply member yang mau di-ban.');
      const g = gs(c.from); t.forEach((j) => { if (!g.banned.includes(H.num(j))) g.banned.push(H.num(j)); }); kv.save();
      await c.sock.groupParticipantsUpdate(c.from, t, 'remove'); H.clearGroupCache(c.from);
      return c.reply(`⊘ ${t.length} member di-ban.`);
    },
  },
  unban: {
    help: 'Cabut ban: .unban <nomor>', ...A,
    run: (c) => {
      const n = (c.args[0] || '').replace(/\D/g, ''); const g = gs(c.from);
      g.banned = g.banned.filter((x) => x !== n); kv.save(); return c.reply('Ban dicabut: ' + (n || '-'));
    },
  },
  promote: {
    help: 'Jadikan admin: .promote @user', ...AB,
    run: async (c) => { const t = H.mentions(c.msg); if (!t.length) return c.reply('Tag/reply dulu.'); await c.sock.groupParticipantsUpdate(c.from, t, 'promote'); H.clearGroupCache(c.from); return c.reply('▲ Jadi admin.'); },
  },
  demote: {
    help: 'Copot admin: .demote @user', ...AB,
    run: async (c) => { const t = H.mentions(c.msg); if (!t.length) return c.reply('Tag/reply dulu.'); await c.sock.groupParticipantsUpdate(c.from, t, 'demote'); H.clearGroupCache(c.from); return c.reply('▼ Admin dicopot.'); },
  },
  tutup: {
    help: 'Kunci grup (admin only)', alias: ['lock'], ...AB,
    run: async (c) => { await c.sock.groupSettingUpdate(c.from, 'announcement'); return c.reply('⊘ Grup dikunci: hanya admin yang bisa kirim pesan.'); },
  },
  buka: {
    help: 'Buka grup untuk semua', alias: ['unlock'], ...AB,
    run: async (c) => { await c.sock.groupSettingUpdate(c.from, 'not_announcement'); return c.reply('○ Grup dibuka.'); },
  },
  jadwalgrup: {
    help: 'Buka/tutup otomatis: .jadwalgrup <tutup HH:MM> <buka HH:MM> | off', ...AB,
    run: (c) => {
      const g = gs(c.from);
      if ((c.args[0] || '').toLowerCase() === 'off') { g.closeAt = ''; g.openAt = ''; kv.save(); return c.reply('Jadwal dimatikan.'); }
      if (!H.validHM(c.args[0]) || !H.validHM(c.args[1])) return c.reply(`Format: .jadwalgrup 22:00 05:00 (tutup, buka; WIB)\nSekarang: tutup ${g.closeAt || '-'} / buka ${g.openAt || '-'}`);
      g.closeAt = c.args[0]; g.openAt = c.args[1]; kv.save();
      return c.reply(`Tutup ${g.closeAt}, buka ${g.openAt} (${H.TZ}).`);
    },
  },
  absen: {
    help: 'Absen: .absen mulai / .absen selesai (member: .hadir)', ...A,
    run: (c) => {
      const a = (c.args[0] || '').toLowerCase();
      if (a === 'mulai') { sessions.set(c.from, new Map()); return c.reply('Absen dibuka! Ketik *.hadir*'); }
      if (a === 'selesai') {
        const s = sessions.get(c.from); if (!s) return c.reply('Belum ada sesi absen.');
        sessions.delete(c.from);
        return c.say(`*Hasil absen* (${s.size})\n${[...s.keys()].map((n, i) => `${i + 1}. @${n}`).join('\n') || '-'}`, [...s.keys()].map(H.toJid));
      }
      return c.reply('Pakai .absen mulai / .absen selesai');
    },
  },
  hadir: {
    help: 'Tandai hadir saat absen', group: true,
    run: (c) => {
      const s = sessions.get(c.from); if (!s) return c.reply('Tidak ada absen yang dibuka.');
      const id = H.num(c.sender); if (s.has(id)) return c.reply('Kamu sudah absen ✓');
      s.set(id, Date.now()); return c.reply(`✓ Hadir (${s.size})`);
    },
  },
  aktif: {
    help: 'Member paling aktif: .aktif [hari=7]', group: true,
    run: (c) => {
      const g = gs(c.from); const d = parseInt(c.args[0], 10) || 7; const since = Date.now() - d * 864e5;
      const top = Object.entries(g.act).filter(([, v]) => v.t >= since).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
      return c.say(`*Member aktif ${d} hari terakhir*\n${top.map(([n, v], i) => `${i + 1}. @${n} — ${v.n} pesan`).join('\n') || 'Belum ada data.'}`, top.map(([n]) => H.toJid(n)));
    },
  },
  hidetag: {
    help: 'Tag semua member tanpa menampilkan @: .hidetag <teks>', alias: ['tagall'], ...A,
    run: async (c) => {
      const { md } = await H.groupInfo(c.sock, c.from);
      return c.sock.sendMessage(c.from, { text: c.rest || '', mentions: md.participants.map((p) => p.id) });
    },
  },
  gstats: {
    help: 'Statistik aktivitas grup', group: true,
    run: async (c) => {
      const g = gs(c.from); const days = Object.keys(g.daily).sort().slice(-7);
      const max = Math.max(1, ...days.map((d) => g.daily[d]));
      const bars = days.map((d) => `${d.slice(5)} ${'█'.repeat(Math.ceil((g.daily[d] / max) * 10))} ${g.daily[d]}`).join('\n');
      const total = Object.values(g.act).reduce((s, v) => s + v.n, 0);
      const { md } = await H.groupInfo(c.sock, c.from);
      return c.reply(`*${md.subject}*\nMember: ${md.participants.length}\nPesan tercatat: ${total}\nPenulis unik: ${Object.keys(g.act).length}\n\n${bars || 'Belum ada data.'}`);
    },
  },
  exportmember: {
    help: 'Ekspor daftar member (CSV)', alias: ['exportmembers'], ...A,
    run: async (c) => {
      const { md } = await H.groupInfo(c.sock, c.from);
      const csv = 'nomor,peran\n' + md.participants.map((p) => `${H.num(p.id)},${p.admin || 'member'}`).join('\n');
      return c.sock.sendMessage(c.from, { document: Buffer.from(csv), mimetype: 'text/csv', fileName: `member-${md.subject.replace(/\W+/g, '_')}.csv` }, { quoted: c.msg });
    },
  },
  pengaturan: {
    help: 'Lihat semua pengaturan grup ini', group: true,
    run: (c) => {
      const g = gs(c.from);
      return c.reply(`*Pengaturan grup*\nWelcome: ${g.welcome ? 'ON' : 'OFF'}\nFarewell: ${g.farewell ? 'ON' : 'OFF'}\nAnti link: ${g.antilink}\nFilter kata kasar: ${g.badword ? 'ON' : 'OFF'}\nAnti spam stiker: ${g.antisticker ? 'ON' : 'OFF'}\nAnti bot: ${g.antibot ? 'ON' : 'OFF'}\nJadwal: tutup ${g.closeAt || '-'} / buka ${g.openAt || '-'}\nMute: ${g.muted.length} | Ban: ${g.banned.length}`);
    },
  },
};

module.exports = { commands, onMessage, onParticipants, tick, hasBad, gs };

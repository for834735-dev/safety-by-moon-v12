'use strict';
/**
 * Kategori 13 — Moderasi & Aktivitas Grup (admin), 8 fitur
 * grafik · pasif · warn · resetwarn · rules · pesansementara · setfoto · infolink
 */
const kv = require('../kv');
const H = require('./helpers');
const { gs } = require('./group');
const numinfo = require('../services/numberinfo');
const { S, ICON, head, row, foot, say } = require('../ui/style');

const A = { group: true, admin: true };
const AB = { group: true, admin: true, botadmin: true };
const box = (title, lines) => [head(ICON.group, title), ...lines.filter(Boolean).map(row), foot()].join('\n');
const fmtDate = (d) => new Intl.DateTimeFormat('id-ID', { timeZone: H.TZ, day: '2-digit', month: 'short' }).format(new Date(d + 'T12:00:00Z')).replace(/\./g, '');

/** Target dari @tag atau reply; menolak admin, owner, dan bot sendiri. */
async function victims(c) {
  const { admins } = await H.groupInfo(c.sock, c.from);
  const me = H.num(c.sock.user?.id);
  return H.mentions(c.msg).filter((j) => !admins.has(H.num(j)) && !admins.has(H.phoneOf(j)) && H.phoneOf(j) !== H.ownerNum() && H.num(j) !== me);
}

const commands = {
  grafik: {
    help: 'Grafik jumlah pesan grup per hari: .grafik [hari 3-14]', alias: ['aktivitasgrup', 'chart'], ...A,
    run: (c) => {
      const g = gs(c.from); const n = H.clamp(parseInt(c.args[0], 10) || 7, 3, 14);
      const days = [];
      for (let i = n - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toLocaleDateString('en-CA', { timeZone: H.TZ }));
      const vals = days.map((d) => g.daily[d] || 0);
      const max = Math.max(...vals, 1); const total = vals.reduce((a, b) => a + b, 0);
      if (!total) return c.reply(say('warn', 'Belum ada data pesan. Bot mulai menghitung sejak masuk grup ini.'));
      const bar = (v) => '█'.repeat(Math.round((v / max) * 14)) || '▏';
      const lines = days.map((d, i) => `${fmtDate(d).padEnd(7)} ${bar(vals[i]).padEnd(14)} ${vals[i]}`);
      const peak = vals.indexOf(max);
      return c.reply(`${S.ok} Aktivitas ${n} hari terakhir\n\`\`\`${lines.join('\n')}\`\`\`\n${S.dot} Total ${total.toLocaleString('id-ID')} pesan · rata-rata ${Math.round(total / n)}/hari\n${S.dot} Teramai: ${fmtDate(days[peak])} (${max} pesan)`);
    },
  },

  pasif: {
    help: 'Daftar anggota tidak aktif: .pasif [hari=14] [tag]', alias: ['inaktif', 'silent'], ...A,
    run: async (c) => {
      const g = gs(c.from);
      const { md } = await H.groupInfo(c.sock, c.from);
      const days = H.clamp(parseInt(c.args.find((a) => /^\d+$/.test(a)), 10) || 14, 1, 180);
      const tag = c.args.some((a) => a.toLowerCase() === 'tag');
      const since = Date.now() - days * 864e5;
      const me = H.num(c.sock.user?.id);
      const silent = md.participants.filter((p) => {
        const ids = H.partIds(p);
        if (ids.includes(me) || ids.includes(H.ownerNum())) return false;
        return !ids.some((i) => (g.act[i]?.t || 0) >= since);
      });
      const tracked = g.since ? Math.floor((Date.now() - g.since) / 864e5) : 0;
      if (!silent.length) return c.reply(`${S.ok} Semua anggota aktif dalam ${days} hari terakhir.`);
      const shown = silent.slice(0, 40);
      const label = (p) => { const ph = H.partIds(p).find((x) => /^\d{8,15}$/.test(x) && !H.isLid(p.id || '')) || H.phoneOf(p.phoneNumber || p.id); return ph ? '+' + ph : H.num(p.id); };
      const text = [`${S.warn} ${silent.length} anggota diam ≥ ${days} hari`, ...shown.map((p, i) => `${String(i + 1).padStart(2, '0')}. ${tag ? '@' + H.num(H.partJid(p)) : label(p)}${p.admin ? ' (admin)' : ''}`), silent.length > shown.length ? `… dan ${silent.length - shown.length} lainnya` : '', '', `${S.dot} Data dihitung sejak bot memantau grup (${tracked} hari lalu).`, `${S.dot} Tidak ada yang dikeluarkan otomatis; pakai .kick bila perlu.`].filter(Boolean).join('\n');
      return tag ? c.say(text, shown.map(H.partJid)) : c.reply(text);
    },
  },

  warn: {
    help: 'Beri peringatan (3x = dikeluarkan): .warn @user [alasan]  ·  .warn tanpa target = daftar', alias: ['peringatan'], ...A,
    run: async (c) => {
      const g = gs(c.from);
      const targets = await victims(c);
      if (!targets.length) {
        const rows = Object.entries(g.warns).filter(([, n]) => n > 0).map(([k, n]) => `${S.arrow} +${k} : ${n}/3`);
        return c.reply(rows.length ? `${S.warn} Peringatan aktif\n${rows.join('\n')}\n\nBeri peringatan: .warn @user alasan` : `${S.ok} Belum ada peringatan aktif.\nPakai: .warn @user alasan (atau reply pesannya)`);
      }
      const reason = c.rest.replace(/@\d+/g, '').trim() || 'pelanggaran aturan grup';
      const canKick = await H.botIsAdmin(c.sock, c.from);
      for (const j of targets) {
        const key = H.num(j);
        g.warns[key] = (g.warns[key] || 0) + 1; kv.save();
        const n = g.warns[key];
        if (n >= 3) {
          g.warns[key] = 0; kv.save();
          if (canKick) { await c.say(`⊘ @${key} mencapai 3/3 peringatan (${reason}) dan dikeluarkan.`, [j]); await c.sock.groupParticipantsUpdate(c.from, [j], 'remove').catch(() => {}); }
          else await c.say(`⊘ @${key} mencapai 3/3 peringatan. Jadikan bot admin agar bisa dikeluarkan otomatis.`, [j]);
        } else await c.say(`${S.warn} @${key} diberi peringatan ${n}/3\nAlasan: ${reason}`, [j]);
      }
    },
  },

  resetwarn: {
    help: 'Hapus peringatan: .resetwarn @user  atau  .resetwarn semua', alias: ['unwarn', 'hapuswarn'], ...A,
    run: async (c) => {
      const g = gs(c.from);
      if ((c.args[0] || '').toLowerCase() === 'semua') { g.warns = {}; kv.save(); return c.reply(`${S.ok} Semua peringatan dihapus.`); }
      const t = H.mentions(c.msg);
      if (!t.length) return c.reply('Format: .resetwarn @user  (atau reply)  ·  .resetwarn semua');
      t.forEach((j) => { delete g.warns[H.num(j)]; }); kv.save();
      return c.reply(`${S.ok} Peringatan ${t.length} anggota dihapus.`);
    },
  },

  rules: {
    help: 'Aturan grup: .rules (lihat)  ·  .rules <teks> (admin menyimpan)  ·  .rules hapus', alias: ['aturan'], group: true,
    run: async (c) => {
      const g = gs(c.from);
      if (!c.rest) return c.reply(g.rules ? `${S.ok} *Aturan grup*\n\n${g.rules}` : 'Belum ada aturan. Admin bisa menyimpannya: .rules <teks aturan>');
      if (!(c.isOwner || (await c.isAdminSender()))) return c.reply(`${S.lock} Hanya admin yang boleh mengubah aturan.`);
      if (c.rest.toLowerCase() === 'hapus') { g.rules = ''; kv.save(); return c.reply(`${S.ok} Aturan dihapus.`); }
      g.rules = c.rest.slice(0, 1500); kv.save();
      return c.reply(`${S.ok} Aturan disimpan. Anggota bisa melihatnya dengan .rules`);
    },
  },

  pesansementara: {
    help: 'Pesan sementara grup: .pesansementara <off|24j|7h|90h>', alias: ['ephemeral', 'disappear'], ...AB,
    run: async (c) => {
      const map = { off: 0, '24j': 86400, '7h': 604800, '90h': 7776000 };
      const k = (c.args[0] || '').toLowerCase();
      if (!(k in map)) return c.reply('Format: .pesansementara <off|24j|7h|90h>\n24j = 24 jam · 7h = 7 hari · 90h = 90 hari');
      await c.sock.groupToggleEphemeral(c.from, map[k]);
      return c.reply(`${S.ok} Pesan sementara: ${k === 'off' ? 'dimatikan' : k}`);
    },
  },

  setfoto: {
    help: 'Ganti foto grup dari gambar yang di-reply: .setfoto', alias: ['gantifoto', 'setpp'], ...AB,
    run: async (c) => {
      const m = H.need(c, ['imageMessage'], 'Reply sebuah gambar dengan .setfoto');
      const buf = await H.downloadMedia(m);
      await c.sock.updateProfilePicture(c.from, buf);
      return c.reply(`${S.ok} Foto grup diganti.`);
    },
  },

  infolink: {
    help: 'Intip info grup dari link undangan: .infolink <link grup>', alias: ['cekgrup', 'groupinfo'], admin: true,
    run: async (c) => {
      const m = (c.rest || H.quotedText(c.msg)).match(/chat\.whatsapp\.com\/([A-Za-z0-9]{10,})/);
      if (!m) return c.reply('Format: .infolink https://chat.whatsapp.com/xxxxxxxx');
      const i = await c.sock.groupGetInviteInfo(m[1]);
      const ownerPn = H.phoneOf(i.ownerPn || i.owner);
      const created = i.creation ? new Intl.DateTimeFormat('id-ID', { timeZone: H.TZ, day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(i.creation * 1000)) : null;
      const line = (k, v) => (v ? `${S.dot} ${k.padEnd(9)}: ${v}` : null);
      return c.reply(box('Info grup', [line('Nama', i.subject), line('Anggota', i.size), line('Pembuat', ownerPn ? numinfo.analyze(ownerPn).display : null), line('Dibuat', created), line('Kirim', i.announce ? 'hanya admin' : 'semua anggota'), line('Persetujuan', i.joinApprovalMode ? 'admin harus menyetujui anggota baru' : null), line('Deskripsi', i.desc && i.desc.slice(0, 220))]));
    },
  },
};

module.exports = { commands };

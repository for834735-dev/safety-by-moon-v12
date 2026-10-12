'use strict';
/**
 * Kategori 14 — Izin & Kelola Grup (khusus owner), 6 fitur
 * gerbang · acc · tolak · grupmenunggu · daftargrup · keluar
 *
 * Alur: bot ditambahkan ke grup -> bot DIAM -> owner dikabari -> owner .acc atau .tolak.
 *   .acc   : bot menyapa grup dengan kartu bergambar dan mulai bekerja.
 *   .tolak : bot pamit dengan sopan lalu keluar dari grup.
 * Grup yang sudah ada saat fitur ini pertama kali aktif dianggap sudah disetujui.
 */
const kv = require('../kv');
const H = require('./helpers');
const config = require('../config');
const { S, ICON, head, row, foot, say } = require('../ui/style');

const DB = () => kv.ns('gate', { enabled: null, init: false, seq: 0, timeoutMin: null, groups: {} });
const enabled = () => (DB().enabled ?? config.bool(process.env.GATE_ENABLED, true)) && Boolean(H.ownerNum());
const timeoutMin = () => DB().timeoutMin ?? config.int(process.env.GATE_TIMEOUT_MIN, 0);
const autoOwner = () => config.bool(process.env.GATE_AUTO_OWNER, true);

const registering = new Set();
let snapshotting = false;
let lastSnapshotTry = 0;
let lastList = []; // hasil .daftargrup terakhir, untuk .keluar <nomor>

const botNums = (sock) => new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(H.num));
const ownerIs = (jid) => Boolean(jid) && H.phoneOf(jid) === H.ownerNum();
const when = (t) => new Intl.DateTimeFormat('id-ID', { timeZone: H.TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t)).replace(/\./g, ':');
const who = (jid) => { if (!jid) return 'tidak diketahui'; const n = H.nameOf(jid); const p = H.phoneOf(jid); return [n, p && '+' + p].filter(Boolean).join(' · ') || 'tidak diketahui'; };

async function meta(sock, gid) {
  try { const md = await sock.groupMetadata(gid); H.learnParticipants(md.participants); return md; } catch { return null; }
}

// ---------- pesan ----------
function pendingText(rec, gid) {
  return [
    head(ICON.group, 'Izin masuk grup'),
    row('Bot ditambahkan ke grup baru dan sedang menunggu keputusanmu.'),
    row(''),
    row(`${S.dot} Grup     : ${rec.name}`),
    row(`${S.dot} Anggota  : ${rec.size || '-'}`),
    row(`${S.dot} Ditambah : ${who(rec.by)}`),
    row(`${S.dot} Waktu    : ${when(rec.at)}`),
    row(`${S.dot} Kode     : ${rec.code}`),
    foot(),
    '',
    `${S.arrow} Balas pesan ini dengan *.acc* untuk menerima`,
    `${S.arrow} atau *.tolak* untuk menolak (bot langsung keluar).`,
    `Cara lain: *.acc ${rec.code}* / *.tolak ${rec.code}*`,
    `Selama belum disetujui, bot tidak merespons siapa pun di grup itu.`,
  ].join('\n');
}

const welcomeText = (name, greet) => [
  `${S.ok} ${greet}, keluarga *${name}*!`,
  '',
  'Salam hangat dari *Safety Your WhatsApp*. Terima kasih sudah mengundang kami, izin dari owner sudah diberikan dan bot siap membantu.',
  '',
  `${S.arrow} *.menu*   lihat seluruh fitur`,
  `${S.arrow} *.rules*  baca aturan grup`,
  `${S.arrow} *.welcome tes*  coba kartu sambutan`,
  '',
  `${S.warn} Jadikan bot admin agar fitur moderasi (kick, anti link, tutup/buka grup) dapat bekerja.`,
].join('\n');

const rejectText = () => [
  `${S.warn} Mohon maaf, *Safety Your WhatsApp* belum mendapat izin dari owner untuk berada di grup ini, sehingga bot pamit keluar.`,
  'Terima kasih sudah mengundang. Bila ingin bot diaktifkan, silakan hubungi owner' + (H.ownerNum() ? `: wa.me/${H.ownerNum()}` : '.'),
].join('\n');

// ---------- inti ----------
async function register(sock, gid, { by = null, md = null } = {}) {
  if (registering.has(gid)) return null;
  const d = DB();
  if (d.groups[gid] && d.groups[gid].status !== 'rejected' && d.groups[gid].status !== 'left') return d.groups[gid];
  registering.add(gid);
  try {
    md = md || (await meta(sock, gid));
    const rec = { status: 'pending', code: 'G' + (++d.seq), name: md?.subject || 'Grup tanpa nama', size: md?.participants?.length || 0, by, at: Date.now(), notifyId: null, reminded: false };
    d.groups[gid] = rec; kv.save();
    if (autoOwner() && ownerIs(by)) { await approve(sock, gid, 'otomatis (owner yang menambahkan)'); return rec; }
    const sent = await H.safeSend(sock, H.ownerJid(), { text: pendingText(rec, gid) });
    if (sent?.key?.id) { rec.notifyId = sent.key.id; kv.save(); }
    return rec;
  } finally { registering.delete(gid); }
}

async function approve(sock, gid, via = 'owner') {
  const d = DB();
  const rec = (d.groups[gid] ||= { code: 'G' + (++d.seq), name: 'Grup', size: 0, by: null, at: Date.now() });
  rec.status = 'approved'; rec.decidedAt = Date.now(); rec.via = via; kv.save();
  const md = await meta(sock, gid);
  if (md) { rec.name = md.subject; rec.size = md.participants.length; }
  const W = require('./welcome');
  const clk = W.clock();
  const avatar = await W.fetchAvatar(sock, [gid]);
  await W.sendCard(sock, gid, { kind: 'approved', name: rec.name, group: rec.name, count: rec.size, avatar, tag: 'izin owner' }, welcomeText(rec.name, W.greeting(clk.hour)));
  return rec;
}

async function reject(sock, gid, why = 'ditolak owner') {
  const d = DB();
  const rec = (d.groups[gid] ||= { code: 'G' + (++d.seq), name: 'Grup', size: 0, by: null, at: Date.now() });
  rec.status = 'rejected'; rec.decidedAt = Date.now(); rec.via = why; kv.save();
  await H.safeSend(sock, gid, { text: rejectText() });
  await H.sleep(1200);
  try { await sock.groupLeave(gid); } catch (e) { H.log.warn('Gagal keluar grup: ' + e.message); return false; }
  return true;
}

/** Dipanggil hub.handle untuk setiap pesan grup dari non-owner. true = boleh diproses. */
async function allow(sock, gid) {
  if (!enabled()) return true;
  const d = DB();
  if (!d.init) return true; // belum ada snapshot grup lama
  const rec = d.groups[gid];
  if (rec) return rec.status === 'approved';
  register(sock, gid).catch((e) => H.log.warn('Gerbang: ' + e.message)); // grup yang terlewat event-nya
  return false;
}

const isBlocked = (gid) => { if (!enabled()) return false; const d = DB(); const r = d.groups[gid]; return Boolean(d.init && r && r.status !== 'approved'); };

async function onParticipants(sock, u) {
  if (!enabled() && !DB().init) return false;
  const me = botNums(sock);
  const list = u.participants || [];
  const botInvolved = list.some((p) => H.partIds(p).some((x) => me.has(x)));
  if (botInvolved) {
    if (u.action === 'add') {
      H.learn(u.author, u.authorPn);
      if (enabled()) await register(sock, u.id, { by: u.authorPn || u.author || null });
      return true;
    }
    if (u.action === 'remove') { const r = DB().groups[u.id]; if (r && r.status !== 'rejected') { r.status = 'left'; kv.save(); } return true; }
  }
  return isBlocked(u.id); // grup belum disetujui: jangan kirim welcome/farewell
}

async function onGroupsUpsert(sock, groups) {
  if (!enabled()) return;
  for (const md of groups || []) {
    if (!md?.id || DB().groups[md.id]) continue;
    await register(sock, md.id, { md });
  }
}

async function tick(sock, now, newMin) {
  if (!sock?.user || !enabled()) return;
  const d = DB();
  if (!d.init && !snapshotting && Date.now() - lastSnapshotTry > 60000) {
    snapshotting = true; lastSnapshotTry = Date.now();
    try {
      const all = await sock.groupFetchAllParticipating();
      for (const [gid, md] of Object.entries(all || {})) d.groups[gid] ||= { status: 'approved', code: 'G' + (++d.seq), name: md.subject, size: md.participants?.length || 0, by: null, at: Date.now(), via: 'grup lama' };
      d.init = true; kv.save();
      H.log.info(`Gerbang grup aktif: ${Object.keys(all || {}).length} grup lama dianggap sudah disetujui.`);
    } catch (e) { H.log.warn('Snapshot grup gagal, dicoba lagi: ' + e.message); } finally { snapshotting = false; }
    return;
  }
  if (!newMin) return;
  const lim = timeoutMin();
  for (const [gid, r] of Object.entries(d.groups)) {
    if (r.status !== 'pending') continue;
    const age = Date.now() - r.at;
    if (lim > 0 && age > lim * 60000) { await H.notifyOwner(sock, `${S.warn} Waktu menunggu habis, bot keluar dari *${r.name}* (${r.code}).`); await reject(sock, gid, 'waktu habis'); continue; }
    if (!r.reminded && age > 30 * 60000) { r.reminded = true; kv.save(); await H.notifyOwner(sock, `${S.wait} Grup *${r.name}* (${r.code}) masih menunggu keputusanmu.\n.acc ${r.code}  ·  .tolak ${r.code}`); }
  }
}

// ---------- command ----------
const O = { owner: true };
const entries = () => Object.entries(DB().groups);
function resolve(c) {
  const d = DB(); const a = (c.args[0] || '').toUpperCase();
  if (/^G\d+$/.test(a)) { const e = entries().find(([, r]) => r.code === a); if (e) return e[0]; throw new Error(`Kode ${a} tidak ditemukan. Lihat .grupmenunggu`); }
  const qid = H.ctxInfo(c.msg)?.stanzaId;
  if (qid) { const e = entries().find(([, r]) => r.notifyId === qid); if (e) return e[0]; }
  if (c.isGroup) return c.from;
  const pend = entries().filter(([, r]) => r.status === 'pending');
  if (pend.length === 1) return pend[0][0];
  if (pend.length > 1) throw new Error(`Ada ${pend.length} grup menunggu. Sebutkan kodenya, mis. .${c.cmd} ${pend[0][1].code}`);
  void d; throw new Error('Tidak ada grup yang menunggu keputusan.');
}

const commands = {
  gerbang: {
    help: 'Atur izin masuk grup: .gerbang on|off|status|timeout <menit>', alias: ['gate'], ...O,
    run: (c) => {
      const d = DB(); const a = (c.args[0] || 'status').toLowerCase();
      if (a === 'timeout') { const m = parseInt(c.args[1], 10); if (!(m >= 0)) return c.reply('Format: .gerbang timeout <menit>  (0 = tunggu tanpa batas)'); d.timeoutMin = m; kv.save(); return c.reply(`${S.ok} Batas waktu keputusan: ${m ? m + ' menit (lewat itu bot otomatis keluar)' : 'tanpa batas'}`); }
      if (['on', 'off'].includes(a)) { d.enabled = a === 'on'; if (a === 'on') d.init = d.init; kv.save(); return c.reply(`${S.ok} Izin masuk grup ${a === 'on' ? 'AKTIF' : 'NONAKTIF'}`); }
      const st = entries().reduce((o, [, r]) => { o[r.status] = (o[r.status] || 0) + 1; return o; }, {});
      return c.reply([`${S.ok} Gerbang grup`, `${S.dot} Status    : ${enabled() ? 'AKTIF' : 'NONAKTIF'}${H.ownerNum() ? '' : ' (OWNER_NUMBER belum diisi)'}`, `${S.dot} Menunggu  : ${st.pending || 0}`, `${S.dot} Disetujui : ${st.approved || 0}`, `${S.dot} Ditolak   : ${st.rejected || 0}`, `${S.dot} Batas     : ${timeoutMin() ? timeoutMin() + ' menit' : 'tanpa batas'}`, `${S.dot} Auto-acc  : ${autoOwner() ? 'bila owner yang menambahkan' : 'mati'}`].join('\n'));
    },
  },
  acc: {
    help: 'Setujui bot di grup: .acc [kode] (atau balas pesan izin)', alias: ['setuju', 'terima'], ...O,
    run: async (c) => {
      const gid = resolve(c); const rec = DB().groups[gid];
      if (rec?.status === 'approved') return c.reply(`${S.ok} ${rec.name} sudah disetujui sebelumnya.`);
      await approve(c.sock, gid, 'owner');
      if (!c.isGroup || c.from !== gid) return c.reply(`${S.ok} Disetujui: ${DB().groups[gid].name}. Bot sudah menyapa grup.`);
    },
  },
  tolak: {
    help: 'Tolak & keluar dari grup: .tolak [kode] (atau balas pesan izin)', alias: ['reject', 'tidak'], ...O,
    run: async (c) => {
      const gid = resolve(c); const name = DB().groups[gid]?.name || gid;
      const ok = await reject(c.sock, gid, 'ditolak owner');
      if (c.from !== gid) return c.reply(ok ? `${S.ok} Ditolak: ${name}. Bot sudah pamit dan keluar.` : `${S.no} Gagal keluar dari ${name}.`);
    },
  },
  grupmenunggu: {
    help: 'Daftar grup yang menunggu izin', alias: ['pending', 'menunggu'], ...O,
    run: (c) => {
      const p = entries().filter(([, r]) => r.status === 'pending');
      if (!p.length) return c.reply(`${S.ok} Tidak ada grup yang menunggu izin.`);
      return c.reply([`${S.wait} Menunggu izin (${p.length})`, ...p.map(([, r]) => `${S.arrow} ${r.code}  ${r.name}  ·  ${r.size} anggota  ·  ${when(r.at)}`), '', 'Pakai: .acc <kode>  atau  .tolak <kode>'].join('\n'));
    },
  },
  daftargrup: {
    help: 'Semua grup tempat bot berada beserta statusnya', alias: ['grupku', 'listgrup'], ...O,
    run: async (c) => {
      const all = Object.values((await c.sock.groupFetchAllParticipating()) || {}).sort((a, b) => a.subject.localeCompare(b.subject));
      lastList = all.map((g) => g.id);
      const label = { approved: 'aktif', pending: 'menunggu', rejected: 'ditolak', left: 'keluar' };
      const lines = all.slice(0, 60).map((g, i) => `${String(i + 1).padStart(2, '0')}. ${g.subject.slice(0, 34)}  ·  ${g.participants.length}  ·  ${label[DB().groups[g.id]?.status] || 'aktif'}`);
      return c.reply([`${S.ok} Grup bot (${all.length})`, ...lines, all.length > 60 ? `… dan ${all.length - 60} lainnya` : '', '', 'Keluar dari satu grup: .keluar <nomor>'].filter(Boolean).join('\n'));
    },
  },
  keluar: {
    help: 'Bot keluar dari grup: .keluar <nomor daftar|kode> (di dalam grup: tanpa argumen)', alias: ['leave', 'out'], ...O,
    run: async (c) => {
      const a = c.args[0]; let gid;
      if (/^\d+$/.test(a || '')) { gid = lastList[parseInt(a, 10) - 1]; if (!gid) return c.reply('Nomor tidak ada. Jalankan .daftargrup dulu.'); }
      else if (/^G\d+$/i.test(a || '')) { gid = entries().find(([, r]) => r.code === a.toUpperCase())?.[0]; if (!gid) return c.reply('Kode tidak ditemukan.'); }
      else if (c.isGroup) gid = c.from;
      else return c.reply('Format: .keluar <nomor dari .daftargrup>  (atau ketik .keluar di dalam grup)');
      const name = DB().groups[gid]?.name || gid;
      await H.safeSend(c.sock, gid, { text: `${S.arrow} Bot pamit atas permintaan owner. Terima kasih, semoga bermanfaat.` });
      await H.sleep(900);
      await c.sock.groupLeave(gid);
      const r = DB().groups[gid]; if (r) { r.status = 'left'; kv.save(); }
      if (c.from !== gid) return c.reply(`${S.ok} Bot keluar dari ${name}.`);
    },
  },
};

module.exports = { commands, allow, isBlocked, onParticipants, onGroupsUpsert, tick, approve, reject, register, enabled, pendingText };

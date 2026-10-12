const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let log;
try { log = require('../utils/logger'); } catch { log = { info: console.log, warn: console.warn, error: console.error }; }

const TZ = process.env.TZ_NAME || 'Asia/Jakarta';
const DATA = path.join(__dirname, '..', '..', 'data');

const num = (j = '') => String(j).split('@')[0].split(':')[0];
const isGroupJid = (j = '') => String(j).endsWith('@g.us');
const ownerNum = () => (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const ownerJid = () => (ownerNum() ? ownerNum() + '@s.whatsapp.net' : null);
const toJid = (n) => String(n).replace(/\D/g, '') + '@s.whatsapp.net';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function onoff(x) {
  x = String(x || '').toLowerCase();
  if (['on', '1', 'aktif', 'ya', 'true'].includes(x)) return true;
  if (['off', '0', 'mati', 'tidak', 'false'].includes(x)) return false;
  return null;
}

// ---------- pesan ----------
function unwrap(m = {}) {
  for (let i = 0; i < 4; i++) {
    const n = m.ephemeralMessage?.message || m.documentWithCaptionMessage?.message;
    if (!n) break;
    m = n;
  }
  return m;
}
function textOf(msg) {
  const m = unwrap(msg.message || {});
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
    m.videoMessage?.caption || m.documentMessage?.caption || '';
}
function ctxInfo(msg) {
  const m = unwrap(msg.message || {});
  return (m.extendedTextMessage || m.imageMessage || m.videoMessage || m.documentMessage ||
    m.stickerMessage || m.audioMessage || {}).contextInfo || {};
}
// jid yang di-mention; kalau tidak ada, pakai pengirim pesan yang di-reply.
function mentions(msg) {
  const ci = ctxInfo(msg);
  const arr = [...(ci.mentionedJid || [])];
  if (!arr.length && ci.participant && ci.quotedMessage) arr.push(ci.participant);
  return arr;
}
function quotedText(msg) {
  const ci = ctxInfo(msg);
  return ci.quotedMessage ? textOf({ message: ci.quotedMessage }) : '';
}
// Cari media di pesan itu sendiri atau pesan yang di-reply. (View-once sengaja tidak di-unwrap.)
function findMedia(msg, types = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
  const m = unwrap(msg.message || {});
  const ci = ctxInfo(msg);
  const cands = [[m, msg.key]];
  if (ci.quotedMessage) {
    cands.push([unwrap(ci.quotedMessage), { ...msg.key, id: ci.stanzaId, participant: ci.participant || msg.key.participant }]);
  }
  for (const [c, key] of cands) for (const t of types) if (c[t]) return { type: t, node: c[t], target: { key, message: c } };
  return null;
}
async function downloadMedia(media) {
  const { downloadMediaMessage } = require('../baileys').get();
  return downloadMediaMessage(media.target, 'buffer', {});
}

// ---------- ffmpeg ----------
function tmp(ext) { return path.join(os.tmpdir(), `sy-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`); }
async function ffmpeg(inputBuf, inExt, outExt, args = []) {
  const i = tmp(inExt);
  const o = tmp(outExt);
  fs.writeFileSync(i, inputBuf);
  try {
    await new Promise((res, rej) => {
      const p = spawn('ffmpeg', ['-y', '-i', i, ...args, o], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', () => rej(new Error('ffmpeg belum terpasang (pkg install ffmpeg)')));
      p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg gagal: ' + err.slice(-160)))));
    });
    return fs.readFileSync(o);
  } finally {
    fs.rmSync(i, { force: true });
    fs.rmSync(o, { force: true });
  }
}

// ---------- http ----------
async function http(url, opts = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), opts.timeout || 15000);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0 SafetyBot', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  } finally { clearTimeout(t); }
}
const getJson = async (url, opts) => (await http(url, opts)).json();
const getBuffer = async (url, opts) => Buffer.from(await (await http(url, opts)).arrayBuffer());

function isPrivateIp(ip = '') {
  if (ip.includes(':')) return /^(::1|f[cd]|fe80)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// ---------- waktu ----------
function nowParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const hh = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${hh}:${p.minute}`, dd: p.day, mm: p.month };
}
// 10s, 5m, 2j (jam), 1h (hari)
function parseDur(s = '') {
  const m = String(s).toLowerCase().match(/^(\d+(?:\.\d+)?)(s|m|j|jam|h|hari|d)$/);
  if (!m) return null;
  const mult = { s: 1e3, m: 6e4, j: 36e5, jam: 36e5, h: 864e5, hari: 864e5, d: 864e5 }[m[2]];
  return Math.round(parseFloat(m[1]) * mult);
}
const validHM = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
function inHours(start, end, hm) {
  return start <= end ? hm >= start && hm < end : hm >= start || hm < end;
}

// ---------- identitas: kompatibel Baileys 6 (nomor) dan Baileys 7 (LID) ----------
const isLid = (j = '') => String(j).endsWith('@lid');
const lidMap = new Map(); // digit LID -> digit nomor telepon
function learn(a, b) {
  if (!a || !b) return;
  const [x, y] = [String(a), String(b)];
  if (isLid(x) && !isLid(y)) lidMap.set(num(x), num(y));
  else if (isLid(y) && !isLid(x)) lidMap.set(num(y), num(x));
  if (lidMap.size > 20000) lidMap.delete(lidMap.keys().next().value);
}
function learnFromKey(key = {}) { learn(key.participant, key.participantAlt); learn(key.remoteJid, key.remoteJidAlt); }
function learnParticipants(list = []) { for (const p of list) if (p && typeof p === 'object') { learn(p.id, p.phoneNumber || p.jid); if (p.lid) learn(p.lid, p.phoneNumber || p.jid || p.id); } }
function learnMapping(m) {
  for (const x of (Array.isArray(m) ? m : [m])) if (x) learn(x.lid || x.lidJid, x.pn || x.phoneNumber || x.jid);
}
/** Nomor telepon (digit) dari jid apa pun; null bila jid-nya LID yang belum terpetakan. */
function phoneOf(jid) {
  if (!jid) return null;
  const s = String(jid);
  return isLid(s) ? (lidMap.get(num(s)) || null) : num(s);
}
/** Peserta grup (string atau objek Baileys 7) -> jid yang bisa dipakai untuk mengirim/mention. */
const partJid = (p) => (typeof p === 'string' ? p : (p?.id || p?.phoneNumber || p?.jid || ''));
/** Semua digit identitas peserta (id, nomor, lid) untuk pencocokan. */
function partIds(p) {
  if (typeof p === 'string') return [num(p), phoneOf(p)].filter(Boolean);
  return [p?.id, p?.phoneNumber, p?.jid, p?.lid].filter(Boolean).flatMap((j) => [num(j), phoneOf(j)]).filter(Boolean);
}
function isOwnerMsg(msg, sender) {
  if (msg.key.fromMe) return true;
  const o = ownerNum();
  if (!o) return false;
  return [sender, msg.key.participantAlt, msg.key.remoteJidAlt, msg.key.remoteJid].some((j) => j && phoneOf(j) === o);
}

// nama profil (pushName) yang pernah terlihat, disimpan agar bisa dipakai fitur lacak/anggota
const names = () => require('../kv').ns('names', {});
function rememberName(jid, name) {
  if (!jid || !name || typeof name !== 'string') return;
  const db = names(); const k = phoneOf(jid) || num(jid);
  if (db[k]?.n === name) return;
  db[k] = { n: name.slice(0, 60), t: Date.now() };
  const keys = Object.keys(db);
  if (keys.length > 4000) keys.sort((a, b) => db[a].t - db[b].t).slice(0, 500).forEach((x) => delete db[x]);
  require('../kv').save();
}
const nameOf = (jid) => { const db = names(); return db[phoneOf(jid) || num(jid)]?.n || db[num(jid)]?.n || null; };

// ---------- grup ----------
const gcache = new Map();
async function groupInfo(sock, gid) {
  const c = gcache.get(gid);
  if (c && Date.now() - c.t < 60000) return c.v;
  const md = await sock.groupMetadata(gid);
  learnParticipants(md.participants);
  const admins = new Set(md.participants.filter((p) => p.admin).flatMap(partIds));
  const v = { md, admins };
  gcache.set(gid, { t: Date.now(), v });
  return v;
}
async function isGroupAdmin(sock, gid, jid) {
  try {
    const { admins } = await groupInfo(sock, gid);
    const ids = typeof jid === 'string' ? [num(jid), phoneOf(jid)] : partIds(jid);
    return ids.some((x) => x && admins.has(x));
  } catch { return false; }
}
async function botIsAdmin(sock, gid) {
  if (await isGroupAdmin(sock, gid, sock.user?.id)) return true;
  return sock.user?.lid ? isGroupAdmin(sock, gid, sock.user.lid) : false;
}
const clearGroupCache = (gid) => gcache.delete(gid);

// ---------- kirim ----------
async function safeSend(sock, jid, content, opts) {
  try { return await sock.sendMessage(jid, content, opts); } catch (e) { log.warn('kirim gagal: ' + e.message); return null; }
}
async function notifyOwner(sock, text) {
  const j = ownerJid();
  if (!j || !sock) return false;
  return Boolean(await safeSend(sock, j, { text }));
}
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

// ---------- argumen & format (dipakai modul fitur baru) ----------
/** Pastikan ada media yang cocok (pesan sendiri atau yang di-reply), kalau tidak lempar petunjuk. */
function need(c, types, hint) {
  const m = findMedia(c.msg, types);
  if (!m) throw new Error(hint);
  return m;
}
/** "q=85 tajam=5 4x png dok" → { kv:{q:'85', tajam:'5', skala:'4'}, flags:['png','dok'] } */
function parseArgs(args = []) {
  const kv = {}; const flags = [];
  for (const a of args) {
    const m = String(a).match(/^([A-Za-z_]+)[=:](.+)$/);
    if (m) kv[m[1].toLowerCase()] = m[2];
    else if (/^\d+(\.\d+)?x$/i.test(a)) kv.skala = a.slice(0, -1);
    else flags.push(String(a).toLowerCase());
  }
  return { kv, flags };
}
const numOr = (v, d, lo, hi) => { const n = parseFloat(v); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };
const rupiah = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
/** "1.500.000", "1,5jt", "250rb", "75k" → angka */
function parseMoney(s) {
  let t = String(s || '').toLowerCase().replace(/rp\.?/g, '').replace(/\s/g, '');
  let mult = 1;
  const m = t.match(/(juta|jt|ribu|rb|k|miliar|milyar|m)$/);
  if (m) { mult = { juta: 1e6, jt: 1e6, ribu: 1e3, rb: 1e3, k: 1e3, miliar: 1e9, milyar: 1e9, m: 1e9 }[m[1]]; t = t.slice(0, -m[1].length); }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n * mult : NaN;
}
const fmtNum = (n, d = 2) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: d });
/** Kirim gambar sebagai foto, atau dokumen agar kualitas asli tidak dikompres WhatsApp. */
function sendImage(c, buf, { caption = '', asDoc = false, ext = 'jpg', name = 'hasil' } = {}) {
  const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || 'image/jpeg';
  if (asDoc || buf.length > 8 * 1048576) return c.sock.sendMessage(c.from, { document: buf, mimetype: mime, fileName: `${name}.${ext}`, caption }, { quoted: c.msg });
  return c.sock.sendMessage(c.from, { image: buf, caption }, { quoted: c.msg });
}
/** Tolak alamat internal (SSRF) sebelum server mengakses URL dari pengguna. */
async function assertPublicHost(hostname) {
  const dns = require('dns').promises;
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Alamat internal/privat tidak diizinkan.');
  return addrs[0].address;
}

module.exports = {
  isLid, learn, learnFromKey, learnParticipants, learnMapping, phoneOf, partJid, partIds, isOwnerMsg, rememberName, nameOf,
  need, parseArgs, numOr, rupiah, parseMoney, fmtNum, sendImage, assertPublicHost,
  log, TZ, DATA, num, isGroupJid, ownerNum, ownerJid, toJid, sleep, rnd, pick, clamp, onoff,
  unwrap, textOf, ctxInfo, mentions, quotedText, findMedia, downloadMedia,
  ffmpeg, http, getJson, getBuffer, isPrivateIp,
  nowParts, parseDur, validHM, inHours,
  groupInfo, isGroupAdmin, botIsAdmin, clearGroupCache,
  safeSend, notifyOwner, ensureDir,
};

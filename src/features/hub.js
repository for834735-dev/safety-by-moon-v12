// Router pusat untuk semua fitur. whatsapp.js cukup memanggil hub.handle / onParticipants / onCall / onDetected / start.
const H = require('./helpers');

const mods = {
  security: require('./security'),
  media: require('./media'),
  group: require('./group'),
  business: require('./business'),
  fun: require('./fun'),
  tools: require('./tools'),
  image: require('./image'),
  av: require('./av'),
  text: require('./text'),
  calc: require('./calc'),
  web: require('./web'),
  intel: require('./intel'),
  admin: require('./admin'),
  gate: require('./gate'),
  extra: require('./extra'),
  osint: require('./osint'),
};
const CATS = {
  security: 'Keamanan & Proteksi', media: 'Download & Media', group: 'Grup & Admin',
  business: 'Bisnis & Custom', fun: 'Personalisasi & Hiburan', tools: 'Utilitas Lainnya',
  image: 'Foto & Gambar', av: 'Audio & Video', text: 'Teks & Kode', calc: 'Hitung & Waktu', web: 'Jaringan & Web',
  intel: 'Intel Nomor & Akun', admin: 'Moderasi & Aktivitas', gate: 'Izin & Kelola Grup',
  extra: 'Grup Plus & Add', osint: 'OSINT & Investigasi',
};
const PASSIVE = ['security', 'group', 'business', 'fun', 'tools', 'extra'];

const registry = new Map();
for (const [mk, mod] of Object.entries(mods)) {
  for (const [name, def] of Object.entries(mod.commands || {})) {
    const d = { ...def, name, cat: mk };
    for (const k of [name, ...(def.alias || [])]) {
      if (registry.has(k)) H.log.warn(`Nama command ganda: .${k} (${registry.get(k).cat}.${registry.get(k).name} ditimpa ${mk}.${name})`);
      registry.set(k, d);
    }
  }
}
const primary = () => [...registry].filter(([k, v]) => k === v.name).map(([, v]) => v);

// ---------- tampilan menu (tanpa emoji: huruf Unicode + simbol geometris) ----------
const { S, ICON, bold } = require('../ui/style');
const BRAND = S.brand;
const CAT_ICON = { security: ICON.security, media: ICON.media, group: ICON.group, business: ICON.business, fun: ICON.fun, tools: ICON.tools, image: ICON.image, av: ICON.av, text: ICON.text, calc: ICON.calc, web: ICON.net, intel: ICON.net, admin: ICON.group, gate: ICON.security, extra: ICON.group, osint: ICON.net };
const KEYS = Object.keys(CATS);

function greeting() {
  const h = parseInt(H.nowParts().hm.slice(0, 2), 10);
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

// "Deskripsi: .contoh <arg>" -> { desc, usage }
function splitHelp(help = '') {
  const i = help.indexOf(': ');
  if (i > 0 && i < 70 && help.slice(i + 2).trim().startsWith('.')) return { desc: help.slice(0, i).trim(), usage: help.slice(i + 2).trim() };
  return { desc: help.trim(), usage: '' };
}

function cmdLine(d) {
  const { desc, usage } = splitHelp(d.help);
  const badge = (d.owner ? ' [owner]' : '') + (d.admin ? ' [admin]' : '');
  let out = `${S.arrow} *.${d.name}*${badge}\n   ${desc}`;
  if (usage) out += `\n   ${S.dot} \`${usage}\``;
  return out;
}

function menuText(arg, name) {
  const all = primary();
  const a = String(arg || '').toLowerCase();
  const who = name ? `, ${name}` : '';
  const count = (k) => all.filter((d) => d.cat === k).length;

  // ---- halaman kategori / semua ----
  const idx = /^\d{1,2}$/.test(a) ? +a - 1 : -1;
  if (idx >= 0 && !KEYS[idx]) return `${S.warn} Kategori tidak ada. Pilih angka 1–${KEYS.length}, atau ketik .menu`;
  if (idx >= 0 || a === 'semua' || a === 'all') {
    const show = idx >= 0 ? [KEYS[idx]] : KEYS;
    let out = `${S.top}${S.bar} ${ICON.security} ${bold(BRAND.toUpperCase())}\n${S.end}${S.bar.repeat(14)}\n`;
    show.forEach((k) => {
      out += `\n${S.top}${S.bar} ${CAT_ICON[k]} ${bold(CATS[k].toUpperCase())}  (${count(k)})\n${S.end}${S.bar.repeat(14)}\n${all.filter((d) => d.cat === k).map(cmdLine).join('\n\n')}\n`;
    });
    out += `\n${S.line}\n[owner] khusus pemilik bot   [admin] khusus admin grup\n${S.arrow} Menu utama: *.menu*\n${S.line}\n_${BRAND}_`;
    return out;
  }

  // ---- halaman utama ----
  let out = `${S.top}${S.bar} ${ICON.security} ${bold(BRAND.toUpperCase())}\n${S.mid} Asisten keamanan & otomasi WhatsApp\n${S.end}${S.bar.repeat(14)}\n\n${greeting()}${who}.\nTersedia *${all.length} command* dalam ${KEYS.length} kategori.\n\n${bold('KATEGORI')}\n`;
  KEYS.forEach((k, i) => { out += `${String(i + 1).padStart(2, '0')}  ${CAT_ICON[k]}  ${CATS[k]}  ${S.dot}  ${count(k)}\n`; });
  out += `\n${bold('CARA PAKAI')}\n`
    + `${S.arrow} *.menu 1* sampai *.menu ${KEYS.length}*  buka satu kategori\n`
    + `${S.arrow} *.menu semua*  tampilkan seluruh command\n`
    + `${S.arrow} Semua command diawali tanda titik ( . )\n`
    + `\n${bold('PROTEKSI OTOMATIS')}\n`
    + `${S.ok} Deteksi bug / virtex   ${S.ok} Anti delete\n${S.ok} Filter link phishing  ${S.ok} Mode aman\n${S.ok} Welcome & farewell    ${S.ok} Balasan otomatis\n`
    + `\n${S.line}\n_${BRAND}_`;
  return out;
}

const cool = new Map();

async function handle(sock, msg, text) {
  const from = msg.key.remoteJid;
  if (!from) return true;
  if (from === 'status@broadcast') { await mods.media.onStatus(msg); return true; }
  if (from.endsWith('@broadcast') || from.endsWith('@newsletter')) return true;

  const sender = msg.key.participant || from;
  H.learnFromKey(msg.key);
  if (!msg.key.fromMe && msg.pushName) H.rememberName(sender, msg.pushName);
  const ctx = {
    sock, msg, from, sender, text: text || '', isGroup: H.isGroupJid(from), cmd: '', args: [], rest: '',
    isOwner: H.isOwnerMsg(msg, sender),
  };
  ctx.reply = (t, o = {}) => sock.sendMessage(from, { text: t, ...o }, { quoted: msg });
  ctx.say = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: msg });
  let adm;
  ctx.isAdminSender = async () => (adm ??= ctx.isGroup ? await H.isGroupAdmin(sock, from, sender) : false);

  // Gerbang izin: di grup yang belum disetujui owner, bot diam (kecuali untuk owner).
  if (ctx.isGroup && !ctx.isOwner && !(await mods.gate.allow(sock, from))) return true;

  for (const k of msg.key.fromMe ? [] : PASSIVE) {
    try { if (await mods[k].onMessage?.(ctx)) return true; } catch (e) { H.log.warn(`${k}.onMessage: ${e.message}`); }
  }

  if (!ctx.text.startsWith('.') || ctx.text.length < 2) return false;
  const body = ctx.text.slice(1).trim();
  const first = body.split(/\s+/)[0] || '';
  ctx.cmd = first.toLowerCase();
  ctx.rest = body.slice(first.length).trim();
  ctx.args = ctx.rest ? ctx.rest.split(/\s+/) : [];

  if (ctx.cmd === 'menu' || ctx.cmd === 'help') {
    const txt = menuText(ctx.args[0], msg.pushName);
    if (ctx.args[0] || !(await require('./menuanim').sendMenu(sock, from, msg, txt))) await ctx.reply(txt);
    return true;
  }

  let def = registry.get(ctx.cmd);
  if (!def) {
    const custom = mods.business.customCommand(ctx.cmd, ctx);
    if (custom) { await ctx.reply(custom); return true; }
    return false;
  }

  if (!ctx.isOwner) {
    const last = cool.get(sender) || 0;
    if (Date.now() - last < 1200) return true;
    cool.set(sender, Date.now());
    if (cool.size > 500) cool.delete(cool.keys().next().value);
  }

  try {
    if (def.owner && !ctx.isOwner) { await ctx.reply('⊘ Command ini khusus owner.'); return true; }
    if (def.group && !ctx.isGroup) { await ctx.reply('⊘ Command ini hanya bisa dipakai di grup.'); return true; }
    if (def.admin && !(ctx.isOwner || (await ctx.isAdminSender()))) { await ctx.reply('⊘ Khusus admin grup.'); return true; }
    if (def.botadmin && !(await H.botIsAdmin(sock, from))) { await ctx.reply('△ Jadikan bot admin grup dulu supaya bisa menjalankan ini.'); return true; }
    await def.run(ctx);
  } catch (e) {
    H.log.error(`.${ctx.cmd}: ${e.message}`);
    await H.safeSend(sock, from, { text: '△ ' + e.message }, { quoted: msg });
  }
  return true;
}

const onParticipants = async (sock, u) => {
  if (await mods.gate.onParticipants(sock, u)) return; // bot sendiri masuk/keluar, atau grup belum disetujui
  const keep = await mods.extra.onParticipants(sock, u).catch(() => u.participants); // antiasing: tendang nomor asing dulu
  if (u.action === 'add' && !keep?.length) return;
  return mods.group.onParticipants(sock, { ...u, participants: keep });
};
const onGroupsUpsert = (sock, groups) => mods.gate.onGroupsUpsert(sock, groups);
const onCall = (sock, calls) => mods.security.onCall(sock, calls);
const onDetected = (sock, from, check) => mods.security.onDetected(sock, from, check);
const catalog = () => primary().map((d) => ({ cmd: '.' + d.name, category: CATS[d.cat], help: d.help, owner: Boolean(d.owner), admin: Boolean(d.admin) }));

// ---------- scheduler ----------
let started = false;
function start(getSock) {
  if (started) return;
  started = true;
  let lastMin = '';
  const t = setInterval(async () => {
    const sock = getSock();
    if (!sock || !sock.user) return;
    const now = H.nowParts();
    const key = now.date + ' ' + now.hm;
    const newMin = key !== lastMin;
    lastMin = key;
    for (const [name, mod] of Object.entries(mods)) {
      try { await mod.tick?.(sock, now, newMin); } catch (e) { H.log.warn(`tick ${name}: ${e.message}`); }
    }
  }, 20000);
  t.unref?.();
}

module.exports = { handle, onParticipants, onGroupsUpsert, onCall, onDetected, start, catalog, registry, menuText };

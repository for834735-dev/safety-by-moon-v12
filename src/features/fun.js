const fs = require('fs');
const path = require('path');
const kv = require('../kv');
const H = require('./helpers');

const F = () => kv.ns('fun', {
  rem: [], todo: {}, water: {}, score: {},
  pfp: { on: false, every: 6, next: 0, i: 0 },
  status: { on: false, every: 60, next: 0, i: 0, texts: [] },
  quote: { at: '', last: '', groups: [] },
});

const QUOTES = [
  'Mulai saja dulu, sempurnakan sambil jalan.', 'Konsisten kecil lebih kuat daripada semangat sesaat.',
  'Gagal itu data, bukan vonis.', 'Yang penting bukan cepat, tapi tidak berhenti.',
  'Hari ini adalah versi terbaik untuk memulai.', 'Tenang, semua orang punya jadwal tumbuhnya sendiri.',
  'Kerjakan yang bisa dikerjakan hari ini.', 'Disiplin adalah bentuk sayang pada diri di masa depan.',
  'Rezeki tidak tertukar, usaha tidak boleh kendor.', 'Jangan bandingkan bab 1 kamu dengan bab 20 orang lain.',
  'Istirahat itu bagian dari proses, bukan kemunduran.', 'Sedikit demi sedikit, lama-lama jadi bukit.',
  'Masalah besar dipecah jadi langkah kecil.', 'Percaya proses, tapi tetap jalan.',
  'Belajar dari kemarin, fokus di hari ini, siapkan besok.', 'Ucapan terima kasih itu murah tapi mahal artinya.',
  'Kamu sudah sejauh ini, jangan menyerah sekarang.', 'Bahagia itu dilatih, bukan ditunggu.',
  'Kebiasaan baik dimulai dari satu hari yang mau dimulai.', 'Fokus pada apa yang bisa kamu kendalikan.',
];

const WORDS = [
  ['komputer', 'perangkat elektronik'], ['keyboard', 'alat ketik komputer'], ['jendela', 'ada di dinding rumah'],
  ['sepeda', 'kendaraan roda dua tanpa mesin'], ['pelangi', 'muncul setelah hujan'], ['nasi goreng', 'makanan'],
  ['universitas', 'tempat kuliah'], ['bulan', 'terlihat di malam hari'], ['handphone', 'alat komunikasi'],
  ['kucing', 'hewan peliharaan mengeong'], ['perpustakaan', 'tempat banyak buku'], ['matahari', 'sumber cahaya siang'],
  ['gunung', 'tinggi, bisa didaki'], ['pantai', 'ada pasir dan ombak'], ['sekolah', 'tempat belajar'],
  ['telepon', 'untuk menelepon'], ['lampu', 'menerangi ruangan'], ['payung', 'pelindung hujan'],
  ['kacamata', 'membantu penglihatan'], ['televisi', 'menampilkan siaran'], ['bandara', 'tempat pesawat mendarat'],
  ['dokter', 'profesi kesehatan'], ['kulkas', 'penyimpan dingin'], ['motor', 'kendaraan roda dua bermesin'],
];
const games = new Map();
const scramble = (w) => {
  const a = w.replace(/\s/g, '').split('');
  for (let k = 0; k < 5; k++) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } if (a.join('') !== w.replace(/\s/g, '')) break; }
  return a.join('');
};

const SIGNS = [
  ['capricorn', 12, 22, 1, 19], ['aquarius', 1, 20, 2, 18], ['pisces', 2, 19, 3, 20], ['aries', 3, 21, 4, 19],
  ['taurus', 4, 20, 5, 20], ['gemini', 5, 21, 6, 20], ['cancer', 6, 21, 7, 22], ['leo', 7, 23, 8, 22],
  ['virgo', 8, 23, 9, 22], ['libra', 9, 23, 10, 22], ['scorpio', 10, 23, 11, 21], ['sagitarius', 11, 22, 12, 21],
];
const ALIAS = { kambing: 'capricorn', capricornus: 'capricorn', kendi: 'aquarius', ikan: 'pisces', domba: 'aries', banteng: 'taurus', kembar: 'gemini', kepiting: 'cancer', singa: 'leo', perawan: 'virgo', timbangan: 'libra', kalajengking: 'scorpio', pemanah: 'sagitarius', sagittarius: 'sagitarius' };
function signFrom(input) {
  const s = (input || '').toLowerCase().trim();
  const name = ALIAS[s] || s;
  if (SIGNS.some((x) => x[0] === name)) return name;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [d, mo] = [+m[1], +m[2]];
    for (const [n, m1, d1, m2, d2] of SIGNS) if ((mo === m1 && d >= d1) || (mo === m2 && d <= d2)) return n;
  }
  return null;
}
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function horoscope(sign, date) {
  let seed = hash(sign + date);
  const r = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const love = ['Komunikasi jujur bikin hubungan makin hangat.', 'Beri ruang, jangan terlalu banyak menebak.', 'Ada obrolan ringan yang berarti hari ini.', 'Fokus mencintai diri sendiri dulu.'];
  const work = ['Selesaikan satu tugas menumpuk, lega rasanya.', 'Ide barumu layak disampaikan.', 'Hindari multitasking berlebihan.', 'Kerja sama tim membawa hasil.'];
  const money = ['Tahan belanja impulsif.', 'Catat pengeluaran kecil, lumayan hasilnya.', 'Ada peluang hemat yang bisa diambil.', 'Waktu baik untuk menata anggaran.'];
  return `*${sign[0].toUpperCase() + sign.slice(1)}* — ${date}\n♥ ${love[r(4)]}\n ${work[r(4)]}\n ${money[r(4)]}\n Angka hoki: ${r(90) + 10}\n\n_Hiburan semata, bukan ramalan sungguhan._`;
}

// ---------- kalkulator & konverter ----------
const MATH = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, ln: Math.log, log: Math.log10,
  sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180) };
function calc(src) {
  const s = String(src).toLowerCase().replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/(?<=[\d)])x(?=[\d(])/g, '*').replace(/\s+/g, '');
  let i = 0;
  const bad = () => { throw new Error('Ekspresi tidak valid'); };
  const expr = () => { let v = term(); while (s[i] === '+' || s[i] === '-') { const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; };
  const term = () => { let v = unary(); while (s[i] === '*' || s[i] === '/' || s[i] === '%') { const o = s[i++]; const r = unary(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; };
  const pow = () => { const v = atom(); if (s[i] === '^') { i++; return Math.pow(v, unary()); } return v; };
  const unary = () => { if (s[i] === '-') { i++; return -unary(); } if (s[i] === '+') { i++; return unary(); } return pow(); };
  const atom = () => {
    if (s[i] === '(') { i++; const v = expr(); if (s[i] !== ')') bad(); i++; return v; }
    const n = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i)); if (n) { i += n[0].length; return parseFloat(n[0]); }
    const f = /^[a-z]+/.exec(s.slice(i));
    if (f) {
      i += f[0].length;
      if (f[0] === 'pi') return Math.PI;
      if (f[0] === 'e') return Math.E;
      if (!(f[0] in MATH) || s[i] !== '(') bad();
      i++; const v = expr(); if (s[i] !== ')') bad(); i++; return MATH[f[0]](v);
    }
    return bad();
  };
  if (!s) bad();
  const v = expr(); if (i < s.length) bad();
  if (!Number.isFinite(v)) throw new Error('Hasil tidak terhingga / tidak valid');
  return v;
}
const UNITS = {
  len: { mm: 0.001, cm: 0.01, m: 1, km: 1000, inch: 0.0254, in: 0.0254, ft: 0.3048, yd: 0.9144, mil: 1609.344, mi: 1609.344 },
  mass: { mg: 1e-6, g: 0.001, kg: 1, ton: 1000, oz: 0.0283495, lb: 0.45359237 },
  vol: { ml: 0.001, l: 1, liter: 1, gal: 3.78541, cup: 0.24 },
  data: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 },
  time: { detik: 1, s: 1, menit: 60, jam: 3600, hari: 86400, minggu: 604800 },
  speed: { 'km/j': 1 / 3.6, kmh: 1 / 3.6, mph: 0.44704, 'm/s': 1, knot: 0.514444 },
};
function convert(v, from, to) {
  from = from.toLowerCase(); to = to.toLowerCase();
  if (['c', 'f', 'k'].includes(from) && ['c', 'f', 'k'].includes(to)) {
    const c = from === 'c' ? v : from === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
    return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
  }
  for (const t of Object.values(UNITS)) if (from in t && to in t) return v * t[from] / t[to];
  throw new Error('Satuan tidak dikenal / tidak cocok');
}
const fmt = (n) => (Math.abs(n) >= 1e-4 || n === 0 ? String(+n.toPrecision(10)) : n.toExponential(4));

// ---------- pfp / status ----------
const pfpDir = () => H.ensureDir(path.join(H.DATA, 'pfp'));
async function rotatePfp(sock) {
  const f = F(); const files = fs.readdirSync(pfpDir()).filter((x) => /\.(jpe?g|png)$/i.test(x));
  if (!files.length) return false;
  f.pfp.i = (f.pfp.i + 1) % files.length;
  await sock.updateProfilePicture(H.toJid(H.num(sock.user.id)), fs.readFileSync(path.join(pfpDir(), files[f.pfp.i])));
  return true;
}
async function rotateStatus(sock) {
  const f = F();
  const up = Math.round(process.uptime() / 3600);
  const pool = [...f.status.texts, 'Safety Your WhatsApp aktif', `Online ${up} jam`, ' ' + QUOTES[H.rnd(0, QUOTES.length - 1)]];
  f.status.i = (f.status.i + 1) % pool.length;
  await sock.updateProfileStatus(pool[f.status.i].slice(0, 139));
}

async function onMessage(ctx) {
  const g = games.get(ctx.from);
  if (!g || !ctx.text || ctx.text.startsWith('.')) return false;
  if (ctx.text.trim().toLowerCase() !== g.answer) return false;
  games.delete(ctx.from);
  const id = H.num(ctx.sender);
  const f = F(); const sb = (f.score[ctx.from] ||= {}); sb[id] = (sb[id] || 0) + 1; kv.save();
  await ctx.say(`@${id} benar! Jawabannya *${g.answer}*\nSkor kamu: ${sb[id]}`, [ctx.sender]);
  return true;
}

async function tick(sock, now, newMin) {
  const f = F();
  const due = f.rem.filter((r) => r.at <= Date.now());
  if (due.length) {
    f.rem = f.rem.filter((r) => r.at > Date.now()); kv.save();
    for (const r of due) await H.safeSend(sock, r.jid, { text: ` @${H.num(r.who)} pengingat: ${r.text}`, mentions: [r.who] });
  }
  for (const [jid, g] of games) if (g.exp < Date.now()) { games.delete(jid); await H.safeSend(sock, jid, { text: `◌ Waktu habis! Jawabannya: *${g.answer}*` }); }
  for (const [jid, w] of Object.entries(f.water)) if (w.next <= Date.now()) { w.next = Date.now() + w.every * 60000; kv.save(); await H.safeSend(sock, jid, { text: w.text || ' Waktunya minum air, jangan lupa ya!' }); }
  if (f.pfp.on && f.pfp.next <= Date.now()) { f.pfp.next = Date.now() + f.pfp.every * 3600e3; kv.save(); await rotatePfp(sock).catch((e) => H.log.warn('pfp: ' + e.message)); }
  if (f.status.on && f.status.next <= Date.now()) { f.status.next = Date.now() + f.status.every * 60e3; kv.save(); await rotateStatus(sock).catch((e) => H.log.warn('status: ' + e.message)); }
  if (newMin && f.quote.at === now.hm && f.quote.last !== now.date) {
    f.quote.last = now.date; kv.save();
    const q = `*Quotes hari ini*\n"${QUOTES[hash(now.date) % QUOTES.length]}"`;
    for (const j of [H.ownerJid(), ...f.quote.groups].filter(Boolean)) await H.safeSend(sock, j, { text: q });
  }
}

const commands = {
  quotes: { help: 'Quotes acak', run: (c) => c.reply(`"${H.pick(QUOTES)}"`) },
  quotesharian: {
    help: 'Quotes harian otomatis: .quotesharian 06:00 | off | grup (toggle grup ini)', owner: true,
    run: (c) => {
      const q = F().quote; const a = (c.args[0] || '').toLowerCase();
      if (a === 'off') { q.at = ''; kv.save(); return c.reply('Quotes harian OFF'); }
      if (a === 'grup') { if (!c.isGroup) return c.reply('Pakai di dalam grup.'); q.groups = q.groups.includes(c.from) ? q.groups.filter((x) => x !== c.from) : [...q.groups, c.from]; kv.save(); return c.reply(q.groups.includes(c.from) ? 'Grup ini ikut menerima quotes harian.' : 'Grup ini berhenti menerima quotes harian.'); }
      if (!H.validHM(a)) return c.reply(`Format: .quotesharian 06:00\nSekarang: ${q.at || 'OFF'}, grup: ${q.groups.length}`);
      q.at = a; kv.save(); return c.reply(`✓ Quotes dikirim tiap ${a} ke owner${q.groups.length ? ' + grup terdaftar' : ''}.`);
    },
  },
  cuaca: {
    help: 'Cek cuaca: .cuaca <kota>',
    run: async (c) => {
      if (!c.rest) return c.reply('Format: .cuaca Jakarta');
      const j = await H.getJson(`https://wttr.in/${encodeURIComponent(c.rest)}?format=j1&lang=id`);
      const cur = j.current_condition[0]; const area = j.nearest_area?.[0]?.areaName?.[0]?.value || c.rest;
      const day = (d, l) => `${l}: ${d.mintempC}–${d.maxtempC}°C`;
      return c.reply(`*Cuaca ${area}*\n${cur.lang_id?.[0]?.value || cur.weatherDesc[0].value}, ${cur.temp_C}°C (terasa ${cur.FeelsLikeC}°C)\nKelembapan ${cur.humidity}% | Angin ${cur.windspeedKmph} km/j\n${day(j.weather[0], 'Hari ini')}\n${day(j.weather[1], 'Besok')}`);
    },
  },
  sholat: {
    help: 'Jadwal sholat: .sholat <kota>[, negara]', alias: ['jadwalsholat'],
    run: async (c) => {
      const [city, country = 'Indonesia'] = (c.rest || 'Jakarta').split(',').map((x) => x.trim());
      const j = await H.getJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=20`);
      const t = j.data.timings;
      return c.reply(`*Jadwal sholat ${city}*\nSubuh   ${t.Fajr}\nTerbit  ${t.Sunrise}\nDzuhur  ${t.Dhuhr}\nAshar   ${t.Asr}\nMaghrib ${t.Maghrib}\nIsya    ${t.Isha}\n_Metode Kemenag RI_`);
    },
  },
  zodiak: {
    help: 'Zodiak harian: .zodiak <aries|…|17-08>', alias: ['zodiac'],
    run: (c) => { const s = signFrom(c.args[0]); if (!s) return c.reply('Format: .zodiak leo (atau tanggal lahir 17-08)'); return c.reply(horoscope(s, H.nowParts().date)); },
  },
  tebakkata: {
    help: 'Game tebak kata (60 detik) | .nyerah | .skor', alias: ['tebak'],
    run: (c) => {
      if (games.has(c.from)) return c.reply('Masih ada soal aktif! Ketik jawabannya atau .nyerah');
      const [w, hint] = H.pick(WORDS);
      games.set(c.from, { answer: w, exp: Date.now() + 60000 });
      return c.reply(`*Tebak kata*\nHuruf acak: *${scramble(w).toUpperCase()}*\nPetunjuk: ${hint}${w.includes(' ') ? ' (2 kata)' : ''}\nWaktu 60 detik!`);
    },
  },
  nyerah: { help: 'Menyerah di tebak kata', run: (c) => { const g = games.get(c.from); if (!g) return c.reply('Tidak ada game aktif.'); games.delete(c.from); return c.reply(`Jawabannya: *${g.answer}*`); } },
  skor: {
    help: 'Papan skor tebak kata chat ini',
    run: (c) => { const sb = Object.entries(F().score[c.from] || {}).sort((a, b) => b[1] - a[1]).slice(0, 10); return c.say(sb.length ? '*Skor*\n' + sb.map(([n, v], i) => `${i + 1}. @${n} — ${v}`).join('\n') : 'Belum ada skor.', sb.map(([n]) => H.toJid(n))); },
  },
  ingatkan: {
    help: 'Pengingat: .ingatkan <10m|2j|1h> <teks> | .ingatkan list', alias: ['remind'],
    run: (c) => {
      const f = F();
      if ((c.args[0] || '') === 'list') { const l = f.rem.filter((r) => r.who === c.sender); return c.reply(l.length ? l.map((r, i) => `${i + 1}. ${new Date(r.at).toLocaleString('id-ID', { timeZone: H.TZ })} — ${r.text}`).join('\n') : 'Tidak ada pengingat.'); }
      const ms = H.parseDur(c.args[0]); const text = c.args.slice(1).join(' ');
      if (!ms || !text) return c.reply('Format: .ingatkan 30m minum obat\nSatuan: s, m (menit), j (jam), h (hari)');
      f.rem.push({ jid: c.from, who: c.sender, at: Date.now() + ms, text }); kv.save();
      return c.reply(`Oke, diingatkan ${c.args[0]} lagi.`);
    },
  },
  todo: {
    help: 'To-do: .todo add <teks> / (kosong) list / done <n> / del <n> / clear',
    run: (c) => {
      const f = F(); const id = H.num(c.sender); const l = (f.todo[id] ||= []); const a = (c.args[0] || 'list').toLowerCase(); const n = parseInt(c.args[1], 10);
      if (a === 'add') { const t = c.rest.slice(3).trim(); if (!t) return c.reply('Format: .todo add beli galon'); l.push({ t, d: false }); kv.save(); return c.reply(`✓ Ditambah (#${l.length})`); }
      if (a === 'done') { if (!l[n - 1]) return c.reply('Nomor tidak ada.'); l[n - 1].d = true; kv.save(); return c.reply('Selesai ✓'); }
      if (a === 'del') { l.splice(n - 1, 1); kv.save(); return c.reply('Dihapus.'); }
      if (a === 'clear') { f.todo[id] = []; kv.save(); return c.reply('To-do dikosongkan.'); }
      return c.reply(l.length ? '*To-do kamu*\n' + l.map((x, i) => `${i + 1}. ${x.d ? '✓ ~' + x.t + '~' : x.t}`).join('\n') : 'To-do kosong. Tambah: .todo add <teks>');
    },
  },
  hitung: {
    help: 'Kalkulator: .hitung 2*(3+4)^2 (sqrt, sin, log, pi)', alias: ['calc', 'kalkulator'],
    run: (c) => { if (!c.rest) return c.reply('Format: .hitung 12*(3+4)'); return c.reply(`${c.rest} = *${fmt(calc(c.rest))}*`); },
  },
  konversi: {
    help: 'Konversi satuan: .konversi 5 km mi', alias: ['convert'],
    run: (c) => {
      const v = parseFloat((c.args[0] || '').replace(',', '.')); if (isNaN(v) || !c.args[1] || !c.args[2]) return c.reply('Format: .konversi 100 c f\nJenis: panjang, berat, volume, data, waktu, kecepatan, suhu (c/f/k)');
      return c.reply(`${v} ${c.args[1]} = *${fmt(convert(v, c.args[1], c.args[2]))} ${c.args[2]}*`);
    },
  },
  pfp: {
    help: 'Ganti foto profil berkala: .pfp add (reply gambar) / on <jam> / off / now / list', owner: true,
    run: async (c) => {
      const f = F(); const a = (c.args[0] || '').toLowerCase();
      if (a === 'add') {
        const m = H.findMedia(c.msg, ['imageMessage']); if (!m) return c.reply('Reply/kirim gambar dengan .pfp add');
        const buf = await H.ffmpeg(await H.downloadMedia(m), 'jpg', 'jpg', ['-vf', 'scale=640:640:force_original_aspect_ratio=increase,crop=640:640']);
        fs.writeFileSync(path.join(pfpDir(), `${Date.now()}.jpg`), buf); return c.reply('✓ Gambar masuk daftar rotasi.');
      }
      if (a === 'on') { f.pfp.on = true; f.pfp.every = Math.max(1, parseFloat(c.args[1]) || 6); f.pfp.next = Date.now() + 5000; kv.save(); return c.reply(`Foto profil diganti tiap ${f.pfp.every} jam.`); }
      if (a === 'off') { f.pfp.on = false; kv.save(); return c.reply('Rotasi foto profil OFF'); }
      if (a === 'now') return c.reply((await rotatePfp(c.sock)) ? '✓ Foto profil diganti.' : 'Belum ada gambar. Pakai .pfp add');
      return c.reply(`Rotasi: ${f.pfp.on ? `ON tiap ${f.pfp.every} jam` : 'OFF'}\nGambar: ${fs.readdirSync(pfpDir()).length}\n(butuh paket jimp — sudah ada di package.json)`);
    },
  },
  botstatus: {
    help: 'Auto update status/bio: .botstatus on <menit> / off / add <teks> / now', owner: true,
    run: async (c) => {
      const s = F().status; const a = (c.args[0] || '').toLowerCase();
      if (a === 'on') { s.on = true; s.every = Math.max(5, parseInt(c.args[1], 10) || 60); s.next = Date.now() + 5000; kv.save(); return c.reply(`Status diganti tiap ${s.every} menit.`); }
      if (a === 'off') { s.on = false; kv.save(); return c.reply('Auto status OFF'); }
      if (a === 'add') { const t = c.rest.slice(3).trim(); if (!t) return c.reply('Format: .botstatus add Buka 09-21'); s.texts.push(t); kv.save(); return c.reply('Teks status ditambah.'); }
      if (a === 'now') { await rotateStatus(c.sock); return c.reply('✓ Status diperbarui.'); }
      return c.reply(`Auto status: ${s.on ? `ON tiap ${s.every} menit` : 'OFF'}\nTeks kustom: ${s.texts.length}`);
    },
  },
  minum: {
    help: 'Pengingat minum air/obat: .minum on <menit> [teks] / off', alias: ['minumair'],
    run: (c) => {
      const f = F(); const a = (c.args[0] || '').toLowerCase();
      if (a === 'on') { const m = Math.max(15, parseInt(c.args[1], 10) || 60); f.water[c.from] = { every: m, next: Date.now() + m * 60000, text: c.args.slice(2).join(' ') }; kv.save(); return c.reply(`Pengingat tiap ${m} menit di chat ini.`); }
      if (a === 'off') { delete f.water[c.from]; kv.save(); return c.reply('Pengingat dimatikan.'); }
      return c.reply(f.water[c.from] ? `Aktif tiap ${f.water[c.from].every} menit.` : 'Format: .minum on 60 [teks] / .minum off');
    },
  },
};

module.exports = { commands, onMessage, tick, calc, convert, horoscope, signFrom };

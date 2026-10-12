'use strict';
/**
 * Kategori 10 — Hitung & Waktu (7 fitur)
 * diskon · cicilan · bagi · umur · bmi · terbilang · jam
 */
const H = require('./helpers');
const { S } = require('../ui/style');

const money = H.parseMoney;
const Rp = H.rupiah;

// ---------- terbilang ----------
const SATU = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function tiga(n) {
  if (n < 12) return SATU[n];
  if (n < 20) return SATU[n - 10] + ' belas';
  if (n < 100) return SATU[Math.floor(n / 10)] + ' puluh' + (n % 10 ? ' ' + SATU[n % 10] : '');
  if (n < 200) return 'seratus' + (n > 100 ? ' ' + tiga(n - 100) : '');
  if (n < 1000) return SATU[Math.floor(n / 100)] + ' ratus' + (n % 100 ? ' ' + tiga(n % 100) : '');
  return '';
}
function terbilangInt(n) {
  if (BigInt(n) === 0n) return 'nol';
  const units = ['', 'ribu', 'juta', 'miliar', 'triliun', 'kuadriliun'];
  const parts = []; let i = 0; let x = BigInt(n);
  while (x > 0n) { parts.push(Number(x % 1000n)); x /= 1000n; i++; }
  const out = [];
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k]; if (!p) continue;
    out.push(k === 1 && p === 1 ? 'seribu' : tiga(p) + (units[k] ? ' ' + units[k] : ''));
  }
  return out.join(' ').trim();
}
function terbilang(str) {
  const s = String(str).trim().replace(/\s/g, '');
  const neg = s.startsWith('-');
  const clean = s.replace(/^[-+]/, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  if (clean.split('.')[0].length > 18) return null;
  const [i, d] = clean.split('.');
  let t = terbilangInt(BigInt(i));
  if (d) t += ' koma ' + d.split('').map((x) => (x === '0' ? 'nol' : SATU[+x])).join(' ');
  return (neg ? 'minus ' : '') + t;
}

// ---------- tanggal ----------
function parseDate(s = '') {
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  let y; let mo; let d;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; } else if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}
function diffYMD(a, b) {
  let y = b.getUTCFullYear() - a.getUTCFullYear(); let m = b.getUTCMonth() - a.getUTCMonth(); let d = b.getUTCDate() - a.getUTCDate();
  if (d < 0) { m--; d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  return { y, m, d };
}
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const today = () => { const n = H.nowParts(); return parseDate(n.date); };

// ---------- zona waktu ----------
const ZONES = {
  jakarta: ['Asia/Jakarta', 'WIB'], wib: ['Asia/Jakarta', 'WIB'], makassar: ['Asia/Makassar', 'WITA'], wita: ['Asia/Makassar', 'WITA'],
  jayapura: ['Asia/Jayapura', 'WIT'], wit: ['Asia/Jayapura', 'WIT'], singapura: ['Asia/Singapore', 'SGT'], kualalumpur: ['Asia/Kuala_Lumpur', 'MYT'],
  bangkok: ['Asia/Bangkok', 'ICT'], tokyo: ['Asia/Tokyo', 'JST'], seoul: ['Asia/Seoul', 'KST'], beijing: ['Asia/Shanghai', 'CST'],
  delhi: ['Asia/Kolkata', 'IST'], dubai: ['Asia/Dubai', 'GST'], mekkah: ['Asia/Riyadh', 'AST'], istanbul: ['Europe/Istanbul', 'TRT'],
  kairo: ['Africa/Cairo', 'EET'], moskow: ['Europe/Moscow', 'MSK'], london: ['Europe/London', 'UK'], paris: ['Europe/Paris', 'CET'],
  berlin: ['Europe/Berlin', 'CET'], amsterdam: ['Europe/Amsterdam', 'CET'], newyork: ['America/New_York', 'ET'], chicago: ['America/Chicago', 'CT'],
  losangeles: ['America/Los_Angeles', 'PT'], sydney: ['Australia/Sydney', 'AET'], auckland: ['Pacific/Auckland', 'NZT'],
};
function clock(tz) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(/\./g, ':');
}

const commands = {
  diskon: {
    help: 'Hitung harga setelah diskon: .diskon <harga> <persen> [persen ke-2]', alias: ['discount'],
    run: (c) => {
      const p = money(c.args[0]); const d1 = parseFloat(c.args[1]); const d2 = c.args[2] ? parseFloat(c.args[2]) : 0;
      if (!(p >= 0) || !(d1 >= 0 && d1 <= 100) || !(d2 >= 0 && d2 <= 100)) return c.reply('Format: .diskon <harga> <persen> [persen ke-2]\nContoh: .diskon 250rb 30  ·  .diskon 1.200.000 50 20');
      const after = p * (1 - d1 / 100) * (1 - d2 / 100);
      return c.reply([`${S.ok} Hitung diskon`, `${S.dot} Harga awal : ${Rp(p)}`, `${S.dot} Diskon     : ${d1}%${d2 ? ' + ' + d2 + '%' : ''}`, `${S.dot} Hemat      : ${Rp(p - after)} (${H.fmtNum(((p - after) / (p || 1)) * 100, 1)}%)`, `${S.dot} Bayar      : ${Rp(after)}`].join('\n'));
    },
  },
  cicilan: {
    help: 'Simulasi cicilan: .cicilan <pokok> <bunga %/tahun> <bulan> [flat]', alias: ['kredit', 'loan'],
    run: (c) => {
      const P = money(c.args[0]); const r = parseFloat(String(c.args[1]).replace(',', '.')); const n = parseInt(c.args[2], 10);
      const flat = (c.args[3] || '').toLowerCase() === 'flat';
      if (!(P > 0) || !(r >= 0 && r <= 100) || !(n > 0 && n <= 600)) return c.reply('Format: .cicilan <pokok> <bunga %/thn> <bulan> [flat]\nContoh: .cicilan 50jt 12 24  ·  .cicilan 15jt 10 12 flat\nanuitas (bawaan): bunga dihitung dari sisa pokok · flat: dari pokok awal.');
      let monthly;
      if (flat) monthly = P / n + (P * (r / 100) * (n / 12)) / n;
      else { const i = r / 100 / 12; monthly = i ? (P * i) / (1 - Math.pow(1 + i, -n)) : P / n; }
      const total = monthly * n;
      return c.reply([`${S.ok} Simulasi cicilan (${flat ? 'flat' : 'anuitas'})`, `${S.dot} Pokok       : ${Rp(P)}`, `${S.dot} Bunga       : ${r}% / tahun`, `${S.dot} Tenor       : ${n} bulan`, `${S.dot} Per bulan   : ${Rp(monthly)}`, `${S.dot} Total bayar : ${Rp(total)}`, `${S.dot} Total bunga : ${Rp(total - P)}`, `${S.warn} Estimasi; belum termasuk biaya admin/asuransi.`].join('\n'));
    },
  },
  bagi: {
    help: 'Patungan / split bill: .bagi <total> <orang> [pajak%] [servis%]', alias: ['patungan', 'split'],
    run: (c) => {
      const t = money(c.args[0]); const n = parseInt(c.args[1], 10); const tax = parseFloat(c.args[2]) || 0; const svc = parseFloat(c.args[3]) || 0;
      if (!(t > 0) || !(n >= 1 && n <= 500)) return c.reply('Format: .bagi <total> <orang> [pajak%] [servis%]\nContoh: .bagi 480rb 4 10 5');
      const all = t * (1 + (tax + svc) / 100);
      return c.reply([`${S.ok} Patungan`, `${S.dot} Tagihan    : ${Rp(t)}`, (tax || svc) && `${S.dot} + pajak/servis: ${Rp(all - t)}`, `${S.dot} Total      : ${Rp(all)}`, `${S.dot} Jumlah     : ${n} orang`, `${S.dot} Per orang  : ${Rp(Math.ceil(all / n / 100) * 100)} (dibulatkan ke Rp100)`].filter(Boolean).join('\n'));
    },
  },
  umur: {
    help: 'Hitung umur & ulang tahun berikutnya: .umur <tgl-lahir>  (contoh .umur 17-08-2000)', alias: ['age'],
    run: (c) => {
      const b = parseDate(c.args[0] || ''); const now = today();
      if (!b || b > now) return c.reply('Format: .umur <dd-mm-yyyy>\nContoh: .umur 17-08-2000');
      const a = diffYMD(b, now);
      let next = new Date(Date.UTC(now.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
      if (next < now) next = new Date(Date.UTC(now.getUTCFullYear() + 1, b.getUTCMonth(), b.getUTCDate()));
      const days = Math.round((now - b) / 864e5); const left = Math.round((next - now) / 864e5);
      return c.reply([`${S.ok} Umur`, `${S.dot} Umur        : ${a.y} tahun ${a.m} bulan ${a.d} hari`, `${S.dot} Hari lahir  : ${HARI[b.getUTCDay()]}`, `${S.dot} Total hari  : ${days.toLocaleString('id-ID')} hari`, `${S.dot} Ulang tahun : ${left === 0 ? 'hari ini' : left + ' hari lagi'}`].join('\n'));
    },
  },
  bmi: {
    help: 'Indeks massa tubuh: .bmi <berat kg> <tinggi cm>', alias: ['imt'],
    run: (c) => {
      const kg = parseFloat(String(c.args[0]).replace(',', '.')); const cm = parseFloat(String(c.args[1]).replace(',', '.'));
      if (!(kg >= 10 && kg <= 400) || !(cm >= 50 && cm <= 260)) return c.reply('Format: .bmi <berat kg> <tinggi cm>\nContoh: .bmi 65 170');
      const v = kg / Math.pow(cm / 100, 2);
      const cat = v < 17 ? 'Kurus berat' : v < 18.5 ? 'Kurus' : v < 23 ? 'Normal' : v < 25 ? 'Berat badan lebih' : v < 30 ? 'Obesitas I' : 'Obesitas II';
      const lo = 18.5 * Math.pow(cm / 100, 2); const hi = 22.9 * Math.pow(cm / 100, 2);
      return c.reply([`${S.ok} BMI (standar Asia-Pasifik)`, `${S.dot} Nilai    : ${v.toFixed(1)}`, `${S.dot} Kategori: ${cat}`, `${S.dot} Berat ideal: ${lo.toFixed(1)}–${hi.toFixed(1)} kg`, `${S.warn} Hanya gambaran umum, bukan diagnosis medis.`].join('\n'));
    },
  },
  terbilang: {
    help: 'Angka jadi tulisan: .terbilang <angka>  (contoh .terbilang 1.250.000)', alias: ['eja'],
    run: (c) => {
      const t = terbilang(c.args[0] || '');
      if (!t) return c.reply('Format: .terbilang <angka>\nContoh: .terbilang 1250000  ·  .terbilang 3,14');
      const asRp = /^\d[\d.]*$/.test(c.args[0]) ? ` rupiah` : '';
      return c.reply(`${S.ok} ${t.charAt(0).toUpperCase() + t.slice(1)}${asRp}`);
    },
  },
  jam: {
    help: 'Jam dunia: .jam [kota]  (contoh .jam tokyo · .jam semua)', alias: ['waktu', 'worldclock'],
    run: (c) => {
      const k = (c.args[0] || '').toLowerCase().replace(/\s/g, '');
      if (!k) return c.reply(`${S.ok} Jam sekarang\n${['wib', 'wita', 'wit', 'london', 'newyork', 'tokyo'].map((z) => `${S.dot} ${ZONES[z][1].padEnd(5)} ${clock(ZONES[z][0])}`).join('\n')}\n\nKota lain: .jam <kota>  ·  .jam semua`);
      if (k === 'semua') return c.reply(`${S.ok} Jam dunia\n${Object.entries(ZONES).filter(([n], i, a) => a.findIndex(([, v]) => v[0] === ZONES[n][0]) === i).map(([n, v]) => `${S.dot} ${n.padEnd(12)} ${clock(v[0])}`).join('\n')}`);
      if (ZONES[k]) return c.reply(`${S.ok} ${k} (${ZONES[k][1]})\n${clock(ZONES[k][0])}`);
      try { return c.reply(`${S.ok} ${c.args[0]}\n${clock(c.args[0])}`); } catch { return c.reply(`${S.no} Kota/zona tidak dikenal. Coba: ${Object.keys(ZONES).slice(0, 10).join(', ')} … atau .jam semua`); }
    },
  },
};

module.exports = { commands, terbilang, parseDate, diffYMD };

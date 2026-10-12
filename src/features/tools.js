const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const kv = require('../kv');
const H = require('./helpers');

const T = () => kv.ns('tools', { birthdays: [] });

// ---------- info nomor (prefix, bukan data pribadi) ----------
const OPS = {
  Telkomsel: ['0811', '0812', '0813', '0821', '0822', '0823', '0851', '0852', '0853'],
  Indosat: ['0814', '0815', '0816', '0855', '0856', '0857', '0858'],
  XL: ['0817', '0818', '0819', '0859', '0877', '0878'],
  Axis: ['0831', '0832', '0833', '0838'],
  Tri: ['0895', '0896', '0897', '0898', '0899'],
  Smartfren: ['0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889'],
};
const CC = { 62: 'Indonesia', 60: 'Malaysia', 65: 'Singapura', 1: 'AS/Kanada', 44: 'Inggris', 91: 'India', 81: 'Jepang', 82: 'Korea Selatan', 86: 'Tiongkok', 61: 'Australia', 966: 'Arab Saudi', 971: 'UEA', 92: 'Pakistan', 880: 'Bangladesh', 63: 'Filipina', 66: 'Thailand', 84: 'Vietnam', 20: 'Mesir', 90: 'Turki', 49: 'Jerman', 33: 'Prancis', 34: 'Spanyol', 39: 'Italia', 7: 'Rusia', 55: 'Brasil', 234: 'Nigeria', 27: 'Afrika Selatan', 673: 'Brunei', 855: 'Kamboja', 95: 'Myanmar', 977: 'Nepal' };
function parseNumber(input) {
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8') && d.length >= 9) d = '62' + d;
  const cc = [3, 2, 1].map((n) => d.slice(0, n)).find((p) => CC[p]);
  let operator = null;
  if (cc === '62') { const nat = '0' + d.slice(2); operator = Object.keys(OPS).find((k) => OPS[k].includes(nat.slice(0, 4))) || null; }
  return { digits: d, cc, country: cc ? CC[cc] : null, operator };
}

// ---------- plagiarisme sederhana ----------
function shingles(t, n = 3) {
  const w = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const s = new Set();
  for (let i = 0; i <= w.length - n; i++) s.add(w.slice(i, i + n).join(' '));
  return s;
}
function similarity(a, b) {
  const A = shingles(a); const B = shingles(b);
  if (!A.size || !B.size) return { pct: 0, shared: [] };
  const shared = [...A].filter((x) => B.has(x));
  return { pct: Math.round((shared.length / Math.min(A.size, B.size)) * 100), shared };
}

// ---------- host info (dengan blok IP privat) ----------
async function hostInfo(input) {
  const host = input.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (!host || host.length > 253) throw new Error('Host tidak valid');
  const ip = net.isIP(host) ? host : (await require('dns').promises.lookup(host)).address;
  if (H.isPrivateIp(ip)) throw new Error('Alamat privat/lokal tidak diizinkan.');
  const g = await H.getJson(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,org,as,hosting,query`);
  if (g.status !== 'success') throw new Error(g.message || 'Lookup gagal');
  let httpInfo = '';
  if (!net.isIP(host)) {
    try { const r = await fetch('https://' + host, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) }); httpInfo = `\nHTTPS: ${r.status}, server ${r.headers.get('server') || '-'}`; } catch { httpInfo = '\nHTTPS: tidak bisa dihubungi'; }
  }
  return `*${host}*\nIP: ${g.query}\nLokasi: ${[g.city, g.regionName, g.country].filter(Boolean).join(', ')}\nISP: ${g.isp}\nOrg/AS: ${g.org || '-'} / ${g.as || '-'}\nHosting/DC: ${g.hosting ? 'ya' : 'tidak'}${httpInfo}`;
}

// ---------- pdf ----------
const pdfSessions = new Map();
const isPdf = (m) => m?.documentMessage && /pdf/i.test(m.documentMessage.mimetype || '');
async function onMessage(ctx) {
  const key = ctx.from + '|' + ctx.sender;
  const s = pdfSessions.get(key);
  if (!s) return false;
  const m = H.unwrap(ctx.msg.message || {});
  if (!isPdf(m)) return false;
  s.push(await H.downloadMedia({ target: { key: ctx.msg.key, message: m } }));
  await ctx.reply(`PDF ke-${s.length} diterima. Kirim lagi atau ketik *.pdfmerge selesai*`);
  return true;
}
function parsePages(spec, total) {
  const out = new Set();
  for (const p of String(spec).split(',')) {
    const m = p.trim().match(/^(\d+)(?:-(\d+))?$/); if (!m) continue;
    const a = +m[1]; const b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= total) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}
function soffice(buf, inExt, target, extra = []) {
  const dir = H.ensureDir(path.join(require('os').tmpdir(), 'sy-' + Date.now()));
  const inp = path.join(dir, 'in.' + inExt);
  fs.writeFileSync(inp, buf);
  return new Promise((res, rej) => {
    const p = spawn('soffice', ['--headless', ...extra, '--convert-to', target, '--outdir', dir, inp], { stdio: 'ignore' });
    p.on('error', () => { fs.rmSync(dir, { recursive: true, force: true }); rej(new Error('LibreOffice (soffice) tidak ada di perangkat ini. Konversi PDF↔Word butuh LibreOffice — jalankan bot di VPS/PC, bukan Termux.')); });
    p.on('close', () => {
      try { const out = fs.readdirSync(dir).find((f) => f !== 'in.' + inExt); if (!out) throw new Error('Konversi gagal'); res(fs.readFileSync(path.join(dir, out))); } catch (e) { rej(e); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  });
}

async function tick(sock, now, newMin) {
  if (!newMin || now.hm !== '07:00') return;
  const t = T();
  for (const b of t.birthdays) {
    if (b.dd === now.dd && b.mm === now.mm && b.last !== now.date) {
      b.last = now.date; kv.save();
      await H.notifyOwner(sock, `Hari ini ulang tahun *${b.name}*${b.note ? ' (' + b.note + ')' : ''}!\nDraf ucapan: "Selamat ulang tahun ${b.name}! Semoga sehat, bahagia, dan sukses selalu"`);
    }
  }
}

const COLORS = { hitam: '#000000', putih: '#ffffff', emas: '#d4af37', merah: '#c0392b', biru: '#2456c8', hijau: '#1e8449', ungu: '#7d3c98' };
const color = (x, def) => { if (!x) return def; const k = x.toLowerCase(); if (COLORS[k]) return COLORS[k]; const m = k.match(/^#?([0-9a-f]{6})$/); return m ? '#' + m[1] : def; };

const commands = {
  cekno: {
    help: 'Info nomor: .cekno <nomor> (negara, operator, terdaftar WA?)', alias: ['ceknomor'],
    run: async (c) => {
      if (!c.args[0]) return c.reply('Format: .cekno 0812xxxxxxx');
      const p = parseNumber(c.args[0]);
      let wa = '';
      try { const r = await c.sock.onWhatsApp(p.digits + '@s.whatsapp.net'); wa = `\nTerdaftar WhatsApp: ${r?.[0]?.exists ? 'ya' : 'tidak'}`; } catch (_) {}
      return c.reply(`*+${p.digits}*\nNegara: ${p.country || 'tidak dikenali'}\nOperator: ${p.operator || (p.cc === '62' ? 'tidak dikenali' : '-')}${wa}\n_Berdasarkan prefix; nomor yang sudah pindah operator bisa berbeda. Lokasi kota tidak bisa ditentukan dari nomor seluler._`);
    },
  },
  resi: {
    help: 'Cek resi: .resi <kurir> <no resi> (jne, jnt, sicepat, anteraja, pos, tiki, ninja…)',
    run: async (c) => {
      const key = process.env.BINDERBYTE_KEY;
      if (!key) throw new Error('BINDERBYTE_KEY belum diisi di .env (daftar gratis di binderbyte.com).');
      if (!c.args[1]) return c.reply('Format: .resi jne 1234567890');
      const j = await H.getJson(`https://api.binderbyte.com/v1/track?api_key=${key}&courier=${encodeURIComponent(c.args[0].toLowerCase())}&awb=${encodeURIComponent(c.args[1])}`);
      if (j.status !== 200) return c.reply('✕ ' + (j.message || 'Resi tidak ditemukan'));
      const s = j.data.summary; const h = (j.data.history || []).slice(0, 4);
      return c.reply(`*${s.courier}* — ${s.awb}\nStatus: ${s.status}\n${s.desc ? s.desc + '\n' : ''}\n${h.map((x) => `• ${x.date}\n  ${x.desc}`).join('\n')}`);
    },
  },
  kurs: {
    help: 'Kurs mata uang: .kurs [jumlah] [dari] [ke]  (default USD→IDR)',
    run: async (c) => {
      const amt = parseFloat(c.args[0]) || 1; const from = (c.args[1] || 'USD').toUpperCase(); const to = (c.args[2] || 'IDR').toUpperCase();
      const j = await H.getJson('https://open.er-api.com/v6/latest/' + from);
      if (j.result !== 'success' || !j.rates?.[to]) throw new Error('Mata uang tidak dikenal');
      return c.reply(`${amt.toLocaleString('id-ID')} ${from} = *${(amt * j.rates[to]).toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${to}*\n_Kurs tengah, bukan kurs jual/beli bank._`);
    },
  },
  emas: {
    help: 'Estimasi harga emas dunia per gram (IDR)',
    run: async (c) => {
      const [g, fx] = await Promise.all([H.getJson('https://api.gold-api.com/price/XAU'), H.getJson('https://open.er-api.com/v6/latest/USD')]);
      const gram = (g.price / 31.1035) * fx.rates.IDR;
      return c.reply(`*Emas (XAU)*\n$${g.price.toLocaleString('en-US')}/oz ≈ *Rp${Math.round(gram).toLocaleString('id-ID')}/gram*\n_Harga pasar dunia (24K murni), belum termasuk pajak/margin toko — beda dengan harga Antam/Pegadaian._`);
    },
  },
  ip: { help: 'Info IP/website: .ip <ip atau domain>', alias: ['web', 'whois'], run: async (c) => { if (!c.args[0]) return c.reply('Format: .ip google.com'); return c.reply(await hostInfo(c.args[0])); } },
  short: {
    help: 'Perpendek link: .short <url>', alias: ['shortlink'],
    run: async (c) => {
      const u = c.args[0]; if (!/^https?:\/\//i.test(u || '')) return c.reply('Format: .short https://contoh.com/panjang');
      const j = await H.getJson('https://is.gd/create.php?format=json&url=' + encodeURIComponent(u));
      if (!j.shorturl) throw new Error(j.errormessage || 'Gagal memperpendek');
      return c.reply(' ' + j.shorturl);
    },
  },
  qr: {
    help: 'QR code: .qr <teks> [| warna | latar]  (hitam, emas, #ff0000…)',
    run: async (c) => {
      const [text, fg, bg] = c.rest.split('|').map((x) => x.trim()); if (!text) return c.reply('Format: .qr https://contoh.com | emas | hitam');
      const buf = await require('qrcode').toBuffer(text.slice(0, 1000), { width: 512, margin: 2, color: { dark: color(fg, '#000000'), light: color(bg, '#ffffff') } });
      return c.sock.sendMessage(c.from, { image: buf, caption: '✓ QR code' }, { quoted: c.msg });
    },
  },
  tr: {
    help: 'Terjemah otomatis: .tr <kode bahasa> <teks> (atau reply)', alias: ['translate'],
    run: async (c) => {
      const to = (c.args[0] || '').toLowerCase(); let text = c.args.slice(1).join(' ') || H.quotedText(c.msg);
      if (!/^[a-z]{2}(-[a-z]{2,4})?$/.test(to) || !text) return c.reply('Format: .tr en selamat pagi\nKode: id, en, ar, ja, ko, zh-cn, es, fr, de…');
      const j = await H.getJson(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text.slice(0, 1500))}`);
      return c.reply(`(${j[2]} → ${to})\n${j[0].map((x) => x[0]).join('')}`);
    },
  },
  ocr: {
    help: 'Gambar jadi teks: reply gambar + .ocr',
    run: async (c) => {
      const m = H.findMedia(c.msg, ['imageMessage']); if (!m) return c.reply('Reply gambar dengan .ocr');
      const buf = await H.downloadMedia(m);
      const fd = new FormData();
      fd.append('apikey', process.env.OCR_API_KEY || 'helloworld'); fd.append('language', 'eng'); fd.append('OCREngine', '2');
      fd.append('base64Image', 'data:image/jpeg;base64,' + buf.toString('base64'));
      const r = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd });
      const j = await r.json(); const t = j.ParsedResults?.[0]?.ParsedText?.trim();
      if (!t) return c.reply('Teks tidak terbaca' + (j.ErrorMessage ? ` (${[].concat(j.ErrorMessage)[0]})` : '.'));
      return c.reply(' ' + t.slice(0, 3500));
    },
  },
  cekemail: {
    help: 'Cek validitas email (format + MX): .cekemail <email>',
    run: async (c) => {
      const e = (c.args[0] || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return c.reply('✕ Format email tidak valid.');
      const dom = e.split('@')[1].toLowerCase();
      const disp = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com', 'trashmail.com'].includes(dom);
      try { const mx = await require('dns').promises.resolveMx(dom); return c.reply(`✓ Format valid, domain *${dom}* punya ${mx.length} server email (MX).${disp ? '\n△ Domain email sementara/disposable.' : ''}\n_Belum tentu kotak suratnya aktif._`); } catch { return c.reply(`✕ Domain *${dom}* tidak punya MX — kemungkinan email tidak bisa menerima.`); }
    },
  },
  random: {
    help: 'Generator: .random pass [panjang] | angka <min> <max> | pilih a,b,c | koin | dadu', alias: ['acak'],
    run: (c) => {
      const a = (c.args[0] || '').toLowerCase();
      if (a === 'pass') { const n = H.clamp(parseInt(c.args[1], 10) || 16, 6, 64); const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*'; let p = ''; for (let i = 0; i < n; i++) p += set[crypto.randomInt(set.length)]; return c.reply(' ' + p); }
      if (a === 'angka') { const lo = parseInt(c.args[1], 10) || 1; const hi = parseInt(c.args[2], 10) || 100; if (hi <= lo) return c.reply('Max harus > min'); return c.reply(' ' + crypto.randomInt(lo, hi + 1)); }
      if (a === 'pilih') { const o = c.rest.slice(5).split(',').map((x) => x.trim()).filter(Boolean); if (o.length < 2) return c.reply('Format: .random pilih nasi, mie, roti'); return c.reply(' ' + o[crypto.randomInt(o.length)]); }
      if (a === 'koin') return c.reply(crypto.randomInt(2) ? 'Angka' : 'Gambar');
      if (a === 'dadu') return c.reply(' ' + (crypto.randomInt(6) + 1));
      return c.reply('Pilihan: pass [panjang] | angka <min> <max> | pilih a,b,c | koin | dadu');
    },
  },
  ultah: {
    help: 'Pengingat ulang tahun: .ultah add Nama 17-08 [catatan] / list / del <n>', owner: true,
    run: (c) => {
      const t = T(); const a = (c.args[0] || 'list').toLowerCase();
      if (a === 'add') {
        const dm = c.args.find((x, i) => i > 1 && /^\d{1,2}[-/]\d{1,2}$/.test(x)); if (!c.args[1] || !dm) return c.reply('Format: .ultah add Budi 17-08 teman kuliah');
        const [dd, mm] = dm.split(/[-/]/).map((x) => x.padStart(2, '0'));
        t.birthdays.push({ name: c.args.slice(1, c.args.indexOf(dm)).join(' '), dd, mm, note: c.args.slice(c.args.indexOf(dm) + 1).join(' '), last: '' }); kv.save();
        return c.reply(`Tersimpan. Aku ingatkan tiap ${dd}-${mm} jam 07:00.`);
      }
      if (a === 'del') { t.birthdays.splice((parseInt(c.args[1], 10) || 0) - 1, 1); kv.save(); return c.reply('Dihapus.'); }
      return c.reply(t.birthdays.length ? t.birthdays.map((b, i) => `${i + 1}. ${b.name} — ${b.dd}-${b.mm}${b.note ? ' (' + b.note + ')' : ''}`).join('\n') : 'Belum ada data.');
    },
  },
  pdfmerge: {
    help: 'Gabung PDF: .pdfmerge → kirim beberapa PDF → .pdfmerge selesai',
    run: async (c) => {
      const key = c.from + '|' + c.sender; const a = (c.args[0] || '').toLowerCase();
      if (a === 'batal') { pdfSessions.delete(key); return c.reply('Dibatalkan.'); }
      if (a === 'selesai') {
        const s = pdfSessions.get(key); if (!s || s.length < 2) return c.reply('Kirim minimal 2 PDF dulu.');
        pdfSessions.delete(key);
        const { PDFDocument } = require('pdf-lib'); const out = await PDFDocument.create();
        for (const b of s) { const d = await PDFDocument.load(b, { ignoreEncryption: true }); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); }
        return c.sock.sendMessage(c.from, { document: Buffer.from(await out.save()), mimetype: 'application/pdf', fileName: 'gabungan.pdf' }, { quoted: c.msg });
      }
      pdfSessions.set(key, []); return c.reply('Kirim file PDF satu per satu, lalu ketik *.pdfmerge selesai* (atau .pdfmerge batal).');
    },
  },
  pdfsplit: {
    help: 'Potong PDF: reply PDF + .pdfsplit 1-3,5 | semua',
    run: async (c) => {
      const m = H.findMedia(c.msg, ['documentMessage']); if (!m || !isPdf(m.target.message)) return c.reply('Reply file PDF dengan .pdfsplit 1-3,5 (atau "semua")');
      const { PDFDocument } = require('pdf-lib'); const src = await PDFDocument.load(await H.downloadMedia(m), { ignoreEncryption: true });
      const total = src.getPageCount();
      if ((c.args[0] || '').toLowerCase() === 'semua') {
        for (let i = 0; i < Math.min(total, 10); i++) { const d = await PDFDocument.create(); d.addPage((await d.copyPages(src, [i]))[0]); await c.sock.sendMessage(c.from, { document: Buffer.from(await d.save()), mimetype: 'application/pdf', fileName: `halaman-${i + 1}.pdf` }); }
        return total > 10 ? c.reply(`Dikirim 10 halaman pertama dari ${total}.`) : undefined;
      }
      const idx = parsePages(c.args[0] || '', total); if (!idx.length) return c.reply(`PDF ini ${total} halaman. Contoh: .pdfsplit 1-3,5`);
      const d = await PDFDocument.create(); (await d.copyPages(src, idx)).forEach((p) => d.addPage(p));
      return c.sock.sendMessage(c.from, { document: Buffer.from(await d.save()), mimetype: 'application/pdf', fileName: 'potongan.pdf' }, { quoted: c.msg });
    },
  },
  pdf2word: {
    help: 'PDF → Word (reply PDF; butuh LibreOffice)',
    run: async (c) => {
      const m = H.findMedia(c.msg, ['documentMessage']); if (!m || !isPdf(m.target.message)) return c.reply('Reply file PDF dengan .pdf2word');
      const out = await soffice(await H.downloadMedia(m), 'pdf', 'docx:MS Word 2007 XML', ['--infilter=writer_pdf_import']);
      return c.sock.sendMessage(c.from, { document: out, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'hasil.docx' }, { quoted: c.msg });
    },
  },
  word2pdf: {
    help: 'Word → PDF (reply .docx; butuh LibreOffice)',
    run: async (c) => {
      const m = H.findMedia(c.msg, ['documentMessage']); if (!m || !/word|officedocument/i.test(m.node.mimetype || '')) return c.reply('Reply file Word (.docx) dengan .word2pdf');
      const out = await soffice(await H.downloadMedia(m), 'docx', 'pdf');
      return c.sock.sendMessage(c.from, { document: out, mimetype: 'application/pdf', fileName: 'hasil.pdf' }, { quoted: c.msg });
    },
  },
  plagiat: {
    help: 'Cek kemiripan teks: .plagiat teks A ||| teks B',
    run: (c) => {
      const [a, b] = c.rest.split('|||').map((x) => x.trim()); if (!a || !b) return c.reply('Format: .plagiat teks pertama ||| teks kedua');
      const { pct, shared } = similarity(a, b);
      const level = pct >= 70 ? '● sangat mirip' : pct >= 40 ? '● cukup mirip' : pct >= 15 ? '● sedikit mirip' : '● berbeda';
      return c.reply(`Kemiripan: *${pct}%* (${level})\nFrasa sama: ${shared.length}${shared.length ? '\n' + shared.slice(0, 5).map((x) => `• "${x}…"`).join('\n') : ''}\n_Pengecekan sederhana antar dua teks (3-kata), bukan pencarian ke internet._`);
    },
  },
};

module.exports = { commands, onMessage, tick, parseNumber, similarity, parsePages };

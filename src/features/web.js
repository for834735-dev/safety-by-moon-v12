'use strict';
/**
 * Kategori 11 — Jaringan & Web (3 fitur)
 * cekweb · dns · lacakurl
 * Semua permintaan keluar diperiksa agar tidak bisa menyentuh alamat internal server (SSRF).
 */
const dns = require('dns').promises;
const H = require('./helpers');
const { S } = require('../ui/style');

function parseUrl(s = '') {
  const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Hanya http/https.');
  return u;
}

/** GET manual yang memeriksa setiap lompatan redirect. */
async function trace(startUrl, max = 10) {
  const hops = []; let url = parseUrl(startUrl);
  for (let i = 0; i < max; i++) {
    await H.assertPublicHost(url.hostname);
    const t0 = Date.now();
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10000);
    let res;
    try { res = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 SafetyBot' } }); } finally { clearTimeout(timer); }
    hops.push({ url: url.href, status: res.status, ms: Date.now() - t0, res });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); continue; }
    break;
  }
  return hops;
}

const commands = {
  cekweb: {
    help: 'Cek website hidup/mati & kecepatan: .cekweb <alamat>', alias: ['isup', 'cekurlstatus'],
    run: async (c) => {
      if (!c.args[0]) return c.reply('Format: .cekweb <alamat>\nContoh: .cekweb google.com');
      let hops;
      try { hops = await trace(c.args[0]); } catch (e) { return c.reply(`${S.no} ${c.args[0]} tidak bisa dijangkau\n${S.dot} ${e.name === 'AbortError' ? 'waktu habis (10 detik)' : e.message}`); }
      const last = hops[hops.length - 1]; const h = last.res.headers;
      const up = last.status < 500;
      return c.reply([`${up ? S.ok : S.no} ${up ? 'Website aktif' : 'Website bermasalah'}`, `${S.dot} Alamat   : ${last.url}`, `${S.dot} Status   : HTTP ${last.status}`, `${S.dot} Respons  : ${last.ms} ms`, hops.length > 1 && `${S.dot} Redirect : ${hops.length - 1}x`, h.get('server') && `${S.dot} Server   : ${h.get('server')}`, h.get('content-type') && `${S.dot} Tipe     : ${h.get('content-type').split(';')[0]}`, h.get('content-length') && `${S.dot} Ukuran   : ${(h.get('content-length') / 1024).toFixed(0)} KB`].filter(Boolean).join('\n'));
    },
  },
  dns: {
    help: 'Lihat data DNS domain: .dns <domain> [A|AAAA|MX|TXT|NS|CNAME]', alias: ['nslookup'],
    run: async (c) => {
      const host = (c.args[0] || '').replace(/^https?:\/\//i, '').split('/')[0];
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return c.reply('Format: .dns <domain> [jenis]\nContoh: .dns google.com MX');
      const types = c.args[1] ? [c.args[1].toUpperCase()] : ['A', 'AAAA', 'MX', 'NS', 'TXT'];
      const out = [];
      for (const t of types) {
        try {
          const r = await dns.resolve(host, t);
          const rows = r.map((x) => (t === 'MX' ? `${x.priority} ${x.exchange}` : Array.isArray(x) ? x.join('') : typeof x === 'object' ? JSON.stringify(x) : x));
          out.push(`${S.dot} ${t}\n${rows.slice(0, 6).map((x) => '   ' + String(x).slice(0, 120)).join('\n')}`);
        } catch (e) { if (c.args[1]) out.push(`${S.dot} ${t}: tidak ada data`); }
      }
      return c.reply(out.length ? `${S.ok} DNS ${host}\n${out.join('\n')}` : `${S.no} Domain ${host} tidak ditemukan.`);
    },
  },
  lacakurl: {
    help: 'Lihat tujuan asli link pendek (tanpa membukanya): .lacakurl <link>', alias: ['expand', 'unshort'],
    run: async (c) => {
      if (!c.args[0]) return c.reply('Format: .lacakurl <link pendek>\nContoh: .lacakurl bit.ly/xxxx');
      let hops;
      try { hops = await trace(c.args[0]); } catch (e) { return c.reply(`${S.no} ${e.message}`); }
      const lines = hops.map((h, i) => `${i + 1}. [${h.status}] ${h.url.slice(0, 140)}`);
      const final = hops[hops.length - 1].url; const host = new URL(final).hostname;
      return c.reply(`${S.ok} Jalur redirect (${hops.length} langkah)\n${lines.join('\n')}\n\n${S.dot} Tujuan akhir: ${host}\n${S.warn} Jangan masukkan data pribadi bila domain tidak kamu kenal.`);
    },
  },
};

module.exports = { commands, trace };

'use strict';
/**
 * Kategori 16 — OSINT & Investigasi (khusus admin / owner), 10 fitur
 * whoisdom · ssl · subdomain · headers · techstack · username · exif · wayback · blacklist · ioc
 *
 * Semua memakai data yang memang terbuka untuk umum (RDAP, sertifikat TLS, Certificate Transparency,
 * header HTTP, arsip web, DNSBL, profil publik). Tidak ada pemindaian port / eksploitasi.
 */
const tls = require('tls');
const dns = require('dns').promises;
const H = require('./helpers');
const { S, ICON, head, row, foot } = require('../ui/style');

const A = { admin: true };
const ic = ICON.net;
const box = (title, lines) => [head(ic, title), ...lines.filter((x) => x !== null && x !== undefined && x !== '').map(row), foot()].join('\n');
const kvl = (k, v, pad = 11) => (v === null || v === undefined || v === '' ? null : `${S.dot} ${String(k).padEnd(pad)}: ${v}`);
const dstr = (t) => (t ? new Intl.DateTimeFormat('id-ID', { timeZone: H.TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(t)) : null);
const daysTo = (t) => Math.round((new Date(t).getTime() - Date.now()) / 86400000);
const cut = (s, n = 60) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/** Ambil nama domain dari input (domain atau URL). */
function domainOf(input = '') {
  let s = String(input).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
  s = s.replace(/\[\.\]/g, '.').replace(/\.$/, '');
  return /^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,24}$/.test(s) || /^xn--/.test(s) ? s : null;
}
const needDomain = (c, usage) => {
  const d = domainOf(c.args[0]);
  if (!d) throw new Error(`Domain tidak valid.\nFormat: ${usage}`);
  return d;
};

/** fetch aman: ikuti redirect manual, tiap lompatan dicek bukan alamat internal. */
async function safeFetch(url, { method = 'GET', hops = 5, timeout = 12000, maxBytes = 600000 } = {}) {
  const chain = [];
  for (let i = 0; i <= hops; i++) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('Hanya http/https.');
    await H.assertPublicHost(u.hostname);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    let res;
    try { res = await fetch(url, { method, redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 SafetyBot', Accept: 'text/html,*/*' } }); } finally { clearTimeout(t); }
    chain.push({ url, status: res.status });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).href; continue; }
    let body = '';
    if (method === 'GET') {
      const reader = res.body?.getReader(); let got = 0; const parts = [];
      if (reader) {
        while (got < maxBytes) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; }
        reader.cancel().catch(() => {});
      }
      body = Buffer.concat(parts.map((p) => Buffer.from(p))).toString('utf8');
    }
    return { res, body, chain, finalUrl: url };
  }
  throw new Error('Terlalu banyak pengalihan (redirect).');
}
const asUrl = (x) => (/^https?:\/\//i.test(x) ? x : 'https://' + x);

// ---------- EXIF (parser ringkas, tanpa dependensi) ----------
function parseExif(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Bukan file JPEG. EXIF hanya dibaca dari JPEG (kirim foto sebagai Dokumen/File).');
  let off = 2; let tiff = -1;
  while (off + 4 < buf.length) {
    if (buf[off] !== 0xff) break;
    const mk = buf[off + 1]; const len = buf.readUInt16BE(off + 2);
    if (mk === 0xe1 && buf.toString('latin1', off + 4, off + 10) === 'Exif\0\0') { tiff = off + 10; break; }
    if (mk === 0xda) break;
    off += 2 + len;
  }
  if (tiff < 0) return null;
  const le = buf.toString('latin1', tiff, tiff + 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  function readIfd(p) {
    const out = {};
    if (p + 2 > buf.length) return out;
    const n = Math.min(u16(p), 200);
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12; if (e + 12 > buf.length) break;
      const tag = u16(e); const type = u16(e + 2); const cnt = u32(e + 4); const size = (SZ[type] || 1) * cnt;
      const vo = size <= 4 ? e + 8 : tiff + u32(e + 8);
      if (vo + size > buf.length || cnt > 4096) continue;
      let v;
      if (type === 2) v = buf.toString('utf8', vo, vo + cnt).replace(/\0.*$/s, '').trim();
      else if (type === 3) v = Array.from({ length: cnt }, (_, k) => u16(vo + k * 2));
      else if (type === 4) v = Array.from({ length: cnt }, (_, k) => u32(vo + k * 4));
      else if (type === 5) v = Array.from({ length: cnt }, (_, k) => { const d = u32(vo + k * 8 + 4); return d ? u32(vo + k * 8) / d : 0; });
      else if (type === 1) v = Array.from({ length: cnt }, (_, k) => buf[vo + k]);
      else continue;
      out[tag] = Array.isArray(v) && v.length === 1 ? v[0] : v;
    }
    return out;
  }
  const ifd0 = readIfd(tiff + u32(tiff + 4));
  const exif = ifd0[0x8769] ? readIfd(tiff + ifd0[0x8769]) : {};
  const gps = ifd0[0x8825] ? readIfd(tiff + ifd0[0x8825]) : {};
  return { ifd0, exif, gps };
}
const dms = (v, ref) => (Array.isArray(v) && v.length === 3 ? (v[0] + v[1] / 60 + v[2] / 3600) * (/[SW]/i.test(ref) ? -1 : 1) : null);

// ---------- deteksi teknologi ----------
const TECH_HDR = [
  ['server', /cloudflare/i, 'Cloudflare'], ['server', /nginx/i, 'Nginx'], ['server', /apache/i, 'Apache'], ['server', /litespeed/i, 'LiteSpeed'],
  ['server', /microsoft-iis/i, 'Microsoft IIS'], ['server', /caddy/i, 'Caddy'], ['server', /gws|esf/i, 'Google Web Server'], ['server', /vercel/i, 'Vercel'], ['server', /netlify/i, 'Netlify'],
  ['x-powered-by', /php/i, 'PHP'], ['x-powered-by', /express/i, 'Express (Node.js)'], ['x-powered-by', /asp\.net/i, 'ASP.NET'], ['x-powered-by', /next\.js/i, 'Next.js'],
  ['cf-ray', /./, 'Cloudflare'], ['x-vercel-id', /./, 'Vercel'], ['x-github-request-id', /./, 'GitHub Pages'], ['x-amz-cf-id', /./, 'Amazon CloudFront'],
  ['x-served-by', /cache/i, 'Fastly'], ['x-shopify-stage', /./, 'Shopify'], ['x-drupal-cache', /./, 'Drupal'], ['x-wix-request-id', /./, 'Wix'],
];
const TECH_HTML = [
  [/wp-content|wp-includes|wordpress/i, 'WordPress'], [/\/_next\//, 'Next.js'], [/__NUXT__|\/_nuxt\//, 'Nuxt.js'], [/data-reactroot|react(?:\.production|-dom)/i, 'React'],
  [/ng-version=|ng-app/i, 'Angular'], [/vue(?:\.runtime|\.min)?\.js|data-v-[0-9a-f]{6}/i, 'Vue.js'], [/svelte/i, 'Svelte'], [/cdn\.shopify\.com/i, 'Shopify'],
  [/content="Joomla/i, 'Joomla'], [/Drupal\.settings|content="Drupal/i, 'Drupal'], [/static\.wixstatic\.com/i, 'Wix'], [/squarespace/i, 'Squarespace'],
  [/jquery(?:\.min)?\.js|jquery-\d/i, 'jQuery'], [/bootstrap(?:\.min)?\.(?:css|js)/i, 'Bootstrap'], [/tailwind/i, 'Tailwind CSS'],
  [/googletagmanager\.com\/gtm/i, 'Google Tag Manager'], [/google-analytics\.com|gtag\(/i, 'Google Analytics'], [/connect\.facebook\.net.*fbevents|fbq\(/i, 'Meta Pixel'],
  [/fonts\.googleapis\.com/i, 'Google Fonts'], [/cdnjs\.cloudflare\.com/i, 'cdnjs'], [/recaptcha/i, 'reCAPTCHA'], [/hcaptcha/i, 'hCaptcha'], [/laravel/i, 'Laravel'],
  [/woocommerce/i, 'WooCommerce'], [/elementor/i, 'Elementor'], [/livewire/i, 'Livewire'], [/alpine(?:\.min)?\.js|x-data=/i, 'Alpine.js'], [/gatsby/i, 'Gatsby'], [/astro-island|astro-/i, 'Astro'],
];

// ---------- username ----------
const SITES = [
  ['GitHub', 'https://github.com/{u}'], ['GitLab', 'https://gitlab.com/{u}'], ['Bitbucket', 'https://bitbucket.org/{u}/'],
  ['DEV', 'https://dev.to/{u}'], ['Medium', 'https://medium.com/@{u}'], ['Replit', 'https://replit.com/@{u}'], ['CodePen', 'https://codepen.io/{u}'],
  ['Keybase', 'https://keybase.io/{u}'], ['HackerNews', 'https://hacker-news.firebaseio.com/v0/user/{u}.json', 'https://news.ycombinator.com/user?id={u}', 'json'],
  ['Gravatar', 'https://en.gravatar.com/{u}.json', 'https://gravatar.com/{u}'], ['Chess.com', 'https://api.chess.com/pub/player/{u}', 'https://www.chess.com/member/{u}'],
  ['Lichess', 'https://lichess.org/api/user/{u}', 'https://lichess.org/@/{u}'], ['PyPI', 'https://pypi.org/user/{u}/'], ['Docker Hub', 'https://hub.docker.com/v2/users/{u}/', 'https://hub.docker.com/u/{u}'],
  ['Telegram', 'https://t.me/{u}', null, 'has:tgme_page_title'], ['Steam', 'https://steamcommunity.com/id/{u}', null, 'not:The specified profile could not be found'],
  ['Linktree', 'https://linktr.ee/{u}'], ['Pastebin', 'https://pastebin.com/u/{u}'], ['Wikipedia', 'https://en.wikipedia.org/wiki/User:{u}'],
  ['SoundCloud', 'https://soundcloud.com/{u}'], ['Codeforces', 'https://codeforces.com/profile/{u}'], ['Roblox', 'https://www.roblox.com/user.aspx?username={u}'],
];
async function checkSite([name, api, pub, rule], u) {
  const url = api.replace('{u}', encodeURIComponent(u)); const shown = (pub || api).replace('{u}', encodeURIComponent(u));
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 SafetyBot' } });
    if (r.status === 404) return { name, state: 'no' };
    if (!r.ok) return { name, state: 'unk' };
    if (rule === 'json') { const j = await r.json().catch(() => null); return { name, state: j ? 'yes' : 'no', url: shown }; }
    if (rule) { const txt = (await r.text()).slice(0, 400000); const [k, v] = rule.split(/:(.*)/s); const has = txt.includes(v); return { name, state: (k === 'has') === has ? 'yes' : 'no', url: shown }; }
    return { name, state: 'yes', url: shown };
  } catch { return { name, state: 'unk' }; } finally { clearTimeout(t); }
}

// ---------- DNSBL ----------
const ZONES = ['zen.spamhaus.org', 'bl.spamcop.net', 'b.barracudacentral.org', 'dnsbl.dronebl.org', 'psbl.surriel.com', 'all.s5h.net', 'dnsbl-1.uceprotect.net', 'dyna.spamrats.com'];

const commands = {
  whoisdom: {
    help: 'Data registrasi domain (RDAP): .whoisdom <domain>', ...A, alias: ['rdap', 'domaininfo'],
    run: async (c) => {
      const d = needDomain(c, '.whoisdom google.com');
      const j = await H.getJson(`https://rdap.org/domain/${d}`, { timeout: 20000, headers: { Accept: 'application/rdap+json' } });
      const ev = (a) => j.events?.find((e) => e.eventAction === a)?.eventDate;
      const reg = j.entities?.find((e) => e.roles?.includes('registrar'));
      const fn = reg?.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3];
      const exp = ev('expiration');
      return c.reply(box('Whois Domain', [
        kvl('Domain', j.ldhName || d), kvl('Registrar', fn), kvl('Status', (j.status || []).slice(0, 4).join(', ')),
        kvl('Dibuat', dstr(ev('registration'))), kvl('Diubah', dstr(ev('last changed'))),
        kvl('Kedaluwarsa', exp ? `${dstr(exp)} (${daysTo(exp)} hari lagi)` : null),
        kvl('Nameserver', (j.nameservers || []).slice(0, 4).map((n) => n.ldhName?.toLowerCase()).join(', ')),
        kvl('DNSSEC', j.secureDNS ? (j.secureDNS.delegationSigned ? 'aktif' : 'tidak aktif') : null),
        `${S.dot} Data pribadi pemilik biasanya disembunyikan (privasi GDPR).`,
      ]));
    },
  },
  ssl: {
    help: 'Info sertifikat SSL/TLS: .ssl <domain>', ...A, alias: ['cert', 'sertifikat'],
    run: async (c) => {
      const d = needDomain(c, '.ssl google.com');
      await H.assertPublicHost(d);
      const cert = await new Promise((resolve, reject) => {
        const s = tls.connect({ host: d, port: 443, servername: d, rejectUnauthorized: false, timeout: 9000 }, () => {
          const x = s.getPeerCertificate(); const out = { x, proto: s.getProtocol(), ok: s.authorized, err: s.authorizationError }; s.end(); resolve(out);
        });
        s.on('timeout', () => { s.destroy(); reject(new Error('Koneksi TLS timeout.')); });
        s.on('error', (e) => reject(new Error('Gagal terhubung: ' + e.message)));
      });
      const x = cert.x; if (!x?.subject) throw new Error('Sertifikat tidak ditemukan.');
      const left = daysTo(x.valid_to);
      const san = String(x.subjectaltname || '').split(', ').map((s) => s.replace(/^DNS:/, '')).filter(Boolean);
      return c.reply(box('Sertifikat SSL', [
        kvl('Domain', d), kvl('Subjek', x.subject.CN), kvl('Penerbit', [x.issuer?.O, x.issuer?.CN].filter(Boolean).join(' / ')),
        kvl('Berlaku', `${dstr(x.valid_from)} → ${dstr(x.valid_to)}`),
        kvl('Sisa', `${left} hari ${left < 0 ? '(KEDALUWARSA)' : left < 15 ? '(segera habis)' : ''}`.trim()),
        kvl('Protokol', cert.proto), kvl('Dipercaya', cert.ok ? 'ya' : `tidak (${cert.err})`),
        kvl('Kunci', x.bits ? `${x.asn1Curve || x.nistCurve || 'RSA'} ${x.bits} bit` : null),
        kvl('SAN', `${san.length} nama${san.length ? ': ' + san.slice(0, 5).join(', ') + (san.length > 5 ? '…' : '') : ''}`),
        kvl('Sidik jari', cut(x.fingerprint256 || '', 47)),
      ]));
    },
  },
  subdomain: {
    help: 'Cari subdomain dari Certificate Transparency: .subdomain <domain>', ...A, alias: ['subs', 'subdom'],
    run: async (c) => {
      const d = needDomain(c, '.subdomain contoh.com');
      await c.reply(`${S.wait} Mencari subdomain ${d} (bisa 10–30 detik)...`);
      let names = new Set();
      try {
        const j = await H.getJson(`https://crt.sh/?q=%25.${d}&output=json`, { timeout: 30000 });
        for (const r of j) for (const n of String(r.name_value).split('\n')) names.add(n.toLowerCase());
      } catch (_) {
        const j = await H.getJson(`https://api.certspotter.com/v1/issuances?domain=${d}&include_subdomains=true&expand=dns_names`, { timeout: 25000 });
        for (const r of j) for (const n of r.dns_names || []) names.add(n.toLowerCase());
      }
      names = [...names].filter((n) => !n.startsWith('*') && n.endsWith(d) && !/\s/.test(n)).sort();
      if (!names.length) return c.reply(`${S.dot} Tidak ada subdomain tercatat di log sertifikat untuk ${d}.`);
      return c.reply(box(`Subdomain (${names.length})`, [...names.slice(0, 40).map((n) => `${S.arrow} ${n}`), names.length > 40 ? `… dan ${names.length - 40} lainnya` : null, `${S.dot} Sumber: log sertifikat publik (tidak mencakup yang tak pernah punya SSL).`]));
    },
  },
  headers: {
    help: 'Audit header keamanan website: .headers <alamat>', ...A, alias: ['hdr', 'secheaders'],
    run: async (c) => {
      if (!c.args[0]) return c.reply('Format: .headers contoh.com');
      const r = await safeFetch(asUrl(c.args[0]), { method: 'GET', maxBytes: 1000 });
      const h = r.res.headers;
      const CHECK = [['strict-transport-security', 'HSTS'], ['content-security-policy', 'CSP'], ['x-frame-options', 'Anti-clickjacking'], ['x-content-type-options', 'Anti-MIME sniff'], ['referrer-policy', 'Referrer-Policy'], ['permissions-policy', 'Permissions-Policy'], ['cross-origin-opener-policy', 'COOP']];
      const got = CHECK.filter(([k]) => h.get(k)); const score = Math.round((got.length / CHECK.length) * 100);
      const leak = ['server', 'x-powered-by', 'x-aspnet-version'].filter((k) => h.get(k)).map((k) => `${k}: ${cut(h.get(k), 30)}`);
      return c.reply(box('Header Keamanan', [
        kvl('URL akhir', cut(r.finalUrl, 50)), kvl('Status', r.res.status), kvl('Skor', `${score}/100 (${got.length}/${CHECK.length} header)`),
        ...CHECK.map(([k, n]) => `${h.get(k) ? S.ok : S.no} ${n}`),
        leak.length ? `${S.warn} Bocor info: ${leak.join(' | ')}` : `${S.ok} Tidak membocorkan versi server`,
        r.chain.length > 1 ? kvl('Redirect', `${r.chain.length - 1}x`) : null,
      ]));
    },
  },
  techstack: {
    help: 'Deteksi teknologi website: .techstack <alamat>', ...A, alias: ['tech', 'wappalyzer'],
    run: async (c) => {
      if (!c.args[0]) return c.reply('Format: .techstack contoh.com');
      const r = await safeFetch(asUrl(c.args[0]));
      const found = new Set();
      for (const [k, re, n] of TECH_HDR) if (re.test(r.res.headers.get(k) || '')) found.add(n);
      const ck = r.res.headers.get('set-cookie') || '';
      if (/PHPSESSID/.test(ck)) found.add('PHP'); if (/laravel_session/.test(ck)) found.add('Laravel'); if (/JSESSIONID/.test(ck)) found.add('Java'); if (/csrftoken|django/i.test(ck)) found.add('Django');
      for (const [re, n] of TECH_HTML) if (re.test(r.body)) found.add(n);
      const gen = r.body.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{2,60})/i)?.[1];
      const title = r.body.match(/<title[^>]*>([^<]{1,90})/i)?.[1]?.trim();
      return c.reply(box('Teknologi Website', [
        kvl('URL', cut(r.finalUrl, 50)), kvl('Judul', title), kvl('Generator', gen),
        kvl('Terdeteksi', found.size ? [...found].join(', ') : 'tidak ada yang dikenali'),
        `${S.dot} Deteksi berbasis tanda terlihat (header/HTML); bisa meleset.`,
      ]));
    },
  },
  username: {
    help: 'Cek username di 22 platform publik: .username <nama>', ...A, alias: ['cariuser', 'sherlock'],
    run: async (c) => {
      const u = (c.args[0] || '').replace(/^@/, '');
      if (!/^[A-Za-z0-9._-]{2,32}$/.test(u)) return c.reply('Format: .username namauser\n(2–32 karakter: huruf, angka, titik, strip, garis bawah)');
      await c.reply(`${S.wait} Memeriksa *${u}* di ${SITES.length} platform...`);
      const res = []; const q = [...SITES];
      await Promise.all(Array.from({ length: 8 }, async () => { while (q.length) res.push(await checkSite(q.shift(), u)); }));
      const yes = res.filter((r) => r.state === 'yes'); const unk = res.filter((r) => r.state === 'unk');
      return c.reply(box(`Username: ${u}`, [
        ...(yes.length ? yes.map((r) => `${S.ok} ${r.name}\n   ${r.url}`) : [`${S.dot} Tidak ditemukan di platform yang dicek.`]),
        kvl('Tidak ada', res.filter((r) => r.state === 'no').length), unk.length ? kvl('Tak terjawab', `${unk.length} (${unk.map((r) => r.name).join(', ')})`) : null,
        `${S.warn} Nama sama belum tentu orang yang sama. Cek manual sebelum menyimpulkan.`,
      ]));
    },
  },
  exif: {
    help: 'Baca metadata foto (kamera, waktu, GPS): reply foto JPEG yang dikirim sebagai Dokumen + .exif', ...A, alias: ['metadata'],
    run: async (c) => {
      const m = H.findMedia(c.msg, ['documentMessage', 'imageMessage']);
      if (!m) return c.reply('Reply foto yang dikirim sebagai *Dokumen/File* dengan .exif\n_Foto biasa dikompres WhatsApp & metadatanya otomatis dihapus._');
      const buf = await H.downloadMedia(m);
      const x = parseExif(buf);
      if (!x) return c.reply(`${S.dot} Tidak ada metadata EXIF di file ini (mungkin sudah dibersihkan atau dikompres WhatsApp).`);
      const { ifd0: a, exif: e, gps: g } = x;
      const lat = dms(g[2], g[1]); const lon = dms(g[4], g[3]);
      const fr = (v) => (v ? (v < 1 ? `1/${Math.round(1 / v)}` : String(v)) : null);
      return c.reply(box('Metadata Foto', [
        kvl('Kamera', [a[0x010f], a[0x0110]].filter(Boolean).join(' ')), kvl('Lensa', e[0xa434]), kvl('Software', a[0x0131]),
        kvl('Diambil', e[0x9003] || a[0x0132]), kvl('Ukuran', e[0xa002] && e[0xa003] ? `${e[0xa002]}×${e[0xa003]}` : null),
        kvl('Eksposur', fr(e[0x829a]) ? `${fr(e[0x829a])}s  f/${e[0x829d] ? e[0x829d].toFixed(1) : '?'}  ISO ${e[0x8827] ?? '?'}` : null),
        kvl('Fokal', e[0x920a] ? `${Math.round(e[0x920a])} mm` : null),
        lat !== null && lon !== null ? kvl('GPS', `${lat.toFixed(6)}, ${lon.toFixed(6)}`) : `${S.dot} GPS        : tidak ada`,
        lat !== null && lon !== null ? `${S.arrow} https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}` : null,
        `${S.warn} Metadata ini terlihat oleh siapa pun yang menerima file asli. Hapus sebelum membagikan foto pribadi.`,
      ]));
    },
  },
  wayback: {
    help: 'Arsip website di Wayback Machine: .wayback <alamat>', ...A, alias: ['arsip', 'archive'],
    run: async (c) => {
      if (!c.args[0]) return c.reply('Format: .wayback contoh.com');
      const target = c.args[0].replace(/^https?:\/\//i, '');
      const q = encodeURIComponent(target);
      const [first, last] = await Promise.all([
        H.getJson(`https://web.archive.org/cdx/search/cdx?url=${q}&output=json&limit=1&fl=timestamp,statuscode`, { timeout: 25000 }),
        H.getJson(`https://web.archive.org/cdx/search/cdx?url=${q}&output=json&limit=-1&fl=timestamp,statuscode`, { timeout: 25000 }),
      ]);
      if (!first?.[1]) return c.reply(`${S.dot} Belum ada arsip untuk ${target}.`);
      const fmt = (ts) => `${ts.slice(6, 8)}-${ts.slice(4, 6)}-${ts.slice(0, 4)}`;
      const f = first[1]; const l = last?.[1] || f;
      return c.reply(box('Arsip Web', [
        kvl('Alamat', cut(target, 50)), kvl('Pertama', `${fmt(f[0])} (HTTP ${f[1]})`), kvl('Terakhir', `${fmt(l[0])} (HTTP ${l[1]})`),
        `${S.arrow} https://web.archive.org/web/${f[0]}/${target}`, `${S.arrow} https://web.archive.org/web/${l[0]}/${target}`,
      ]));
    },
  },
  blacklist: {
    help: 'Cek IP/domain di daftar hitam spam (DNSBL): .blacklist <ip atau domain>', ...A, alias: ['dnsbl', 'cekblacklist'],
    run: async (c) => {
      const t = (c.args[0] || '').trim(); if (!t) return c.reply('Format: .blacklist 1.2.3.4  atau  .blacklist contoh.com');
      let ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(t) ? t : null;
      if (!ip) { const d = domainOf(t); if (!d) return c.reply('Masukkan IPv4 atau domain yang valid.'); ip = (await dns.lookup(d, { family: 4 })).address; }
      if (ip.split('.').some((o) => +o > 255) || H.isPrivateIp(ip)) return c.reply('Alamat IP tidak valid / privat.');
      const rev = ip.split('.').reverse().join('.');
      const resolver = new dns.Resolver({ timeout: 4000, tries: 1 });
      const out = await Promise.all(ZONES.map(async (z) => {
        try { const r = await resolver.resolve4(`${rev}.${z}`); return /^127\.255\.255\./.test(r[0]) ? { z, s: 'unk' } : { z, s: 'listed' }; } catch (e) { return { z, s: e.code === 'ENOTFOUND' || e.code === 'ENODATA' ? 'clean' : 'unk' }; }
      }));
      const bad = out.filter((x) => x.s === 'listed').length;
      return c.reply(box('Cek Daftar Hitam', [
        kvl('IP', ip), kvl('Hasil', bad ? `TERDAFTAR di ${bad}/${ZONES.length} daftar` : `bersih di ${out.filter((x) => x.s === 'clean').length}/${ZONES.length} daftar`),
        ...out.map((x) => `${x.s === 'listed' ? S.no : x.s === 'clean' ? S.ok : S.wait} ${x.z}${x.s === 'unk' ? ' (tak terjawab)' : ''}`),
        `${S.dot} Beberapa daftar menolak resolver publik; "tak terjawab" bukan berarti bersih.`,
      ]));
    },
  },
  ioc: {
    help: 'Ekstrak IP, URL, domain, email, hash, CVE dari teks: .ioc <teks> atau reply pesan', ...A, alias: ['ekstrak', 'extractioc'],
    run: async (c) => {
      let t = c.rest || H.quotedText(c.msg);
      if (!t) return c.reply('Tempel teks setelah .ioc, atau reply pesan yang mau dianalisis.');
      t = t.replace(/hxxp/gi, 'http').replace(/\[\.\]|\(\.\)|\[dot\]/gi, '.').replace(/\[@\]|\[at\]/gi, '@');
      const uniq = (a) => [...new Set(a)];
      const urls = uniq(t.match(/https?:\/\/[^\s<>"')]+/gi) || []);
      const emails = uniq((t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((x) => x.toLowerCase()));
      const ips = uniq((t.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []).filter((x) => x.split('.').every((o) => +o <= 255)));
      const hashes = uniq(t.match(/\b(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40}|[a-fA-F0-9]{32})\b/g) || []);
      const cves = uniq((t.match(/CVE-\d{4}-\d{4,7}/gi) || []).map((x) => x.toUpperCase()));
      const crypto = uniq(t.match(/\b(?:0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g) || []);
      const skip = new Set([...emails.map((e) => e.split('@')[1]), ...ips]);
      const doms = uniq([...(t.match(/\b(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}\b/gi) || []), ...urls.map((u) => { try { return new URL(u).hostname; } catch { return ''; } })].map((x) => x.toLowerCase()).filter((x) => x && !skip.has(x) && domainOf(x) && !/\.(png|jpe?g|gif|js|css|html?|php|txt|pdf|zip)$/.test(x)));
      const sec = (n, a) => (a.length ? [`${S.arrow} ${n} (${a.length})`, ...a.slice(0, 12).map((x) => `   ${cut(x, 64)}`), a.length > 12 ? `   … +${a.length - 12}` : null] : []);
      const total = urls.length + emails.length + ips.length + hashes.length + cves.length + crypto.length + doms.length;
      if (!total) return c.reply(`${S.dot} Tidak ada indikator (IP/URL/domain/email/hash) yang ditemukan.`);
      return c.reply(box(`Indikator (${total})`, [...sec('IP', ips), ...sec('URL', urls), ...sec('Domain', doms), ...sec('Email', emails), ...sec('Hash', hashes), ...sec('CVE', cves), ...sec('Wallet', crypto), `${S.dot} Format yang diobfuskasi (hxxp, [.]) otomatis dibersihkan.`]));
    },
  },
};

module.exports = { commands, domainOf, parseExif };

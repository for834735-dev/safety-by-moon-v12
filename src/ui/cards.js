'use strict';
/**
 * Mesin kartu gambar (welcome, farewell, bot aktif). Dibuat dengan @napi-rs/canvas.
 *
 * Desain: latar dari foto profil yang diburamkan + cahaya warna aksen yang diambil dari foto itu sendiri,
 * panel kaca, foto bulat berbingkai gradien, nama besar, dan chip info. Tanpa emoji: ikon digambar
 * sebagai bentuk vektor sehingga tidak bergantung pada font di server.
 */
const { fontFamily } = require('./fonts');

const W = 1280;
const H = 720;

// ---------- tema ----------
const THEMES = {
  aurora: { name: 'Aurora', bg: ['#060a1c', '#101a42'], a1: '#8b6dff', a2: '#22d3ee' },
  emas: { name: 'Emas', bg: ['#0a0a0a', '#1a1408'], a1: '#f2e2b6', a2: '#d9a94a' },
  zamrud: { name: 'Zamrud', bg: ['#031210', '#082a22'], a1: '#34d399', a2: '#a7f3d0' },
  senja: { name: 'Senja', bg: ['#180914', '#2e1024'], a1: '#fb7185', a2: '#fbbf24' },
  samudra: { name: 'Samudra', bg: ['#03111e', '#0a2540'], a1: '#38bdf8', a2: '#818cf8' },
};
const THEME_KEYS = ['otomatis', ...Object.keys(THEMES)];

// ---------- warna ----------
function hsl(h, s, l, a = 1) { return `hsla(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`; }
function rgbToHue(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
  if (!d) return { h: 0, s: 0 };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { h, s: d / (1 - Math.abs(2 * ((mx + mn) / 2) - 1) || 1) };
}
/** Warna dominan foto -> tema dengan warna sama. */
function themeFromImage(ctxFactory, img) {
  const t = ctxFactory(48, 48); const c = t.getContext('2d');
  c.drawImage(img, 0, 0, 48, 48);
  const d = c.getImageData(0, 0, 48, 48).data;
  let x = 0; let y = 0; let wsum = 0; let lum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const { h, s } = rgbToHue(d[i], d[i + 1], d[i + 2]);
    const w = s * s + 0.02;
    x += Math.cos((h * Math.PI) / 180) * w; y += Math.sin((h * Math.PI) / 180) * w; wsum += w;
    lum += (d[i] + d[i + 1] + d[i + 2]) / 765;
  }
  let hue = (Math.atan2(y, x) * 180) / Math.PI; if (hue < 0) hue += 360;
  const flat = wsum / (d.length / 4) < 0.05; // foto nyaris abu-abu
  if (flat) return { ...THEMES.emas, name: 'Otomatis' };
  return { name: 'Otomatis', bg: [hsl(hue, 55, 6), hsl(hue + 18, 50, 13)], a1: hsl(hue, 85, 68), a2: hsl(hue + 42, 90, 62) };
}

/** '#rrggbb' atau 'hsla(...)' -> warna yang sama dengan alpha baru. */
function alpha(color, a) {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return color.replace(/,\s*[\d.]+\)$/, `, ${a})`);
}

// ---------- gambar bantu ----------
function path(ctx, fn) { ctx.beginPath(); fn(); }
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function cover(ctx, img, x, y, w, h) {
  const k = Math.max(w / img.width, h / img.height);
  const sw = w / k; const sh = h / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
/** Blur tanpa ctx.filter: turunkan resolusi bertahap lalu bentangkan kembali. */
function blurredCover(make, img, w, h) {
  const a = make(96, Math.round(96 * (h / w)));
  const ac = a.getContext('2d'); ac.imageSmoothingEnabled = true; ac.imageSmoothingQuality = 'high';
  cover(ac, img, 0, 0, a.width, a.height);
  const b = make(24, Math.max(8, Math.round(24 * (h / w))));
  const bc = b.getContext('2d'); bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high';
  bc.drawImage(a, 0, 0, b.width, b.height);
  const out = make(w, h);
  const oc = out.getContext('2d'); oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
  oc.drawImage(b, 0, 0, w, h);
  return out;
}
function spaced(ctx, text, x, y, gap) {
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + gap; }
  return cx - gap;
}
function fit(ctx, text, maxW, size, min, weight = 'bold') {
  let s = size;
  for (; s > min; s -= 2) { ctx.font = `${weight} ${s}px ${fontFamily()}`; if (ctx.measureText(text).width <= maxW) return s; }
  ctx.font = `${weight} ${min}px ${fontFamily()}`;
  return min;
}
function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
function sparkle(ctx, x, y, s, color, alpha) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.22, y - s * 0.22); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 0.22, y + s * 0.22);
  ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.22, y + s * 0.22); ctx.lineTo(x - s, y); ctx.lineTo(x - s * 0.22, y - s * 0.22);
  ctx.closePath(); ctx.fill(); ctx.restore();
}
const seeded = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; }; };

// ikon vektor di dalam lencana (pusat 0,0, ukuran ~ r)
const ICONS = {
  check: (ctx, r) => { ctx.moveTo(-r * 0.42, 0); ctx.lineTo(-r * 0.1, r * 0.34); ctx.lineTo(r * 0.46, -r * 0.32); },
  leave: (ctx, r) => { ctx.moveTo(r * 0.4, 0); ctx.lineTo(-r * 0.4, 0); ctx.moveTo(-r * 0.4, 0); ctx.lineTo(-r * 0.04, -r * 0.34); ctx.moveTo(-r * 0.4, 0); ctx.lineTo(-r * 0.04, r * 0.34); },
  bot: (ctx, r) => { ctx.moveTo(0, -r * 0.46); ctx.lineTo(0, r * 0.46); ctx.moveTo(-r * 0.46, 0); ctx.lineTo(r * 0.46, 0); },
};

function moon(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.beginPath();
  ctx.rect(cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4);
  ctx.arc(cx + r * 0.5, cy - r * 0.18, r * 0.82, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill('evenodd');
  ctx.restore();
}

// ---------- isi kartu per jenis ----------
const KINDS = {
  welcome: { label: 'SELAMAT DATANG', icon: 'check', prep: 'di', line: (o) => `${o.greet}! Semoga betah di sini.` },
  farewell: { label: 'SAMPAI JUMPA', icon: 'leave', prep: 'dari', line: () => 'Terima kasih sudah pernah bersama kami.' },
  approved: { label: 'BOT AKTIF', icon: 'bot', prep: '', line: () => 'Ketik .menu untuk melihat seluruh fitur.' },
};

/**
 * @param {object} o  { kind, name, group, count, avatar:Buffer|null, theme, greet, date, time, tag }
 * @returns {Promise<Buffer>} PNG
 */
async function render(o) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const make = (w, h) => createCanvas(w, h);
  const kind = KINDS[o.kind] || KINDS.welcome;
  let img = null;
  if (o.avatar) { try { img = await loadImage(o.avatar); } catch { img = null; } }

  const key = String(o.theme || 'otomatis').toLowerCase();
  const T = key !== 'otomatis' && THEMES[key] ? THEMES[key] : (img ? themeFromImage(make, img) : THEMES.emas);

  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  const F = fontFamily();

  // 1) latar
  let g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, T.bg[0]); g.addColorStop(1, T.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (img) {
    ctx.save(); ctx.globalAlpha = 0.5;
    ctx.drawImage(blurredCover(make, img, W, H), 0, 0, W, H);
    ctx.restore();
  }
  g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.30)'); g.addColorStop(0.55, 'rgba(0,0,0,0.58)'); g.addColorStop(1, 'rgba(0,0,0,0.74)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // 2) cahaya aksen
  const AV = { x: 340, y: 360, r: 178 };
  let rg = ctx.createRadialGradient(AV.x, AV.y, 20, AV.x, AV.y, 560);
  rg.addColorStop(0, alpha(T.a1, 0.32)); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  rg = ctx.createRadialGradient(W - 120, H - 60, 10, W - 120, H - 60, 420);
  rg.addColorStop(0, alpha(T.a2, 0.22)); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

  // 3) hiasan: titik, kilau
  const rnd = seeded(o.name + o.group);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (let x = 640; x < W - 70; x += 36) for (let y = 96; y < 140; y += 36) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 0; i < 14; i++) {
    const sx = 80 + rnd() * (W - 160); const sy = 80 + rnd() * (H - 160); const ss = 5 + rnd() * 9; const sa = 0.18 + rnd() * 0.3;
    const inText = sx > 600 && sy > 150 && sy < 640; // jangan menimpa teks
    if (!inText) sparkle(ctx, sx, sy, ss, i % 2 ? T.a1 : '#ffffff', sa);
  }

  // 4) panel kaca
  ctx.save();
  ctx.beginPath(); rr(ctx, 48, 48, W - 96, H - 96, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.stroke();
  ctx.restore();

  // 5) foto profil
  ctx.save();
  ctx.shadowColor = T.a1; ctx.shadowBlur = 70;
  ctx.beginPath(); ctx.arc(AV.x, AV.y, AV.r + 16, 0, Math.PI * 2);
  ctx.lineWidth = 12;
  g = ctx.createLinearGradient(AV.x - AV.r, AV.y - AV.r, AV.x + AV.r, AV.y + AV.r);
  g.addColorStop(0, T.a1); g.addColorStop(1, T.a2);
  ctx.strokeStyle = g; ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.setLineDash([2, 14]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.arc(AV.x, AV.y, AV.r + 44, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.arc(AV.x, AV.y, AV.r, 0, Math.PI * 2); ctx.clip();
  if (img) cover(ctx, img, AV.x - AV.r, AV.y - AV.r, AV.r * 2, AV.r * 2);
  else {
    g = ctx.createLinearGradient(AV.x - AV.r, AV.y - AV.r, AV.x + AV.r, AV.y + AV.r);
    g.addColorStop(0, T.a1); g.addColorStop(1, T.a2);
    ctx.fillStyle = g; ctx.fillRect(AV.x - AV.r, AV.y - AV.r, AV.r * 2, AV.r * 2);
    const letter = (String(o.name || '').match(/^\p{L}/u) || [''])[0];
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    if (letter) {
      ctx.font = `bold 190px ${F}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(letter.toUpperCase(), AV.x, AV.y + 8);
    } else { // nama berupa nomor / kosong: siluet orang
      ctx.beginPath(); ctx.arc(AV.x, AV.y - 38, 62, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(AV.x, AV.y + 150, 118, 112, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();

  // lencana ikon
  const bx = AV.x + AV.r * 0.74; const by = AV.y + AV.r * 0.74; const br = 46;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.arc(bx, by, br + 8, 0, Math.PI * 2); ctx.fillStyle = T.bg[0]; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
  g = ctx.createLinearGradient(bx - br, by - br, bx + br, by + br); g.addColorStop(0, T.a1); g.addColorStop(1, T.a2);
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.translate(bx, by); ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b0b0b';
  ctx.beginPath(); ICONS[kind.icon](ctx, br); ctx.stroke(); ctx.restore();

  // 6) teks
  const X = 640; const MAXW = W - X - 84;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 22px ${F}`; ctx.fillStyle = T.a1;
  ctx.beginPath(); rr(ctx, X, 178, 44, 5, 2.5); ctx.fillStyle = T.a1; ctx.fill();
  ctx.fillStyle = T.a1; spaced(ctx, kind.label, X + 60, 188, 7);

  const name = String(o.name || 'Anggota Baru');
  const ns = fit(ctx, name, MAXW, 86, 40);
  ctx.fillStyle = '#ffffff'; ctx.font = `bold ${ns}px ${F}`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18;
  ctx.fillText(ellipsize(ctx, name, MAXW), X, 280);
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

  ctx.beginPath(); rr(ctx, X, 308, 150, 7, 3.5);
  g = ctx.createLinearGradient(X, 0, X + 150, 0); g.addColorStop(0, T.a1); g.addColorStop(1, T.a2);
  ctx.fillStyle = g; ctx.fill();

  const sub = kind.prep ? `${kind.prep} ${o.group || 'grup ini'}` : 'Safety Your WhatsApp siap membantu';
  fit(ctx, sub, MAXW, 33, 22, 'bold'); ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillText(ellipsize(ctx, sub, MAXW), X, 372);

  const ln = kind.line(o);
  fit(ctx, ln, MAXW, 25, 19, '400'); ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(ellipsize(ctx, ln, MAXW), X, 420);

  // chip info
  const chips = [];
  if (o.count) chips.push(o.kind === 'approved' ? `${o.count} anggota` : `Anggota ke-${o.count}`);
  if (o.date) chips.push(o.date);
  if (o.time) chips.push(o.time);
  ctx.font = `bold 20px ${F}`;
  let cx = X; const cy = 480;
  for (const t of chips) {
    const w = ctx.measureText(t).width + 30;
    if (cx + w > X + MAXW + 6) break;
    ctx.beginPath(); rr(ctx, cx, cy, w, 48, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(t, cx + 15, cy + 31);
    cx += w + 10;
  }

  // 7) footer
  ctx.beginPath(); ctx.moveTo(X, 566); ctx.lineTo(W - 110, 566);
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
  moon(ctx, X + 14, 610, 14, T.a1);
  ctx.textAlign = 'left'; ctx.font = `bold 21px ${F}`; ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const brand = 'Safety Your WhatsApp';
  ctx.fillText(brand, X + 42, 618);
  const brandEnd = X + 42 + ctx.measureText(brand).width;
  ctx.textAlign = 'right'; ctx.font = `400 18px ${F}`; ctx.fillStyle = 'rgba(255,255,255,0.55)';
  const tag = ellipsize(ctx, o.tag || 'ketik .menu', Math.max(0, W - 110 - brandEnd - 30));
  if (tag.length > 3) ctx.fillText(tag, W - 110, 618);

  return cv.toBuffer('image/png');
}

module.exports = { render, THEMES, THEME_KEYS, KINDS, W, H };

'use strict';
/**
 * Mendaftarkan font untuk @napi-rs/canvas. Di VPS/panel minimal biasanya tidak ada font sistem,
 * sehingga teks di gambar (welcome, watermark, meme) tampil kosong. Modul ini mencari font umum
 * (versi biasa + tebal) dan mendaftarkannya dengan satu nama keluarga: "SafetySans".
 * Bisa dipaksa lewat FONT_FILE (huruf biasa) dan FONT_FILE_BOLD (huruf tebal) di .env.
 */
const fs = require('fs');
const config = require('../config');

const DIRS = [
  '/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/dejavu', '/usr/share/fonts/TTF',
  '/usr/share/fonts/truetype/liberation', '/usr/share/fonts/liberation',
  '/usr/share/fonts/truetype/noto', '/usr/share/fonts/noto', '/usr/share/fonts/opentype/noto',
  '/system/fonts', // Android / Termux
  '/data/data/com.termux/files/usr/share/fonts/TTF',
  '/Library/Fonts', '/System/Library/Fonts/Supplemental', 'C:/Windows/Fonts',
];
const REGULAR = ['DejaVuSans.ttf', 'LiberationSans-Regular.ttf', 'NotoSans-Regular.ttf', 'Roboto-Regular.ttf', 'Arial.ttf', 'arial.ttf'];
const BOLD = ['DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf', 'NotoSans-Bold.ttf', 'Roboto-Bold.ttf', 'Arial Bold.ttf', 'arialbd.ttf'];

const find = (names, forced) => {
  if (forced && fs.existsSync(forced)) return forced;
  for (const d of DIRS) for (const n of names) { const f = `${d}/${n}`; if (fs.existsSync(f)) return f; }
  return null;
};

let family = null;
function fontFamily() {
  if (family) return family;
  family = 'sans-serif';
  try {
    const { GlobalFonts } = require('@napi-rs/canvas');
    const reg = find(REGULAR, config.fontFile);
    const bold = find(BOLD, process.env.FONT_FILE_BOLD);
    let ok = false;
    if (reg) ok = Boolean(GlobalFonts.registerFromPath(reg, 'SafetySans')) || ok;
    if (bold) ok = Boolean(GlobalFonts.registerFromPath(bold, 'SafetySans')) || ok;
    if (ok) family = 'SafetySans, sans-serif';
  } catch (_) { /* canvas belum terpasang: pakai default */ }
  return family;
}

module.exports = { fontFamily };

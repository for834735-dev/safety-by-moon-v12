'use strict';
/**
 * Analisis nomor telepon secara offline (tanpa menghubungi siapa pun).
 *
 * Yang BISA diketahui dari nomor: negara (kode negara), operator awal (khusus Indonesia, dari prefix),
 * dan wilayah penomoran untuk telepon rumah. Yang TIDAK bisa: posisi/alamat orang tersebut.
 * Nomor yang sudah pindah operator (porting) bisa saja meleset dari tabel prefix.
 */

// kode negara -> [nama, ISO, zona waktu]
const C = {
  1: ['Amerika Serikat / Kanada', 'US/CA', 'UTC−10 s.d. −4'], 7: ['Rusia / Kazakhstan', 'RU/KZ', 'UTC+2 s.d. +12'], 20: ['Mesir', 'EG', 'UTC+2'],
  27: ['Afrika Selatan', 'ZA', 'UTC+2'], 30: ['Yunani', 'GR', 'UTC+2'], 31: ['Belanda', 'NL', 'UTC+1'], 32: ['Belgia', 'BE', 'UTC+1'],
  33: ['Prancis', 'FR', 'UTC+1'], 34: ['Spanyol', 'ES', 'UTC+1'], 36: ['Hungaria', 'HU', 'UTC+1'], 39: ['Italia', 'IT', 'UTC+1'],
  40: ['Rumania', 'RO', 'UTC+2'], 41: ['Swiss', 'CH', 'UTC+1'], 43: ['Austria', 'AT', 'UTC+1'], 44: ['Inggris', 'GB', 'UTC+0'],
  45: ['Denmark', 'DK', 'UTC+1'], 46: ['Swedia', 'SE', 'UTC+1'], 47: ['Norwegia', 'NO', 'UTC+1'], 48: ['Polandia', 'PL', 'UTC+1'],
  49: ['Jerman', 'DE', 'UTC+1'], 51: ['Peru', 'PE', 'UTC−5'], 52: ['Meksiko', 'MX', 'UTC−6'], 54: ['Argentina', 'AR', 'UTC−3'],
  55: ['Brasil', 'BR', 'UTC−3'], 56: ['Chili', 'CL', 'UTC−4'], 57: ['Kolombia', 'CO', 'UTC−5'], 58: ['Venezuela', 'VE', 'UTC−4'],
  60: ['Malaysia', 'MY', 'UTC+8'], 61: ['Australia', 'AU', 'UTC+8 s.d. +11'], 62: ['Indonesia', 'ID', 'UTC+7 / +8 / +9'],
  63: ['Filipina', 'PH', 'UTC+8'], 64: ['Selandia Baru', 'NZ', 'UTC+12'], 65: ['Singapura', 'SG', 'UTC+8'], 66: ['Thailand', 'TH', 'UTC+7'],
  81: ['Jepang', 'JP', 'UTC+9'], 82: ['Korea Selatan', 'KR', 'UTC+9'], 84: ['Vietnam', 'VN', 'UTC+7'], 86: ['Tiongkok', 'CN', 'UTC+8'],
  90: ['Turki', 'TR', 'UTC+3'], 91: ['India', 'IN', 'UTC+5:30'], 92: ['Pakistan', 'PK', 'UTC+5'], 93: ['Afganistan', 'AF', 'UTC+4:30'],
  94: ['Sri Lanka', 'LK', 'UTC+5:30'], 95: ['Myanmar', 'MM', 'UTC+6:30'], 98: ['Iran', 'IR', 'UTC+3:30'], 212: ['Maroko', 'MA', 'UTC+1'],
  213: ['Aljazair', 'DZ', 'UTC+1'], 216: ['Tunisia', 'TN', 'UTC+1'], 234: ['Nigeria', 'NG', 'UTC+1'], 249: ['Sudan', 'SD', 'UTC+2'],
  251: ['Etiopia', 'ET', 'UTC+3'], 254: ['Kenya', 'KE', 'UTC+3'], 255: ['Tanzania', 'TZ', 'UTC+3'], 256: ['Uganda', 'UG', 'UTC+3'],
  351: ['Portugal', 'PT', 'UTC+0'], 353: ['Irlandia', 'IE', 'UTC+0'], 358: ['Finlandia', 'FI', 'UTC+2'], 380: ['Ukraina', 'UA', 'UTC+2'],
  420: ['Ceko', 'CZ', 'UTC+1'], 670: ['Timor Leste', 'TL', 'UTC+9'], 673: ['Brunei', 'BN', 'UTC+8'], 852: ['Hong Kong', 'HK', 'UTC+8'],
  853: ['Makau', 'MO', 'UTC+8'], 855: ['Kamboja', 'KH', 'UTC+7'], 856: ['Laos', 'LA', 'UTC+7'], 880: ['Bangladesh', 'BD', 'UTC+6'],
  886: ['Taiwan', 'TW', 'UTC+8'], 960: ['Maladewa', 'MV', 'UTC+5'], 961: ['Lebanon', 'LB', 'UTC+2'], 962: ['Yordania', 'JO', 'UTC+3'],
  963: ['Suriah', 'SY', 'UTC+3'], 964: ['Irak', 'IQ', 'UTC+3'], 965: ['Kuwait', 'KW', 'UTC+3'], 966: ['Arab Saudi', 'SA', 'UTC+3'],
  967: ['Yaman', 'YE', 'UTC+3'], 968: ['Oman', 'OM', 'UTC+4'], 971: ['Uni Emirat Arab', 'AE', 'UTC+4'], 972: ['Israel', 'IL', 'UTC+2'],
  973: ['Bahrain', 'BH', 'UTC+3'], 974: ['Qatar', 'QA', 'UTC+3'], 975: ['Bhutan', 'BT', 'UTC+6'], 976: ['Mongolia', 'MN', 'UTC+8'],
  977: ['Nepal', 'NP', 'UTC+5:45'], 992: ['Tajikistan', 'TJ', 'UTC+5'], 993: ['Turkmenistan', 'TM', 'UTC+5'], 994: ['Azerbaijan', 'AZ', 'UTC+4'],
  995: ['Georgia', 'GE', 'UTC+4'], 998: ['Uzbekistan', 'UZ', 'UTC+5'],
};

// Indonesia: prefix seluler nasional (tanpa 0 awal) -> operator
const ID_OPS = [];
const addOps = (name, brand, prefixes) => prefixes.forEach((p) => ID_OPS.push([p, name, brand]));
addOps('Telkomsel', 'simPATI / Kartu Halo', ['811', '812', '813', '821', '822', '823']);
addOps('Telkomsel', 'by.U / kartuAs', ['851', '852', '853']);
addOps('Indosat Ooredoo Hutchison', 'IM3 / Mentari', ['814', '815', '816', '855', '856', '857', '858']);
addOps('XL Axiata', 'XL / Live.On', ['817', '818', '819', '859', '877', '878']);
addOps('Axis (XL Axiata)', 'Axis', ['831', '832', '833', '838']);
addOps('Tri Indonesia (Indosat)', '3 / Tri', ['895', '896', '897', '898', '899']);
addOps('Smartfren', 'Smartfren', ['881', '882', '883', '884', '885', '886', '887', '888', '889']);
ID_OPS.sort((a, b) => b[0].length - a[0].length);

// Indonesia: kode area telepon rumah (tanpa 0 awal) -> wilayah
const ID_AREA = {
  21: 'Jakarta & sekitarnya', 22: 'Bandung', 24: 'Semarang', 31: 'Surabaya', 61: 'Medan', 251: 'Bogor', 254: 'Serang', 260: 'Subang', 261: 'Sumedang',
  274: 'Yogyakarta', 271: 'Surakarta (Solo)', 281: 'Purwokerto', 341: 'Malang', 361: 'Denpasar (Bali)', 370: 'Mataram (NTB)', 380: 'Kupang (NTT)',
  411: 'Makassar', 431: 'Manado', 451: 'Palu', 481: 'Watampone', 511: 'Banjarmasin', 541: 'Samarinda', 542: 'Balikpapan', 561: 'Pontianak',
  711: 'Palembang', 721: 'Bandar Lampung', 741: 'Jambi', 751: 'Padang', 761: 'Pekanbaru', 771: 'Tanjungpinang', 778: 'Batam', 911: 'Ambon', 967: 'Jayapura',
};
const AREA_KEYS = Object.keys(ID_AREA).sort((a, b) => b.length - a.length);

const DEFAULT_CC = () => String(process.env.DEFAULT_CC || '62').replace(/\D/g, '') || '62';

/** "+62 812-3456-7890", "0812 3456 7890", "62812..." -> digit E.164 tanpa plus; null bila tak masuk akal. */
function normalize(input) {
  let d = String(input || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (String(input).trim().startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = DEFAULT_CC() + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

function countryOf(d) {
  for (const len of [3, 2, 1]) { const c = C[d.slice(0, len)]; if (c) return { code: d.slice(0, len), name: c[0], iso: c[1], tz: c[2] }; }
  return null;
}

const group = (s) => { const out = []; for (let i = 0; i < s.length; i += 4) out.push(s.slice(i, i + 4)); return out.join('-'); };

/** Analisis lengkap sebuah nomor. */
function analyze(input) {
  const d = normalize(input);
  if (!d) return { valid: false, input: String(input || ''), reason: 'Format nomor tidak dikenali (butuh 8–15 digit).' };
  const c = countryOf(d);
  const r = { valid: true, digits: d, e164: '+' + d, country: c, type: 'tidak diketahui', operator: null, brand: null, region: null, prefix: null, display: '+' + d, note: null };
  if (!c) { r.note = 'Kode negara tidak ada di tabel.'; return r; }
  const national = d.slice(c.code.length);
  r.display = `+${c.code} ${group(national)}`;
  if (c.code === '62') {
    if (national.startsWith('8')) {
      r.type = 'seluler';
      const hit = ID_OPS.find(([p]) => national.startsWith(p));
      if (hit) { r.operator = hit[1]; r.brand = hit[2]; r.prefix = '0' + hit[0]; } else r.note = 'Prefix seluler tidak ada di tabel operator.';
      r.region = 'Nomor seluler tidak terikat kota; wilayah tidak bisa ditentukan dari nomor.';
      r.display = `+62 ${national.slice(0, 3)}-${group(national.slice(3))}`;
    } else {
      const area = AREA_KEYS.find((k) => national.startsWith(k));
      r.type = 'telepon rumah / kantor';
      if (area) { r.region = ID_AREA[area]; r.prefix = '0' + area; r.display = `+62 ${area} ${national.slice(area.length)}`; }
      else r.note = 'Kode area belum ada di tabel.';
    }
    if (national.length < 9 || national.length > 13) r.note = (r.note ? r.note + ' ' : '') + 'Panjang nomor tidak lazim untuk Indonesia.';
  } else {
    r.type = 'tidak ditentukan';
    r.note = 'Tabel operator hanya mencakup Indonesia.';
  }
  return r;
}

module.exports = { analyze, normalize, countryOf, ID_OPS, ID_AREA, C };

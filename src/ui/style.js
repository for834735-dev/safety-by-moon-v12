'use strict';
/**
 * Gaya teks bot: huruf Unicode modern (Sans Bold) + simbol geometris. Tanpa emoji.
 * Semua modul memakai helper ini supaya tampilan pesan konsisten.
 */
const upper = 0x1d5d4; // 𝗔  (Mathematical Sans-Serif Bold)
const lower = 0x1d5ee; // 𝗮
const digit = 0x1d7ec; // 𝟬

function bold(text = '') {
  return [...String(text)].map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48);
    return ch;
  }).join('');
}

const S = {
  brand: 'Safety Your WhatsApp',
  dot: '◦', arrow: '▸', ok: '✓', no: '✕', warn: '△', wait: '◌', lock: '⊘', bullet: '•',
  top: '╭', mid: '│', end: '╰', bar: '─', line: '━━━━━━━━━━━━━━━━━━━━━',
};

// Simbol per kategori (semuanya karakter teks biasa, bukan emoji).
const ICON = {
  security: '◈', media: '⇩', group: '❖', business: '◆', fun: '✦', tools: '⌬',
  image: '▣', av: '♫', text: '¶', calc: '∑', net: '⌖',
};

/** Judul kotak:  ╭─ ◈ 𝗝𝗨𝗗𝗨𝗟 */
const head = (icon, title) => `${S.top}${S.bar} ${icon} ${bold(String(title).toUpperCase())}`;
/** Baris isi dalam kotak */
const row = (t) => `${S.mid} ${t}`;
const foot = () => `${S.end}${S.bar.repeat(14)}`;

/** Balasan singkat berlabel. kind: ok | no | warn | wait */
const say = (kind, text) => `${S[kind] || S.dot} ${text}`;

/** Kotak lengkap dari daftar baris. */
function box(icon, title, lines = []) {
  return [head(icon, title), ...lines.map(row), foot()].join('\n');
}

/** Pasangan label : nilai rata. */
function kv(pairs, pad = 9) {
  return pairs.filter(Boolean).map(([k, v]) => `${S.dot} ${String(k).padEnd(pad)}: ${v}`);
}

module.exports = { bold, S, ICON, head, row, foot, say, box, kv };

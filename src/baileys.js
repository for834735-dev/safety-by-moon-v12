'use strict';
/**
 * Pemuat Baileys terpusat. Mendukung Baileys 6.x (CommonJS) dan 7.x (ESM, memakai LID).
 *
 * Urutan: require() biasa (Baileys 6, atau Baileys 7 di Node 22.12+) lalu import() dinamis
 * (Baileys 7 di Node 18/20, yang tidak bisa require() paket ESM). Karena import() bersifat async,
 * pemuatan dilakukan satu kali saat start lewat load(); sesudah itu get() sinkron.
 * Kegagalan memuat TIDAK mematikan server: dashboard tetap hidup dan menampilkan penyebabnya.
 */
const NAME = '@whiskeysockets/baileys';
let mod = null;
let loading = null;
let lastError = null;

function normalize(ns) {
  const base = ns && typeof ns.default === 'object' && ns.default ? { ...ns.default } : {};
  const B = { ...base, ...ns };
  const factory = typeof ns.default === 'function' ? ns.default : (ns.default && ns.default.default) || ns.makeWASocket || base.makeWASocket;
  if (typeof factory !== 'function') throw new Error('Paket Baileys terpasang tetapi fungsi makeWASocket tidak ditemukan (versi tidak dikenal).');
  B.default = factory;
  B.makeWASocket = factory;
  return B;
}

const hint = (e) => {
  const m = String((e && e.message) || e);
  if (/Cannot find module|MODULE_NOT_FOUND/.test(m)) return 'Paket @whiskeysockets/baileys belum terpasang. Jalankan "npm install" (build gagal atau node_modules hilang).';
  if (/ERR_REQUIRE_ESM|ERR_REQUIRE_ASYNC_MODULE/.test(m + (e.code || ''))) return `Baileys berformat ESM dan Node.js ${process.versions.node} belum bisa memuatnya. Pakai Node.js 22.12 atau lebih baru.`;
  return 'Gagal memuat Baileys: ' + m.split('\n')[0];
};

async function load() {
  if (mod) return mod;
  if (loading) return loading;
  loading = (async () => {
    try {
      try { mod = normalize(require(NAME)); } catch (e1) {
        if (e1 && e1.code === 'MODULE_NOT_FOUND' && String(e1.message).includes(NAME)) throw e1;
        mod = normalize(await import(NAME)); // fallback untuk paket ESM
      }
      lastError = null;
      return mod;
    } catch (e) {
      lastError = hint(e);
      loading = null;
      throw new Error(lastError);
    }
  })();
  return loading;
}

function get() {
  if (!mod) throw new Error(lastError || 'Baileys belum dimuat (tunggu server selesai start).');
  return mod;
}

const version = () => {
  // Dibaca lewat fs: paket ESM dengan "exports" tidak mengizinkan require('.../package.json').
  const fs = require('fs'); const path = require('path');
  let dir = __dirname;
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
    const f = path.join(dir, 'node_modules', NAME, 'package.json');
    try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).version; } catch (_) { /* lanjut */ }
  }
  return 'versi tidak diketahui';
};
const error = () => lastError;
const state = () => (mod ? 'ok' : lastError ? 'gagal: ' + lastError : 'memuat');

module.exports = { load, get, version, error, state };

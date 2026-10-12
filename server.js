'use strict';
/**
 * Titik masuk backend.  Jalankan:  node server.js   (atau: python server.py)
 * Cocok untuk Termux, VPS, maupun panel (Pterodactyl, dsb).
 */
const path = require('path');

const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) {
  console.error(`Node.js ${process.versions.node} terlalu lama. Dibutuhkan Node.js 18 atau lebih baru.`);
  process.exit(1);
}

// Selalu bekerja dari folder server agar path relatif (.env, ./data) benar di panel mana pun.
process.chdir(__dirname);
require('dotenv').config({ path: path.join(__dirname, '.env') });

require('./src/app').start();

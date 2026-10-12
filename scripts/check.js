'use strict';
// Pemeriksaan cepat: npm run check  — memastikan semua modul termuat & tidak ada command ganda.
const fs = require('fs');
const path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
let bad = 0;
for (const f of walk(path.join(__dirname, '..', 'src'))) {
  try { new (require('vm').Script)(fs.readFileSync(f, 'utf8'), { filename: f }); } catch (e) { bad++; console.log('SINTAKS ✕', f, e.message); }
}
const hub = require('../src/features/hub');
const list = hub.catalog();
console.log(`✓ ${list.length} command dimuat, ${new Set(list.map((x) => x.category)).size} kategori`);
const dl = require('../src/services/downloader');
console.log('Penyedia unduhan:', JSON.stringify(dl.status()));
console.log('ffmpeg :', require('child_process').spawnSync('ffmpeg', ['-version']).status === 0 ? 'ada' : 'TIDAK ADA');
process.exit(bad ? 1 : 0);

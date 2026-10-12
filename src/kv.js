// Penyimpanan pengaturan/data fitur (data/settings.json). Tulis di-debounce biar hemat I/O di HP.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'settings.json');
let data = null;
let timer = null;

function load() {
  if (data) return data;
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { data = {}; }
  return data;
}
function flush() {
  timer = null;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(data));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (_) {}
}
function save() { if (!timer) timer = setTimeout(flush, 400); }

// Ambil namespace; key default yang belum ada otomatis diisi.
function ns(name, def = {}) {
  const d = load();
  const cur = (d[name] ||= {});
  for (const k of Object.keys(def)) if (!(k in cur)) cur[k] = JSON.parse(JSON.stringify(def[k]));
  return cur;
}

process.on('exit', () => { if (timer) flush(); });
process.on('SIGINT', () => { if (timer) flush(); process.exit(0); });

module.exports = { ns, save, flush };

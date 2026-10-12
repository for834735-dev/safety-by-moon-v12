const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify(
        {
          status: { connected: false, number: null, pairingCode: null },
          history: [],
          stats: { detected: 0, blocked: 0, reported: 0 },
        },
        null,
        2
      )
    );
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  getStatus() {
    return readDb().status;
  },
  setStatus(partial) {
    const db = readDb();
    db.status = { ...db.status, ...partial };
    writeDb(db);
  },
  getHistory() {
    // terbaru duluan, dibatasi 200 biar file nggak bengkak
    return readDb().history.slice(-200).reverse();
  },
  addHistoryEntry(entry) {
    const db = readDb();
    db.history.push(entry);
    if (db.history.length > 500) db.history = db.history.slice(-500);
    writeDb(db);
  },
  markReported(jid) {
    const db = readDb();
    const item = [...db.history].reverse().find((h) => h.from === jid && !h.reported);
    if (item) item.reported = true;
    writeDb(db);
  },
  getStats() {
    return readDb().stats;
  },
  incrementStat(key) {
    const db = readDb();
    db.stats[key] = (db.stats[key] || 0) + 1;
    writeDb(db);
  },
};

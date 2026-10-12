const baileys = require('./baileys');
// Diisi oleh init() sebelum socket pertama dibuat (Baileys 7 berformat ESM sehingga dimuat async).
let makeWASocket;
let Browsers;
let useMultiFileAuthState;
let DisconnectReason = {};
async function init() {
  const B = await baileys.load();
  makeWASocket = B.default;
  ({ Browsers, useMultiFileAuthState } = B);
  DisconnectReason = B.DisconnectReason || {};
  return B;
}

const fs = require('fs');

const logger = require('./utils/logger');
const store = require('./store');
const { isSuspicious } = require('./detector');
const { containsLink } = require('./features/antilink');
const hub = require('./features/hub');

let sock = null;
let authState = null;
let startPromise = null;
let reconnectTimer = null;
let pairingRequestPromise = null;
let connectionState = 'idle';
let pairingActive = false;
let pairingNumber = null;
let shuttingDown = false;
let socketGeneration = 0;
let saveCredsPromise = Promise.resolve();
let lastPairingAttemptAt = 0;
const PAIRING_COOLDOWN_MS = 12000;
const PAIRING_HANDSHAKE_GRACE_MS = 3000;

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  );
}

/** Error apa pun (Error, Boom, objek, string) -> teks yang bisa dibaca. Tidak pernah "[object Object]". */
function describeError(e) {
  if (!e) return 'Terjadi kesalahan tidak dikenal.';
  if (typeof e === 'string') return e;
  const m = e.message ?? e.output?.payload?.message ?? e.error ?? e.reason;
  if (typeof m === 'string' && m) return m;
  try { return JSON.stringify(m ?? e).slice(0, 200); } catch { return String(e.name || 'Error'); }
}

function statusCodeOf(error) {
  return error?.output?.statusCode ?? error?.statusCode ?? null;
}

function normalizePhone(phoneNumber) {
  return String(phoneNumber || '').replace(/\D/g, '');
}

function wipeSessionDir() {
  const sessionDir = process.env.SESSION_DIR || './data/session';
  try {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch (e) {
    logger.warn('Gagal membersihkan session lama: ' + e.message);
  }
}

function updatePairingStatus(partial = {}) {
  store.setStatus({
    connected: false,
    ...partial,
  });
}

async function waitForSocketReady(currentSock, timeoutMs = 30000) {
  // Do not use the global connectionState here. createSocket() can assign
  // that value before the WebSocket has actually opened, which makes
  // requestPairingCode() race the Noise handshake and commonly ends in 401.
  if (currentSock.__safetyConnectionState === 'close') {
    throw new Error('Koneksi WhatsApp ditutup sebelum pairing code siap.');
  }

  if (typeof currentSock.waitForSocketOpen === 'function') {
    let timer;
    try {
      await Promise.race([
        currentSock.waitForSocketOpen(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Timeout menunggu koneksi WhatsApp siap untuk pairing code.')),
            timeoutMs
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }

    if (currentSock.__safetyConnectionState === 'close') {
      throw new Error('Koneksi WhatsApp ditutup sebelum pairing code siap.');
    }

    // waitForSocketOpen() only means the TCP/WebSocket transport is open.
    // Baileys still needs a moment to finish the Noise hello/client-finish
    // exchange before it can send the pairing IQ safely.
    await new Promise((resolve) => setTimeout(resolve, PAIRING_HANDSHAKE_GRACE_MS));
    return;
  }

  // Compatibility fallback for older Baileys builds without
  // waitForSocketOpen().
  if (
    currentSock.__safetyConnectionState === 'connecting' ||
    currentSock.__safetyConnectionState === 'open'
  ) {
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('Timeout menunggu koneksi WhatsApp siap untuk pairing code.')),
      timeoutMs
    );

    const cleanup = () => {
      clearTimeout(timer);
      currentSock.ev.off('connection.update', onUpdate);
    };

    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const onUpdate = ({ connection, qr }) => {
      if (connection === 'connecting' || qr) finish();
      else if (connection === 'close') {
        finish(new Error('Koneksi WhatsApp ditutup sebelum pairing code siap.'));
      }
    };

    currentSock.ev.on('connection.update', onUpdate);
  });
}

async function closeCurrentSocket(reason = 'replace') {
  const currentSock = sock;
  if (!currentSock) {
    await saveCredsPromise.catch(() => {});
    return;
  }

  if (sock === currentSock) sock = null;
  connectionState = 'closing';
  currentSock.__safetyConnectionState = 'closing';

  try {
    // Baileys exposes ws.close() for an intentional transport shutdown.
    // Do not call logout(), because that invalidates a usable WhatsApp session.
    if (currentSock.ws && typeof currentSock.ws.close === 'function') {
      currentSock.ws.close();
    }
  } catch (e) {
    logger.warn(`Gagal menutup socket (${reason}): ${e.message}`);
  }

  // A creds.update may already be queued when the socket is closed. Never
  // wipe the session directory while that write is still in flight; doing so
  // recreates half-written auth files and makes the next pairing fail again.
  await saveCredsPromise.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 150));
  await saveCredsPromise.catch(() => {});
}

function scheduleReconnect(delay = 1500) {
  if (shuttingDown || reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSock().catch((e) => logger.error('Gagal reconnect: ' + e.message));
  }, delay);
}

function attachSocketHandlers(currentSock, state, saveCreds, generation) {
  currentSock.ev.on('creds.update', () => {
    // Serialize auth writes so a 515 restart cannot race a pending creds update.
    saveCredsPromise = saveCredsPromise
      .then(() => saveCreds())
      .catch((e) => {
        logger.error('Gagal menyimpan kredensial: ' + e.message);
      });
  });

  currentSock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, isNewLogin } = update;
    const code = statusCodeOf(lastDisconnect?.error);

    if (generation !== socketGeneration) return;

    if (connection) {
      connectionState = connection;
      currentSock.__safetyConnectionState = connection;
    }

    if (isNewLogin) {
      logger.info('WhatsApp menerima login baru. Menyimpan session...');
    }

    if (connection === 'open') {
      pairingActive = false;
      pairingNumber = null;
      store.setStatus({
        connected: true,
        number: currentSock.user?.id?.split(':')[0] || null,
        pairingCode: null,
        error: null,
      });
      logger.info(`✓ WhatsApp terhubung (Baileys ${baileys.version()})`);
      return;
    }

    if (connection !== 'close') return;

    const restartRequired = code === DisconnectReason.restartRequired || code === 515;
    const loggedOut = code === DisconnectReason.loggedOut || code === 401;
    const wasPairing = pairingActive || Boolean(pairingNumber);

    if (sock === currentSock) sock = null;
    connectionState = 'close';

    if (restartRequired) {
      logger.info('WhatsApp meminta restart socket (515). Menunggu kredensial tersimpan...');

      saveCredsPromise
        .catch(() => {})
        .finally(() => {
          pairingActive = false;
          pairingNumber = null;
          updatePairingStatus({ pairingCode: null, number: null, error: null });
          scheduleReconnect(250);
        });
      return;
    }

    if (loggedOut) {
      pairingActive = false;
      pairingNumber = null;
      updatePairingStatus({ pairingCode: null, number: null, error: wasPairing
        ? 'WhatsApp menolak proses penautan. Buat pairing code baru dan coba lagi.'
        : null });
      logger.warn(wasPairing
        ? '✕ Pairing ditolak WhatsApp (401). Kode/session percobaan sudah tidak valid.'
        : '△ Session WhatsApp logout (401). Pairing ulang diperlukan.');
      return;
    }

    if (wasPairing) {
      const message = code
        ? `Pairing terputus (code ${code}). Buat pairing code baru.`
        : 'Pairing terputus. Buat pairing code baru.';
      pairingActive = false;
      pairingNumber = null;
      updatePairingStatus({ pairingCode: null, number: null, error: message });
      logger.warn(`✕ ${message}`);
      return;
    }

    updatePairingStatus({ connected: false, pairingCode: null, number: null, error: null });
    logger.warn(`Koneksi ditutup (code ${code}). Reconnect: true`);
    scheduleReconnect(1500);
  });

  currentSock.ev.on('group-participants.update', async (update) => {
    try {
      await hub.onParticipants(currentSock, update);
    } catch (e) {
      logger.error('Gagal proses peserta grup: ' + e.message);
    }
  });

  // Grup baru tempat bot ditambahkan (dasar fitur izin masuk grup).
  currentSock.ev.on('groups.upsert', async (groups) => {
    try { await hub.onGroupsUpsert(currentSock, groups); } catch (e) { logger.warn('groups.upsert: ' + e.message); }
  });

  // Baileys 7: pemetaan LID <-> nomor telepon, dipakai untuk mengenali owner/admin di grup.
  currentSock.ev.on('lid-mapping.update', (m) => {
    try { require('./features/helpers').learnMapping(m); } catch (_) { /* opsional */ }
  });

  currentSock.ev.on('call', (calls) => {
    hub.onCall(currentSock, calls).catch((e) => logger.warn('Call handler: ' + e.message));
  });

  hub.start(() => sock);

  currentSock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;

      const from = msg.key.remoteJid;
      const text = require('./features/helpers').textOf(msg) || extractText(msg);

      // Pesan dari akun bot sendiri (mis. kamu ngetik .menu dari HP yang sama dengan nomor bot)
      // hanya diproses kalau berupa command berawalan "." dan masih baru (anti-loop, anti-history).
      if (msg.key.fromMe) {
        const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0);
        const fresh = !ts || Date.now() / 1000 - ts < 60;
        if (!text.startsWith('.') || !fresh) continue;
        try {
          await hub.handle(currentSock, msg, text);
        } catch (e) {
          logger.error('Hub error (self): ' + e.message);
        }
        continue;
      }
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

      const check = isSuspicious(text, mentioned);
      if (check.suspicious) {
        store.addHistoryEntry({
          time: new Date().toISOString(),
          from,
          type: check.type,
          detail: check.reason,
          reported: false,
        });
        store.incrementStat('detected');
        hub.onDetected(currentSock, from, check).catch(() => {});

        if (process.env.AUTO_BLOCK === 'true') {
          try {
            await currentSock.updateBlockStatus(from, 'block');
            store.incrementStat('blocked');
          } catch (e) {
            logger.error('Gagal blokir otomatis: ' + e.message);
          }
        }
        continue;
      }

      try {
        if (await hub.handle(currentSock, msg, text)) continue;
      } catch (e) {
        logger.error('Hub error: ' + e.message);
      }

      if (process.env.ANTILINK === 'true' && from.endsWith('@g.us') && containsLink(text)) {
        try {
          await currentSock.sendMessage(from, { delete: msg.key });
        } catch (e) {
          logger.error('Gagal hapus pesan link: ' + e.message);
        }
        continue;
      }
    }
  });
}

async function createSocket() {
  await init();
  const sessionDir = process.env.SESSION_DIR || './data/session';
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const currentGeneration = ++socketGeneration;
  const currentSock = makeWASocket({
    // Sengaja TIDAK memanggil fetchLatestBaileysVersion(). Banyak laporan
    // (termasuk isu resmi di GitHub Baileys) menunjukkan versi WA yang
    // di-fetch itu bisa nggak sinkron sama protokol yang benar-benar
    // diimplementasikan di versi library yang lo install, dan itu persis
    // memicu "Connection Failure" / decodeFrame error kayak di log lo.
    // Baileys sudah punya default version bawaan yang cocok dengan kode
    // di dalamnya — lebih aman dipakai apa adanya.
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
  });

  sock = currentSock;
  authState = state;
  // The real state is assigned by connection.update. Setting this to
  // "connecting" here would let pairing skip the actual socket handshake.
  connectionState = 'idle';
  currentSock.__safetyConnectionState = 'idle';
  attachSocketHandlers(currentSock, state, saveCreds, currentGeneration);

  return { sock: currentSock, state };
}

async function startSock() {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    shuttingDown = false;
    const existing = sock && authState?.creds;

    if (existing && (existing.registered || connectionState === 'connecting' || connectionState === 'open')) {
      return sock;
    }

    const created = await createSocket();
    if (created.state.creds.registered) {
      logger.info('Session terdaftar. Menunggu koneksi WhatsApp...');
    }
    return created.sock;
  })();

  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

async function requestNewPairingCode(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);
  if (!normalized || normalized.length < 8) {
    throw new Error('Nomor WhatsApp tidak valid. Gunakan format internasional tanpa tanda +.');
  }

  if (pairingRequestPromise) return pairingRequestPromise;

  const now = Date.now();
  const sinceLastAttempt = now - lastPairingAttemptAt;
  if (sinceLastAttempt < PAIRING_COOLDOWN_MS) {
    const waitSec = Math.ceil((PAIRING_COOLDOWN_MS - sinceLastAttempt) / 1000);
    throw new Error(
      `Tunggu ${waitSec} detik lagi sebelum minta kode pairing baru. Minta berkali-kali dalam waktu singkat malah bikin WhatsApp nolak (401) — ini bukan bug, tapi rate-limit dari sisi WhatsApp sendiri.`
    );
  }

  pairingRequestPromise = (async () => {
    shuttingDown = false;
    lastPairingAttemptAt = Date.now();

    // A registered authState with no live socket can be a stale session after
    // a 401/logout. It must be allowed to be replaced by a fresh pairing.
    if (authState?.creds?.registered && sock) {
      throw new Error('Session WhatsApp sedang/ sudah terdaftar. Tunggu koneksi selesai atau hapus session untuk pairing ulang.');
    }

    // Bersihin session lama secara total sebelum pairing baru. Sisa file
    // auth yang setengah-jadi dari percobaan gagal sebelumnya adalah
    // penyebab umum lain dari 401 yang terus berulang.
    await closeCurrentSocket('refresh-pairing');
    wipeSessionDir();
    const created = await createSocket();
    let currentSock = created.sock;

    pairingActive = true;
    pairingNumber = normalized;
    updatePairingStatus({
      pairingCode: null,
      number: normalized,
      error: null,
      connected: false,
    });

    try {
      await waitForSocketReady(currentSock);
      const code = await currentSock.requestPairingCode(normalized);
      if (!code || typeof code !== 'string') {
        throw new Error('WhatsApp tidak mengembalikan pairing code yang valid.');
      }

      updatePairingStatus({
        pairingCode: code,
        number: normalized,
        error: null,
        connected: false,
      });
      logger.info(`Pairing code baru: ${code}`);
      return { code, number: normalized };
    } catch (error) {
      const msg = describeError(error);
      logger.warn('Pairing gagal: ' + msg);
      updatePairingStatus({
        pairingCode: null,
        number: normalized,
        error: msg,
        connected: false,
      });
      throw new Error(msg);
    }
  })();

  try {
    return await pairingRequestPromise;
  } finally {
    pairingRequestPromise = null;
  }
}

function getSock() {
  return sock;
}

async function sendReport({ targetJid, reason, evidence }) {
  const ownerNumber = process.env.OWNER_NUMBER;
  if (!sock) throw new Error('Bot belum terhubung ke WhatsApp');
  if (!ownerNumber) throw new Error('OWNER_NUMBER belum diset di .env');

  const ownerJid = ownerNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  const text =
    `*Laporan Otomatis - Safety Your WhatsApp*\n\n` +
    `Nomor terlapor: ${targetJid}\n` +
    `Waktu: ${new Date().toLocaleString('id-ID')}\n` +
    `Alasan: ${reason}\n` +
    `Bukti: ${evidence || '-'}\n\n` +
    `Catatan: WhatsApp nggak punya API resmi buat auto-submit laporan ke tim mereka. ` +
    `Pesan ini dikirim ke nomor owner sebagai draf siap pakai — kalau mau proses resmi, `+
    `teruskan manual lewat fitur Report bawaan WhatsApp (tekan lama kontak > Report).`;

  await sock.sendMessage(ownerJid, { text });
  return text;
}

module.exports = {
  startSock,
  requestNewPairingCode,
  getSock,
  sendReport,
};

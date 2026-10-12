const express = require('express');
const router = express.Router();

const store = require('../store');

/** Pastikan pesan error selalu string (dashboard menampilkannya langsung). */
const errText = (e, fallback) => {
  const m = typeof e === 'string' ? e : e?.message;
  if (typeof m === 'string' && m) return m;
  try { return m ? JSON.stringify(m).slice(0, 200) : fallback; } catch { return fallback; }
};
const { requestNewPairingCode, getSock, sendReport } = require('../whatsapp');

router.get('/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(store.getStatus());
});

router.get('/stats', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(store.getStats());
});

router.get('/riwayat', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const n = String(req.query.number || '').replace(/\D/g, '');
  const h = store.getHistory();
  res.json(n ? h.filter((x) => String(x.from).includes(n)) : h);
});

router.get('/features', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(require('../features/hub').catalog());
});

// Read-only pairing status. This NEVER generates or reuses a pairing code.
router.get('/pair', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const status = store.getStatus();
  res.json({
    connected: status.connected,
    code: status.pairingCode || null,
    number: status.number || null,
    error: status.error || null,
  });
});

// Every POST /api/pair explicitly requests a NEW code.
// There is intentionally no "return existing pairingCode" cache here.
router.post('/pair', async (req, res) => {
  try {
    const phoneNumber = String(req.body?.phoneNumber || '').replace(/[^0-9]/g, '');

    if (!phoneNumber || phoneNumber.length < 8) {
      return res.status(400).json({
        error: 'Nomor WhatsApp tidak valid. Gunakan format internasional, contoh 62812xxxxxxx.',
      });
    }

    const currentStatus = store.getStatus();
    if (currentStatus.connected) {
      return res.status(409).json({
        error: 'Bot sudah terhubung.',
        connected: true,
        number: currentStatus.number,
      });
    }

    const result = await requestNewPairingCode(phoneNumber);

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      code: result.code,
      connected: false,
      number: result.number,
      fresh: true,
    });
  } catch (e) {
    const message = errText(e, 'Gagal meminta pairing code.');
    const lower = message.toLowerCase();
    const status = lower.includes('sudah terdaftar') || lower.includes('sedang/ sudah') ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

// Clear only the dashboard's visible pairing state. It does not logout an
// already registered WhatsApp account.
router.post('/pair/clear', (req, res) => {
  const current = store.getStatus();
  if (current.connected) {
    return res.status(409).json({ error: 'Bot sedang terhubung.' });
  }
  store.setStatus({ pairingCode: null, error: null });
  res.json({ ok: true });
});

router.post('/report', async (req, res) => {
  try {
    const { targetJid, reason, evidence } = req.body || {};
    if (!targetJid) return res.status(400).json({ error: 'targetJid wajib diisi' });

    if (!getSock()) return res.status(409).json({ error: 'Bot belum terhubung ke WhatsApp' });

    const text = await sendReport({
      targetJid,
      reason: reason || 'Terdeteksi virtex/bug',
      evidence,
    });

    store.markReported(targetJid);
    store.incrementStat('reported');

    res.json({
      ok: true,
      message: 'Draf laporan sudah dikirim ke WhatsApp owner.',
      text,
    });
  } catch (e) {
    res.status(500).json({ error: errText(e, 'Gagal mengirim laporan.') });
  }
});

module.exports = router;

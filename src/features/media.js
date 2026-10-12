const fs = require('fs');
const H = require('./helpers');
const config = require('../config');
const dlx = require('../services/downloader');
const { S, say } = require('../ui/style');

// ---------- Downloader (bawaan: AUDIO saja; tambahkan "video" untuk videonya) ----------
const VIDEO_WORDS = ['video', 'vid', 'mp4', 'v'];
const AUDIO_WORDS = ['audio', 'lagu', 'mp3', 'a'];
const QUALITIES = ['144', '240', '360', '480', '720', '1080', '1440'];

/** Baca opsi dari argumen: mode (audio/video) dan kualitas video. */
function parseOpts(args, forced) {
  let mode = forced || config.download.defaultMode;
  let quality = '720';
  for (const a of args.map((x) => x.toLowerCase())) {
    if (!forced && VIDEO_WORDS.includes(a)) mode = 'video';
    else if (!forced && AUDIO_WORDS.includes(a)) mode = 'audio';
    else if (QUALITIES.includes(a.replace(/p$/, ''))) { quality = a.replace(/p$/, ''); if (!forced) mode = 'video'; }
  }
  return { mode, quality };
}

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

/** Kirim hasil unduhan ke chat, lalu hapus file sementara. */
async function sendMedia(c, res, label) {
  try {
    const buf = fs.readFileSync(res.file);
    const cap = `${S.ok} ${res.title}\n${S.dot} ${label} ${S.dot} ${res.mode === 'audio' ? 'Audio MP3' : 'Video MP4'} ${S.dot} ${mb(buf.length)}`;
    if (res.mode === 'audio') {
      if (buf.length > config.download.audioAsDocMb * 1048576) {
        await c.sock.sendMessage(c.from, { document: buf, mimetype: 'audio/mpeg', fileName: safeName(res.title) + '.mp3', caption: cap }, { quoted: c.msg });
      } else {
        await c.sock.sendMessage(c.from, { audio: buf, mimetype: 'audio/mpeg', fileName: safeName(res.title) + '.mp3' }, { quoted: c.msg });
        await c.reply(cap);
      }
    } else if (buf.length > 60 * 1048576) {
      await c.sock.sendMessage(c.from, { document: buf, mimetype: 'video/mp4', fileName: safeName(res.title) + '.mp4', caption: cap }, { quoted: c.msg });
    } else {
      await c.sock.sendMessage(c.from, { video: buf, caption: cap }, { quoted: c.msg });
    }
  } finally { dlx.cleanup(res); }
}
const safeName = (t = 'media') => String(t).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'media';

/** Pembuat command downloader per platform. */
const dl = (id, label, o = {}) => ({
  alias: o.alias || [],
  help: `Download ${label} (bawaan audio): .${o.name} <link> [video] [kualitas]`,
  run: async (c) => {
    const url = dlx.extractUrl(c.rest) || dlx.extractUrl(H.quotedText(c.msg));
    const p = url && dlx.detect(url);
    if (!url || (id !== 'any' && (!p || p.id !== id))) {
      return c.reply(say('warn', `Format: .${o.name} <link ${label}>\nTambahkan kata "video" bila ingin videonya.\nContoh: .${o.name} <link> video 720`));
    }
    const opt = parseOpts(c.args.slice(1), o.forced);
    await c.reply(say('wait', `Mengunduh ${opt.mode === 'audio' ? 'audio' : 'video'} dari ${p ? p.label : 'link'}...`));
    const res = await dlx.download(url, opt);
    return sendMedia(c, res, p ? p.label : label);
  },
});

// ---------- TTS / STT ----------
async function ttsBuffer(text, lang = 'id') {
  const chunks = text.match(/[\s\S]{1,180}(\s|$)/g) || [text];
  const bufs = [];
  for (const ch of chunks.slice(0, 6)) {
    bufs.push(await H.getBuffer(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(ch.trim())}`));
  }
  return Buffer.concat(bufs);
}
async function transcribe(buf) {
  const key = process.env.STT_API_KEY;
  if (!key) throw new Error('STT_API_KEY belum diisi di .env (kompatibel OpenAI/Groq Whisper).');
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/ogg' }), 'vn.ogg');
  fd.append('model', process.env.STT_MODEL || 'whisper-1');
  const r = await fetch(process.env.STT_API_URL || 'https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'STT gagal');
  return j.text || '';
}

// ---------- cache status WA ----------
const statuses = [];
async function onStatus(msg) {
  const m = H.unwrap(msg.message || {});
  const type = m.imageMessage ? 'image' : m.videoMessage ? 'video' : null;
  if (!type) return;
  statuses.push({ key: msg.key, message: m, who: H.num(msg.key.participant || ''), type, ts: Date.now(), cap: (m.imageMessage || m.videoMessage).caption || '' });
  if (statuses.length > 60) statuses.shift();
}

const needMedia = (c, types, hint) => {
  const m = H.findMedia(c.msg, types);
  if (!m) throw new Error(hint);
  return m;
};

const commands = {
  sticker: {
    help: 'Gambar/video → stiker (kirim/reply dengan .sticker)', alias: ['stiker', 's'],
    run: async (c) => {
      const media = needMedia(c, ['imageMessage', 'videoMessage'], 'Reply/kirim gambar atau video pendek dengan caption .sticker ya.');
      const { makeStickerFromBuffer } = require('./sticker');
      const buf = await H.downloadMedia(media);
      const st = await makeStickerFromBuffer(buf, { animated: media.type === 'videoMessage' });
      return c.sock.sendMessage(c.from, { sticker: st }, { quoted: c.msg });
    },
  },
  tiktok: dl('tiktok', 'TikTok', { name: 'tiktok', alias: ['tt'] }),
  ig: dl('instagram', 'Instagram', { name: 'ig', alias: ['reels', 'instagram'] }),
  fb: dl('facebook', 'Facebook', { name: 'fb', alias: ['facebook'] }),
  x: dl('twitter', 'X / Twitter', { name: 'x', alias: ['twitter'] }),
  yt: dl('youtube', 'YouTube', { name: 'yt', alias: ['youtube'] }),
  ytmp3: dl('youtube', 'YouTube MP3', { name: 'ytmp3', forced: 'audio' }),
  ytmp4: dl('youtube', 'YouTube MP4', { name: 'ytmp4', alias: ['ytv'], forced: 'video' }),
  dl: dl('any', 'semua platform', { name: 'dl', alias: ['unduh', 'download'] }),
  play: {
    help: 'Cari & kirim lagu dari YouTube: .play <judul lagu>', alias: ['lagu', 'song'],
    run: async (c) => {
      if (!c.rest) return c.reply(say('warn', 'Format: .play <judul lagu>'));
      await c.reply(say('wait', 'Mencari lagu...'));
      const res = await dlx.search(c.rest);
      return sendMedia(c, res, 'YouTube');
    },
  },
  playvid: {
    help: 'Cari & kirim video dari YouTube: .playvid <judul> [kualitas]', alias: ['carivideo'],
    run: async (c) => {
      const q = c.args.filter((a) => !QUALITIES.includes(a)).join(' ');
      if (!q) return c.reply(say('warn', 'Format: .playvid <judul> [kualitas]'));
      await c.reply(say('wait', 'Mencari video...'));
      const res = await dlx.search(q, { mode: 'video', quality: c.args.find((a) => QUALITIES.includes(a)) || '480' });
      return sendMedia(c, res, 'YouTube');
    },
  },
  mp3: {
    help: 'Video/VN → MP3 (reply media + .mp3)', alias: ['tomp3'],
    run: async (c) => {
      const m = needMedia(c, ['videoMessage', 'audioMessage'], 'Reply video/voice note dengan .mp3');
      const out = await H.ffmpeg(await H.downloadMedia(m), 'mp4', 'mp3', ['-vn', '-b:a', '128k']);
      return c.sock.sendMessage(c.from, { audio: out, mimetype: 'audio/mpeg' }, { quoted: c.msg });
    },
  },
  resize: {
    help: 'Resize gambar: .resize <lebar px> (reply gambar)',
    run: async (c) => {
      const w = H.clamp(parseInt(c.args[0], 10) || 0, 16, 4000); if (!c.args[0]) return c.reply('Format: .resize 800 (reply gambar)');
      const m = needMedia(c, ['imageMessage'], 'Reply gambar dengan .resize <lebar>');
      const out = await H.ffmpeg(await H.downloadMedia(m), 'jpg', 'jpg', ['-vf', `scale=${w}:-2`, '-q:v', '3']);
      return c.sock.sendMessage(c.from, { image: out, caption: `Resize → ${w}px lebar` }, { quoted: c.msg });
    },
  },
  compress: {
    help: 'Kompres gambar: .compress [kualitas 1-100] (reply gambar)',
    run: async (c) => {
      const q = H.clamp(parseInt(c.args[0], 10) || 40, 1, 100);
      const m = needMedia(c, ['imageMessage'], 'Reply gambar dengan .compress [kualitas]');
      const inBuf = await H.downloadMedia(m);
      const qv = H.clamp(Math.round(31 - (q / 100) * 29), 2, 31);
      const out = await H.ffmpeg(inBuf, 'jpg', 'jpg', ['-q:v', String(qv)]);
      return c.sock.sendMessage(c.from, { image: out, caption: `Kompres: ${(inBuf.length / 1024).toFixed(0)}KB → ${(out.length / 1024).toFixed(0)}KB` }, { quoted: c.msg });
    },
  },
  tts: {
    help: 'Teks jadi suara: .tts [kode bahasa] <teks>', alias: ['say'],
    run: async (c) => {
      let lang = 'id'; let text = c.rest;
      if (/^[a-z]{2}(-[A-Za-z]{2})?\s/.test(text)) { lang = text.split(/\s/)[0]; text = text.slice(lang.length).trim(); }
      text = text || H.quotedText(c.msg);
      if (!text) return c.reply('Format: .tts id halo semuanya');
      const mp3 = await ttsBuffer(text.slice(0, 900), lang);
      try {
        const ogg = await H.ffmpeg(mp3, 'mp3', 'ogg', ['-vn', '-c:a', 'libopus', '-b:a', '32k']);
        return c.sock.sendMessage(c.from, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: c.msg });
      } catch (_) { return c.sock.sendMessage(c.from, { audio: mp3, mimetype: 'audio/mpeg' }, { quoted: c.msg }); }
    },
  },
  stt: {
    help: 'Voice note jadi teks (reply VN + .stt)', alias: ['transkrip'],
    run: async (c) => {
      const m = needMedia(c, ['audioMessage'], 'Reply voice note dengan .stt');
      const t = await transcribe(await H.downloadMedia(m));
      return c.reply(t ? ` ${t}` : 'Tidak ada ucapan terdeteksi.');
    },
  },
  status: {
    help: 'Download status WA teman: .status (daftar) / .status <no>', owner: true,
    run: async (c) => {
      const list = [...statuses].reverse();
      const n = parseInt(c.args[0], 10);
      if (!n) {
        return c.reply(list.length
          ? '*Status terbaru*\n' + list.slice(0, 15).map((s, i) => `${i + 1}. wa.me/${s.who} — ${s.type}${s.cap ? ' — ' + s.cap.slice(0, 30) : ''}`).join('\n') + '\n\nAmbil: .status <nomor urut>'
          : 'Belum ada status yang masuk sejak bot nyala.');
      }
      const s = list[n - 1]; if (!s) return c.reply('Nomor urut tidak ada.');
      const buf = await H.downloadMedia({ target: { key: s.key, message: s.message } });
      const cap = `Status wa.me/${s.who}`;
      return c.sock.sendMessage(c.from, s.type === 'image' ? { image: buf, caption: cap } : { video: buf, caption: cap }, { quoted: c.msg });
    },
  },
};

module.exports = { commands, onStatus, sendMedia, parseOpts };

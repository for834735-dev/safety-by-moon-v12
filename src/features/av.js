'use strict';
/**
 * Kategori 8 — Audio & Video (10 fitur)
 * potong · kecepatan · bass · nightcore · balik · togif · tovn · frame · vidkompres · mediainfo
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./helpers');
const { S, say } = require('../ui/style');

const AV = ['videoMessage', 'audioMessage', 'documentMessage'];
const VID = ['videoMessage', 'documentMessage'];
const AUD = ['audioMessage', 'videoMessage', 'documentMessage'];
const isVideo = (m) => m.type === 'videoMessage' || /^video\//.test(m.node.mimetype || '');
const MAX_SEC = 180;

/** "1:30", "01:02:03", "45", "45.5" → detik */
function parseTime(s = '') {
  const p = String(s).trim().split(':').map(Number);
  if (!p.length || p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return p.reduce((acc, n) => acc * 60 + n, 0);
}
const fmtTime = (sec) => {
  sec = Math.round(sec); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
/** atempo hanya menerima 0.5–2.0 per filter, jadi dirantai. */
function atempoChain(x) {
  const out = []; let v = x;
  while (v > 2) { out.push('atempo=2'); v /= 2; }
  while (v < 0.5) { out.push('atempo=0.5'); v /= 0.5; }
  out.push(`atempo=${v.toFixed(4)}`);
  return out.join(',');
}

const fps = (r) => { const [a, b] = String(r).split('/').map(Number); return b ? a / b : a; };

function probe(buf) {
  const f = path.join(os.tmpdir(), `sy-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(f, buf);
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => { fs.rmSync(f, { force: true }); reject(new Error('ffprobe belum terpasang (ikut paket ffmpeg)')); });
    p.on('close', () => { fs.rmSync(f, { force: true }); try { resolve(JSON.parse(out)); } catch { reject(new Error('File media tidak bisa dibaca')); } });
  });
}

const sendAudio = (c, buf, cap) => c.sock.sendMessage(c.from, { audio: buf, mimetype: 'audio/mpeg' }, { quoted: c.msg }).then(() => cap && c.reply(cap));
const sendVideo = (c, buf, cap, extra = {}) => c.sock.sendMessage(c.from, { video: buf, caption: cap, ...extra }, { quoted: c.msg });
const VCODEC = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];

const commands = {
  potong: {
    help: 'Potong audio/video: .potong <mulai> <durasi>  (contoh .potong 0:30 15)', alias: ['trim', 'cut'],
    run: async (c) => {
      const start = parseTime(c.args[0]); const dur = parseTime(c.args[1]);
      if (start === null || !dur) return c.reply('Format: .potong <mulai> <durasi>\nContoh: .potong 0:30 15 → mulai menit 0:30 selama 15 detik (reply audio/video)');
      const m = H.need(c, AV, 'Reply audio atau video dengan .potong');
      const d = Math.min(dur, MAX_SEC);
      if (isVideo(m)) return sendVideo(c, await H.ffmpeg(await H.downloadMedia(m), 'mp4', 'mp4', ['-ss', String(start), '-t', String(d), ...VCODEC]), say('ok', `Dipotong ${fmtTime(start)} selama ${fmtTime(d)}`));
      return sendAudio(c, await H.ffmpeg(await H.downloadMedia(m), 'ogg', 'mp3', ['-ss', String(start), '-t', String(d), '-vn', '-b:a', '160k']), say('ok', `Dipotong ${fmtTime(start)} selama ${fmtTime(d)}`));
    },
  },
  kecepatan: {
    help: 'Ubah kecepatan: .kecepatan <0.25-4>  (1.5 = lebih cepat, 0.8 = lebih lambat)', alias: ['speedup', 'tempo'],
    run: async (c) => {
      const x = parseFloat((c.args[0] || '').replace(',', '.'));
      if (!(x >= 0.25 && x <= 4)) return c.reply('Format: .kecepatan <0.25-4>\nContoh: .kecepatan 1.5 (reply audio/video)');
      const m = H.need(c, AV, 'Reply audio atau video dengan .kecepatan 1.5');
      const buf = await H.downloadMedia(m);
      if (isVideo(m)) return sendVideo(c, await H.ffmpeg(buf, 'mp4', 'mp4', ['-t', String(MAX_SEC), '-vf', `setpts=PTS/${x}`, '-af', atempoChain(x), ...VCODEC]), say('ok', `Kecepatan ${x}x`));
      return sendAudio(c, await H.ffmpeg(buf, 'ogg', 'mp3', ['-vn', '-af', atempoChain(x), '-b:a', '160k']), say('ok', `Kecepatan ${x}x`));
    },
  },
  bass: {
    help: 'Tambah bass audio: .bass [level 1-20]', alias: ['bassboost'],
    run: async (c) => {
      const g = H.clamp(parseInt(c.args[0], 10) || 8, 1, 20);
      const m = H.need(c, AUD, 'Reply audio/voice note/video dengan .bass');
      return sendAudio(c, await H.ffmpeg(await H.downloadMedia(m), 'ogg', 'mp3', ['-vn', '-af', `bass=g=${g}:f=110:w=0.6,alimiter=limit=0.95`, '-b:a', '160k']), say('ok', `Bass boost level ${g}`));
    },
  },
  nightcore: {
    help: 'Efek nightcore (lebih cepat & tinggi): .nightcore [1.1-1.6]', alias: ['nc'],
    run: async (c) => {
      const r = H.numOr((c.args[0] || '').replace(',', '.'), 1.25, 1.05, 1.6);
      const m = H.need(c, AUD, 'Reply audio/voice note/video dengan .nightcore');
      return sendAudio(c, await H.ffmpeg(await H.downloadMedia(m), 'ogg', 'mp3', ['-vn', '-af', `asetrate=${Math.round(44100 * r)},aresample=44100`, '-b:a', '160k']), say('ok', `Nightcore ${r}x`));
    },
  },
  balik: {
    help: 'Putar mundur audio/video (maks 60 detik): reply + .balik', alias: ['reverse'],
    run: async (c) => {
      const m = H.need(c, AV, 'Reply audio atau video dengan .balik');
      const buf = await H.downloadMedia(m);
      if (isVideo(m)) return sendVideo(c, await H.ffmpeg(buf, 'mp4', 'mp4', ['-t', '60', '-vf', 'reverse', '-af', 'areverse', ...VCODEC]), say('ok', 'Video diputar mundur'));
      return sendAudio(c, await H.ffmpeg(buf, 'ogg', 'mp3', ['-t', '60', '-vn', '-af', 'areverse', '-b:a', '160k']), say('ok', 'Audio diputar mundur'));
    },
  },
  togif: {
    help: 'Video jadi GIF (maks 10 detik): reply video + .togif', alias: ['gif'],
    run: async (c) => {
      const m = H.need(c, VID, 'Reply video dengan .togif');
      const out = await H.ffmpeg(await H.downloadMedia(m), 'mp4', 'mp4', ['-t', '10', '-an', '-vf', 'fps=15,scale=480:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']);
      return sendVideo(c, out, '', { gifPlayback: true });
    },
  },
  tovn: {
    help: 'Audio/video jadi voice note: reply + .tovn', alias: ['vn', 'keptt'],
    run: async (c) => {
      const m = H.need(c, AUD, 'Reply audio atau video dengan .tovn');
      const out = await H.ffmpeg(await H.downloadMedia(m), 'ogg', 'ogg', ['-t', String(MAX_SEC), '-vn', '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1']);
      return c.sock.sendMessage(c.from, { audio: out, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: c.msg });
    },
  },
  frame: {
    help: 'Ambil satu gambar dari video: .frame <waktu>  (contoh .frame 0:12)', alias: ['ss', 'tangkap'],
    run: async (c) => {
      const t = parseTime(c.args[0] || '0');
      if (t === null) return c.reply('Format: .frame <waktu>\nContoh: .frame 0:12 (reply video)');
      const m = H.need(c, VID, 'Reply video dengan .frame 0:12');
      const out = await H.ffmpeg(await H.downloadMedia(m), 'mp4', 'jpg', ['-ss', String(t), '-frames:v', '1', '-q:v', '2']);
      return H.sendImage(c, out, { caption: say('ok', `Frame pada ${fmtTime(t)}`) });
    },
  },
  vidkompres: {
    help: 'Kecilkan ukuran video: .vidkompres [kualitas 10-90] [tinggi 240-1080]', alias: ['kompresvideo', 'vcompress'],
    run: async (c) => {
      const q = H.clamp(parseInt(c.args[0], 10) || 50, 10, 90);
      const hgt = H.clamp(parseInt(c.args[1], 10) || 480, 240, 1080);
      const m = H.need(c, VID, 'Reply video dengan .vidkompres [kualitas]');
      const inBuf = await H.downloadMedia(m);
      const crf = Math.round(36 - (q / 100) * 18); // q90 → crf 20, q10 → crf 34
      const out = await H.ffmpeg(inBuf, 'mp4', 'mp4', ['-t', String(MAX_SEC * 2), '-vf', `scale=-2:'min(${hgt},ih)'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart']);
      const kb = (b) => (b.length / 1048576).toFixed(2) + ' MB';
      return sendVideo(c, out, `${S.ok} Video dikompres\n${S.dot} ${kb(inBuf)} ${S.arrow} ${kb(out)}\n${S.dot} kualitas ${q} · tinggi ${hgt}p`);
    },
  },
  mediainfo: {
    help: 'Info teknis audio/video/gambar: reply media + .mediainfo', alias: ['infomedia'],
    run: async (c) => {
      const m = H.need(c, ['videoMessage', 'audioMessage', 'imageMessage', 'documentMessage', 'stickerMessage'], 'Reply sebuah media dengan .mediainfo');
      const buf = await H.downloadMedia(m);
      const j = await probe(buf);
      const f = j.format || {}; const lines = [];
      lines.push(`${S.dot} Ukuran   : ${(buf.length / 1048576).toFixed(2)} MB`, `${S.dot} Durasi   : ${f.duration ? fmtTime(f.duration) : '-'}`, `${S.dot} Bitrate  : ${f.bit_rate ? Math.round(f.bit_rate / 1000) + ' kbps' : '-'}`, `${S.dot} Wadah    : ${f.format_long_name || f.format_name || '-'}`);
      for (const s of j.streams || []) {
        if (s.codec_type === 'video') lines.push(`${S.dot} Video    : ${s.codec_name} ${s.width}×${s.height}${s.r_frame_rate && s.r_frame_rate !== '0/0' ? ' @' + Math.round(fps(s.r_frame_rate)) + 'fps' : ''}`);
        if (s.codec_type === 'audio') lines.push(`${S.dot} Audio    : ${s.codec_name} ${s.sample_rate || ''}Hz ${s.channels || ''}ch`);
      }
      return c.reply(`${S.ok} Informasi media\n${lines.join('\n')}`);
    },
  },
};

module.exports = { commands, parseTime, atempoChain, fmtTime };

'use strict';
/** Provider utama: yt-dlp (lokal). Mendukung ratusan situs; hasil disimpan ke folder sementara. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const config = require('../../config');

let resolved; // { cmd, pre:[] } | null
function resolveBinary() {
  if (resolved !== undefined) return resolved;
  const local = path.join(config.ROOT, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const tries = [
    config.download.ytdlpPath && { cmd: config.download.ytdlpPath, pre: [] },
    fs.existsSync(local) && { cmd: local, pre: [] },
    { cmd: 'yt-dlp', pre: [] },
    { cmd: 'python3', pre: ['-m', 'yt_dlp'] },
    { cmd: 'python', pre: ['-m', 'yt_dlp'] },
  ].filter(Boolean);
  resolved = tries.find((t) => { try { return spawnSync(t.cmd, [...t.pre, '--version'], { timeout: 8000 }).status === 0; } catch { return false; } }) || null;
  return resolved;
}
const available = () => Boolean(resolveBinary());

function run(args, timeoutSec) {
  const bin = resolveBinary();
  return new Promise((resolve, reject) => {
    const p = spawn(bin.cmd, [...bin.pre, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('yt-dlp melewati batas waktu')); }, timeoutSec * 1000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      const line = err.split('\n').filter((l) => /ERROR/.test(l)).pop() || err.slice(-200);
      reject(new Error(line.replace(/^ERROR:\s*/, '').slice(0, 200) || 'yt-dlp gagal'));
    });
  });
}

/**
 * @param {string} target link ATAU "ytsearch1:kata kunci"
 * @param {{mode:'audio'|'video', quality?:string}} o
 * @returns {{file:string, title:string, ext:string, mode:string, duration:number}}
 */
async function fetchMedia(target, { mode = 'audio', quality = '720' } = {}) {
  if (!available()) throw new Error('yt-dlp belum terpasang');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-dl-'));
  const maxMb = config.download.maxMb;
  const args = ['--no-playlist', '--no-warnings', '--no-progress', '--restrict-filenames', '--max-filesize', `${maxMb}M`,
    '-o', path.join(dir, '%(id)s.%(ext)s'), '--print', 'after_move:%(title)s\t%(duration)s\t%(filepath)s'];
  if (config.download.cookies) args.push('--cookies', config.download.cookies);
  if (mode === 'audio') {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '128K', '--embed-metadata');
  } else {
    const h = /^\d+$/.test(quality) ? quality : '720';
    args.push('-f', `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/bv*[height<=${h}]+ba/b[height<=${h}]/b`, '--merge-output-format', 'mp4');
  }
  args.push(target);
  try {
    const out = await run(args, config.download.timeoutSec);
    const line = out.trim().split('\n').filter(Boolean).pop() || '';
    const [title, dur, filepath] = line.split('\t');
    const file = filepath && fs.existsSync(filepath) ? filepath : fs.readdirSync(dir).map((f) => path.join(dir, f))[0];
    if (!file || !fs.existsSync(file)) throw new Error('File hasil unduhan tidak ditemukan');
    return { file, dir, title: title || 'media', duration: Number(dur) || 0, ext: path.extname(file).slice(1), mode };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

module.exports = { name: 'ytdlp', available, fetchMedia, run, resolveBinary };

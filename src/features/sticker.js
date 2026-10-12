const { spawn } = require('child_process');
const crypto = require('crypto');
const WebP = require('node-webpmux');

const DEFAULT_PACK = 'Safety Your WhatsApp';
const DEFAULT_AUTHOR = 'by Moon';

function runFfmpeg(inputBuffer, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      ...args,
      '-f', 'webp',
      'pipe:1',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const chunks = [];
    const errors = [];

    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (chunk) => errors.push(chunk));

    proc.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('FFmpeg belum terpasang. Jalankan: pkg install ffmpeg'));
        return;
      }
      reject(error);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }

      const detail = Buffer.concat(errors).toString('utf8').trim();
      reject(new Error(detail || `FFmpeg gagal dengan exit code ${code}`));
    });

    proc.stdin.end(inputBuffer);
  });
}

function createExif({ pack, author, categories = [], id }) {
  const metadata = {
    emojis: categories,
    'sticker-pack-id': id,
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
  };

  const data = JSON.stringify(metadata);
  const exif = Buffer.concat([
    Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00,
      0x00, 0x00,
    ]),
    Buffer.from(data, 'utf8'),
  ]);

  // The sticker metadata format stores the JSON byte length here.
  exif.writeUIntLE(Buffer.byteLength(data, 'utf8'), 14, 4);

  return exif;
}

async function attachMetadata(webpBuffer, options) {
  const image = new WebP.Image();
  await image.load(webpBuffer);
  image.exif = createExif(options);
  return image.save(null);
}

function normalizeOptions(options = {}) {
  const pack = String(options.pack || DEFAULT_PACK).slice(0, 64);
  const author = String(options.author || DEFAULT_AUTHOR).slice(0, 64);
  const qualityNumber = Number.isFinite(Number(options.quality))
    ? Math.max(1, Math.min(100, Math.round(Number(options.quality))))
    : 70;

  return {
    pack,
    author,
    quality: qualityNumber,
    categories: Array.isArray(options.categories) ? options.categories.slice(0, 3) : [],
    id: String(options.id || `safety-${crypto.randomBytes(8).toString('hex')}`).slice(0, 128),
  };
}

function imageFilter() {
  return [
    'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos',
    'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0.0',
    'format=yuva420p',
  ].join(',');
}

function animatedFilter() {
  return [
    'fps=12',
    'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos',
    'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0.0',
    'format=yuva420p',
  ].join(',');
}

async function makeStickerFromBuffer(
  buffer,
  { pack = DEFAULT_PACK, author = DEFAULT_AUTHOR, quality = 70, animated = false, categories = [] } = {},
) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Media kosong atau format buffer tidak valid.');
  }

  const options = normalizeOptions({ pack, author, quality, categories });

  const args = animated
    ? [
        '-t', '7',
        '-vf', animatedFilter(),
        '-c:v', 'libwebp_anim',
        '-loop', '0',
        '-q:v', String(options.quality),
        '-compression_level', '4',
      ]
    : [
        '-frames:v', '1',
        '-vf', imageFilter(),
        '-c:v', 'libwebp',
        '-q:v', String(options.quality),
        '-compression_level', '4',
      ];

  const webp = await runFfmpeg(buffer, args);
  return attachMetadata(webp, options);
}

module.exports = { makeStickerFromBuffer };

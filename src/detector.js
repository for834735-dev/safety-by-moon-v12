/**
 * Deteksi pola pesan mencurigakan (virtex/bug/spam).
 * Ini bagian INTI dari fitur keamanan — sengaja cuma mendeteksi & melaporkan,
 * bukan bikin/ngirim payload apapun.
 */
function isSuspicious(text = '', mentionedJid = []) {
  if (!text) return { suspicious: false };

  // 1) Payload teks kepanjangan (ciri khas virtex)
  if (text.length > 3000) {
    return {
      suspicious: true,
      type: 'Virtex',
      reason: `Payload teks sepanjang ${text.length} karakter`,
    };
  }

  // 2) Karakter unicode tersembunyi/berbahaya (zero-width, RTL override, dll)
  const zeroWidthMatches = text.match(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g) || [];
  if (zeroWidthMatches.length > 20) {
    return {
      suspicious: true,
      type: 'Bug Unicode',
      reason: `${zeroWidthMatches.length} karakter unicode tersembunyi terdeteksi`,
    };
  }

  // 3) Mention flood
  if (mentionedJid.length > 15) {
    return {
      suspicious: true,
      type: 'Mention Flood',
      reason: `${mentionedJid.length} akun di-mention sekaligus`,
    };
  }

  // 4) Karakter yang sama diulang ekstrem
  if (/(.)\1{200,}/.test(text)) {
    return {
      suspicious: true,
      type: 'Virtex',
      reason: 'Karakter berulang ekstrem terdeteksi',
    };
  }

  return { suspicious: false };
}

module.exports = { isSuspicious };

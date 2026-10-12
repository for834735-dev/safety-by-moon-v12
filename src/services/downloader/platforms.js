'use strict';
/** Daftar platform yang dikenali dan cara mendeteksinya dari link. */
const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', re: /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i },
  { id: 'tiktok', label: 'TikTok', re: /(?:tiktok\.com|vt\.tiktok|vm\.tiktok)/i },
  { id: 'instagram', label: 'Instagram', re: /(?:instagram\.com|instagr\.am)/i },
  { id: 'facebook', label: 'Facebook', re: /(?:facebook\.com|fb\.watch|fb\.com)/i },
  { id: 'twitter', label: 'X / Twitter', re: /(?:twitter\.com|x\.com|t\.co)\//i },
  { id: 'threads', label: 'Threads', re: /threads\.(?:net|com)/i },
  { id: 'soundcloud', label: 'SoundCloud', re: /soundcloud\.com/i },
  { id: 'pinterest', label: 'Pinterest', re: /(?:pinterest\.\w+|pin\.it)/i },
  { id: 'reddit', label: 'Reddit', re: /(?:reddit\.com|redd\.it)/i },
  { id: 'twitch', label: 'Twitch', re: /twitch\.tv/i },
  { id: 'vimeo', label: 'Vimeo', re: /vimeo\.com/i },
  { id: 'dailymotion', label: 'Dailymotion', re: /(?:dailymotion\.com|dai\.ly)/i },
  { id: 'bilibili', label: 'Bilibili', re: /(?:bilibili\.com|b23\.tv)/i },
  { id: 'likee', label: 'Likee', re: /likee\.video/i },
  { id: 'snackvideo', label: 'Snack Video', re: /snackvideo\.com/i },
];

const URL_RE = /https?:\/\/[^\s<>"']+/i;

function extractUrl(text = '') {
  const m = String(text).match(URL_RE);
  return m ? m[0].replace(/[).,]+$/, '') : null;
}

function detect(url = '') {
  return PLATFORMS.find((p) => p.re.test(url)) || null;
}

module.exports = { PLATFORMS, extractUrl, detect };

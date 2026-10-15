// plugins/songcard.js
// SHAN MINI BOT — Now Playing song card (1280x720 image)
// ESM Plugin | Install: npm i ytmusic-api yt-search sharp
// Usage: .songcard <song name>   (alias: .npcard)

'use strict';

import sharp from 'sharp';
import yts from 'yt-search';
import YTMusic from 'ytmusic-api';

/* ========================= CONFIG ========================= */

const WIDTH = 1280;
const HEIGHT = 720;
const BRAND = 'SHAN MINI BOT';
const PROGRESS = 0.35; // progress bar fill (0 - 1)

/* ========================= HELPERS ========================= */

let ytm = null;
async function getYTMusic() {
  if (!ytm) {
    ytm = new YTMusic();
    await ytm.initialize();
  }
  return ytm;
}

function esc(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDuration(seconds = 0) {
  seconds = Number(seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function secondsFromTimestamp(ts = '') {
  const parts = String(ts).split(':').map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

// text එක width එකට ගැලපෙන්න font size අඩු කරනවා / කපනවා
function fitText(text, maxWidth, maxSize, minSize, factor) {
  let value = String(text || '').trim();
  let size = Math.min(maxSize, maxWidth / (Math.max(value.length, 1) * factor));

  if (size < minSize) {
    size = minSize;
    const maxChars = Math.max(4, Math.floor(maxWidth / (minSize * factor)));
    if (value.length > maxChars) value = value.slice(0, maxChars - 1).trimEnd() + '…';
  }

  return { text: value, size: Math.round(size) };
}

function upgradeThumb(url = '') {
  // Google image URL නම් high-res එකක් ගන්නවා
  return String(url).replace(/=w\d+-h\d+[^&?]*$/i, '=w800-h800-l90-rj');
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/* ========================= SEARCH ========================= */

async function findSong(query) {
  // YouTube link එකක් නම්
  if (/youtube\.com|youtu\.be/i.test(query)) {
    const detail = await yts(query);
    const vid = detail?.videos?.[0];
    if (!vid) throw new Error('Video not found');

    return {
      title: vid.title || 'Unknown',
      artist: vid.author?.name || 'YouTube',
      duration: formatDuration(secondsFromTimestamp(vid.timestamp)),
      thumb: vid.thumbnail || ''
    };
  }

  try {
    const music = await getYTMusic();
    const songs = await music.search(query);
    const track = songs.find(s => s.type === 'SONG') || songs[0];

    if (track?.name || track?.title) {
      const artist = track.artists?.length
        ? track.artists.map(a => a.name).join(', ')
        : track.artist?.name || 'Unknown Artist';

      const thumbs = track.thumbnails || [];

      // YT Music search result එකේ duration නැති වෙලාවල් තියෙනවා → yt-search වලින් ගන්නවා
      let durationSec = Number(track.duration) || 0;

      if (!durationSec && track.videoId) {
        try {
          const info = await yts({ videoId: track.videoId });
          durationSec = Number(info?.seconds) || secondsFromTimestamp(info?.timestamp);
        } catch {}
      }

      if (!durationSec) {
        try {
          const found = await yts(`${track.name || track.title} ${artist}`);
          const vid = found?.videos?.[0];
          durationSec = Number(vid?.seconds) || secondsFromTimestamp(vid?.timestamp);
        } catch {}
      }

      return {
        title: track.name || track.title,
        artist,
        duration: formatDuration(durationSec),
        thumb: thumbs.length ? thumbs[thumbs.length - 1].url : ''
      };
    }
  } catch {}

  // fallback: yt-search
  const result = await yts(query);
  const vid = result?.videos?.[0];
  if (!vid) throw new Error('Song not found');

  return {
    title: vid.title || 'Unknown',
    artist: vid.author?.name || 'YouTube',
    duration: formatDuration(secondsFromTimestamp(vid.timestamp)),
    thumb: vid.thumbnail || ''
  };
}

/* ========================= IMAGE ========================= */

async function createCard({ title, artist, duration, coverBuffer }) {
  // 1) Blurred background
  const background = await sharp(coverBuffer)
    .resize(WIDTH, HEIGHT, { fit: 'cover' })
    .blur(45)
    .modulate({ saturation: 1.5, brightness: 0.75 })
    .toBuffer();

  // 2) Rounded cover (520x520)
  const COVER = 520;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER}" height="${COVER}"><rect width="${COVER}" height="${COVER}" rx="36" ry="36" fill="#fff"/></svg>`
  );

  const cover = await sharp(coverBuffer)
    .resize(COVER, COVER, { fit: 'cover', position: 'center' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 3) Text / UI layer
  const t = fitText(title, 565, 56, 34, 0.62);
  const a = fitText(artist, 565, 34, 24, 0.55);

  const BAR_X = 655;
  const BAR_W = 565;
  const fillX = Math.round(BAR_X + BAR_W * PROGRESS);

  const ui = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgba(0,0,0,0.25)"/>

  <!-- NOW PLAYING pill -->
  <rect x="655" y="150" width="230" height="46" rx="23" fill="rgba(255,255,255,0.16)"/>
  <circle cx="683" cy="173" r="7" fill="#1ed760"/>
  <text x="701" y="181" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="2.5" fill="#ffffff">NOW PLAYING</text>

  <!-- Title / Artist -->
  <text x="656" y="250" font-family="DejaVu Sans, Arial, sans-serif" font-size="${t.size}" font-weight="700" fill="#ffffff">${esc(t.text)}</text>
  <text x="656" y="312" font-family="DejaVu Sans, Arial, sans-serif" font-size="${a.size}" fill="rgba(255,255,255,0.72)">${esc(a.text)}</text>

  <!-- Progress -->
  <rect x="${BAR_X}" y="392" width="${BAR_W}" height="8" rx="4" fill="rgba(255,255,255,0.3)"/>
  <rect x="${BAR_X}" y="392" width="${fillX - BAR_X}" height="8" rx="4" fill="#1ed760"/>
  <circle cx="${fillX}" cy="396" r="11" fill="#ffffff"/>

  <text x="${BAR_X}" y="434" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="rgba(255,255,255,0.8)">0:00</text>
  <text x="${BAR_X + BAR_W}" y="434" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" text-anchor="end" fill="rgba(255,255,255,0.8)">${esc(duration)}</text>

  <!-- Controls -->
  <rect x="821" y="476" width="5" height="32" fill="#ffffff"/>
  <polygon points="856,476 856,508 830,492" fill="#ffffff"/>

  <circle cx="937" cy="492" r="38" fill="#ffffff"/>
  <polygon points="926,472 926,512 958,492" fill="#111111"/>

  <polygon points="1019,476 1019,508 1045,492" fill="#ffffff"/>
  <rect x="1050" y="476" width="5" height="32" fill="#ffffff"/>

  <!-- Brand -->
  <text x="${WIDTH / 2}" y="686" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" letter-spacing="4" text-anchor="middle" fill="rgba(255,255,255,0.6)">${esc(BRAND)}</text>
</svg>`);

  // 4) Compose
  return sharp(background)
    .composite([
      { input: ui, top: 0, left: 0 },
      { input: cover, top: 90, left: 70 }
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/* ========================= PLUGIN ========================= */

export default {
  name: 'songcard',
  command: ['songcard', 'npcard'],
  alias: [],
  help: ['songcard'],
  tags: ['music'],

  async execute(sock, msg, args = [], commandName = 'songcard') {
    const jid = msg.key.remoteJid;
    const query = args.join(' ').trim();
    const prefix = process.env.PREFIX || '.';

    const react = async emoji => {
      try {
        await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
      } catch {}
    };

    if (!query) {
      await sock.sendMessage(
        jid,
        { text: `🎵 Example:\n${prefix}${commandName} nasuna chamath sangeeth` },
        { quoted: msg }
      );
      return;
    }

    await react('🎧');

    try {
      const song = await findSong(query);

      if (!song.thumb) throw new Error('Cover image not found');

      let coverBuffer;
      try {
        coverBuffer = await fetchBuffer(upgradeThumb(song.thumb));
      } catch {
        coverBuffer = await fetchBuffer(song.thumb);
      }

      const image = await createCard({
        title: song.title,
        artist: song.artist,
        duration: song.duration,
        coverBuffer
      });

      await sock.sendMessage(
        jid,
        {
          image,
          caption: `🎵 *${song.title}*\n👤 ${song.artist}\n⏱️ ${song.duration}\n\n> ${BRAND}`
        },
        { quoted: msg }
      );

      await react('✅');
    } catch (error) {
      await react('❌');
      await sock.sendMessage(
        jid,
        { text: `❌ Song card create කරන්න බැරි වුණා.\n\n> ${error?.message || error}` },
        { quoted: msg }
      );
    }
  }
};

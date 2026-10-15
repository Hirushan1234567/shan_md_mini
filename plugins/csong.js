// plugins/chsong.js
// SHAN MINI BOT V1
// WhatsApp Channel Song Publisher
// Thumbnail: styled 16:9 card (1280x720) using the original song cover
// Audio: Voice note (opus/ogg, ptt) — channels don't play mp3 files
//
// Usage:
// .chsong <channel JID or link> | <song name or YouTube URL>

'use strict';

import { createDecipheriv } from 'crypto';
import { spawn } from 'child_process';
import yts from 'yt-search';
import YTMusic from 'ytmusic-api';
import sharp from 'sharp';

/* =========================================
   CONFIG
========================================= */

const PREFIX = process.env.PREFIX || '.';

const OWNER_NUMBER = String(
  process.env.OWNER_NUMBER || '94752661225'
).replace(/\D/g, '');

const MAX_AUDIO_MB = Number(process.env.MAX_AUDIO_MB || 2048);
const MAX_AUDIO_SIZE = MAX_AUDIO_MB * 1024 * 1024;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const METADATA_DECRYPTION_KEY = Buffer.from(
  'C5D58EF67A7584E4A29F6C35BBC4EB12',
  'hex'
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://yt.savetube.me',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'
};

// ffmpeg path: use ffmpeg-static if installed, otherwise system ffmpeg
let FFMPEG_PATH = 'ffmpeg';

try {
  const mod = await import('ffmpeg-static');
  if (mod?.default) FFMPEG_PATH = mod.default;
} catch {
  // ffmpeg-static not installed, use system ffmpeg
}

/* =========================================
   HELPERS
========================================= */

function cleanNumber(value = '') {
  return String(value)
    .split(':')[0]
    .split('@')[0]
    .replace(/\D/g, '');
}

function isOwner(msg) {
  if (msg?.key?.fromMe === true) return true;

  const key = msg?.key || {};

  const values = [
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid
  ];

  return values.some(
    value => value && cleanNumber(value) === OWNER_NUMBER
  );
}

async function react(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: {
        text: emoji,
        key: msg.key
      }
    });
  } catch {}
}

function box(title, lines = [], footer = true) {
  const body = lines
    .map(line => line === '' ? '┃' : `┃ ${line}`)
    .join('\n');

  const tail = footer
    ? '\n> ✨ _Powered by SHAN MINI BOT_'
    : '';

  return `╭━━━〔 *${title}* 〕
┃
${body}
┃
╰━━━━━━━━━━━━━━━━━━${tail}`;
}

function formatDuration(seconds = 0) {
  seconds = Number(seconds);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  return `${m}:${String(s).padStart(2, '0')}`;
}

/* =========================================
   INPUT PARSING
========================================= */

function parseInput(args) {
  const raw = (args || []).join(' ').trim();

  if (!raw) {
    return { channel: '', query: '' };
  }

  if (raw.includes('|')) {
    const [first, ...rest] = raw.split('|');

    return {
      channel: first.trim(),
      query: rest.join('|').trim()
    };
  }

  const match = raw.match(
    /(?:\d{8,}@newsletter|https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[A-Za-z0-9_-]+)/i
  );

  if (match) {
    return {
      channel: match[0],
      query: raw.replace(match[0], '').trim()
    };
  }

  return {
    channel: '',
    query: raw
  };
}

/* =========================================
   CHANNEL RESOLUTION
========================================= */

async function resolveChannelJid(sock, value) {
  const input = String(value || '').trim();

  if (!input) return null;

  const jidMatch = input.match(/\d{8,}@newsletter/i);

  if (jidMatch) {
    return jidMatch[0];
  }

  const linkMatch = input.match(
    /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
  );

  if (linkMatch) {
    const metadata = await sock.newsletterMetadata(
      'invite',
      linkMatch[1]
    );

    return metadata?.id || null;
  }

  return null;
}

/* =========================================
   CHANNEL ACCESS
========================================= */

async function checkChannelAccess(sock, channelJid) {
  try {
    const metadata = await sock.newsletterMetadata(
      'jid',
      channelJid
    );

    const role = String(
      metadata?.viewer_metadata?.role ||
      metadata?.viewerMetadata?.role ||
      metadata?.role ||
      ''
    ).toUpperCase();

    const botNumber = cleanNumber(sock?.user?.id || '');
    const channelOwner = cleanNumber(metadata?.owner || '');

    const isChannelOwner = Boolean(
      botNumber &&
      channelOwner &&
      botNumber === channelOwner
    );

    const name =
      metadata?.name ||
      metadata?.thread_metadata?.name?.text ||
      '';

    const invite = String(
      metadata?.invite ||
      metadata?.thread_metadata?.invite ||
      ''
    ).trim();

    if (
      isChannelOwner ||
      role === 'OWNER' ||
      role === 'ADMIN'
    ) {
      return {
        allowed: true,
        role: isChannelOwner ? 'OWNER' : role,
        name,
        invite
      };
    }

    if (role) {
      return {
        allowed: false,
        role,
        name,
        invite
      };
    }

    return {
      allowed: null,
      role: '',
      name,
      invite
    };
  } catch (error) {
    console.error(
      '[chsong] Channel access check:',
      error?.message || error
    );

    return {
      allowed: null,
      role: '',
      name: '',
      invite: ''
    };
  }
}

/* =========================================
   SONG SEARCH
========================================= */

let ytMusicInstance = null;

async function getYTMusic() {
  if (!ytMusicInstance) {
    const instance = new YTMusic();

    await instance.initialize();

    ytMusicInstance = instance;
  }

  return ytMusicInstance;
}

async function findSong(query) {
  if (!query) {
    throw new Error('ගීතයේ නම ඇතුළත් කරන්න.');
  }

  // Direct YouTube link
  if (/youtube\.com|youtu\.be/i.test(query)) {
    const result = await yts(query);
    const video = result?.videos?.[0];

    if (!video) {
      throw new Error('YouTube වීඩියෝව සොයාගත නොහැක.');
    }

    return {
      url: video.url || query,
      title: video.title || 'Unknown Song',
      artist: video.author?.name || 'Unknown Artist',
      duration: video.timestamp || '0:00',
      thumbUrl: video.thumbnail || ''
    };
  }

  // Search by song name
  const ytm = await getYTMusic();
  const results = await ytm.search(query);

  const track = results.find(
    item => item.type === 'SONG' && item.videoId
  ) || results.find(item => item.videoId);

  if (!track?.videoId) {
    throw new Error('ගීතය සොයාගත නොහැක.');
  }

  return {
    url: `https://www.youtube.com/watch?v=${track.videoId}`,
    title: track.name || track.title || 'Unknown Song',
    artist: track.artists?.length
      ? track.artists.map(artist => artist.name).join(', ')
      : track.artist?.name || 'Unknown Artist',
    duration: formatDuration(Number(track.duration || 0)),
    thumbUrl: track.thumbnails?.length
      ? track.thumbnails[track.thumbnails.length - 1].url
      : ''
  };
}

/* =========================================
   SAVETUBE AUDIO DOWNLOAD
========================================= */

async function savetube(url) {
  const idMatch = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/
  );

  if (!idMatch) {
    throw new Error('YouTube සබැඳිය වලංගු නැහැ.');
  }

  const videoId = idMatch[1];

  const cdnResponse = await fetch(
    'https://media.savetube.vip/api/random-cdn',
    {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000)
    }
  );

  if (!cdnResponse.ok) {
    throw new Error('Download server එක සම්බන්ධ කරගත නොහැක.');
  }

  const cdnData = await cdnResponse.json();
  const cdn = cdnData?.cdn;

  if (!cdn) {
    throw new Error('CDN එක සොයාගත නොහැක.');
  }

  const infoResponse = await fetch(`https://${cdn}/v2/info`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      url: `https://www.youtube.com/watch?v=${videoId}`
    }),
    signal: AbortSignal.timeout(25000)
  });

  if (!infoResponse.ok) {
    throw new Error('Song metadata ලබාගත නොහැක.');
  }

  const info = await infoResponse.json();

  if (!info?.data) {
    throw new Error('Song metadata හිස්.');
  }

  let metadata;

  try {
    const encrypted = Buffer.from(info.data, 'base64');

    if (encrypted.length <= 16) {
      throw new Error('Invalid encrypted metadata.');
    }

    const decipher = createDecipheriv(
      'aes-128-cbc',
      METADATA_DECRYPTION_KEY,
      encrypted.subarray(0, 16)
    );

    const decrypted = Buffer.concat([
      decipher.update(encrypted.subarray(16)),
      decipher.final()
    ]);

    metadata = JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new Error('Song metadata විකේතනය අසාර්ථකයි.');
  }

  if (!metadata?.key) {
    throw new Error('Download key එක සොයාගත නොහැක.');
  }

  const downloadResponse = await fetch(
    `https://${cdn}/download`,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        id: videoId,
        downloadType: 'audio',
        quality: '128kbps',
        key: metadata.key
      }),
      signal: AbortSignal.timeout(25000)
    }
  );

  if (!downloadResponse.ok) {
    throw new Error('Audio download request එක අසාර්ථකයි.');
  }

  const downloadData = await downloadResponse.json();

  if (!downloadData?.data?.downloadUrl) {
    throw new Error(
      downloadData?.message || 'Audio download link එක නැහැ.'
    );
  }

  return downloadData.data.downloadUrl;
}

async function downloadAudioBuffer(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': HEADERS['User-Agent']
    },
    signal: AbortSignal.timeout(900000)
  });

  if (!response.ok) {
    throw new Error(`Audio download failed (${response.status}).`);
  }

  const declaredLength = Number(
    response.headers.get('content-length') || 0
  );

  if (declaredLength > MAX_AUDIO_SIZE) {
    throw new Error(`Audio ගොනුව ${MAX_AUDIO_MB} MB සීමාව ඉක්මවයි.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (!buffer.length || buffer.length > MAX_AUDIO_SIZE) {
    throw new Error('Audio file එකේ ප්‍රමාණය වැරදියි.');
  }

  return buffer;
}

/* =========================================
   MP3 → OPUS VOICE NOTE CONVERSION
========================================= */

function toOpusVoice(inputBuffer) {
  return new Promise((resolve, reject) => {
    let ff;

    try {
      ff = spawn(FFMPEG_PATH, [
        '-i', 'pipe:0',
        '-vn',
        '-c:a', 'libopus',
        '-b:a', '48k',
        '-ar', '48000',
        '-ac', '1',
        '-application', 'voip',
        '-f', 'ogg',
        'pipe:1'
      ]);
    } catch (error) {
      return reject(
        new Error('ffmpeg ක්‍රියාත්මක කළ නොහැක: ' + error.message)
      );
    }

    const chunks = [];

    ff.stdout.on('data', chunk => chunks.push(chunk));
    ff.stderr.on('data', () => {});

    ff.on('error', error => {
      reject(
        new Error('ffmpeg ක්‍රියාත්මක කළ නොහැක: ' + error.message)
      );
    });

    ff.on('close', code => {
      const output = Buffer.concat(chunks);

      if (code !== 0 || !output.length) {
        return reject(new Error('Voice note බවට convert කළ නොහැක.'));
      }

      resolve(output);
    });

    ff.stdin.on('error', () => {});
    ff.stdin.end(inputBuffer);
  });
}

/* =========================================
   THUMBNAIL — STYLED 16:9 CARD (1280x720)
   Uses the ORIGINAL song cover, no distortion.
========================================= */

const CARD_W = 1280;
const CARD_H = 720;

function upgradeThumbUrl(url = '') {
  if (!url) return '';

  // YouTube Music album art (googleusercontent) -> large square art
  if (/=w\d+-h\d+/.test(url)) {
    return url.replace(/=w\d+-h\d+/, '=w1200-h1200');
  }

  // YouTube video thumbnail -> max resolution
  if (
    /i\.ytimg\.com\/vi\/[^/]+\/(default|mqdefault|hqdefault|sddefault)\.jpg/.test(url)
  ) {
    return url.replace(
      /(default|mqdefault|hqdefault|sddefault)\.jpg(\?.*)?$/,
      'maxresdefault.jpg'
    );
  }

  return url;
}

async function fetchImageBuffer(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': HEADERS['User-Agent']
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error('Thumbnail එක ලබාගත නොහැක.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (!buffer.length || buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('Thumbnail image එකේ size එක වැරදියි.');
  }

  return buffer;
}

async function getRawCover(url = '') {
  if (!url) return null;

  const candidates = [upgradeThumbUrl(url), url];

  // maxresdefault sometimes doesn't exist, try hqdefault too
  if (/maxresdefault/.test(candidates[0])) {
    candidates.splice(1, 0, candidates[0].replace('maxresdefault', 'hqdefault'));
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      return await fetchImageBuffer(candidate);
    } catch {}
  }

  return null;
}

function escapeXml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text = '', maxChars = 22, maxLines = 2) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);

  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] =
      cut[maxLines - 1].slice(0, Math.max(1, maxChars - 1)).trim() + '…';
    return cut;
  }

  return lines.length ? lines : [''];
}

function truncate(text = '', max = 30) {
  const value = String(text).trim();
  return value.length > max ? value.slice(0, max - 1).trim() + '…' : value;
}

async function createSongCard(song, rawCover) {
  const meta = await sharp(rawCover).metadata();
  const ratio = (meta.width || 1) / (meta.height || 1);
  const landscape = ratio > 1.3;

  // Cover box: square for album art, 16:9 for video thumbnails
  const artW = landscape ? 560 : 520;
  const artH = landscape ? 315 : 520;
  const artX = 70;
  const artY = Math.round((CARD_H - artH) / 2) - 10;
  const radius = 30;

  // 1) Blurred, darkened background from the same cover
  const background = await sharp(rawCover)
    .resize(CARD_W, CARD_H, { fit: 'cover', position: 'centre' })
    .blur(45)
    .modulate({ brightness: 0.45, saturation: 1.35 })
    .toBuffer();

  // 2) Rounded cover (original, not stretched)
  const roundMask = Buffer.from(
    `<svg width="${artW}" height="${artH}" xmlns="http://www.w3.org/2000/svg">
       <rect width="${artW}" height="${artH}" rx="${radius}" ry="${radius}" fill="#fff"/>
     </svg>`
  );

  const art = await sharp(rawCover)
    .resize(artW, artH, { fit: 'cover', position: 'centre' })
    .composite([{ input: roundMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 3) Shadow behind the cover
  const shadow = Buffer.from(
    `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
       <defs>
         <filter id="b" x="-30%" y="-30%" width="160%" height="160%">
           <feGaussianBlur stdDeviation="22"/>
         </filter>
       </defs>
       <rect x="${artX}" y="${artY + 18}" width="${artW}" height="${artH}"
             rx="${radius}" ry="${radius}" fill="#000" opacity="0.6" filter="url(#b)"/>
     </svg>`
  );

  // 4) Text / player UI
  const textX = artX + artW + 65;
  const textW = CARD_W - textX - 60;

  const titleLines = wrapText(song.title, landscape ? 20 : 22, 2);
  const artist = escapeXml(truncate(song.artist, 30));
  const duration = escapeXml(song.duration || '0:00');

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="${textX}" y="${250 + i * 62}" font-size="54" font-weight="700"
               fill="#ffffff">${escapeXml(line)}</text>`
    )
    .join('\n');

  const afterTitleY = 250 + (titleLines.length - 1) * 62;
  const artistY = afterTitleY + 62;
  const barY = artistY + 80;
  const barW = textW;
  const filled = Math.round(barW * 0.32);
  const ctrlY = barY + 100;
  const ctrlCx = textX + barW / 2;

  const ui = Buffer.from(
    `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"
          font-family="Segoe UI, Noto Sans, DejaVu Sans, Arial, sans-serif">

       <!-- Now playing pill -->
       <rect x="${textX}" y="150" width="230" height="46" rx="23"
             fill="#ffffff" opacity="0.18"/>
       <circle cx="${textX + 28}" cy="173" r="7" fill="#25D366"/>
       <text x="${textX + 46}" y="181" font-size="22" font-weight="700"
             letter-spacing="2" fill="#ffffff">NOW PLAYING</text>

       ${titleSvg}

       <text x="${textX}" y="${artistY}" font-size="32" fill="#e2e2e2"
             opacity="0.9">${artist}</text>

       <!-- Progress bar -->
       <rect x="${textX}" y="${barY}" width="${barW}" height="8" rx="4"
             fill="#ffffff" opacity="0.28"/>
       <rect x="${textX}" y="${barY}" width="${filled}" height="8" rx="4"
             fill="#25D366"/>
       <circle cx="${textX + filled}" cy="${barY + 4}" r="11" fill="#ffffff"/>
       <text x="${textX}" y="${barY + 42}" font-size="22" fill="#dddddd">0:00</text>
       <text x="${textX + barW}" y="${barY + 42}" font-size="22" fill="#dddddd"
             text-anchor="end">${duration}</text>

       <!-- Player controls -->
       <polygon points="${ctrlCx - 110},${ctrlY} ${ctrlCx - 82},${ctrlY - 17} ${ctrlCx - 82},${ctrlY + 17}"
                fill="#ffffff"/>
       <rect x="${ctrlCx - 116}" y="${ctrlY - 17}" width="5" height="34" fill="#ffffff"/>
       <circle cx="${ctrlCx}" cy="${ctrlY}" r="38" fill="#ffffff"/>
       <polygon points="${ctrlCx - 11},${ctrlY - 20} ${ctrlCx + 21},${ctrlY} ${ctrlCx - 11},${ctrlY + 20}"
                fill="#111111"/>
       <polygon points="${ctrlCx + 110},${ctrlY} ${ctrlCx + 82},${ctrlY - 17} ${ctrlCx + 82},${ctrlY + 17}"
                fill="#ffffff"/>
       <rect x="${ctrlCx + 111}" y="${ctrlY - 17}" width="5" height="34" fill="#ffffff"/>

       <!-- Footer -->
       <text x="${CARD_W / 2}" y="${CARD_H - 34}" font-size="22" letter-spacing="3"
             fill="#ffffff" opacity="0.65" text-anchor="middle">SHAN MINI BOT</text>
     </svg>`
  );

  return sharp(background)
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: art, left: artX, top: artY },
      { input: ui, left: 0, top: 0 }
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

async function getThumb(song) {
  const raw = await getRawCover(song?.thumbUrl || '');

  if (!raw) return Buffer.alloc(0);

  try {
    return await createSongCard(song, raw);
  } catch (error) {
    console.error('[chsong] Card design:', error.message);

    // Fallback: plain original cover, no stretching
    try {
      return await sharp(raw)
        .resize(CARD_W, CARD_H, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 1 }
        })
        .jpeg({ quality: 88 })
        .toBuffer();
    } catch {
      return Buffer.alloc(0);
    }
  }
}

/* =========================================
   CAPTION DESIGN
========================================= */

function buildCaption(song, channelName = '', channelLink = '') {
  const lines = [
    '╭━━『 🎧 𝐌𝐔𝐒𝐈𝐂 𝐋𝐎𝐔𝐍𝐆𝐄 🎧 』━━╮',
    '',
    `🎵 *${song.title}*`,
    `🎤 ${song.artist}`,
    `⏱️ ${song.duration}`
  ];

  if (channelName) {
    lines.push(`📻 ${channelName}`);
  }

  lines.push(
    '',
    '🎧 𝐅𝐄𝐄𝐋 𝐓𝐇𝐄 𝐁𝐄𝐀𝐓 🎹 𝐋𝐈𝐕𝐄 𝐘𝐎𝐔𝐑 𝐌𝐔𝐒𝐈𝐂 💖',
    '╰━━━━━━━━━━━━━━━━━━╯'
  );

  if (channelLink) {
    lines.push('', `📲 𝐉𝐨𝐢𝐧 👉 ${channelLink}`);
  }

  lines.push('', '> ✨ _Powered by SHAN MINI BOT_');

  return lines.join('\n');
}

/* =========================================
   MAIN COMMAND
========================================= */

async function runChannelSong(sock, msg, args) {
  const chat = msg?.key?.remoteJid;

  if (!chat) return;

  if (!isOwner(msg)) {
    await sock.sendMessage(
      chat,
      {
        text: '👑 මෙම command එක භාවිතා කළ හැක්කේ Bot Owner ට පමණයි.'
      },
      { quoted: msg }
    );

    return;
  }

  const { channel, query } = parseInput(args);

  if (!channel || !query) {
    await sock.sendMessage(
      chat,
      {
        text: box('📢 CHANNEL SONG', [
          '❌ Channel link/JID එක සහ ගීතයේ නම ඇතුළත් කරන්න.',
          '',
          '📌 උදාහරණ:',
          `${PREFIX}chsong 120363xxxxxxxx@newsletter | song name`,
          `${PREFIX}chsong https://whatsapp.com/channel/XXXXXXXX | song name`,
          '',
          '🎵 YouTube link එකක් වුණත් භාවිතා කළ හැකියි.'
        ])
      },
      { quoted: msg }
    );

    return;
  }

  await react(sock, msg, '🔍');

  try {
    const channelJid = await resolveChannelJid(sock, channel);

    if (!channelJid) {
      throw new Error('Channel JID හෝ link එක වලංගු නැහැ.');
    }

    const access = await checkChannelAccess(sock, channelJid);

    if (access.allowed === false) {
      throw new Error(
        `Bot ගිණුමට Channel admin අවසර නැහැ. Role: ${access.role}`
      );
    }

    await react(sock, msg, '🎵');

    const song = await findSong(query);

    await react(sock, msg, '⬇️');

    const audioUrl = await savetube(song.url);
    const audioBuffer = await downloadAudioBuffer(audioUrl);

    // Convert mp3 -> opus/ogg so it plays as a voice note in channels
    const voiceBuffer = await toOpusVoice(audioBuffer);

    const thumbnail = await getThumb(song);

    // Channel link (never show the JID)
    const inputLink =
      channel.match(
        /https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[A-Za-z0-9_-]+/i
      )?.[0] || '';

    const channelLink = access.invite
      ? `https://whatsapp.com/channel/${access.invite}`
      : inputLink;

    const channelName = access.name || '';

    const caption = buildCaption(song, channelName, channelLink);

    // Publish thumbnail and song details.
    if (thumbnail.length) {
      await sock.sendMessage(channelJid, {
        image: thumbnail,
        caption
      });
    } else {
      await sock.sendMessage(channelJid, {
        text: caption
      });
    }

    // Send as voice note (PTT)
    await sock.sendMessage(channelJid, {
      audio: voiceBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true
    });

    await react(sock, msg, '✅');

    await sock.sendMessage(
      chat,
      {
        text: box('📢 CHANNEL SONG', [
          '✅ ගීතය යැවීමේ request එක සාර්ථකයි.',
          '',
          `🎵 ${song.title}`,
          `👤 ${song.artist}`,
          `📡 ${access.name || 'Channel'}`,
          '🖼️ Thumbnail: Styled card (1280 × 720)',
          '🎙️ Audio: Voice note'
        ])
      },
      { quoted: msg }
    );

  } catch (error) {
    console.error(
      '[chsong] Error:',
      error?.stack || error?.message || error
    );

    await react(sock, msg, '❌');

    await sock.sendMessage(
      chat,
      {
        text: box('📢 CHANNEL SONG', [
          '❌ ගීතය යැවීමට නොහැකි විය.',
          '',
          `විස්තරය: ${error?.message || 'Unknown error'}`,
          '',
          '🔎 Channel link එක පරීක්ෂා කරන්න.',
          '👑 Bot ගිණුමට අවශ්‍ය Channel අවසර තිබේද බලන්න.',
          '🌐 Download server එක ක්‍රියාත්මකද බලන්න.',
          '🎛️ ffmpeg install වී තිබේද බලන්න.'
        ])
      },
      { quoted: msg }
    );
  }
}

/* =========================================
   PLUGIN EXPORT
========================================= */

export default {
  command: ['chsong'],
  alias: ['chplay', 'songch'],
  help: ['chsong'],
  tags: ['owner'],

  async execute(sock, msg, args) {
    await runChannelSong(sock, msg, args);
  }
};

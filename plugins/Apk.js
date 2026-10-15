// plugins/apk.js
// SHAN MINI BOT V1 — APK Downloader (Uptodown)
// Command: .apk <app name | uptodown url>

'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/* =========================================================
 * CONFIG
 * ========================================================= */

const PREFIX = process.env.PREFIX || '.';

// Put this in your .env file:  CHAMINDU_API_KEY=your_key_here
const API_BASE = 'https://api.chamindu.site/api/v1/apk/uptodown/infodl';
const API_KEY = process.env.CHAMINDU_API_KEY || '';

// Max APK size the bot will upload (MB). Bigger files get a link instead.
const MAX_APK_MB = Number(process.env.APK_MAX_MB || 100);
const MAX_APK_SIZE = MAX_APK_MB * 1024 * 1024;

const UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';

/* =========================================================
 * HELPERS
 * ========================================================= */

async function react(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch {}
}

function box(title, lines = []) {
  const body = lines.map(l => `┃ ${l}`).join('\n');
  return `╭━━〔 ${title} 〕━━╮\n┃\n${body}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━╯`;
}

function safeFileName(name = 'app') {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'app';
}

function toUptodownUrl(input) {
  const value = String(input || '').trim();

  if (/^https?:\/\/[^\s]*uptodown\.com/i.test(value)) {
    return value.replace(/\/+$/, '');
  }

  // Name -> slug guess  (e.g. "stickers whats app images" -> stickers-whats-app-images)
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return null;

  return `https://${slug}.en.uptodown.com/android`;
}

async function getAppInfo(uptodownUrl) {
  if (!API_KEY) {
    throw new Error('CHAMINDU_API_KEY අගය .env ගොනුවේ සඳහන් කර නොමැත.');
  }

  const endpoint =
    `${API_BASE}?url=${encodeURIComponent(uptodownUrl)}&api_key=${encodeURIComponent(API_KEY)}`;

  const res = await fetch(endpoint, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) throw new Error(`API error (${res.status})`);

  const json = await res.json().catch(() => null);

  if (!json?.status || !json?.data?.name) {
    throw new Error('යෙදුම සොයාගත නොහැකි විය.');
  }

  return json.data;
}

// Tries to pull the real file link out of the Uptodown download page
async function resolveDirectLink(downloadPage) {
  try {
    if (!downloadPage) return null;

    const res = await fetch(downloadPage, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: downloadPage.replace(/\/download\/?$/, '')
      },
      signal: AbortSignal.timeout(30000)
    });

    const html = await res.text();
    console.log(`[apk] download page status=${res.status} length=${html.length} has-data-url=${/data-url=/i.test(html)}`);

    if (!res.ok) return null;

    // 1) data-url="..."  (full link OR just a token)
    // 2) any dw.uptodown.com/dwn/... link inside the page
    const match =
      html.match(/data-url=["']([^"']+)["']/i) ||
      html.match(/(https?:\/\/dw\.uptodown\.com\/dwn\/[^"'\s<>]+)/i) ||
      html.match(/id=["']detail-download-button["'][^>]*href=["']([^"']+)["']/i);

    if (!match) return null;

    let link = match[1].replace(/&amp;/g, '&').trim();

    if (/^https?:\/\//i.test(link)) return link;
    if (link.startsWith('//')) return 'https:' + link;
    if (link.startsWith('/')) return new URL(link, downloadPage).href;

    // Token only -> Uptodown's file server
    return `https://dw.uptodown.com/dwn/${link}`;
  } catch (error) {
    console.error('[apk] resolveDirectLink error:', error?.message || error);
    return null;
  }
}

async function downloadApkToFile(link, referer) {
  const res = await fetch(link, {
    headers: { 'User-Agent': UA, Referer: referer || link },
    redirect: 'follow',
    signal: AbortSignal.timeout(30 * 60 * 1000)
  });

  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);

  const length = Number(res.headers.get('content-length') || 0);
  console.log(`[apk] download status=${res.status} size=${length || 'unknown'}`);

  if (length && length > MAX_APK_SIZE) {
    const error = new Error('TOO_BIG');
    error.code = 'TOO_BIG';
    throw error;
  }

  const file = path.join(os.tmpdir(), `apk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.apk`);
  const body = Readable.fromWeb(res.body);
  let size = 0;

  body.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_APK_SIZE) {
      const error = new Error('TOO_BIG');
      error.code = 'TOO_BIG';
      body.destroy(error);
    }
  });

  try {
    await pipeline(body, fs.createWriteStream(file));
  } catch (error) {
    await fs.promises.unlink(file).catch(() => {});
    throw error;
  }

  if (!size) {
    await fs.promises.unlink(file).catch(() => {});
    throw new Error('Empty file');
  }

  return { file, size };
}

async function getIcon(url) {
  try {
    if (!url) return null;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

/* =========================================================
 * MAIN
 * ========================================================= */

async function runApk(sock, msg, args) {
  const jid = msg.key.remoteJid;
  const query = (args || []).join(' ').trim();

  if (!query) {
    await sock.sendMessage(
      jid,
      {
        text: box('📦 APK DOWNLOADER', [
          '❌ කරුණාකර යෙදුමේ නම ඇතුළත් කරන්න.',
          '',
          '📌 උදාහරණ:',
          `${PREFIX}apk whatsapp`,
          `${PREFIX}apk stickers whats app images`,
          `${PREFIX}apk https://whatsapp.en.uptodown.com/android`
        ])
      },
      { quoted: msg }
    );
    return;
  }

  await react(sock, msg, '🔍');

  try {
    const uptodownUrl = toUptodownUrl(query);
    if (!uptodownUrl) throw new Error('අවලංගු යෙදුම් නමකි.');

    const app = await getAppInfo(uptodownUrl);

    const caption = box('📦 APK DOWNLOADER', [
      `📱 Name    : ${app.name}`,
      `🆔 Package : ${app.package_name || 'N/A'}`,
      `💾 Size    : ${app.size || 'N/A'}`,
      '🌐 Source  : Uptodown',
      '',
      '⏳ APK ගොනුව එවමින් පවතී. කරුණාකර රැඳී සිටින්න.'
    ]);

    const icon = await getIcon(app.icon);

    if (icon) {
      await sock.sendMessage(jid, { image: icon, caption }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    }

    await react(sock, msg, '⬇️');

    const directLink = await resolveDirectLink(app.download_page);
    console.log('[apk] resolved link:', directLink || 'NOT FOUND');

    if (!directLink) {
      await sock.sendMessage(
        jid,
        {
          text: box('📦 DOWNLOAD LINK', [
            '⚠️ APK ගොනුව කෙලින්ම එවීමට නොහැකි විය.',
            '',
            '🔗 පහත සබැඳියෙන් බාගත කරන්න:',
            app.download_page || app.uptodown_url
          ])
        },
        { quoted: msg }
      );
      await react(sock, msg, '✅');
      return;
    }

    let downloaded;
    try {
      console.log('[apk] direct link:', directLink);
      downloaded = await downloadApkToFile(directLink, app.download_page);
    } catch (error) {
      console.error('[apk] download error:', error?.message || error);
      const reason =
        error?.code === 'TOO_BIG'
          ? `⚠️ ගොනුවේ ප්‍රමාණය ${MAX_APK_MB}MB සීමාව ඉක්මවයි.`
          : '⚠️ APK ගොනුව බාගත කිරීමට නොහැකි විය.';

      await sock.sendMessage(
        jid,
        {
          text: box('📦 DOWNLOAD LINK', [
            reason,
            '',
            '🔗 පහත සබැඳියෙන් බාගත කරන්න:',
            app.download_page || app.uptodown_url
          ])
        },
        { quoted: msg }
      );
      await react(sock, msg, '✅');
      return;
    }

    try {
      await sock.sendMessage(
        jid,
        {
          document: { url: downloaded.file },
          mimetype: 'application/vnd.android.package-archive',
          fileName: `${safeFileName(app.name)}.apk`,
          caption: `✅ ${app.name}\n💾 ${app.size || ''}`.trim()
        },
        { quoted: msg }
      );
    } finally {
      await fs.promises.unlink(downloaded.file).catch(() => {});
    }

    await react(sock, msg, '✅');
  } catch (error) {
    await react(sock, msg, '❌');

    await sock.sendMessage(
      jid,
      {
        text: box('📦 APK DOWNLOADER', [
          '❌ අසාර්ථක විය',
          '',
          `> ${error?.message || 'Unknown error'}`,
          '',
          '💡 උපදෙස්: යෙදුමේ නම නිවැරදිව ඇතුළත් කරන්න,',
          'නැතහොත් Uptodown සබැඳිය කෙලින්ම ලබා දෙන්න.'
        ])
      },
      { quoted: msg }
    );
  }
}

/* =========================================================
 * PLUGIN EXPORT (SHAN MINI BOT format)
 * ========================================================= */

export default {
  command: ['apk'],
  alias: ['uptodown'],
  help: ['apk'],
  tags: ['downloader'],

  async execute(sock, msg, args) {
    await runApk(sock, msg, args);
  }
};

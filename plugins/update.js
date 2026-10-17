// plugins/update.js
// SHAN MINI BOT V1
// GitHub එකෙන් අලුත් files බාගෙන bot එක restart කරන command
//
// .update         → GitHub එකේ අලුත් files බාගෙන restart කරනවා
// .update check   → වෙනස්වූ files පෙන්වනවා (apply කරන්නේ නැහැ)
// .restart        → bot එක restart කරනවා
//
// Railway Variables (අවශ්‍ය නම්):
//   GITHUB_REPO   = username/repo       (default: hirushan1234567/shan-mini-bot)
//   GITHUB_BRANCH = main                (නැත්නම් main, පස්සේ master උත්සාහ කරනවා)
//   GITHUB_TOKEN  = ghp_xxx             (private repo නම්, හෝ rate limit නිසා)

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

const REPO = process.env.GITHUB_REPO || 'https://github.com/Hirushan1234567/shan_md_mini/blob/main/plugins/update.js';
const TOKEN = process.env.GITHUB_TOKEN || '';
const BRANCHES = process.env.GITHUB_BRANCH
  ? [process.env.GITHUB_BRANCH]
  : ['main', 'master'];

const ROOT = process.cwd();

// යාවත්කාලීන කරන්න අවසර ඇති files පමණයි (.env, sessions ආදිය අල්ලන්නේ නැහැ)
function allowed(file) {
  return (
    file === 'index.js' ||
    file === 'package.json' ||
    file === 'logo.jpg' ||
    /^plugins\/[^/]+\.(js|mjs|json)$/.test(file) ||
    /^public\/[^/]+$/.test(file)
  );
}

function ghHeaders() {
  const headers = {
    'User-Agent': 'shan-mini-bot-updater',
    Accept: 'application/vnd.github+json'
  };

  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  return headers;
}

async function gh(url) {
  const res = await fetch(url, {
    headers: ghHeaders(),
    signal: AbortSignal.timeout(30000)
  });

  if (res.status === 403 || res.status === 429) {
    throw new Error(
      'GitHub rate limit එක පිරුණා. Railway Variables වල GITHUB_TOKEN දාන්න.'
    );
  }

  if (!res.ok) {
    const error = new Error(`GitHub API error (${res.status}).`);
    error.status = res.status;
    throw error;
  }

  return res.json();
}

function gitBlobSha(buffer) {
  return crypto
    .createHash('sha1')
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest('hex');
}

function localSha(file) {
  try {
    return gitBlobSha(fs.readFileSync(path.join(ROOT, file)));
  } catch {
    return null;
  }
}

async function getRemoteTree() {
  let lastError = null;

  for (const branch of BRANCHES) {
    try {
      const data = await gh(
        `https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(branch)}?recursive=1`
      );

      return { branch, tree: data.tree || [] };
    } catch (error) {
      lastError = error;

      if (error.status !== 404) break;
    }
  }

  throw new Error(
    lastError?.status === 404
      ? `Repo/branch හම්බුණේ නැහැ (${REPO}). Private repo නම් GITHUB_TOKEN, නැත්නම් GITHUB_REPO හරිද බලන්න.`
      : lastError?.message || 'GitHub එකට සම්බන්ධ විය නොහැක.'
  );
}

async function findChanges() {
  const { branch, tree } = await getRemoteTree();

  const changes = tree
    .filter(item => item.type === 'blob' && allowed(item.path))
    .filter(item => localSha(item.path) !== item.sha)
    .map(item => ({
      path: item.path,
      sha: item.sha,
      isNew: localSha(item.path) === null
    }));

  return { branch, changes };
}

async function downloadBlob(sha) {
  const data = await gh(
    `https://api.github.com/repos/${REPO}/git/blobs/${sha}`
  );

  return Buffer.from(data.content || '', data.encoding || 'base64');
}

async function applyChanges(changes) {
  // මුලින් සියල්ල බාගන්නවා (එකක් අසාර්ථක වුණොත් කිසිවක් වෙනස් වෙන්නේ නැහැ)
  const downloaded = [];

  for (const change of changes) {
    const buffer = await downloadBlob(change.sha);

    if (gitBlobSha(buffer) !== change.sha) {
      throw new Error(`${change.path} බාගත කිරීම නිවැරදි නැහැ. නැවත උත්සාහ කරන්න.`);
    }

    downloaded.push({ ...change, buffer });
  }

  for (const file of downloaded) {
    const target = path.join(ROOT, file.path);
    const temp = `${target}.updating`;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, file.buffer);
    fs.renameSync(temp, target);
  }
}

function runNpmInstall() {
  return new Promise(resolve => {
    let output = '';

    const child = spawn(
      'npm',
      ['install', '--omit=dev', '--no-audit', '--no-fund'],
      { cwd: ROOT, shell: process.platform === 'win32' }
    );

    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, output: 'npm install timeout (5 min).' });
    }, 5 * 60 * 1000);

    child.stdout?.on('data', chunk => (output += chunk));
    child.stderr?.on('data', chunk => (output += chunk));

    child.on('error', error => {
      clearTimeout(timer);
      resolve({ ok: false, output: error.message });
    });

    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: output.slice(-400) });
    });
  });
}

function restartBot() {
  // Railway: non-zero exit එකක් නිසා container එක ස්වයංක්‍රීයව නැවත පටන් ගනී
  setTimeout(() => process.exit(1), 2500);
}

function isOwnerMsg(sock, msg) {
  if (sock?.isMainSession === false) return false;
  if (msg?.key?.fromMe === true) return true;

  const owner = String(
    globalThis.SHAN?.MAIN_OWNER_NUMBER ||
    process.env.OWNER_NUMBER ||
    '94752661225'
  ).replace(/\D/g, '');

  const key = msg?.key || {};

  return [
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid
  ].some(
    value =>
      value &&
      String(value).split('@')[0].split(':')[0].replace(/\D/g, '') === owner
  );
}

export default {
  command: ['update'],
  alias: ['restart'],
  help: ['update', 'update check', 'restart'],
  tags: ['owner'],

  async execute(sock, msg, args, commandName) {
    const chat = msg.key.remoteJid;
    const reply = text =>
      sock.sendMessage(chat, { text }, { quoted: msg }).catch(() => {});

    if (!isOwnerMsg(sock, msg)) {
      await reply('👑 Owner only command.');
      return;
    }

    /* ---------- .restart ---------- */

    if (commandName === 'restart') {
      await reply('🔄 Bot එක restart වෙමින්... තත්පර 20ක් විතර ඉන්න.');
      restartBot();
      return;
    }

    /* ---------- .update / .update check ---------- */

    const checkOnly = String(args?.[0] || '').toLowerCase() === 'check';

    await reply('🔎 GitHub එකේ අලුත් වෙනස්කම් බලමින්...');

    try {
      const { branch, changes } = await findChanges();

      if (!changes.length) {
        await reply(`✅ දැනටමත් අලුත්ම version එකයි.\n\n📦 ${REPO} (${branch})`);
        return;
      }

      const list = changes
        .map(c => `${c.isNew ? '🆕' : '✏️'} ${c.path}`)
        .join('\n');

      if (checkOnly) {
        await reply(
          `📋 වෙනස් වූ files (${changes.length}):\n\n${list}\n\n` +
          `Apply කරන්න: .update`
        );
        return;
      }

      await reply(`⬇️ බාගනිමින් (${changes.length} files)...\n\n${list}`);

      await applyChanges(changes);

      let npmNote = '';

      if (changes.some(c => c.path === 'package.json')) {
        await reply('📦 package.json වෙනස් වී ඇත — npm install කරමින්...');

        const result = await runNpmInstall();

        npmNote = result.ok
          ? '\n📦 npm install සාර්ථකයි.'
          : `\n⚠️ npm install අසාර්ථකයි:\n${result.output}`;
      }

      await reply(
        `✅ Update සාර්ථකයි! (${changes.length} files)${npmNote}\n\n` +
        `🔄 Bot එක restart වෙමින්... තත්පර 20ක් විතර ඉන්න.`
      );

      restartBot();
    } catch (error) {
      console.error('[update] Error:', error?.stack || error?.message || error);

      await reply(`❌ Update අසාර්ථකයි.\n\n${error?.message || error}`);
    }
  }
};

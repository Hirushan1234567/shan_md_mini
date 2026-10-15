// plugins/authorizedbots.js
// SHAN MINI BOT V1
// Group Admin + Bot Owner + Linked Account Protection

'use strict';

import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';
const DATA_FILE = path.join(DATA_DIR, 'authorized-bots.json');

const OWNER_NUMBERS = (
  process.env.OWNER_NUMBER || '94752661225'
)
  .split(',')
  .map(n => n.replace(/\D/g, ''));

function normalizeNumber(value = '') {
  return String(value)
    .split(':')[0]
    .split('@')[0]
    .replace(/\D/g, '');
}

function getNumber(jid = '') {
  return normalizeNumber(jid);
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function isAdmin(participant) {
  return (
    participant?.admin === 'admin' ||
    participant?.admin === 'superadmin'
  );
}

function getSender(msg) {
  return msg.key?.participant || msg.key?.remoteJid || '';
}

const plugin = {
  commands: [
    'authorizedbots',
    'allowbot',
    'unallowbot',
    'botpermission'
  ],

  async execute(sock, msg, args, command) {
    const jid = msg.key?.remoteJid;
    if (!jid) return;

    if (!jid.endsWith('@g.us')) {
      return sock.sendMessage(jid, {
        text: '❌ This command can only be used in groups.'
      }, { quoted: msg });
    }

    try {
      const metadata = await sock.groupMetadata(jid);
      const participants = metadata.participants || [];

      const sender = getSender(msg);
      const senderNumber = getNumber(sender);

      const botNumber = getNumber(sock.user?.id || '');

      const senderParticipant = participants.find(
        p => getNumber(p.id) === senderNumber
      );

      const isBotOwner =
        OWNER_NUMBERS.includes(senderNumber) ||
        senderNumber === botNumber ||
        msg.key.fromMe === true;

      const isGroupAdmin = isAdmin(senderParticipant);

      // Only Group Admin, Bot Owner, or the linked bot account
      if (!isGroupAdmin && !isBotOwner) {
        return sock.sendMessage(jid, {
          text:
            '🔐 *Admin Only Command*\n\n' +
            '❌ Only Group Admins or Bot Owner can use this command.'
        }, { quoted: msg });
      }

      const data = loadData();

      if (!Array.isArray(data[jid])) {
        data[jid] = [];
      }

      // List authorized numbers
      if (
        command === 'authorizedbots' ||
        command === 'botpermission'
      ) {
        const list = data[jid];

        return sock.sendMessage(jid, {
          text:
            '🔐 *AUTHORIZED ACCOUNTS*\n\n' +
            (list.length
              ? list.map((n, i) => `${i + 1}. +${n}`).join('\n')
              : 'No authorized accounts.') +
            '\n\n➕ .allowbot 947xxxxxxxx' +
            '\n➖ .unallowbot 947xxxxxxxx'
        }, { quoted: msg });
      }

      // Add authorization
      if (command === 'allowbot') {
        const number = normalizeNumber(args[0] || '');

        if (number.length < 8 || number.length > 15) {
          return sock.sendMessage(jid, {
            text: '❌ Usage: .allowbot 947xxxxxxxx'
          }, { quoted: msg });
        }

        if (data[jid].includes(number)) {
          return sock.sendMessage(jid, {
            text: `ℹ️ +${number} is already authorized.`
          }, { quoted: msg });
        }

        data[jid].push(number);
        saveData(data);

        return sock.sendMessage(jid, {
          text:
            '✅ *ACCOUNT AUTHORIZED*\n\n' +
            `📱 Number: +${number}\n` +
            `👥 Group: ${metadata.subject}\n` +
            `👮 Authorized by: ${isBotOwner ? 'Bot Owner' : 'Group Admin'}`
        }, { quoted: msg });
      }

      // Remove authorization
      if (command === 'unallowbot') {
        const number = normalizeNumber(args[0] || '');

        if (!number) {
          return sock.sendMessage(jid, {
            text: '❌ Usage: .unallowbot 947xxxxxxxx'
          }, { quoted: msg });
        }

        if (!data[jid].includes(number)) {
          return sock.sendMessage(jid, {
            text: `❌ +${number} is not authorized.`
          }, { quoted: msg });
        }

        data[jid] = data[jid].filter(n => n !== number);
        saveData(data);

        return sock.sendMessage(jid, {
          text:
            '🚫 *AUTHORIZATION REMOVED*\n\n' +
            `📱 Number: +${number}`
        }, { quoted: msg });
      }
    } catch (error) {
      console.error('[AUTHORIZED BOTS]', error);

      return sock.sendMessage(jid, {
        text: `❌ Error: ${error.message || 'Unknown error'}`
      }, { quoted: msg });
    }
  }
};

export default plugin;
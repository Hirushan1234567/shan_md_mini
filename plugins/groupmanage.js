// plugins/groupmanage.js
// SHAN MINI BOT V1 - Group Manager
'use strict';

const OWNER = '94752661225';

function getSenderNumber(msg) {
  const key = msg?.key || {};

  const raw =
    key.participantPn ||
    key.participantAlt ||
    key.participant ||
    key.remoteJidAlt ||
    key.remoteJid ||
    '';

  return String(raw)
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
}

function isOwner(msg) {
  if (msg?.key?.fromMe) return true;
  return getSenderNumber(msg) === OWNER;
}

function isGroup(msg) {
  return String(msg?.key?.remoteJid || '').endsWith('@g.us');
}

function getMentionedJids(msg) {
  const ctx =
    msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    msg?.message?.documentMessage?.contextInfo ||
    {};

  return ctx.mentionedJid || [];
}

function getQuotedParticipant(msg) {
  const ctx =
    msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    msg?.message?.documentMessage?.contextInfo ||
    {};

  return ctx.participant || null;
}

function getTargetJids(msg) {
  const mentioned = getMentionedJids(msg);

  if (mentioned.length) return mentioned;

  const quoted = getQuotedParticipant(msg);

  if (quoted) return [quoted];

  return [];
}

async function getGroupMetadata(sock, jid) {
  return await sock.groupMetadata(jid);
}

function isAdmin(metadata, number) {
  const clean = String(number || '').replace(/\D/g, '');

  return metadata.participants.some(p => {
    const id = String(p.id || '');
    const pn = String(p.phoneNumber || '');

    return (
      id.includes(clean) ||
      pn.includes(clean)
    ) && (
      p.admin === 'admin' ||
      p.admin === 'superadmin'
    );
  });
}

async function requireGroup(sock, msg) {
  if (!isGroup(msg)) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: '❌ මේ command එක group එකක විතරයි වැඩ කරන්නේ.' },
      { quoted: msg }
    );
    return false;
  }

  return true;
}

async function requireAdmin(sock, msg) {
  if (!(await requireGroup(sock, msg))) return false;

  const jid = msg.key.remoteJid;
  const metadata = await getGroupMetadata(sock, jid);
  const sender = getSenderNumber(msg);

  if (!isAdmin(metadata, sender) && !isOwner(msg)) {
    await sock.sendMessage(
      jid,
      { text: '❌ මේ command එක Group Admin / Owner විතරයි භාවිතා කරන්න පුළුවන්.' },
      { quoted: msg }
    );
    return false;
  }

  return true;
}

async function sendMenu(sock, msg) {
  const text = `
╭━━━〔 👥 GROUP MANAGER 〕━━━╮
┃
┃ 👑 *GROUP MANAGEMENT*
┃
┃ 🔹 *.groupmenu*
┃     Show this menu
┃
┃ 🔹 *.groupinfo*
┃     Group information
┃
┃ 🔹 *.admins*
┃     Show group admins
┃
┃ 🔹 *.tagall*
┃     Mention everyone
┃
┃ 🔹 *.hidetag*
┃     Hidden mention everyone
┃
┃ 🔹 *.promote @user*
┃     Promote member
┃
┃ 🔹 *.demote @user*
┃     Demote admin
┃
┃ 🔹 *.kick @user*
┃     Remove member
┃
┃ 🔹 *.add 947xxxxxxxxx*
┃     Add member
┃
┃ 🔹 *.subject New Name*
┃     Change group name
┃
┃ 🔹 *.desc New Description*
┃     Change group description
┃
┃ 🔹 *.open*
┃     Open group
┃
┃ 🔹 *.close*
┃     Close group
┃
┃ 🔹 *.lock*
┃     Only admins can edit
┃
┃ 🔹 *.unlock*
┃     Everyone can edit
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

⚡ *SHAN MINI BOT V1*
`;

  await sock.sendMessage(
    msg.key.remoteJid,
    { text },
    { quoted: msg }
  );
}

const plugin = {
  commands: [
    'groupmenu',
    'gmenu',
    'groupinfo',
    'admins',
    'tagall',
    'hidetag',
    'promote',
    'demote',
    'kick',
    'add',
    'subject',
    'setsubject',
    'desc',
    'setdesc',
    'open',
    'close',
    'lock',
    'unlock'
  ],

  async execute(sock, msg, args, command) {
    const jid = msg.key.remoteJid;

    try {
      // =========================
      // MENU
      // =========================

      if (
        command === 'groupmenu' ||
        command === 'gmenu'
      ) {
        return await sendMenu(sock, msg);
      }

      // =========================
      // GROUP INFO
      // =========================

      if (command === 'groupinfo') {
        if (!(await requireGroup(sock, msg))) return;

        const metadata = await getGroupMetadata(sock, jid);

        const admins = metadata.participants.filter(
          p =>
            p.admin === 'admin' ||
            p.admin === 'superadmin'
        );

        const text = `
╭━━〔 👥 GROUP INFO 〕━━╮
┃
┃ 📝 Name
┃ ${metadata.subject || 'Unknown'}
┃
┃ 👥 Members
┃ ${metadata.participants.length}
┃
┃ 👑 Admins
┃ ${admins.length}
┃
┃ 🆔 ID
┃ ${jid}
┃
╰━━━━━━━━━━━━━━━━╯
`;

        return await sock.sendMessage(
          jid,
          { text },
          { quoted: msg }
        );
      }

      // =========================
      // ADMINS
      // =========================

      if (command === 'admins') {
        if (!(await requireGroup(sock, msg))) return;

        const metadata = await getGroupMetadata(sock, jid);

        const admins = metadata.participants.filter(
          p =>
            p.admin === 'admin' ||
            p.admin === 'superadmin'
        );

        let text = `╭━━〔 👑 GROUP ADMINS 〕━━╮\n┃\n`;

        for (let i = 0; i < admins.length; i++) {
          const number = String(
            admins[i].phoneNumber ||
            admins[i].id ||
            ''
          ).split('@')[0];

          text += `┃ ${i + 1}. @${number}\n`;
        }

        text += `┃\n╰━━━━━━━━━━━━━━━━╯`;

        return await sock.sendMessage(
          jid,
          {
            text,
            mentions: admins.map(p => p.id)
          },
          { quoted: msg }
        );
      }

      // =========================
      // ADMIN COMMANDS
      // =========================

      if (!(await requireAdmin(sock, msg))) return;

      const metadata = await getGroupMetadata(sock, jid);

      // =========================
      // TAG ALL
      // =========================

      if (command === 'tagall') {
        let text = `╭━━〔 📢 TAG ALL 〕━━╮\n┃\n`;

        const mentions = [];

        for (const participant of metadata.participants) {
          const id = participant.id;
          const number =
            String(participant.phoneNumber || id)
              .split('@')[0];

          mentions.push(id);
          text += `┃ 👤 @${number}\n`;
        }

        text += `┃\n╰━━━━━━━━━━━━━━━━╯`;

        return await sock.sendMessage(
          jid,
          {
            text,
            mentions
          },
          { quoted: msg }
        );
      }

      // =========================
      // HIDETAG
      // =========================

      if (command === 'hidetag') {
        const mentions =
          metadata.participants.map(p => p.id);

        const text =
          args.length
            ? args.join(' ')
            : '📢 Attention Everyone!';

        return await sock.sendMessage(
          jid,
          {
            text,
            mentions
          },
          { quoted: msg }
        );
      }

      // =========================
      // PROMOTE
      // =========================

      if (command === 'promote') {
        const targets = getTargetJids(msg);

        if (!targets.length) {
          return await sock.sendMessage(
            jid,
            {
              text:
                '❌ User mention කරන්න හෝ message එකක් reply කරලා `.promote` දෙන්න.'
            },
            { quoted: msg }
          );
        }

        await sock.groupParticipantsUpdate(
          jid,
          targets,
          'promote'
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              `👑 ${targets.map(x => '@' + x.split('@')[0]).join(', ')} promoted to admin.`,
            mentions: targets
          },
          { quoted: msg }
        );
      }

      // =========================
      // DEMOTE
      // =========================

      if (command === 'demote') {
        const targets = getTargetJids(msg);

        if (!targets.length) {
          return await sock.sendMessage(
            jid,
            {
              text:
                '❌ User mention කරන්න හෝ message එකක් reply කරලා `.demote` දෙන්න.'
            },
            { quoted: msg }
          );
        }

        await sock.groupParticipantsUpdate(
          jid,
          targets,
          'demote'
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              `⬇️ ${targets.map(x => '@' + x.split('@')[0]).join(', ')} demoted.`,
            mentions: targets
          },
          { quoted: msg }
        );
      }

      // =========================
      // KICK
      // =========================

      if (command === 'kick') {
        const targets = getTargetJids(msg);

        if (!targets.length) {
          return await sock.sendMessage(
            jid,
            {
              text:
                '❌ User mention කරන්න හෝ message එකක් reply කරලා `.kick` දෙන්න.'
            },
            { quoted: msg }
          );
        }

        await sock.groupParticipantsUpdate(
          jid,
          targets,
          'remove'
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              `❌ ${targets.map(x => '@' + x.split('@')[0]).join(', ')} removed.`,
            mentions: targets
          },
          { quoted: msg }
        );
      }

      // =========================
      // ADD
      // =========================

      if (command === 'add') {
        let number = args.join('').replace(/\D/g, '');

        if (!number) {
          return await sock.sendMessage(
            jid,
            {
              text:
                '❌ Number එක දෙන්න.\n\nExample:\n.add 94771234567'
            },
            { quoted: msg }
          );
        }

        if (number.startsWith('0')) {
          number = '94' + number.slice(1);
        }

        const target = `${number}@s.whatsapp.net`;

        await sock.groupParticipantsUpdate(
          jid,
          [target],
          'add'
        );

        return await sock.sendMessage(
          jid,
          {
            text: `✅ Added @${number}`,
            mentions: [target]
          },
          { quoted: msg }
        );
      }

      // =========================
      // SUBJECT
      // =========================

      if (
        command === 'subject' ||
        command === 'setsubject'
      ) {
        const subject = args.join(' ').trim();

        if (!subject) {
          return await sock.sendMessage(
            jid,
            {
              text:
                '❌ New group name එක දෙන්න.\n\nExample:\n.subject SHAN MINI GROUP'
            },
            { quoted: msg }
          );
        }

        await sock.groupUpdateSubject(
          jid,
          subject
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              `✅ Group name changed to:\n*${subject}*`
          },
          { quoted: msg }
        );
      }

      // =========================
      // DESCRIPTION
      // =========================

      if (
        command === 'desc' ||
        command === 'setdesc'
      ) {
        const description = args.join(' ').trim();

        if (!description) {
          return await sock.sendMessage(
            jid,
            {
              text:
                '❌ Description එක දෙන්න.\n\nExample:\n.desc Welcome to our group ❤️'
            },
            { quoted: msg }
          );
        }

        await sock.groupUpdateDescription(
          jid,
          description
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              '✅ Group description updated.'
          },
          { quoted: msg }
        );
      }

      // =========================
      // OPEN GROUP
      // =========================

      if (command === 'open') {
        await sock.groupSettingUpdate(
          jid,
          'not_announcement'
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              '🔓 *Group Opened*\n\nEveryone can send messages now.'
          },
          { quoted: msg }
        );
      }

      // =========================
      // CLOSE GROUP
      // =========================

      if (command === 'close') {
        await sock.groupSettingUpdate(
          jid,
          'announcement'
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              '🔒 *Group Closed*\n\nOnly admins can send messages now.'
          },
          { quoted: msg }
        );
      }

      // =========================
      // LOCK GROUP SETTINGS
      // =========================

      if (command === 'lock') {
        await sock.groupSettingUpdate(
          jid,
          'locked'
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              '🔐 *Group Locked*\n\nOnly admins can edit group info.'
          },
          { quoted: msg }
        );
      }

      // =========================
      // UNLOCK GROUP SETTINGS
      // =========================

      if (command === 'unlock') {
        await sock.groupSettingUpdate(
          jid,
          'unlocked'
        );

        return await sock.sendMessage(
          jid,
          {
            text:
              '🔓 *Group Unlocked*\n\nEveryone can edit group info.'
          },
          { quoted: msg }
        );
      }

    } catch (error) {
      console.error(
        '[GROUPMANAGE ERROR]',
        error
      );

      await sock.sendMessage(
        jid,
        {
          text:
            `❌ Group Manager Error\n\n${error?.message || 'Unknown error'}`
        },
        { quoted: msg }
      );
    }
  }
};

export default plugin;
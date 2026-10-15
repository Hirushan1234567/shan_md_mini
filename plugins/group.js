// plugins/group.js
'use strict';

const plugin = {
  commands: [
    'group',
    'groupmenu',
    'gmenu',
    'groupinfo',
    'admins',
    'tagadmin',

    'promote',
    'demote',
    'kick',
    'add',

    'tagall',
    'hidetag',

    'open',
    'close',
    'lock',
    'unlock',

    'subject',
    'setsubject',
    'desc',
    'setdesc',

    'link',
    'invite',
    'revoke',
    'leave'
  ],

  async execute(sock, msg, args, command) {
    const jid = msg?.key?.remoteJid;

    if (!jid) return;

    // GROUP ONLY
    if (!jid.endsWith('@g.us')) {
      return sock.sendMessage(
        jid,
        {
          text: '❌ This command can only be used in groups.'
        },
        { quoted: msg }
      );
    }

    try {
      const metadata = await sock.groupMetadata(jid);
      const participants = metadata.participants || [];

      const normalize = id =>
        id?.split(':')[0]?.split('@')[0];

      const botNumber = normalize(sock.user?.id);

      const sender =
        msg.key.participant ||
        msg.key.remoteJid;

      const senderNumber = normalize(sender);

      const isAdmin = participant =>
        participant?.admin === 'admin' ||
        participant?.admin === 'superadmin';

      const botParticipant = participants.find(
        p => normalize(p.id) === botNumber
      );

      const senderParticipant = participants.find(
        p => normalize(p.id) === senderNumber
      );

      const botIsAdmin = isAdmin(botParticipant);

      const senderIsAdmin =
        isAdmin(senderParticipant) ||
        msg.key.fromMe;

      // ==========================================
      // GROUP MENU
      // ==========================================

      if (
        command === 'group' ||
        command === 'groupmenu' ||
        command === 'gmenu'
      ) {
        const text = `
👑 GROUP MENU

📌 GROUP
• .groupinfo
• .admins
• .tagadmin

👮 ADMIN
• .promote @user
• .demote @user
• .kick @user
• .add 947xxxxxxxx

📢 TAG
• .tagall
• .hidetag

⚙️ SETTINGS
• .open
• .close
• .lock
• .unlock
• .subject New Name
• .desc New Description

🔗 LINK
• .link
• .invite
• .revoke

🚪 OTHER
• .leave
`;

        return sock.sendMessage(
          jid,
          { text: text.trim() },
          { quoted: msg }
        );
      }

      // ==========================================
      // ADMIN ONLY COMMANDS
      // ==========================================

      const adminOnlyCommands = [
        'promote',
        'demote',
        'kick',
        'add',
        'tagall',
        'hidetag',
        'tagadmin',
        'open',
        'close',
        'lock',
        'unlock',
        'subject',
        'setsubject',
        'desc',
        'setdesc',
        'link',
        'invite',
        'revoke',
        'leave'
      ];

      if (adminOnlyCommands.includes(command)) {

        if (!senderIsAdmin) {
          return sock.sendMessage(
            jid,
            {
              text:
                `🔐 *Admin Only Command*\n\n` +
                `❌ This command is only available to Group Admins.`
            },
            { quoted: msg }
          );
        }

        if (!botIsAdmin) {
          return sock.sendMessage(
            jid,
            {
              text:
                `⚠️ *Bot Permission Required*\n\n` +
                `Please make the bot a Group Admin first.`
            },
            { quoted: msg }
          );
        }
      }

      // ==========================================
      // GROUP INFO
      // ==========================================

      if (command === 'groupinfo') {
        const admins = participants.filter(isAdmin);

        const owner =
          metadata.owner ||
          admins.find(
            p => p.admin === 'superadmin'
          )?.id;

        const text =
          `👥 *GROUP INFO*\n\n` +
          `🏷️ Name: ${metadata.subject || 'Unknown'}\n` +
          `👤 Members: ${participants.length}\n` +
          `👑 Admins: ${admins.length}\n` +
          `🆔 ID: ${jid}\n` +
          `👑 Owner: ${
            owner
              ? '@' + normalize(owner)
              : 'Unknown'
          }`;

        return sock.sendMessage(
          jid,
          {
            text,
            mentions: owner ? [owner] : []
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // ADMINS
      // ==========================================

      if (command === 'admins') {
        const admins = participants.filter(isAdmin);

        const mentions = admins.map(
          p => p.id
        );

        const text =
          `👑 *GROUP ADMINS*\n\n` +
          admins
            .map(
              (p, i) =>
                `${i + 1}. @${normalize(p.id)}`
            )
            .join('\n');

        return sock.sendMessage(
          jid,
          {
            text,
            mentions
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // TAG ADMINS
      // ==========================================

      if (command === 'tagadmin') {
        const admins = participants.filter(isAdmin);

        const mentions = admins.map(
          p => p.id
        );

        const text =
          `👑 *GROUP ADMINS*\n\n` +
          admins
            .map(
              p => `@${normalize(p.id)}`
            )
            .join(' ');

        return sock.sendMessage(
          jid,
          {
            text,
            mentions
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // GET TARGET
      // ==========================================

      const context =
        msg.message?.extendedTextMessage?.contextInfo;

      const mentioned =
        context?.mentionedJid?.[0];

      const quotedParticipant =
        context?.participant;

      const target =
        mentioned ||
        quotedParticipant;

      // ==========================================
      // TARGET REQUIRED
      // ==========================================

      if (
        ['promote', 'demote', 'kick'].includes(command)
      ) {
        if (!target) {
          return sock.sendMessage(
            jid,
            {
              text:
                `❌ Please mention a user or reply to their message.\n\n` +
                `Example:\n.${command} @user`
            },
            { quoted: msg }
          );
        }

        if (
          normalize(target) === botNumber
        ) {
          return sock.sendMessage(
            jid,
            {
              text:
                '🤖 You cannot target the bot.'
            },
            { quoted: msg }
          );
        }

        const targetParticipant =
          participants.find(
            p =>
              normalize(p.id) ===
              normalize(target)
          );

        if (!targetParticipant) {
          return sock.sendMessage(
            jid,
            {
              text:
                '❌ This user is not in the group.'
            },
            { quoted: msg }
          );
        }
      }

      // ==========================================
      // PROMOTE
      // ==========================================

      if (command === 'promote') {
        await sock.groupParticipantsUpdate(
          jid,
          [target],
          'promote'
        );

        return sock.sendMessage(
          jid,
          {
            text:
              `👑 @${normalize(target)} is now a Group Admin.`,
            mentions: [target]
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // DEMOTE
      // ==========================================

      if (command === 'demote') {
        await sock.groupParticipantsUpdate(
          jid,
          [target],
          'demote'
        );

        return sock.sendMessage(
          jid,
          {
            text:
              `⬇️ @${normalize(target)} has been demoted.`,
            mentions: [target]
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // KICK
      // ==========================================

      if (command === 'kick') {
        await sock.groupParticipantsUpdate(
          jid,
          [target],
          'remove'
        );

        return sock.sendMessage(
          jid,
          {
            text:
              `🚫 @${normalize(target)} has been removed.`,
            mentions: [target]
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // ADD
      // ==========================================

      if (command === 'add') {
        let number =
          String(args[0] || '')
            .replace(/\D/g, '');

        if (number.startsWith('00')) {
          number = number.slice(2);
        }

        if (number.length < 8) {
          return sock.sendMessage(
            jid,
            {
              text:
                `❌ Invalid number.\n\n` +
                `Example:\n.add 947xxxxxxxx`
            },
            { quoted: msg }
          );
        }

        const user =
          `${number}@s.whatsapp.net`;

        await sock.groupParticipantsUpdate(
          jid,
          [user],
          'add'
        );

        return sock.sendMessage(
          jid,
          {
            text:
              `➕ @${number} add request sent.`,
            mentions: [user]
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // TAG ALL
      // ==========================================

      if (command === 'tagall') {
        const mentions =
          participants.map(p => p.id);

        const text =
          `📢 *GROUP MEMBERS*\n\n` +
          participants
            .map(
              (p, i) =>
                `${i + 1}. @${normalize(p.id)}`
            )
            .join('\n');

        return sock.sendMessage(
          jid,
          {
            text,
            mentions
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // HIDETAG
      // ==========================================

      if (command === 'hidetag') {
        const mentions =
          participants.map(p => p.id);

        const text =
          args.join(' ').trim() ||
          '📢 Attention everyone!';

        return sock.sendMessage(
          jid,
          {
            text,
            mentions
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // OPEN
      // ==========================================

      if (command === 'open') {
        await sock.groupSettingUpdate(
          jid,
          'not_announcement'
        );

        return sock.sendMessage(
          jid,
          {
            text:
              '🔓 *GROUP OPENED*\n\n' +
              'Everyone can now send messages.'
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // CLOSE
      // ==========================================

      if (command === 'close') {
        await sock.groupSettingUpdate(
          jid,
          'announcement'
        );

        return sock.sendMessage(
          jid,
          {
            text:
              '🔒 *GROUP CLOSED*\n\n' +
              'Only admins can send messages.'
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // LOCK
      // ==========================================

      if (command === 'lock') {
        await sock.groupSettingUpdate(
          jid,
          'locked'
        );

        return sock.sendMessage(
          jid,
          {
            text:
              '🔐 *GROUP SETTINGS LOCKED*'
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // UNLOCK
      // ==========================================

      if (command === 'unlock') {
        await sock.groupSettingUpdate(
          jid,
          'unlocked'
        );

        return sock.sendMessage(
          jid,
          {
            text:
              '🔓 *GROUP SETTINGS UNLOCKED*'
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // SUBJECT
      // ==========================================

      if (
        command === 'subject' ||
        command === 'setsubject'
      ) {
        const subject =
          args.join(' ').trim();

        if (!subject) {
          return sock.sendMessage(
            jid,
            {
              text:
                `❌ Enter the new group name.\n\n` +
                `Example:\n.subject SHAN FAMILY`
            },
            { quoted: msg }
          );
        }

        await sock.groupUpdateSubject(
          jid,
          subject
        );

        return sock.sendMessage(
          jid,
          {
            text:
              `✅ Group name updated.\n\n🏷️ ${subject}`
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // DESCRIPTION
      // ==========================================

      if (
        command === 'desc' ||
        command === 'setdesc'
      ) {
        const description =
          args.join(' ').trim();

        if (!description) {
          return sock.sendMessage(
            jid,
            {
              text:
                `❌ Enter the new description.\n\n` +
                `Example:\n.desc Welcome everyone`
            },
            { quoted: msg }
          );
        }

        await sock.groupUpdateDescription(
          jid,
          description
        );

        return sock.sendMessage(
          jid,
          {
            text:
              '✅ Group description updated.'
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // GROUP LINK
      // ==========================================

      if (
        command === 'link' ||
        command === 'invite'
      ) {
        const code =
          await sock.groupInviteCode(jid);

        return sock.sendMessage(
          jid,
          {
            text:
              `🔗 *GROUP INVITE LINK*\n\n` +
              `https://chat.whatsapp.com/${code}`
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // REVOKE LINK
      // ==========================================

      if (command === 'revoke') {
        await sock.groupRevokeInvite(jid);

        return sock.sendMessage(
          jid,
          {
            text:
              '♻️ Group invite link has been revoked and renewed.'
          },
          { quoted: msg }
        );
      }

      // ==========================================
      // LEAVE
      // ==========================================

      if (command === 'leave') {
        await sock.sendMessage(
          jid,
          {
            text:
              '👋 Goodbye everyone!'
          },
          { quoted: msg }
        );

        await sock.groupLeave(jid);
      }

    } catch (error) {
      console.error(
        '[GROUP PLUGIN ERROR]',
        error
      );

      return sock.sendMessage(
        jid,
        {
          text:
            `❌ Command failed.\n\n` +
            `${error?.message || 'Unknown error'}`
        },
        { quoted: msg }
      );
    }
  }
};

export default plugin;
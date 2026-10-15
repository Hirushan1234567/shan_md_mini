// plugins/statusreact.js

'use strict';

import {
  jidNormalizedUser
} from '@whiskeysockets/baileys';

/*
╔══════════════════════════════════════╗
║       STATUS AUTO REACT SETTINGS     ║
╚══════════════════════════════════════╝
*/

const AUTO_SEEN = true;
const AUTO_REACT = true;

// "fixed" = එකම emoji
// "random" = list එකෙන් random emoji
const REACT_MODE = 'random';

const FIXED_REACT = '❤️';

const REACT_EMOJIS = [
  '❤️',
  '🔥',
  '😍',
  '🥰',
  '😂',
  '💯',
  '👏',
  '👍',
  '✨',
  '😮'
];

// [] = සියලු status වලට
// ['image'] = image විතරයි
// ['video'] = video විතරයි
// ['text'] = text විතරයි
const ALLOWED_TYPES = [];


/*
╔══════════════════════════════════════╗
║              HELPERS                 ║
╚══════════════════════════════════════╝
*/

function getStatusType(message) {

  if (!message) {
    return 'unknown';
  }

  if (message.imageMessage) {
    return 'image';
  }

  if (message.videoMessage) {
    return 'video';
  }

  if (message.audioMessage) {
    return 'audio';
  }

  if (message.extendedTextMessage) {
    return 'text';
  }

  if (message.conversation) {
    return 'text';
  }

  return 'unknown';
}

function getRandomEmoji() {

  if (!REACT_EMOJIS.length) {
    return FIXED_REACT;
  }

  return REACT_EMOJIS[
    Math.floor(
      Math.random() * REACT_EMOJIS.length
    )
  ];
}


/*
╔══════════════════════════════════════╗
║              PLUGIN                  ║
╚══════════════════════════════════════╝
*/

const plugin = {

  commands: [
    'statusreact',
    'autoreact'
  ],


  /*
  ================================
  COMMAND
  ================================
  */

  async execute(sock, msg, args, command) {

    const jid = msg?.key?.remoteJid;

    try {

      await sock.sendMessage(
        jid,
        {
          text:
            '╭━━━〔 STATUS REACT 〕━━━╮\n' +
            '┃\n' +
            `┃ 👁️ Auto Seen  : ${AUTO_SEEN ? 'ON' : 'OFF'}\n` +
            `┃ ❤️ Auto React : ${AUTO_REACT ? 'ON' : 'OFF'}\n` +
            `┃ 🎯 Mode       : ${REACT_MODE}\n` +
            `┃ ❤️ Fixed      : ${FIXED_REACT}\n` +
            '┃\n' +
            '╰━━━━━━━━━━━━━━━━━━━━╯'
        },
        {
          quoted: msg
        }
      );

    } catch (error) {

      console.error(
        '[STATUSREACT COMMAND ERROR]',
        error
      );

    }
  },


  /*
  ================================
  STATUS HANDLER
  ================================
  */

  async handleMessage(sock, msg) {

    try {

      /*
      IMPORTANT:
      Normal WhatsApp messages stop here.
      ONLY status messages continue.
      */

      if (
        msg?.key?.remoteJid !== 'status@broadcast'
      ) {
        return;
      }


      /*
      Don't react to own status
      */

      if (msg?.key?.fromMe === true) {
        return;
      }


      /*
      Get status owner
      */

      const participant =
        msg?.key?.participant ||
        msg?.key?.participantAlt;

      if (!participant) {
        return;
      }

      const statusJid =
        jidNormalizedUser(participant);


      /*
      ================================
      AUTO SEEN
      ================================
      */

      if (AUTO_SEEN) {

        try {

          await sock.readMessages([
            msg.key
          ]);

        } catch (error) {

          console.error(
            '[STATUS SEEN ERROR]',
            error
          );

        }
      }


      /*
      ================================
      AUTO REACT
      ================================
      */

      if (!AUTO_REACT) {
        return;
      }


      /*
      Detect status type
      */

      const statusType =
        getStatusType(msg?.message);


      /*
      Type filter
      */

      if (
        ALLOWED_TYPES.length > 0 &&
        !ALLOWED_TYPES.includes(statusType)
      ) {
        return;
      }


      /*
      Select emoji
      */

      let emoji = FIXED_REACT;

      if (REACT_MODE === 'random') {
        emoji = getRandomEmoji();
      }


      /*
      ================================
      REACT ONLY TO THIS STATUS
      ================================
      */

      await sock.sendMessage(
        'status@broadcast',
        {
          react: {
            text: emoji,
            key: msg.key
          }
        },
        {
          statusJidList: [
            statusJid
          ]
        }
      );

      console.log(
        `[STATUS REACT] ${statusJid} -> ${emoji}`
      );

    } catch (error) {

      console.error(
        '[STATUS REACT ERROR]',
        error
      );

    }

  }

};

export default plugin;
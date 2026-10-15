'use strict';

const plugin = {
  commands: ['ping'],

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    try {
      // Initial message
      const sent = await sock.sendMessage(
        jid,
        {
          text: '🏓 Ping Loading...\n\n▰▱▱▱▱▱▱▱▱▱ 10%'
        },
        { quoted: msg }
      );

      const steps = [
        '20%',
        '30%',
        '40%',
        '50%',
        '60%',
        '70%',
        '80%',
        '90%'
      ];

      for (const percent of steps) {
        await new Promise(resolve => setTimeout(resolve, 150));

        const value = parseInt(percent);

        const full = Math.floor(value / 10);
        const empty = 10 - full;

        const bar =
          '▰'.repeat(full) +
          '▱'.repeat(empty);

        await sock.sendMessage(
          jid,
          {
            text:
              `🏓 Ping Loading...\n\n${bar} ${percent}`,
            edit: sent.key
          }
        );
      }

      // Final result
      await new Promise(resolve => setTimeout(resolve, 150));

      const start = Date.now();

      await sock.sendMessage(
        jid,
        {
          text:
            '🏓 Ping Loading...\n\n' +
            '▰▰▰▰▰▰▰▰▰▰ 100%'
        },
        { edit: sent.key }
      );

      const ping = Date.now() - start;

      await new Promise(resolve => setTimeout(resolve, 200));

      await sock.sendMessage(
        jid,
        {
          text:
            `╭━━〔 🏓 PING 〕━━╮\n` +
            `┃\n` +
            `┃ ⚡ Speed : ${ping} ms\n` +
            `┃ 🚀 Status : Online\n` +
            `┃ 🤖 Bot : SHAN MINI BOT V1\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━╯`
        },
        { edit: sent.key }
      );

    } catch (error) {
      console.error('[PING ERROR]', error);

      await sock.sendMessage(
        jid,
        {
          text: `❌ Ping Error\n\n${error.message}`
        },
        { quoted: msg }
      );
    }
  }
};

export default plugin;
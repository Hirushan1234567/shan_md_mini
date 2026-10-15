import fs from "fs";

const LOGO_PATH = "./logo.jpg";

export default {
  command: "menu",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    const text = `╭━━━━━━━━━━━━━━━━━━━━━━━━╮
       🧑‍💻 SHAN MINI BOT V1
╰━━━━━━━━━━━━━━━━━━━━━━━━╯

              ✦ MENU ✦

╭────────「 BASIC 」────────╮

  🏓  .ping
  🟢  .alive
  ⏱️  .runtime
  🤖  .botinfo

╰──────────────────────────╯

╭────────「 BOT 」──────────╮

  ⚙️  .settings
  🛡️  .block
  🔓  .unblock

╰──────────────────────────╯

╭──────────────────────────╮
       ♛ SHAN MINI BOT ♛
          VERSION 1.0
╰──────────────────────────╯

        ✦ READY TO SERVE ✦`;

    try {
      if (fs.existsSync(LOGO_PATH)) {
        await sock.sendMessage(
          jid,
          {
            image: fs.readFileSync(LOGO_PATH),
            caption: text
          },
          { quoted: msg }
        );
      } else {
        await sock.sendMessage(
          jid,
          {
            text
          },
          { quoted: msg }
        );
      }
    } catch (error) {
      console.error(
        "Menu error:",
        error.message
      );

      await sock.sendMessage(
        jid,
        {
          text
        },
        { quoted: msg }
      );
    }
  }
};
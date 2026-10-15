import fs from "fs";

const LOGO_PATH = "./logo.jpg";

export default {
  command: "botinfo",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    const text = `╭━━━━━━━━━━━━━━━━━━━━━━╮
       🧑‍💻 SHAN MINI BOT
              V1
╰━━━━━━━━━━━━━━━━━━━━━━╯

            ✦ BOT INFO ✦

      ╭────────────────╮
       🤖 NAME    : SHAN MINI BOT
       🔰 VERSION : V1
       ⚡ ENGINE  : BAILEYS
       🟢 STATUS  : ONLINE
      ╰────────────────╯

          ♛ SYSTEM ACTIVE ♛

╰━━━━━━━━━━━━━━━━━━━━━━╯`;

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
        "Botinfo error:",
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
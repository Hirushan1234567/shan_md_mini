import fs from "fs";

const LOGO_PATH = "./logo.jpg";
const startedAt = Date.now();

/* =========================
   FORMAT RUNTIME
========================= */

function formatRuntime(ms) {
  let seconds = Math.floor(ms / 1000);

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

/* =========================
   RUNTIME PLUGIN
========================= */

export default {
  command: "runtime",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    const runtime =
      formatRuntime(
        Date.now() - startedAt
      );

    const text = `╭━━━━━━━━━━━━━━━━━━━━━━╮
        🧑‍💻 SHAN MINI BOT
               V1
╰━━━━━━━━━━━━━━━━━━━━━━╯

            ✦ RUNTIME ✦

       ╭────────────────╮
          ⏱️ ${runtime}
       ╰────────────────╯

          🟢 SYSTEM ACTIVE

       ❝ Running smoothly ❞

╭━━━━━━━━━━━━━━━━━━━━━━╮
        ♛ SHAN MINI BOT ♛
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
        "Runtime error:",
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
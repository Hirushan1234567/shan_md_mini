import fs from "fs";

const LOGO_PATH = "./logo.jpg";

const sleep = (ms) =>
  new Promise((resolve) =>
    setTimeout(resolve, ms)
  );

export default {
  command: "ping",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    try {
      /* =========================
         START
      ========================= */

      const sent =
        await sock.sendMessage(
          jid,
          {
            text:
              "╭━━━━━━━━━━━━━━━━━━━━━━╮\n" +
              "      🧑‍💻 SHAN MINI BOT V1\n" +
              "╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n" +
              "      🤖 PING SYSTEM\n\n" +
              "      ▰▱▱▱▱▱▱▱▱▱ 10%\n\n" +
              "      Initializing..."
          },
          { quoted: msg }
        );

      /* =========================
         30%
      ========================= */

      await sleep(400);

      await sock.sendMessage(
        jid,
        {
          text:
            "╭━━━━━━━━━━━━━━━━━━━━━━╮\n" +
            "      🧑‍💻 SHAN MINI BOT V1\n" +
            "╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n" +
            "      🤖 PING SYSTEM\n\n" +
            "      ▰▰▰▱▱▱▱▱▱▱ 30%\n\n" +
            "      Connecting..."
        },
        { edit: sent.key }
      );

      /* =========================
         60%
      ========================= */

      await sleep(400);

      await sock.sendMessage(
        jid,
        {
          text:
            "╭━━━━━━━━━━━━━━━━━━━━━━╮\n" +
            "      🧑‍💻 SHAN MINI BOT V1\n" +
            "╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n" +
            "      🤖 PING SYSTEM\n\n" +
            "      ▰▰▰▰▰▰▱▱▱▱ 60%\n\n" +
            "      Checking response..."
        },
        { edit: sent.key }
      );

      /* =========================
         100%
      ========================= */

      await sleep(400);

      const ping =
        Date.now() -
        Date.now();

      const finalText =
        `╭━━━━━━━━━━━━━━━━━━━━━━╮
      🧑‍💻 SHAN MINI BOT V1
╰━━━━━━━━━━━━━━━━━━━━━━╯

          🤖 PING COMPLETE

      ▰▰▰▰▰▰▰▰▰▰ 100%

        ╭──────────────╮
          🏓 PONG!
        ╰──────────────╯

      ⚡ RESPONSE : FAST
      🟢 STATUS   : ONLINE

          ♛ SYSTEM ACTIVE ♛

╰━━━━━━━━━━━━━━━━━━━━━━╯`;

      await sock.sendMessage(
        jid,
        {
          text: finalText
        },
        { edit: sent.key }
      );

    } catch (error) {
      console.error(
        "Ping error:",
        error.message
      );
    }
  }
};
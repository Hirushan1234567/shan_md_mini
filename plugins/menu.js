import { isPremium } from "./premium.js";

const OWNER_NUMBER = String(
  process.env.OWNER_NUMBER || "94752661225"
)
  .replace(/\D/g, "");

function cleanNumber(value = "") {
  return String(value)
    .replace(/@s\.whatsapp\.net/g, "")
    .replace(/@c\.us/g, "")
    .replace(/@lid/g, "")
    .split(":")[0]
    .replace(/\D/g, "");
}

function getUserNumber(msg) {
  const key = msg.key || {};

  // Private chat
  const remote = cleanNumber(key.remoteJid);

  if (remote.length >= 8) {
    return remote;
  }

  const values = [
    key.senderPn,
    key.participantPn,
    key.participant,
    key.participantAlt
  ];

  for (const value of values) {
    const number = cleanNumber(value);

    if (number.length >= 8) {
      return number;
    }
  }

  return "";
}

export default {
  command: "menu",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    try {
      const userNumber = getUserNumber(msg);

      if (!userNumber) {
        return;
      }

      const owner =
        userNumber === OWNER_NUMBER;

      // Owner = automatic premium
      const premium =
        owner || await isPremium(userNumber);

      console.log(
        "\n📋 MENU REQUEST"
      );

      console.log(
        `👤 User: ${userNumber}`
      );

      console.log(
        `👑 Owner: ${owner}`
      );

      console.log(
        `💎 Premium: ${premium}`
      );

      // =========================
      // NORMAL USER MENU
      // =========================
      if (!premium) {

        const normalMenu =
`╭━━〔 👑 SHAN MINI BOT V1 〕━━╮

🟢 Status : Online
⚡ Prefix : .

📌 COMMANDS
• .alive
• .ping
• .runtime
• .botinfo
• .menu

🛡️ OWNER
• .settings
• .block
• .unblock

╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;

        return await sock.sendMessage(
          jid,
          {
            text: normalMenu
          },
          { quoted: msg }
        );
      }

      // =========================
      // PREMIUM / OWNER MENU
      // =========================

      const premiumMenu =
`╭━━〔 💎 SHAN MINI BOT V1 〕━━╮

🟢 Status : Online
⚡ Prefix : .

📌 COMMANDS
• .alive
• .ping
• .runtime
• .botinfo
• .menu

💎 PREMIUM
• .mypremium
• .activechanreact

📢 CHANNEL REACT
• .activechanreact

✨ PREMIUM FEATURES
• Channel Auto React
• More features coming soon

╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;

      return await sock.sendMessage(
        jid,
        {
          text: premiumMenu
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error(
        "❌ Menu error:",
        error?.message || error
      );
    }
  }
};
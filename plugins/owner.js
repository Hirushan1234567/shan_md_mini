export default {
  command: ["owner", "ownercontact"],

  async execute(sock, msg) {
    const OWNER_NAME = "SHAN MINI BOT OWNER";
    const OWNER_NUMBER = "94752661225";

    const HELPER_NAME = "BOT HELPER";
    const HELPER_NUMBER = "94740027418";

    const CHANNEL_NAME = "Shan_Mini_Bot 👨‍💻";
    const CHANNEL_LINK =
      "https://whatsapp.com/channel/0029Vb9KJ1dJP210AYAZX61O";

    const owner = OWNER_NUMBER.replace(/\D/g, "");
    const helper = HELPER_NUMBER.replace(/\D/g, "");

    const text = `
╭━━〔 👑 OWNER CONTACT 〕━━╮

👑 *OWNER*
👤 ${OWNER_NAME}
📞 +${owner}
🔗 https://wa.me/${owner}

━━━━━━━━━━━━━━━━━━

🤝 *BOT HELPER*
👤 ${HELPER_NAME}
📞 +${helper}
🔗 https://wa.me/${helper}

━━━━━━━━━━━━━━━━━━

📢 *OFFICIAL CHANNEL*
${CHANNEL_NAME}
🔗 ${CHANNEL_LINK}

🤖 Powered by SHAN MINI BOT V1
╰━━━━━━━━━━━━━━━━━━╯
`.trim();

    await sock.sendMessage(
      msg.key.remoteJid,
      { text },
      { quoted: msg }
    );
  }
};
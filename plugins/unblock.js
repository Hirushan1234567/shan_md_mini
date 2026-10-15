import mongoose from "mongoose";

const blockedSchema = new mongoose.Schema({
  number: {
    type: String,
    unique: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const BlockedUser =
  mongoose.models.BlockedUser ||
  mongoose.model("BlockedUser", blockedSchema);

function cleanNumber(value = "") {
  return String(value)
    .replace(/@s\.whatsapp\.net/g, "")
    .replace(/@c\.us/g, "")
    .replace(/@lid/g, "")
    .split(":")[0]
    .replace(/\D/g, "");
}

export default {
  command: "unblock",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      let target = args?.[0];

      if (!target) {
        target =
          msg.message?.extendedTextMessage
            ?.contextInfo?.participant;
      }

      if (!target) {
        return await sock.sendMessage(
          jid,
          {
            text: "❌ Usage: .unblock 947XXXXXXXX"
          },
          { quoted: msg }
        );
      }

      target = cleanNumber(target);

      if (target.length < 8) {
        return await sock.sendMessage(
          jid,
          {
            text: "❌ Invalid WhatsApp number."
          },
          { quoted: msg }
        );
      }

      const result = await BlockedUser.deleteOne({
        number: target
      });

      if (!result.deletedCount) {
        return await sock.sendMessage(
          jid,
          {
            text: `⚠️ ${target} is not blocked.`
          },
          { quoted: msg }
        );
      }

      await sock.sendMessage(
        jid,
        {
          text:
            `╭━━〔 🔓 UNBLOCKED 〕━━╮\n` +
            `┃\n` +
            `┃ 👤 User : ${target}\n` +
            `┃ ✅ Status : UNBLOCKED\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━╯`
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error("Unblock error:", error);

      await sock.sendMessage(
        jid,
        {
          text: "❌ Failed to unblock user."
        },
        { quoted: msg }
      );
    }
  }
};
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const OWNER_NUMBER = String(process.env.OWNER_NUMBER || "")
  .replace(/\D/g, "");

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

async function isBlocked(number) {
  const clean = cleanNumber(number);

  if (!clean) return false;

  const found = await BlockedUser.findOne({
    number: clean
  }).lean();

  return !!found;
}

export default {
  command: "block",

  isBlocked,

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      let target = args?.[0];

      // .block + reply to a user's message
      if (!target) {
        target =
          msg.message?.extendedTextMessage
            ?.contextInfo?.participant;
      }

      if (!target) {
        return await sock.sendMessage(
          jid,
          {
            text: "❌ Usage: .block 947XXXXXXXX"
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

      // OWNER CAN NEVER BE BLOCKED
      if (OWNER_NUMBER && target === OWNER_NUMBER) {
        return await sock.sendMessage(
          jid,
          {
            text: "🛡️ Owner number cannot be blocked."
          },
          { quoted: msg }
        );
      }

      if (await isBlocked(target)) {
        return await sock.sendMessage(
          jid,
          {
            text: `⚠️ ${target} is already blocked.`
          },
          { quoted: msg }
        );
      }

      await BlockedUser.create({
        number: target
      });

      await sock.sendMessage(
        jid,
        {
          text:
            `╭━━〔 🚫 BLOCKED 〕━━╮\n` +
            `┃\n` +
            `┃ 👤 User : ${target}\n` +
            `┃ 🚫 Status : BLOCKED\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━╯`
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error("Block error:", error);

      await sock.sendMessage(
        jid,
        {
          text: "❌ Failed to block user."
        },
        { quoted: msg }
      );
    }
  }
};
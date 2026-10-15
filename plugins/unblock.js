import mongoose from "mongoose";

/* =========================
   DATABASE SCHEMA
========================= */

const blockedSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      unique: true,
      required: true
    }
  },
  {
    timestamps: true
  }
);

const BlockedUser =
  mongoose.models.BlockedUser ||
  mongoose.model(
    "BlockedUser",
    blockedSchema
  );

/* =========================
   CLEAN NUMBER
========================= */

function cleanNumber(value) {
  return String(value || "")
    .replace(/\D/g, "");
}

/* =========================
   UNBLOCK PLUGIN
========================= */

export default {
  command: "unblock",

  async execute(sock, msg, args) {
    const jid =
      msg.key.remoteJid;

    /* =========================
       USAGE
    ========================= */

    if (!args[0]) {
      await sock.sendMessage(
        jid,
        {
          text: `╭─「 🧑‍💻 SHAN MINI BOT V1 」─╮

         UNBLOCK USER

Usage:
.unblock 947XXXXXXXXX

Example:
.unblock 94771234567

╰────────────────────────────╯`
        },
        { quoted: msg }
      );

      return;
    }

    /* =========================
       NUMBER
    ========================= */

    const number =
      cleanNumber(args[0]);

    if (number.length < 8) {
      await sock.sendMessage(
        jid,
        {
          text:
            "❌ Invalid phone number."
        },
        { quoted: msg }
      );

      return;
    }

    /* =========================
       DATABASE
    ========================= */

    try {
      const removed =
        await BlockedUser.findOneAndDelete({
          number
        });

      if (!removed) {
        await sock.sendMessage(
          jid,
          {
            text: `╭─「 🧑‍💻 SHAN MINI BOT V1 」─╮

         UNBLOCK STATUS

Number : ${number}

User is not in the
bot block list.

╰────────────────────────────╯`
          },
          { quoted: msg }
        );

        return;
      }

      /* =========================
         SUCCESS
      ========================= */

      await sock.sendMessage(
        jid,
        {
          text: `╭─「 🧑‍💻 SHAN MINI BOT V1 」─╮

        UNBLOCK SUCCESS

Number : ${number}

User unblocked successfully.

Status : ALLOWED

╰────────────────────────────╯`
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error(
        "Unblock error:",
        error.message
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "❌ Unblock failed."
        },
        { quoted: msg }
      );
    }
  }
};
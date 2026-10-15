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
   BLOCK PLUGIN
========================= */

export default {
  command: "block",

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

          BLOCK USER

Usage:
.block 947XXXXXXXXX

Example:
.block 94771234567

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
      const exists =
        await BlockedUser.findOne({
          number
        });

      if (exists) {
        await sock.sendMessage(
          jid,
          {
            text: `╭─「 🧑‍💻 SHAN MINI BOT V1 」─╮

          BLOCK STATUS

Number : ${number}

Already blocked.

╰────────────────────────────╯`
          },
          { quoted: msg }
        );

        return;
      }

      await BlockedUser.create({
        number
      });

      /* =========================
         SUCCESS
      ========================= */

      await sock.sendMessage(
        jid,
        {
          text: `╭─「 🧑‍💻 SHAN MINI BOT V1 」─╮

          BLOCK SUCCESS

Number : ${number}

User blocked successfully.

Status : BLOCKED

╰────────────────────────────╯`
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error(
        "Block error:",
        error.message
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "❌ Block failed."
        },
        { quoted: msg }
      );
    }
  },

  /* =========================
     CHECK BLOCKED
  ========================= */

  async isBlocked(number) {
    const clean =
      cleanNumber(number);

    if (!clean) {
      return false;
    }

    try {
      const user =
        await BlockedUser.findOne({
          number: clean
        });

      return !!user;

    } catch (error) {
      console.error(
        "Block check error:",
        error.message
      );

      return false;
    }
  }
};
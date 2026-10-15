import mongoose from "mongoose";

/* =========================
   SETTINGS SCHEMA
========================= */

const settingsSchema = new mongoose.Schema(
  {
    publicMode: {
      type: Boolean,
      default: true
    },

    ownerOnly: {
      type: Boolean,
      default: false
    },

    prefix: {
      type: String,
      default: "."
    },

    autoSeen: {
      type: Boolean,
      default: false
    },

    autoReact: {
      type: Boolean,
      default: false
    },

    autoTyping: {
      type: Boolean,
      default: false
    },

    autoReply: {
      type: Boolean,
      default: false
    },

    welcome: {
      type: Boolean,
      default: false
    },

    goodbye: {
      type: Boolean,
      default: false
    },

    antiLink: {
      type: Boolean,
      default: false
    },

    antiSpam: {
      type: Boolean,
      default: false
    },

    autoSticker: {
      type: Boolean,
      default: false
    },

    autoDownload: {
      type: Boolean,
      default: false
    },

    autoCrop: {
      type: Boolean,
      default: false
    },

    autoReconnect: {
      type: Boolean,
      default: true
    },

    debugMode: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

const BotSettings =
  mongoose.models.BotSettings ||
  mongoose.model(
    "BotSettings",
    settingsSchema
  );


/* =========================
   GET SETTINGS
========================= */

async function getSettings() {
  let settings =
    await BotSettings.findOne();

  if (!settings) {
    settings =
      await BotSettings.create({});
  }

  return settings;
}


/* =========================
   STATE
========================= */

function state(value) {
  return value ? "ON" : "OFF";
}


/* =========================
   SETTINGS MENU
========================= */

function createMenu(settings) {
  return `╭━━━〔 🧑‍💻 SHAN MINI BOT V1 〕━━━╮

             ⚙️ SETTINGS

╭──────「 🌐 GENERAL 」──────╮

  🌍 1.1 Public Mode    [ ${state(
    settings.publicMode
  )} ]

  🔒 1.2 Private Mode   [ ${state(
    !settings.publicMode
  )} ]

  👑 1.3 Owner Only     [ ${state(
    settings.ownerOnly
  )} ]

  🔧 1.4 Prefix         [ ${settings.prefix} ]

╰──────────────────────────╯

╭───────「 🤖 AUTO 」───────╮

  👀 2.1 Auto Seen      [ ${state(
    settings.autoSeen
  )} ]

  👍 2.2 Auto React     [ ${state(
    settings.autoReact
  )} ]

  ⌨️  2.3 Auto Typing    [ ${state(
    settings.autoTyping
  )} ]

  💬 2.4 Auto Reply     [ ${state(
    settings.autoReply
  )} ]

╰──────────────────────────╯

╭──────「 👥 GROUP 」──────╮

  👋 3.1 Welcome        [ ${state(
    settings.welcome
  )} ]

  🚪 3.2 Goodbye        [ ${state(
    settings.goodbye
  )} ]

  🔗 3.3 Anti Link      [ ${state(
    settings.antiLink
  )} ]

  🛡️ 3.4 Anti Spam      [ ${state(
    settings.antiSpam
  )} ]

╰──────────────────────────╯

╭───────「 🎨 MEDIA 」──────╮

  🖼️ 4.1 Auto Sticker   [ ${state(
    settings.autoSticker
  )} ]

  📥 4.2 Auto Download  [ ${state(
    settings.autoDownload
  )} ]

  ✂️ 4.3 Auto Crop      [ ${state(
    settings.autoCrop
  )} ]

╰──────────────────────────╯

╭──────「 ⚡ SYSTEM 」──────╮

  🔄 5.1 Auto Reconnect [ ${state(
    settings.autoReconnect
  )} ]

  🐞 5.2 Debug Mode     [ ${state(
    settings.debugMode
  )} ]

╰──────────────────────────╯

💡 Reply with a number
   to change a setting.

        ♛ SHAN MINI BOT ♛
╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯

SHAN_SETTINGS_MENU_V1`;
}


/* =========================
   CONFIRMATION
========================= */

function confirmation() {
  return `╭─「 🧑‍💻 SHAN MINI BOT V1 」─╮

        ⚙️ SETTING CHANGED
         SUCCESSFULLY ✅

╰────────────────────────────╯`;
}


/* =========================
   TOGGLE SETTING
========================= */

async function toggleSetting(
  number,
  settings
) {
  switch (number) {

    case "1.1":
      settings.publicMode = true;
      break;

    case "1.2":
      settings.publicMode = false;
      break;

    case "1.3":
      settings.ownerOnly =
        !settings.ownerOnly;
      break;

    case "2.1":
      settings.autoSeen =
        !settings.autoSeen;
      break;

    case "2.2":
      settings.autoReact =
        !settings.autoReact;
      break;

    case "2.3":
      settings.autoTyping =
        !settings.autoTyping;
      break;

    case "2.4":
      settings.autoReply =
        !settings.autoReply;
      break;

    case "3.1":
      settings.welcome =
        !settings.welcome;
      break;

    case "3.2":
      settings.goodbye =
        !settings.goodbye;
      break;

    case "3.3":
      settings.antiLink =
        !settings.antiLink;
      break;

    case "3.4":
      settings.antiSpam =
        !settings.antiSpam;
      break;

    case "4.1":
      settings.autoSticker =
        !settings.autoSticker;
      break;

    case "4.2":
      settings.autoDownload =
        !settings.autoDownload;
      break;

    case "4.3":
      settings.autoCrop =
        !settings.autoCrop;
      break;

    case "5.1":
      settings.autoReconnect =
        !settings.autoReconnect;
      break;

    case "5.2":
      settings.debugMode =
        !settings.debugMode;
      break;

    default:
      return false;
  }

  await settings.save();

  return true;
}


/* =========================
   PREFIX VALIDATION
========================= */

function validPrefix(prefix) {
  if (!prefix) {
    return false;
  }

  if (prefix.length > 3) {
    return false;
  }

  if (/\s/.test(prefix)) {
    return false;
  }

  return true;
}


/* =========================
   PLUGIN
========================= */

export default {

  command: "settings",


  /* =========================
     OPEN SETTINGS
  ========================= */

  async execute(sock, msg) {

    const jid =
      msg.key.remoteJid;

    try {

      const settings =
        await getSettings();

      const menu =
        createMenu(settings);

      await sock.sendMessage(
        jid,
        {
          text: menu
        },
        { quoted: msg }
      );

    } catch (error) {

      console.error(
        "Settings error:",
        error.message
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "❌ Unable to load settings."
        },
        { quoted: msg }
      );
    }
  },


  /* =========================
     HANDLE SETTINGS REPLY
  ========================= */

  async handleReply(
    sock,
    msg,
    text
  ) {

    const jid =
      msg.key.remoteJid;

    const value =
      String(text || "")
        .trim();


    /* =========================
       PREFIX CHANGE
    ========================= */

    if (value === "1.4") {

      await sock.sendMessage(
        jid,
        {
          text: `╭─「 🔧 PREFIX 」─╮

Send your new prefix.

Example:
!

Maximum length: 3 characters.

╰──────────────────╯`
        },
        { quoted: msg }
      );

      return;
    }


    /* =========================
       SAVE NEW PREFIX
    ========================= */

    if (
      value.startsWith("PREFIX:")
    ) {

      const newPrefix =
        value
          .replace(
            "PREFIX:",
            ""
          )
          .trim();

      if (
        !validPrefix(
          newPrefix
        )
      ) {

        await sock.sendMessage(
          jid,
          {
            text:
              "❌ Invalid prefix."
          },
          { quoted: msg }
        );

        return;
      }

      const settings =
        await getSettings();

      settings.prefix =
        newPrefix;

      await settings.save();

      await sock.sendMessage(
        jid,
        {
          text: confirmation()
        },
        { quoted: msg }
      );

      return;
    }


    /* =========================
       NORMAL SETTINGS
    ========================= */

    const settings =
      await getSettings();

    const changed =
      await toggleSetting(
        value,
        settings
      );

    if (!changed) {
      return;
    }


    /* =========================
       CONFIRMATION
    ========================= */

    await sock.sendMessage(
      jid,
      {
        text: confirmation()
      },
      { quoted: msg }
    );
  },


  /* =========================
     EXPORT SETTINGS
  ========================= */

  async getSettings() {
    return await getSettings();
  }
};
import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import readline from "readline";
import fs from "fs";
import path from "path";
import http from "http";
import { pathToFileURL } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config();

/* =====================================================
BAILEYS
===================================================== */

const makeWASocket =
  typeof baileys.default === "function"
    ? baileys.default
    : baileys.makeWASocket;

const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  jidNormalizedUser
} = baileys;

/* =====================================================
ENV CLEANERS
(Railway / Render variables වල වැරදි paste වීම් හදාගන්න)
===================================================== */

// "94752661225" දෙපාරක් ඇලිලා (9475266122594752661225) තිබුණොත් එක පාරක් විතරක් ගන්නවා
function normalizePairNumber(value = "") {
  let digits = String(value).replace(/\D/g, "");

  if (digits.length > 15 && digits.length % 2 === 0) {
    const half = digits.slice(0, digits.length / 2);

    if (digits === half + half) {
      digits = half;
    }
  }

  return digits;
}

// HTTP header එකට නුසුදුසු අකුරු (space, quotes, සිංහල, අලුත් line) ඉවත් කරනවා
function normalizeCorsOrigin(value = "") {
  const cleaned = String(value)
    .replace(/[^\x21-\x7E]/g, "")
    .replace(/["']/g, "")
    .replace(/\/+$/, "");

  return cleaned || "*";
}

/* =====================================================
CONFIG
===================================================== */

// Main bot session
// Persistent Volume mount කළොත්: SESSION_DIR=/data/sessions
const SESSION_DIR = process.env.SESSION_DIR || "./sessions";

// අනිත් users ලාගේ sessions (අංකයක් අංකයක් වශයෙන් folder)
// Persistent Volume mount කළොත්: USER_SESSIONS_DIR=/data/user_sessions
const USER_SESSIONS_DIR = process.env.USER_SESSIONS_DIR || "./user_sessions";

const PLUGINS_DIR = process.env.PLUGINS_DIR || "./plugins";
const MONGODB_URI = process.env.MONGODB_URI || "";
const DEFAULT_PREFIX = process.env.PREFIX || ".";

// Main bot pair කරන අංකය (Railway / Render වල terminal එකක් නැති නිසා env එකෙන්)
// දාන්නේ නැත්නම් main bot start වෙන්නේ නැහැ, ඒත් website එකෙන් user pairing වැඩ කරනවා.
const MAIN_PAIR_NUMBER = normalizePairNumber(process.env.MAIN_PAIR_NUMBER || "");

// Welcome message logo
const BOT_LOGO_PATH = process.env.BOT_LOGO_PATH || "./logo.jpg";
const BOT_LOGO_URL = process.env.BOT_LOGO_URL || "";

// Multi-session settings
const ALLOW_PUBLIC_PAIR =
  String(process.env.ALLOW_PUBLIC_PAIR ?? "true").toLowerCase() !== "false";
const MAX_USER_SESSIONS = Number(process.env.MAX_USER_SESSIONS || 50);
const PAIR_TIMEOUT_MS = 150000;

// Pairing Website API server
const API_ENABLED =
  String(process.env.API_ENABLED ?? "true").toLowerCase() !== "false";

// Railway / Render PORT එක auto set කරනවා
const API_PORT = Number(
  process.env.PORT || process.env.SERVER_PORT || process.env.API_PORT || 3000
);

// GitHub Pages origin එක දාන්න: https://username.github.io  (නැත්නම් * — default)
const API_CORS_ORIGIN = normalizeCorsOrigin(process.env.CORS_ORIGIN || "*");

// User sessions වල භාවිතා කරන්න බැරි (main bot එකට විතරක්) commands
const USER_BLOCKED_COMMANDS = new Set(
  String(
    process.env.USER_BLOCKED_COMMANDS ||
      "update,restart,eval,exec,shell,pluginon,pluginoff,pluginlist,plugins,block,unblock,addprem,delprem,premium,broadcast,bc,pair,delpair,pairlist"
  )
    .split(",")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean)
);

/* =====================================================
AUTO FOLLOW CHANNELS
(link හෝ 120363xxxx@newsletter JID දෙකම පුළුවන්)
Extra channels env එකෙන්: AUTO_FOLLOW_CHANNELS=link1,link2
===================================================== */

const AUTO_FOLLOW_CHANNELS = [
  "https://whatsapp.com/channel/0029Vb9KJ1dJP210AYAZX61O",
  ...String(process.env.AUTO_FOLLOW_CHANNELS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
];

/* =====================================================
NUMBER CLEANER
===================================================== */

function cleanNumber(value = "") {
  return String(value)
    .replace(/@s\.whatsapp\.net/g, "")
    .replace(/@c\.us/g, "")
    .replace(/@lid/g, "")
    .split(":")[0]
    .split("@")[0]
    .replace(/\D/g, "");
}

/* =====================================================
BOT OWNERS
===================================================== */

// Main Owner — Owner-only කමාන්ඩ් ක්‍රියාත්මක වන්නේ මේ අංකයට
const MAIN_OWNER_NUMBER = "94752661225";

const OWNER_NUMBERS = [MAIN_OWNER_NUMBER].map(cleanNumber);

/* =====================================================
LOGGER
===================================================== */

const logger = pino({
  level: process.env.LOG_LEVEL || "silent"
});

/* =====================================================
READLINE (main bot pairing සඳහා පමණක් — local run)
===================================================== */

let rl = null;

function ask(question) {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim());
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* =====================================================
MONGODB
===================================================== */

let mongoConnected = false;

async function connectMongo() {
  if (!MONGODB_URI) {
    console.log("⚠️ MONGODB_URI not configured.");
    console.log("⚠️ Session backup & per-user settings need MongoDB.");
    console.log("⚠️ MongoDB නැතුව restart/redeploy කළාම sessions මැකෙනවා!");
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    mongoConnected = true;
    console.log("✅ MongoDB connected.");
  } catch (error) {
    console.error("❌ MongoDB error:", error?.message || error);
  }
}

/* =====================================================
PREMIUM MODEL
===================================================== */

const premiumSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      unique: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  {
    collection: "premiumusers"
  }
);

const PremiumUser =
  mongoose.models.PremiumUser ||
  mongoose.model("PremiumUser", premiumSchema);

async function isPremium(number) {
  const cleaned = cleanNumber(number);

  if (cleaned === cleanNumber(MAIN_OWNER_NUMBER)) {
    return true;
  }

  if (!mongoConnected) {
    return false;
  }

  try {
    const user = await PremiumUser.findOne({
      number: cleaned,
      expiresAt: { $gt: new Date() }
    });

    return Boolean(user);
  } catch (error) {
    console.error("❌ Premium check error:", error?.message || error);
    return false;
  }
}

async function expirePremiumUsers() {
  if (!mongoConnected) {
    return;
  }

  try {
    const result = await PremiumUser.deleteMany({
      expiresAt: { $lte: new Date() }
    });

    if (result.deletedCount > 0) {
      console.log(
        `💎 Expired premium users removed: ${result.deletedCount}`
      );
    }
  } catch (error) {
    console.error("❌ Premium expiry error:", error?.message || error);
  }
}

/* =====================================================
SETTINGS MODEL  (session එකකට settings එකක්)
===================================================== */

const settingsSchema = new mongoose.Schema(
  {
    sessionId: { type: String, default: "main", index: true },

    publicMode: { type: Boolean, default: true },
    ownerOnly: { type: Boolean, default: false },
    prefix: { type: String, default: DEFAULT_PREFIX },

    autoSeen: { type: Boolean, default: false },
    autoReact: { type: Boolean, default: false },
    autoTyping: { type: Boolean, default: false },
    autoReply: { type: Boolean, default: false },

    welcome: { type: Boolean, default: false },
    goodbye: { type: Boolean, default: false },
    antiLink: { type: Boolean, default: false },
    antiSpam: { type: Boolean, default: false },

    autoSticker: { type: Boolean, default: false },
    autoDownload: { type: Boolean, default: false },
    autoCrop: { type: Boolean, default: false },

    autoReconnect: { type: Boolean, default: true },
    debugMode: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    collection: "botsettings"
  }
);

const BotSettings =
  mongoose.models.BotSettings ||
  mongoose.model("BotSettings", settingsSchema);

function defaultSettings() {
  return {
    sessionId: "main",

    publicMode: true,
    ownerOnly: false,
    prefix: DEFAULT_PREFIX,

    autoSeen: false,
    autoReact: false,
    autoTyping: false,
    autoReply: false,

    welcome: false,
    goodbye: false,
    antiLink: false,
    antiSpam: false,

    autoSticker: false,
    autoDownload: false,
    autoCrop: false,

    autoReconnect: true,
    debugMode: false
  };
}

async function getSettings(sessionId = "main") {
  if (!mongoConnected) {
    return { ...defaultSettings(), sessionId };
  }

  try {
    // පරණ main settings document එකට sessionId නැති නිසා ඒකත් main ලෙස ගන්නවා
    const filter =
      sessionId === "main"
        ? { $or: [{ sessionId: "main" }, { sessionId: { $exists: false } }] }
        : { sessionId };

    let settings = await BotSettings.findOne(filter);

    if (!settings) {
      settings = await BotSettings.create({
        sessionId,
        prefix: DEFAULT_PREFIX
      });
    }

    return settings;
  } catch (error) {
    console.error("❌ Settings error:", error?.message || error);
    return { ...defaultSettings(), sessionId };
  }
}

async function updateSettings(sessionId, patch = {}) {
  const settings = await getSettings(sessionId);

  if (!mongoConnected || typeof settings.save !== "function") {
    return Object.assign(settings, patch);
  }

  try {
    Object.assign(settings, patch);
    await settings.save();
  } catch (error) {
    console.error("❌ Update settings error:", error?.message || error);
  }

  return settings;
}

/* =====================================================
PLUGIN MANAGER MODEL
===================================================== */

const pluginStateSchema = new mongoose.Schema(
  {
    plugin: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    enabled: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    collection: "pluginstates"
  }
);

const PluginState =
  mongoose.models.PluginState ||
  mongoose.model("PluginState", pluginStateSchema);

/* =====================================================
SESSION BACKUP MODEL
(session files මැකුණත් MongoDB එකෙන් ආයෙ restore කරන්න)
===================================================== */

const sessionFileSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    name: { type: String, required: true },
    data: { type: String, required: true }
  },
  {
    timestamps: true,
    collection: "sessionfiles"
  }
);

sessionFileSchema.index({ sessionId: 1, name: 1 }, { unique: true });

const SessionFile =
  mongoose.models.SessionFile ||
  mongoose.model("SessionFile", sessionFileSchema);

/* =====================================================
PLUGIN MAP
===================================================== */

const plugins = new Map();
const pluginFiles = new Map();

async function getPluginState(pluginName) {
  const name = String(pluginName || "").trim().toLowerCase();

  if (!name) {
    return true;
  }

  if (!mongoConnected) {
    return true;
  }

  try {
    let state = await PluginState.findOne({ plugin: name });

    if (!state) {
      state = await PluginState.create({
        plugin: name,
        enabled: true
      });
    }

    return state.enabled !== false;
  } catch (error) {
    console.error(
      `❌ Plugin state error (${name}):`,
      error?.message || error
    );

    return true;
  }
}

async function setPluginState(pluginName, enabled) {
  const name = String(pluginName || "").trim().toLowerCase();

  if (!name) {
    return null;
  }

  if (!mongoConnected) {
    return {
      plugin: name,
      enabled: Boolean(enabled)
    };
  }

  try {
    return await PluginState.findOneAndUpdate(
      { plugin: name },
      {
        plugin: name,
        enabled: Boolean(enabled)
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );
  } catch (error) {
    console.error("❌ Set plugin state error:", error?.message || error);
    return null;
  }
}

/* =====================================================
COMMAND NAME
===================================================== */

function getCommandName(command) {
  if (typeof command === "string") {
    return command.trim().toLowerCase() || null;
  }

  if (
    command &&
    typeof command === "object" &&
    typeof command.name === "string"
  ) {
    return command.name.trim().toLowerCase() || null;
  }

  if (command instanceof RegExp) {
    const source = command.source
      .replace(/^\^/, "")
      .replace(/\$$/, "");

    const match = source.match(/^[a-zA-Z0-9_-]+/);

    if (match) {
      return match[0].toLowerCase();
    }
  }

  return null;
}

function getPluginCommands(plugin) {
  const commands = [];

  if (!plugin) {
    return commands;
  }

  const addCommand = value => {
    const name = getCommandName(value);

    if (name) {
      commands.push(name);
    }
  };

  const addAll = value => {
    if (Array.isArray(value)) {
      for (const item of value) {
        addCommand(item);
      }
    } else {
      addCommand(value);
    }
  };

  addAll(plugin.command);
  addAll(plugin.commands);
  addAll(plugin.alias);

  return [...new Set(commands)];
}

const MANAGER_COMMANDS = [
  "pluginon",
  "pluginoff",
  "pluginlist",
  "plugins"
];

async function getAllPluginStates() {
  const result = [];
  const seen = new Set();

  for (const [command, plugin] of plugins.entries()) {
    if (!plugin) {
      continue;
    }

    if (seen.has(plugin)) {
      continue;
    }

    seen.add(plugin);

    if (MANAGER_COMMANDS.includes(command)) {
      continue;
    }

    const commands = getPluginCommands(plugin);
    const checkCommand = commands[0] || command;
    const enabled = await getPluginState(checkCommand);

    result.push({
      command: checkCommand,
      enabled
    });
  }

  return result;
}

async function isPluginEnabled(command) {
  const name = String(command || "").trim().toLowerCase();

  if (MANAGER_COMMANDS.includes(name)) {
    return true;
  }

  return await getPluginState(name);
}

/* =====================================================
LOAD PLUGINS
===================================================== */

async function loadPlugins() {
  plugins.clear();
  pluginFiles.clear();

  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  const files = fs.readdirSync(PLUGINS_DIR);

  console.log("");
  console.log("📂 Loading plugins...");
  console.log("");

  for (const file of files) {
    if (!file.endsWith(".js") && !file.endsWith(".mjs")) {
      continue;
    }

    try {
      const fullPath = path.resolve(PLUGINS_DIR, file);
      const url = `${pathToFileURL(fullPath).href}?v=${Date.now()}`;
      const mod = await import(url);

      let plugin = mod.default || mod;

      if (!plugin) {
        console.log(`⚠️ Skipped ${file}: empty export`);
        continue;
      }

      if (typeof plugin === "function") {
        const command = getCommandName(plugin.command);

        if (!command) {
          console.log(`⚠️ Skipped ${file}: function has no command`);
          continue;
        }

        plugins.set(command, plugin);
        pluginFiles.set(command, file);

        console.log(`✅ Plugin loaded: ${file} -> ${command}`);
        continue;
      }

      if (typeof plugin !== "object") {
        console.log(`⚠️ Skipped ${file}: invalid export`);
        continue;
      }

      const commands = getPluginCommands(plugin);

      if (!commands.length) {
        console.log(`⚠️ Skipped ${file}: no command`);
        continue;
      }

      for (const command of commands) {
        plugins.set(command, plugin);
        pluginFiles.set(command, file);
      }

      console.log(`✅ Plugin loaded: ${file} -> ${commands.join(", ")}`);
    } catch (error) {
      console.error(`❌ Plugin load error: ${file}`);
      console.error(error?.stack || error?.message || error);
    }
  }

  console.log("");
  console.log(`📦 Total plugin commands loaded: ${plugins.size}`);
  console.log("");
}

/* =====================================================
MESSAGE WRAPPER
===================================================== */

function createMessageWrapper(sock, msg) {
  const jid = msg?.key?.remoteJid;
  const sender = msg?.key?.participant || jid;

  return {
    ...msg,

    chat: jid,
    sender,
    fromMe: msg?.key?.fromMe || false,

    reply: async text => {
      if (!jid) {
        return;
      }

      return sock.sendMessage(
        jid,
        { text: String(text) },
        { quoted: msg }
      );
    },

    react: async emoji => {
      if (!msg?.key || !jid) {
        return;
      }

      return sock.sendMessage(jid, {
        react: {
          text: String(emoji),
          key: msg.key
        }
      });
    }
  };
}

/* =====================================================
BLOCK CHECK
===================================================== */

async function isNumberBlocked(number) {
  const cleaned = cleanNumber(number);

  if (cleaned === cleanNumber(MAIN_OWNER_NUMBER)) {
    return false;
  }

  const plugin = plugins.get("block");

  if (!plugin || typeof plugin.isBlocked !== "function") {
    return false;
  }

  try {
    return Boolean(await plugin.isBlocked(cleaned));
  } catch (error) {
    console.error("❌ Block check error:", error?.message || error);
    return false;
  }
}

/* =====================================================
SENDER / OWNER  (session එක අනුව)
===================================================== */

function getSenderNumber(msg, ctx) {
  const key = msg?.key || {};

  if (key.fromMe === true) {
    return ctx && !ctx.isMain ? ctx.number || "" : MAIN_OWNER_NUMBER;
  }

  const values = [
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid
  ];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const number = cleanNumber(value);

    if (number === MAIN_OWNER_NUMBER) {
      return MAIN_OWNER_NUMBER;
    }
  }

  for (const value of values) {
    if (!value) {
      continue;
    }

    const number = cleanNumber(value);

    if (number.length >= 8) {
      return number;
    }
  }

  return "";
}

// Main owner හෝ ඒ session එකේ අයිතිකරු
function isOwner(msg, ctx) {
  if (msg?.key?.fromMe === true) {
    return true;
  }

  const sender = cleanNumber(getSenderNumber(msg, ctx));

  if (!sender) {
    return false;
  }

  if (OWNER_NUMBERS.includes(sender)) {
    return true;
  }

  return Boolean(ctx && !ctx.isMain && ctx.number && sender === ctx.number);
}

// ප්‍රධාන Owner පමණක්
function isMainOwner(msg, ctx) {
  if (msg?.key?.fromMe === true) {
    return !ctx || ctx.isMain;
  }

  return cleanNumber(getSenderNumber(msg, ctx)) === MAIN_OWNER_NUMBER;
}

/* =====================================================
MESSAGE TEXT
===================================================== */

function getMessageText(msg) {
  let message = msg?.message;

  if (!message) {
    return "";
  }

  if (message.ephemeralMessage?.message) {
    message = message.ephemeralMessage.message;
  }

  if (message.viewOnceMessage?.message) {
    message = message.viewOnceMessage.message;
  }

  if (message.viewOnceMessageV2?.message) {
    message = message.viewOnceMessageV2.message;
  }

  if (message.viewOnceMessageV2Extension?.message) {
    message = message.viewOnceMessageV2Extension.message;
  }

  if (typeof message.conversation === "string") {
    return message.conversation;
  }

  if (typeof message.extendedTextMessage?.text === "string") {
    return message.extendedTextMessage.text;
  }

  if (typeof message.imageMessage?.caption === "string") {
    return message.imageMessage.caption;
  }

  if (typeof message.videoMessage?.caption === "string") {
    return message.videoMessage.caption;
  }

  if (typeof message.documentMessage?.caption === "string") {
    return message.documentMessage.caption;
  }

  return "";
}

function parseCommand(text, prefix) {
  const value = String(text || "").trim();

  if (!prefix || !value.startsWith(prefix)) {
    return null;
  }

  const body = value.slice(prefix.length).trim();

  if (!body) {
    return null;
  }

  const parts = body.split(/\s+/);
  const command = String(parts.shift() || "").toLowerCase();

  return {
    command,
    args: parts
  };
}

function getQuotedMessage(msg) {
  const message = msg?.message;

  if (!message) {
    return null;
  }

  const context = message.extendedTextMessage?.contextInfo;

  return context?.quotedMessage || null;
}

/* =====================================================
PLUGIN REPLY
===================================================== */

async function handlePluginReply(sock, msg) {
  const text = getMessageText(msg).trim();

  if (!text) {
    return false;
  }

  const quoted = getQuotedMessage(msg);

  if (!quoted) {
    return false;
  }

  const quotedText =
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    "";

  if (quotedText.includes("SHAN_SETTINGS_MENU_V1")) {
    const plugin = plugins.get("settings");

    if (plugin && typeof plugin.handleReply === "function") {
      try {
        const enabled = await isPluginEnabled("settings");

        if (!enabled) {
          return true;
        }

        await plugin.handleReply(sock, msg, text);

        return true;
      } catch (error) {
        console.error(
          "❌ Settings reply error:",
          error?.stack || error?.message || error
        );

        return true;
      }
    }
  }

  const uniquePlugins = [...new Set(plugins.values())];

  for (const plugin of uniquePlugins) {
    if (typeof plugin.handleReply !== "function") {
      continue;
    }

    if (plugin.replyHandler !== true) {
      continue;
    }

    let pluginEnabled = true;

    for (const [command, registeredPlugin] of plugins.entries()) {
      if (registeredPlugin !== plugin) {
        continue;
      }

      if (MANAGER_COMMANDS.includes(command)) {
        continue;
      }

      pluginEnabled = await isPluginEnabled(command);

      break;
    }

    if (!pluginEnabled) {
      continue;
    }

    try {
      const handled = await plugin.handleReply(sock, msg, text);

      if (handled === true) {
        return true;
      }
    } catch (error) {
      console.error("❌ Plugin reply error:", error?.message || error);
    }
  }

  return false;
}

/* =====================================================
ACCESS GATE (owner-only / private / blocked)
===================================================== */

async function denyIfRestricted(sock, msg, settings, owner, sender) {
  if (owner) {
    return false;
  }

  let text = "";

  if (settings.ownerOnly) {
    text = "👑 This bot is currently owner-only.";
  } else if (!settings.publicMode) {
    text = "🔒 Bot is currently in private mode.";
  } else if (sender && (await isNumberBlocked(sender))) {
    text = "🚫 You are blocked from using this bot.";
  }

  if (!text) {
    return false;
  }

  await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

  return true;
}

/* =====================================================
EXECUTE PLUGIN
===================================================== */

async function executePlugin(sock, msg, command, args, settings, ctx) {
  const commandName = String(command).toLowerCase().trim();
  const plugin = plugins.get(commandName);

  if (!plugin) {
    console.log(`⚠️ Plugin not found: ${commandName}`);
    return false;
  }

  const sender = getSenderNumber(msg, ctx);
  const owner = isOwner(msg, ctx);

  // User sessions වලට main-only commands තහනම්
  if (
    !ctx.isMain &&
    !isMainOwner(msg, ctx) &&
    (USER_BLOCKED_COMMANDS.has(commandName) ||
      getPluginCommands(plugin).some(c => USER_BLOCKED_COMMANDS.has(c)))
  ) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: "⛔ This command is available only in the main bot." },
      { quoted: msg }
    );

    return true;
  }

  if (!MANAGER_COMMANDS.includes(commandName)) {
    const enabled = await isPluginEnabled(commandName);

    if (!enabled) {
      console.log(`⛔ Plugin disabled: ${commandName}`);

      if (owner) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
              `╭━━〔 🔌 PLUGIN MANAGER 〕━━╮\n\n⛔ PLUGIN DISABLED\n\n📦 Plugin:\n${commandName}\n\n🔴 Status: OFF\n\nEnable:\n.pluginon ${commandName}\n\n╰━━━━━━━━━━━━━━━━━━━━━━╯`
          },
          { quoted: msg }
        );
      }

      return true;
    }
  }

  if (await denyIfRestricted(sock, msg, settings, owner, sender)) {
    return true;
  }

  if (plugin.premium === true && !owner) {
    const premium = await isPremium(sender);

    if (!premium) {
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
            `💎 PREMIUM COMMAND\n\nThis command is available\nfor premium users only.\n\nContact the owner to activate premium.`
        },
        { quoted: msg }
      );

      return true;
    }
  }

  console.log("");
  console.log(`🔌 [${ctx.id}] Executing plugin: ${commandName}`);
  console.log(`👤 Sender: ${sender || "Unknown"}`);
  console.log(`👑 Owner: ${owner}`);

  try {
    if (typeof plugin.execute === "function") {
      await plugin.execute(sock, msg, args, commandName);

      console.log(`✅ Plugin completed: ${commandName}`);
      return true;
    }

    if (typeof plugin.run === "function") {
      const wrapped = createMessageWrapper(sock, msg);

      await plugin.run({
        sock,
        m: wrapped,
        args,
        config: {
          ...process.env,
          PREFIX: settings.prefix
        }
      });

      console.log(`✅ Plugin completed: ${commandName}`);
      return true;
    }

    if (typeof plugin === "function") {
      const wrapped = createMessageWrapper(sock, msg);
      const text = args.join(" ").trim();

      await plugin(wrapped, {
        conn: sock,
        text,
        usedPrefix: settings.prefix,
        command: commandName
      });

      console.log(`✅ Plugin completed: ${commandName}`);
      return true;
    }

    if (typeof plugin.handleMessage === "function") {
      await plugin.handleMessage(sock, msg, args, commandName);

      console.log(`✅ Plugin completed: ${commandName}`);
      return true;
    }

    console.log(`❌ Plugin "${commandName}" has no supported executor.`);

    return false;
  } catch (error) {
    console.error(
      `❌ ${commandName} error:`,
      error?.stack || error?.message || error
    );

    try {
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: `❌ Command Error\n\n${error?.message || error}`
        },
        { quoted: msg }
      );
    } catch {}

    return true;
  }
}

/* =====================================================
CHANNEL REACT
===================================================== */

async function handleChannelReact(sock, msg) {
  const plugin = plugins.get("activechanreact");

  if (!plugin || typeof plugin.handleMessage !== "function") {
    return;
  }

  const enabled = await isPluginEnabled("activechanreact");

  if (!enabled) {
    return;
  }

  try {
    const handled = await plugin.handleMessage(sock, msg);

    if (handled) {
      console.log("📢 Channel message handled by activechanreact");
    }
  } catch (error) {
    console.error(
      "❌ Channel React Error:",
      error?.stack || error?.message || error
    );
  }
}

/* =====================================================
AUTO SEEN
===================================================== */

async function handleAutoSeen(sock, msg, settings) {
  if (!settings.autoSeen) {
    return;
  }

  try {
    await sock.readMessages([msg.key]);
  } catch {}
}

/* =====================================================
BACKGROUND PLUGINS
===================================================== */

async function handleBackgroundPlugins(sock, msg) {
  const uniquePlugins = [...new Set(plugins.values())];

  for (const plugin of uniquePlugins) {
    if (!plugin) {
      continue;
    }

    if (typeof plugin.handleMessage !== "function") {
      continue;
    }

    let command = null;

    for (const [registeredCommand, registeredPlugin] of plugins.entries()) {
      if (registeredPlugin === plugin) {
        command = registeredCommand;
        break;
      }
    }

    if (!command) {
      continue;
    }

    if (MANAGER_COMMANDS.includes(command)) {
      continue;
    }

    const enabled = await isPluginEnabled(command);

    if (!enabled) {
      continue;
    }

    try {
      await plugin.handleMessage(sock, msg);
    } catch (error) {
      console.error(
        `❌ Background plugin error: ${command}`,
        error?.stack || error?.message || error
      );
    }
  }
}

/* =====================================================
MULTI SESSION — STATE
===================================================== */

// id -> session context   (main bot id = "main", users = ඔවුන්ගේ අංකය)
const sessions = new Map();

// session backup: අන්තිමට backup කළ file mtime
const backupState = new Map();

// .pair cooldown
const pairCooldown = new Map();

let cachedVersion = null;
let cachedVersionAt = 0;

function isValidUserId(id) {
  return /^\d{8,15}$/.test(String(id));
}

function createCtx(id) {
  const isMain = id === "main";

  return {
    id,
    isMain,
    dir: isMain ? SESSION_DIR : path.join(USER_SESSIONS_DIR, id),

    sock: null,
    status: "init", // init | pairing | connecting | open | closed | replaced
    starting: false,
    stopped: false,

    reconnectTimer: null,
    backupTimer: null,
    pairTimer: null,

    pairNumber: "",
    pairingRequested: false,
    pairFails: 0,
    notify: null,

    // Website API සඳහා
    onCode: null,
    onFail: null,
    lastCode: "",
    lastCodeAt: 0,

    followed: new Set(),
    number: ""
  };
}

/* =====================================================
SESSION BACKUP / RESTORE (MongoDB)
===================================================== */

async function backupSession(id, dir) {
  if (!mongoConnected || !fs.existsSync(dir)) {
    return;
  }

  const credsPath = path.join(dir, "creds.json");

  if (!fs.existsSync(credsPath)) {
    return;
  }

  // Pair නොවූ (registered නොවන) session backup කරන්නේ නැහැ
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));

    if (!creds?.registered) {
      return;
    }
  } catch {
    return;
  }

  const known = backupState.get(id) || new Map();
  backupState.set(id, known);

  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  const ops = [];

  for (const file of files) {
    try {
      const full = path.join(dir, file);
      const mtime = fs.statSync(full).mtimeMs;

      if (known.get(file) === mtime) {
        continue;
      }

      const data = fs.readFileSync(full, "utf8");

      // අඩක් ලියවුණු file එකක් නම් මග හරින්න
      JSON.parse(data);

      ops.push({
        updateOne: {
          filter: { sessionId: id, name: file },
          update: { $set: { data } },
          upsert: true
        }
      });

      known.set(file, mtime);
    } catch {}
  }

  for (const file of [...known.keys()]) {
    if (!files.includes(file)) {
      ops.push({
        deleteOne: { filter: { sessionId: id, name: file } }
      });

      known.delete(file);
    }
  }

  if (ops.length) {
    await SessionFile.bulkWrite(ops, { ordered: false });
  }
}

async function restoreSession(id, dir) {
  if (!mongoConnected) {
    return false;
  }

  if (fs.existsSync(path.join(dir, "creds.json"))) {
    return false;
  }

  try {
    const docs = await SessionFile.find({ sessionId: id }).lean();

    if (!docs.some(d => d.name === "creds.json")) {
      return false;
    }

    fs.mkdirSync(dir, { recursive: true });

    for (const doc of docs) {
      fs.writeFileSync(path.join(dir, path.basename(doc.name)), doc.data);
    }

    return true;
  } catch (error) {
    console.error(`❌ [${id}] Restore error:`, error?.message || error);
    return false;
  }
}

function scheduleBackup(ctx) {
  clearTimeout(ctx.backupTimer);

  ctx.backupTimer = setTimeout(() => {
    backupSession(ctx.id, ctx.dir).catch(() => {});
  }, 4000);
}

// Bot run වෙද්දි session files මැකුණොත් MongoDB එකෙන් ආයෙ හදාගන්න
async function healSession(ctx) {
  if (ctx.status !== "open" || ctx.stopped) {
    return;
  }

  if (fs.existsSync(path.join(ctx.dir, "creds.json"))) {
    return;
  }

  const restored = await restoreSession(ctx.id, ctx.dir);

  if (!restored) {
    return;
  }

  console.log(`♻️ [${ctx.id}] Session files were deleted — restored from MongoDB.`);

  backupState.delete(ctx.id);
  detachSocket(ctx);
  ctx.starting = false;
  scheduleReconnect(ctx, 1000);
}

function startBackupLoop() {
  setInterval(async () => {
    for (const ctx of sessions.values()) {
      try {
        await healSession(ctx);
        await backupSession(ctx.id, ctx.dir);
      } catch {}
    }
  }, 60000);
}

/* =====================================================
SESSION CLEANUP
===================================================== */

function detachSocket(ctx) {
  const old = ctx.sock;

  if (!old) {
    return;
  }

  try {
    old.ev.removeAllListeners("connection.update");
    old.ev.removeAllListeners("messages.upsert");
    old.ev.removeAllListeners("creds.update");
  } catch {}

  try {
    old.end?.(undefined);
  } catch {}

  ctx.sock = null;
}

async function removeSession(id) {
  const ctx = sessions.get(id);

  if (ctx) {
    ctx.stopped = true;

    clearTimeout(ctx.reconnectTimer);
    clearTimeout(ctx.backupTimer);
    clearTimeout(ctx.pairTimer);

    ctx.reconnectTimer = null;
    ctx.backupTimer = null;
    ctx.pairTimer = null;

    detachSocket(ctx);
    sessions.delete(id);
  }

  const dir = id === "main" ? SESSION_DIR : path.join(USER_SESSIONS_DIR, id);

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}

  backupState.delete(id);

  if (mongoConnected) {
    try {
      await SessionFile.deleteMany({ sessionId: id });

      if (id !== "main") {
        await BotSettings.deleteOne({ sessionId: id });
      }
    } catch {}
  }
}

async function sendViaMain(number, text) {
  const main = sessions.get("main");

  if (!main?.sock || main.status !== "open") {
    return;
  }

  try {
    await main.sock.sendMessage(`${number}@s.whatsapp.net`, { text });
  } catch {}
}

async function abortPairing(ctx, text) {
  try {
    if (ctx.notify) {
      await ctx.notify(text);
    }
  } catch {}

  try {
    if (ctx.onFail) {
      ctx.onFail(text);
    }
  } catch {}

  console.log(`🗑️ [${ctx.id}] Pairing aborted.`);

  await removeSession(ctx.id);
}

async function handleInvalidSession(ctx) {
  if (ctx.isMain) {
    console.log("❌ Main session logged out / invalid.");
    console.log("🗑️ Clearing session — pairing again...");

    await removeSession("main");

    // MAIN_PAIR_NUMBER නැත්නම් main bot ආයෙ පටන් ගන්නේ නැහැ
    if (!MAIN_PAIR_NUMBER && !process.stdin.isTTY) {
      console.log("ℹ️ MAIN_PAIR_NUMBER not set — main bot stays off.");
      return;
    }

    setTimeout(() => {
      startSession("main", { pairNumber: MAIN_PAIR_NUMBER }).catch(error => {
        console.error("❌ Main restart error:", error?.message || error);
      });
    }, 3000);

    return;
  }

  const number = ctx.id;

  console.log(`❌ [${number}] User session logged out / invalid — removed.`);

  await removeSession(number);

  await sendViaMain(
    number,
    `⚠️ ඔබගේ bot session එක logout වුණා.\n\nආයෙ සම්බන්ධ වෙන්න main bot එකට:\n${DEFAULT_PREFIX}pair ${number}`
  );
}

/* =====================================================
WHATSAPP WEB VERSION (cache)
===================================================== */

async function getWaVersion() {
  if (cachedVersion && Date.now() - cachedVersionAt < 10 * 60 * 1000) {
    return cachedVersion;
  }

  if (typeof fetchLatestWaWebVersion !== "function") {
    throw new Error("fetchLatestWaWebVersion is unavailable.");
  }

  console.log("🌐 Fetching latest WhatsApp Web version...");

  const latest = await fetchLatestWaWebVersion();
  const version = latest?.version;

  if (!Array.isArray(version) || version.length !== 3) {
    throw new Error("Invalid WhatsApp Web version received.");
  }

  cachedVersion = version;
  cachedVersionAt = Date.now();

  console.log(
    `🌐 WhatsApp Web version: ${version.join(".")} (latest: ${
      latest?.isLatest === false ? "NO" : "YES"
    })`
  );

  return version;
}

/* =====================================================
WELCOME MESSAGE (logo + text)
Connect වුණාම ඒ අංකයටම එක පාරක් යනවා
===================================================== */

async function sendWelcomeMessage(ctx, sock) {
  try {
    const flag = path.join(ctx.dir, "welcome_sent.json");

    if (fs.existsSync(flag)) {
      return;
    }

    const myJid = jidNormalizedUser(sock.user?.id || "");

    if (!myJid) {
      return;
    }

    const settings = await getSettings(ctx.id);
    const prefix = settings.prefix || DEFAULT_PREFIX;
    const number = cleanNumber(myJid);

    const caption =
`╭─「 💙 SHAN MINI BOT 」─╮

👋 Welcome to SHAN MINI BOT!

💙 Your WhatsApp is now connected.
📱 Number : ${number}
⚡ Prefix : ${prefix}
🟢 Status : Online

✨ Enjoy Your Bot Experience!

🚀 Full Version Coming Soon... 💙

📢 Follow Our WhatsApp Channel! 👨‍💻
🔗 https://whatsapp.com/channel/0029Vb9KJ1dJP210AYAZX61O

╰─「 ⚡ VERSION 1.0 」─╯`;

    let image = null;

    if (fs.existsSync(BOT_LOGO_PATH)) {
      image = fs.readFileSync(BOT_LOGO_PATH);
    } else if (BOT_LOGO_URL) {
      image = { url: BOT_LOGO_URL };
    }

    if (image) {
      await sock.sendMessage(myJid, { image, caption });
    } else {
      await sock.sendMessage(myJid, { text: caption });
    }

    fs.mkdirSync(ctx.dir, { recursive: true });
    fs.writeFileSync(flag, JSON.stringify({ at: new Date().toISOString() }));

    scheduleBackup(ctx);

    console.log(`👋 [${ctx.id}] Welcome message sent to: ${number}`);
  } catch (error) {
    console.error(
      `❌ [${ctx.id}] Welcome message error:`,
      error?.message || error
    );
  }
}

/* =====================================================
AUTO FOLLOW CHANNELS
===================================================== */

async function autoFollowChannels(ctx, sock) {
  for (const item of AUTO_FOLLOW_CHANNELS) {
    if (ctx.stopped || ctx.sock !== sock) {
      return;
    }

    try {
      const value = String(item || "").trim();

      if (!value) {
        continue;
      }

      let jid = value.match(/\d{8,}@newsletter/i)?.[0] || "";

      if (!jid) {
        const code = value.match(
          /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
        )?.[1];

        if (!code) {
          console.log(`⚠️ Invalid channel link/JID: ${value}`);
          continue;
        }

        const meta = await sock.newsletterMetadata("invite", code);

        jid = meta?.id || "";
      }

      if (!jid) {
        console.log(`⚠️ Channel JID not found for: ${value}`);
        continue;
      }

      if (ctx.followed.has(jid)) {
        continue;
      }

      try {
        await sock.newsletterFollow(jid);
        console.log(`📢 [${ctx.id}] Channel followed: ${jid}`);
      } catch (error) {
        console.log(
          `ℹ️ [${ctx.id}] Channel follow skipped (${jid}): ${
            error?.message || error
          }`
        );
      }

      ctx.followed.add(jid);
    } catch (error) {
      console.error(
        `❌ [${ctx.id}] Auto follow error:`,
        error?.message || error
      );
    }

    await sleep(2000);
  }
}

/* =====================================================
BUILT-IN COMMANDS (main bot එකේ පමණක්)
.pair <number>   — තමන්ගේ අංකය bot එකට link කරන්න
.delpair [number] — session එක ඉවත් කරන්න
.pairlist        — owner only: සියලු sessions
===================================================== */

async function handleBuiltinCommand(sock, msg, ctx, parsed, settings) {
  if (!ctx.isMain) {
    return false;
  }

  const cmd = parsed.command;

  if (cmd !== "pair" && cmd !== "delpair" && cmd !== "pairlist") {
    return false;
  }

  const chat = msg.key.remoteJid;
  const prefix = settings.prefix || DEFAULT_PREFIX;
  const owner = isOwner(msg, ctx);
  const sender = cleanNumber(getSenderNumber(msg, ctx));

  const reply = text =>
    sock.sendMessage(chat, { text }, { quoted: msg }).catch(() => {});

  if (await denyIfRestricted(sock, msg, settings, owner, sender)) {
    return true;
  }

  /* ---------- .pairlist ---------- */

  if (cmd === "pairlist") {
    if (!owner) {
      await reply("👑 Owner only command.");
      return true;
    }

    const lines = [];

    for (const [id, s] of sessions.entries()) {
      const icon =
        s.status === "open" ? "🟢" : s.status === "pairing" ? "🟡" : "🔴";

      lines.push(`${icon} ${id}${s.isMain ? " (main)" : ""} — ${s.status}`);
    }

    await reply(
      `╭━━〔 📋 SESSIONS 〕━━╮\n\n${lines.join("\n") || "No sessions"}\n\n` +
        `Total: ${sessions.size}\n╰━━━━━━━━━━━━━━╯`
    );

    return true;
  }

  /* ---------- .delpair ---------- */

  if (cmd === "delpair") {
    const target = cleanNumber(parsed.args.join("")) || sender;

    if (!isValidUserId(target)) {
      await reply(`❌ Usage:\n${prefix}delpair 947XXXXXXXX`);
      return true;
    }

    if (!owner && target !== sender) {
      await reply("⛔ ඔබට ඉවත් කළ හැක්කේ ඔබගේම session එක පමණයි.");
      return true;
    }

    const existing = sessions.get(target);

    if (!existing) {
      await reply("⚠️ ඒ අංකයට session එකක් නැහැ.");
      return true;
    }

    try {
      if (existing.sock && existing.status === "open") {
        await existing.sock.logout();
      }
    } catch {}

    await removeSession(target);

    await reply(`✅ Session removed: ${target}`);

    return true;
  }

  /* ---------- .pair ---------- */

  if (!ALLOW_PUBLIC_PAIR && !owner) {
    await reply("👑 Pairing is currently owner-only.");
    return true;
  }

  const number = cleanNumber(parsed.args.join(""));

  if (!isValidUserId(number)) {
    await reply(
      `╭━━〔 🔗 PAIR 〕━━╮\n\n` +
        `ඔබගේ අංකය bot එකට link කරන්න:\n\n` +
        `${prefix}pair 947XXXXXXXX\n\n` +
        `(country code එක්ක, + නැතුව)\n╰━━━━━━━━━━╯`
    );
    return true;
  }

  const mainCtx = sessions.get("main");

  if (mainCtx?.number && number === mainCtx.number) {
    await reply("⚠️ මේ අංකය main bot එකම තමයි.");
    return true;
  }

  const existing = sessions.get(number);

  if (existing) {
    if (existing.status === "open") {
      await reply(`✅ ${number} දැනටමත් connect වී ඇත.\n\nඉවත් කරන්න: ${prefix}delpair ${number}`);
    } else if (existing.status === "pairing") {
      await reply("⏳ මේ අංකයට pairing code එකක් දැනටමත් ලබා දී ඇත. ටිකක් රැඳී ඉන්න.");
    } else {
      await reply("🔄 මේ session එක reconnect වෙමින් පවතී.");
    }

    return true;
  }

  const userCount = [...sessions.values()].filter(s => !s.isMain).length;

  if (userCount >= MAX_USER_SESSIONS) {
    await reply("⚠️ Session limit එක පිරී ඇත. පසුව උත්සාහ කරන්න.");
    return true;
  }

  const last = pairCooldown.get(sender) || 0;

  if (!owner && Date.now() - last < 30000) {
    await reply("⏳ තත්පර 30කට පස්සේ ආයෙ උත්සාහ කරන්න.");
    return true;
  }

  pairCooldown.set(sender, Date.now());

  await reply("⏳ Pairing code එක සාදමින්...");

  await startSession(number, {
    pairNumber: number,
    notify: text => reply(text)
  });

  return true;
}

/* =====================================================
MESSAGE HANDLER (session එකකට එකක්)
===================================================== */

function setupMessages(sock, ctx) {
  sock.ev.on("messages.upsert", async update => {
    try {
      const messages = update?.messages || [];

      if (!messages.length) {
        return;
      }

      const settings = await getSettings(ctx.id);

      for (const msg of messages) {
        if (!msg?.message) {
          continue;
        }

        const jid = String(msg?.key?.remoteJid || "");

        if (!jid) {
          continue;
        }

        if (jid.endsWith("@newsletter")) {
          console.log(`📢 [${ctx.id}] Newsletter message received: ${jid}`);

          await handleChannelReact(sock, msg);
          await handleBackgroundPlugins(sock, msg);

          continue;
        }

        await handleBackgroundPlugins(sock, msg);

        const replyHandled = await handlePluginReply(sock, msg);

        if (replyHandled) {
          continue;
        }

        await handleAutoSeen(sock, msg, settings);

        const text = getMessageText(msg).trim();

        if (!text) {
          continue;
        }

        const prefix = settings.prefix || DEFAULT_PREFIX;
        const parsed = parseCommand(text, prefix);

        if (!parsed) {
          continue;
        }

        console.log(`📥 [${ctx.id}] COMMAND: ${prefix}${parsed.command}`);
        console.log("🧩 ARGS:", parsed.args);

        const builtin = await handleBuiltinCommand(
          sock,
          msg,
          ctx,
          parsed,
          settings
        );

        if (builtin) {
          continue;
        }

        const result = await executePlugin(
          sock,
          msg,
          parsed.command,
          parsed.args,
          settings,
          ctx
        );

        console.log(`⚙️ EXECUTION RESULT: ${result}`);
        console.log("");
      }
    } catch (error) {
      console.error(
        `❌ [${ctx.id}] messages.upsert error:`,
        error?.stack || error?.message || error
      );
    }
  });
}

/* =====================================================
RECONNECT
===================================================== */

function scheduleReconnect(ctx, delay = 3000) {
  if (ctx.stopped || ctx.reconnectTimer) {
    return;
  }

  console.log(`🔄 [${ctx.id}] Reconnecting in ${Math.ceil(delay / 1000)} seconds...`);

  ctx.reconnectTimer = setTimeout(async () => {
    ctx.reconnectTimer = null;

    try {
      await connectSession(ctx);
    } catch (error) {
      console.error(`❌ [${ctx.id}] Reconnect error:`, error?.message || error);
    }
  }, delay);
}

function getDisconnectCode(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.statusCode ||
    lastDisconnect?.error?.statusCode ||
    null
  );
}

function getDisconnectMessage(lastDisconnect) {
  return (
    lastDisconnect?.error?.message ||
    lastDisconnect?.error?.output?.payload?.message ||
    "Unknown"
  );
}

/* =====================================================
REQUEST PAIRING
===================================================== */

async function requestPairing(ctx, sock) {
  try {
    console.log(`⏳ [${ctx.id}] Requesting WhatsApp pairing code...`);

    await sleep(2000);

    const raw = await sock.requestPairingCode(ctx.pairNumber);
    const code = String(raw).match(/.{1,4}/g)?.join("-") || raw;

    ctx.lastCode = code;
    ctx.lastCodeAt = Date.now();

    if (ctx.onCode) {
      try {
        ctx.onCode(code);
      } catch {}
    }

    if (ctx.isMain) {
      console.log("");
      console.log("╭━━〔 WHATSAPP PAIRING CODE 〕━━╮");
      console.log("┃");
      console.log(`┃ 🔐 CODE : ${code}`);
      console.log("┃");
      console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯");
      console.log("");
      console.log("📱 WhatsApp → Settings → Linked Devices");
      console.log("   → Link a device → Link with phone number instead");
      console.log("");
      console.log("⚡ Enter the code immediately.");
      console.log("");
    } else {
      console.log(`🔐 [${ctx.id}] Pairing code generated.`);
    }

    if (ctx.notify) {
      await ctx.notify(
        `╭━━〔 🔐 PAIRING CODE 〕━━╮\n\n` +
          `📱 Number : ${ctx.pairNumber}\n` +
          `🔐 CODE   : ${code}\n\n` +
          `WhatsApp → Settings\n` +
          `→ Linked Devices\n` +
          `→ Link a device\n` +
          `→ Link with phone number instead\n\n` +
          `⚡ මිනිත්තු 2ක් ඇතුළත code එක ඇතුළත් කරන්න.\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━╯`
      );
    }

    return true;
  } catch (error) {
    console.error(`❌ [${ctx.id}] PAIRING CODE ERROR:`);
    console.error(error?.stack || error?.message || error);

    return false;
  }
}

/* =====================================================
CONNECT SESSION
===================================================== */

async function connectSession(ctx) {
  if (ctx.starting || ctx.stopped) {
    return;
  }

  ctx.starting = true;

  try {
    console.log("");
    console.log(`╭━━〔 SHAN MINI BOT V1 · ${ctx.id} 〕━━╮`);
    console.log("┃ 🚀 Starting session...");
    console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯");

    fs.mkdirSync(ctx.dir, { recursive: true });

    // Files මැකිලා නම් MongoDB backup එකෙන් ආයෙ හදනවා
    const restored = await restoreSession(ctx.id, ctx.dir);

    if (restored) {
      console.log(`♻️ [${ctx.id}] Session restored from MongoDB backup.`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(ctx.dir);

    console.log(`🔐 [${ctx.id}] Session registered: ${state.creds.registered}`);

    // Pair නොකළ, pair අංකයක් නැති user session = අතරමං folder එකක්
    if (!state.creds.registered && !ctx.isMain && !ctx.pairNumber) {
      console.log(`🗑️ [${ctx.id}] Unregistered leftover session removed.`);
      await removeSession(ctx.id);
      return;
    }

    // Main bot — pair අංකය ගන්නේ env එකෙන් (Railway / Render) හෝ terminal එකෙන් (local)
    if (!state.creds.registered && ctx.isMain && !ctx.pairNumber) {
      // Railway / Render / Docker වගේ terminal නැති තැන්වල prompt එක නැහැ
      if (!process.stdin.isTTY) {
        console.log("");
        console.log("ℹ️ MAIN_PAIR_NUMBER is not set — main bot is OFF.");
        console.log("ℹ️ Main bot එක ඕන නම් Variables වල MAIN_PAIR_NUMBER=947XXXXXXXX දාන්න.");
        console.log("ℹ️ Website pairing (user sessions) සාමාන්‍ය පරිදි වැඩ කරනවා.");
        console.log("");

        ctx.starting = false;

        // Reconnect loop එකක් නැහැ — main session එක ඉවත් කරනවා
        sessions.delete(ctx.id);

        return;
      }

      console.log("");
      console.log("╭━━〔 WHATSAPP PAIRING 〕━━╮");
      console.log("┃ 📱 Enter WhatsApp number");
      console.log("┃    with country code");
      console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━╯");

      const input = await ask("📱 Enter WhatsApp number with country code: ");
      const number = normalizePairNumber(input);

      if (!number || number.length < 8) {
        console.log("❌ Invalid WhatsApp number.");

        ctx.starting = false;
        scheduleReconnect(ctx, 3000);

        return;
      }

      ctx.pairNumber = number;
    }

    let version;

    try {
      version = await getWaVersion();
    } catch (error) {
      console.error("❌ Failed to fetch WhatsApp Web version:");
      console.error(error?.stack || error?.message || error);

      ctx.starting = false;
      scheduleReconnect(ctx, 10000);

      return;
    }

    detachSocket(ctx);

    console.log(`🚀 [${ctx.id}] Creating WhatsApp socket...`);

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      generateHighQualityLinkPreview: false,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    ctx.sock = sock;

    // Plugins වලට session info
    sock.sessionId = ctx.id;
    sock.isMainSession = ctx.isMain;
    sock.getSettings = () => getSettings(ctx.id);
    sock.updateSettings = patch => updateSettings(ctx.id, patch);

    sock.ev.on("creds.update", async () => {
      try {
        await saveCreds();
        scheduleBackup(ctx);
      } catch (error) {
        console.error(`❌ [${ctx.id}] saveCreds error:`, error?.message || error);
      }
    });

    setupMessages(sock, ctx);

    sock.ev.on("connection.update", async update => {
      const { connection, lastDisconnect, isNewLogin } = update;

      if (ctx.sock !== sock || ctx.stopped) {
        return;
      }

      if (connection === "connecting") {
        console.log(`🔄 [${ctx.id}] Connecting to WhatsApp...`);
      }

      if (isNewLogin) {
        console.log(`🎉 [${ctx.id}] NEW WHATSAPP LOGIN DETECTED!`);

        try {
          await saveCreds();
          scheduleBackup(ctx);
        } catch (error) {
          console.error(
            `❌ [${ctx.id}] New login save error:`,
            error?.message || error
          );
        }
      }

      /* ---------------- OPEN ---------------- */

      if (connection === "open") {
        ctx.starting = false;
        ctx.status = "open";
        ctx.pairingRequested = false;
        ctx.pairFails = 0;
        ctx.number = cleanNumber(sock.user?.id || "");
        ctx.lastCode = "";
        ctx.onCode = null;
        ctx.onFail = null;

        clearTimeout(ctx.pairTimer);
        ctx.pairTimer = null;

        console.log("");
        console.log("╭━━〔 WHATSAPP CONNECTED 〕━━╮");
        console.log("┃");
        console.log(`┃ ✅ Status  : ONLINE`);
        console.log(`┃ 🆔 Session : ${ctx.id}`);
        console.log(`┃ 📱 Number  : ${ctx.number}`);
        console.log("┃ 🤖 SHAN MINI BOT V1");
        console.log("┃");
        console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯");
        console.log("");

        if (ctx.isMain) {
          console.log(`📦 Active plugin commands: ${plugins.size}`);

          const settings = await getSettings(ctx.id);

          console.log(`🎯 Prefix: ${settings.prefix}`);
          console.log("");

          try {
            const states = await getAllPluginStates();
            const disabled = states.filter(x => !x.enabled);

            if (disabled.length) {
              console.log(
                `⛔ Disabled plugins: ${disabled.map(x => x.command).join(", ")}`
              );
            }
          } catch (error) {
            console.error(
              "❌ Plugin status display error:",
              error?.message || error
            );
          }

          console.log("");
        }

        // .pair කළ කෙනාට දැනුම් දීම
        if (ctx.notify) {
          try {
            await ctx.notify(
              `✅ ${ctx.number} සාර්ථකව connect වුණා!\n\nWelcome message එක ඔබගේ WhatsApp එකට යවා ඇත.`
            );
          } catch {}

          ctx.notify = null;
        }

        scheduleBackup(ctx);

        // Welcome message (logo + text)
        setTimeout(() => sendWelcomeMessage(ctx, sock), 3000);

        // Auto follow channels after connect
        setTimeout(() => autoFollowChannels(ctx, sock), 5000);
      }

      /* ---------------- CLOSE ---------------- */

      if (connection === "close") {
        ctx.starting = false;
        ctx.status = "closed";

        const statusCode = getDisconnectCode(lastDisconnect);
        const errorMessage = getDisconnectMessage(lastDisconnect);

        console.log("");
        console.log(
          `╭━━〔 CONNECTION CLOSED · ${ctx.id} 〕━━╮\n┃ Status code: ${
            statusCode || "Unknown"
          }\n┃ Reason: ${errorMessage}\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`
        );
        console.log("");

        if (
          statusCode === DisconnectReason.loggedOut ||
          statusCode === DisconnectReason.badSession
        ) {
          await handleInvalidSession(ctx);
          return;
        }

        if (statusCode === DisconnectReason.connectionReplaced) {
          ctx.status = "replaced";

          console.log(
            `⚠️ [${ctx.id}] Session opened somewhere else (connection replaced). Not reconnecting.`
          );

          return;
        }

        if (statusCode === DisconnectReason.restartRequired) {
          console.log(`🔄 [${ctx.id}] WhatsApp requested socket restart.`);

          try {
            await saveCreds();
          } catch {}

          scheduleReconnect(ctx, 1000);

          return;
        }

        if (!state.creds.registered) {
          ctx.pairingRequested = false;

          if (!ctx.isMain) {
            ctx.pairFails += 1;

            if (ctx.pairFails > 2) {
              await abortPairing(
                ctx,
                `❌ Pairing අසාර්ථකයි.\n\nආයෙ උත්සාහ කරන්න:\n${DEFAULT_PREFIX}pair ${ctx.id}`
              );

              return;
            }
          }
        }

        const fast =
          statusCode === DisconnectReason.connectionClosed ||
          statusCode === DisconnectReason.connectionLost ||
          statusCode === DisconnectReason.timedOut;

        if (!fast) {
          const settings = await getSettings(ctx.id);

          if (settings.autoReconnect === false) {
            console.log(`⛔ [${ctx.id}] Auto reconnect disabled.`);
            return;
          }
        }

        scheduleReconnect(ctx, fast ? 3000 : 5000);
      }
    });

    /* ---------- Pairing (නව session) ---------- */

    if (!state.creds.registered) {
      ctx.status = "pairing";

      if (!ctx.pairingRequested) {
        ctx.pairingRequested = true;

        console.log(`📱 [${ctx.id}] Pairing number: ${ctx.pairNumber}`);

        const success = await requestPairing(ctx, sock);

        if (!success) {
          ctx.pairingRequested = false;

          if (ctx.isMain) {
            ctx.starting = false;
            scheduleReconnect(ctx, 5000);
          } else {
            await abortPairing(
              ctx,
              `❌ Pairing code එක ලබාගත නොහැකි වුණා.\n\nආයෙ උත්සාහ කරන්න:\n${DEFAULT_PREFIX}pair ${ctx.id}`
            );
          }

          return;
        }
      }

      if (!ctx.isMain && !ctx.pairTimer) {
        ctx.pairTimer = setTimeout(async () => {
          ctx.pairTimer = null;

          if (ctx.status !== "open" && !state.creds.registered) {
            await abortPairing(
              ctx,
              `⌛ Pairing code එක කල් ඉකුත් වුණා.\n\nආයෙ උත්සාහ කරන්න:\n${DEFAULT_PREFIX}pair ${ctx.id}`
            );
          }
        }, PAIR_TIMEOUT_MS);
      }
    } else {
      ctx.status = "connecting";
    }
  } catch (error) {
    ctx.starting = false;

    console.error("");
    console.error(`❌ [${ctx.id}] Session start error:`);
    console.error(error?.stack || error?.message || error);
    console.error("");

    scheduleReconnect(ctx, 5000);
  }
}

/* =====================================================
START SESSION
===================================================== */

async function startSession(id, opts = {}) {
  let ctx = sessions.get(id);

  if (!ctx) {
    ctx = createCtx(id);
    sessions.set(id, ctx);
  }

  if (opts.pairNumber) {
    ctx.pairNumber = opts.pairNumber;
  }

  if (opts.notify) {
    ctx.notify = opts.notify;
  }

  if (opts.onCode) {
    ctx.onCode = opts.onCode;
  }

  if (opts.onFail) {
    ctx.onFail = opts.onFail;
  }

  await connectSession(ctx);

  return ctx;
}

/* =====================================================
RESTORE USER SESSIONS (bot start වෙද්දි)
===================================================== */

async function restoreUserSessions() {
  const ids = new Set();

  try {
    if (fs.existsSync(USER_SESSIONS_DIR)) {
      for (const entry of fs.readdirSync(USER_SESSIONS_DIR, {
        withFileTypes: true
      })) {
        if (entry.isDirectory() && isValidUserId(entry.name)) {
          ids.add(entry.name);
        }
      }
    }
  } catch {}

  if (mongoConnected) {
    try {
      const backedUp = await SessionFile.distinct("sessionId", {
        name: "creds.json"
      });

      for (const id of backedUp) {
        if (isValidUserId(id)) {
          ids.add(id);
        }
      }
    } catch (error) {
      console.error("❌ Backup list error:", error?.message || error);
    }
  }

  console.log(`👥 User sessions to start: ${ids.size}`);

  for (const id of ids) {
    try {
      await startSession(id);
    } catch (error) {
      console.error(`❌ [${id}] Start error:`, error?.message || error);
    }

    // WhatsApp rate-limit වැළැක්වීමට
    await sleep(2500);
  }
}

/* =====================================================
PAIRING API SERVER
GitHub Pages / Railway / Render වෙබ් අඩවියෙන් pairing code ගන්න

GET  /                                (public/index.html)
GET  /logo.jpg  (සහ public/ ඇති images)
GET  /api/health
GET  /api/pair?number=947XXXXXXXX   (හෝ POST {"number": "..."})
GET  /api/status?number=947XXXXXXXX
===================================================== */

const apiHits = new Map();

function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const list = (apiHits.get(key) || []).filter(t => now - t < windowMs);

  if (list.length >= limit) {
    apiHits.set(key, list);
    return true;
  }

  list.push(now);
  apiHits.set(key, list);

  return false;
}

// apiHits memory leak වැළැක්වීමට පරණ entries ඉවත් කරනවා
setInterval(() => {
  const now = Date.now();

  for (const [key, list] of apiHits.entries()) {
    const fresh = list.filter(t => now - t < 10 * 60 * 1000);

    if (fresh.length) {
      apiHits.set(key, fresh);
    } else {
      apiHits.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function getClientIp(req) {
  return String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
  )
    .split(",")[0]
    .trim();
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": API_CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders()
  });

  res.end(JSON.stringify(body));
}

// JSON හෝ form-urlencoded body එකක් කියවනවා
function readJsonBody(req) {
  return new Promise(resolve => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;

      if (raw.length > 4096) {
        raw = "";
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        try {
          resolve(Object.fromEntries(new URLSearchParams(raw)));
        } catch {
          resolve({});
        }
      }
    });

    req.on("error", () => resolve({}));
  });
}

// Static files (logo.jpg වගේ images) — public/ folder එකෙන් හෝ project root එකෙන්
const STATIC_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".css": "text/css; charset=utf-8"
};

function serveStatic(route, res) {
  if (!/^\/[A-Za-z0-9._-]+$/.test(route)) {
    return false;
  }

  const file = route.slice(1);
  const type = STATIC_TYPES[path.extname(file).toLowerCase()];

  if (!type) {
    return false;
  }

  const roots = [path.join(process.cwd(), "public"), process.cwd()];

  for (const root of roots) {
    const full = path.join(root, file);

    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        res.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders()
        });

        fs.createReadStream(full).pipe(res);

        return true;
      }
    } catch {}
  }

  return false;
}

// Website එකෙන් pairing code එකක් ඉල්ලීම
async function getPairCodeForWeb(number) {
  const mainCtx = sessions.get("main");

  if (mainCtx?.number && number === mainCtx.number) {
    return {
      status: 409,
      body: {
        success: false,
        error: "main_number",
        message: "මේ අංකය main bot එකම තමයි."
      }
    };
  }

  const existing = sessions.get(number);

  if (existing) {
    if (existing.status === "open") {
      return {
        status: 409,
        body: {
          success: false,
          error: "already_connected",
          message: "මේ අංකය දැනටමත් bot එකට connect වී ඇත."
        }
      };
    }

    if (
      existing.status === "pairing" &&
      existing.lastCode &&
      Date.now() - existing.lastCodeAt < 50000
    ) {
      return {
        status: 200,
        body: {
          success: true,
          number,
          code: existing.lastCode,
          expiresIn: 60
        }
      };
    }

    if (existing.status === "pairing") {
      // පරණ (කල් ඉකුත් වූ) pairing එක ඉවත් කර අලුතින් පටන් ගන්න
      await removeSession(number);
    } else {
      return {
        status: 409,
        body: {
          success: false,
          error: "session_exists",
          message: "මේ අංකයට session එකක් දැනටමත් තියෙනවා (reconnect වෙමින්)."
        }
      };
    }
  }

  const userCount = [...sessions.values()].filter(s => !s.isMain).length;

  if (userCount >= MAX_USER_SESSIONS) {
    return {
      status: 503,
      body: {
        success: false,
        error: "limit_reached",
        message: "Session limit එක පිරී ඇත. පසුව උත්සාහ කරන්න."
      }
    };
  }

  return await new Promise(resolve => {
    let done = false;

    const finish = result => {
      if (done) {
        return;
      }

      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        status: 504,
        body: {
          success: false,
          error: "timeout",
          message: "Pairing code එක ලබාගන්න බැරි වුණා. ආයෙ උත්සාහ කරන්න."
        }
      });
    }, 30000);

    startSession(number, {
      pairNumber: number,
      onCode: code =>
        finish({
          status: 200,
          body: { success: true, number, code, expiresIn: 60 }
        }),
      onFail: text =>
        finish({
          status: 500,
          body: {
            success: false,
            error: "pairing_failed",
            message: String(text || "Pairing failed.")
          }
        })
    }).catch(error => {
      finish({
        status: 500,
        body: {
          success: false,
          error: "server_error",
          message: error?.message || "Server error"
        }
      });
    });
  });
}

async function handleApiRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const route = url.pathname.replace(/\/+$/, "") || "/";
  const ip = getClientIp(req);

  /* ---------- health (healthcheck / keep-alive) ---------- */

  if (route === "/api" || route === "/api/health") {
    sendJson(res, 200, {
      success: true,
      bot: "SHAN MINI BOT V1",
      sessions: sessions.size,
      online: [...sessions.values()].filter(s => s.status === "open").length
    });
    return;
  }

  /* ---------- PAIRING WEBSITE ---------- */

  if (
    req.method === "GET" &&
    (route === "/" || route === "/index.html")
  ) {
    const websitePath = path.join(
      process.cwd(),
      "public",
      "index.html"
    );

    // website එකක් නැත්නම් "/" එකට health JSON එක දෙනවා
    if (!fs.existsSync(websitePath)) {
      sendJson(res, 200, {
        success: true,
        bot: "SHAN MINI BOT V1",
        sessions: sessions.size,
        online: [...sessions.values()].filter(s => s.status === "open").length
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      ...corsHeaders()
    });

    fs.createReadStream(websitePath).pipe(res);
    return;
  }

  /* ---------- static images (logo.jpg ...) ---------- */

  if (req.method === "GET" && serveStatic(route, res)) {
    return;
  }

  /* ---------- pair / status ---------- */

  if (route === "/api/pair" || route === "/api/status") {
    // number එක query එකෙන් (number / phone / num) හෝ POST body එකෙන් ගන්නවා
    let numberValue =
      url.searchParams.get("number") ||
      url.searchParams.get("phone") ||
      url.searchParams.get("num") ||
      "";

    if (req.method === "POST") {
      const body = await readJsonBody(req);

      console.log("📨 API body:", JSON.stringify(body));

      // key නම මොකක් වුණත් ඉලක්කම් 8+ ඇති අගයක් හොයාගන්නවා
      const anyDigits = Object.values(body || {}).find(v =>
        /\d{8,}/.test(String(v))
      );

      numberValue =
        body?.number ||
        body?.phone ||
        body?.num ||
        body?.msisdn ||
        anyDigits ||
        numberValue;
    }

    const number = cleanNumber(numberValue);

    if (!isValidUserId(number)) {
      sendJson(res, 400, {
        success: false,
        error: "invalid_number",
        message: "අංකය country code එක්ක දාන්න (උදා: 947XXXXXXXX)."
      });
      return;
    }

    if (route === "/api/status") {
      if (rateLimited(`status:${ip}`, 90, 60000)) {
        sendJson(res, 429, { success: false, error: "rate_limited" });
        return;
      }

      const status = sessions.get(number)?.status || "none";

      sendJson(res, 200, {
        success: true,
        number,
        status,
        connected: status === "open"
      });
      return;
    }

    // /api/pair — IP එකකට විනාඩි 10කට 5 වතාවක්
    if (rateLimited(`pair:${ip}`, 5, 10 * 60 * 1000)) {
      sendJson(res, 429, {
        success: false,
        error: "rate_limited",
        message: "ඉතා වැඩි ඉල්ලීම්. විනාඩි කිහිපයකින් උත්සාහ කරන්න."
      });
      return;
    }

    if (!ALLOW_PUBLIC_PAIR) {
      sendJson(res, 403, {
        success: false,
        error: "owner_only",
        message: "Pairing දැනට owner පමණයි."
      });
      return;
    }

    const result = await getPairCodeForWeb(number);

    sendJson(res, result.status, result.body);
    return;
  }

  sendJson(res, 404, { success: false, error: "not_found" });
}

function startApiServer() {
  if (!API_ENABLED) {
    console.log("ℹ️ API server disabled.");
    return;
  }

  const server = http.createServer((req, res) => {
    handleApiRequest(req, res).catch(error => {
      console.error("❌ API error:", error?.message || error);

      try {
        sendJson(res, 500, { success: false, error: "server_error" });
      } catch {}
    });
  });

  server.on("error", error => {
    console.error("❌ API server error:", error?.message || error);
  });

  server.listen(API_PORT, "0.0.0.0", () => {
    console.log(`🌐 Pairing API running on port ${API_PORT}`);
    console.log(`🌐 CORS origin: ${API_CORS_ORIGIN}`);
  });
}

/* =====================================================
KEEP ALIVE  (Render free plan එක විනාඩි 15ක් idle වුණාම නිදාගන්නවා)
Railway වලට ඕන නැහැ. KEEP_ALIVE_URL / RENDER_EXTERNAL_URL තියෙනවා නම් විතරක් ක්‍රියාත්මකයි.
නවත්තන්න: KEEP_ALIVE=false
===================================================== */

function startKeepAlive() {
  if (String(process.env.KEEP_ALIVE ?? "true").toLowerCase() === "false") {
    return;
  }

  const base = String(
    process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || ""
  ).replace(/\/+$/, "");

  if (!base) {
    return;
  }

  const target = `${base}/api/health`;

  console.log(`💓 Keep-alive ping enabled: ${target}`);

  setInterval(async () => {
    try {
      const res = await fetch(target, {
        headers: { "User-Agent": "shan-mini-bot-keepalive" }
      });

      if (process.env.DEBUG_KEEP_ALIVE === "true") {
        console.log(`💓 Keep-alive: ${res.status}`);
      }
    } catch (error) {
      console.log(`⚠️ Keep-alive failed: ${error?.message || error}`);
    }
  }, 10 * 60 * 1000).unref();
}

/* =====================================================
GLOBAL CORE (plugins වලට පාවිච්චි කරන්න පුළුවන්)
===================================================== */

globalThis.SHAN_CORE = {
  sessions,
  BotSettings,
  getSettings,
  updateSettings,
  isOwner,
  isMainOwner,
  isPremium,
  cleanNumber,
  MAIN_OWNER_NUMBER
};

/* =====================================================
MAIN
===================================================== */

async function main() {
  console.log("");
  console.log("╭━━━━━━━━━━━━━━━━━━━━━━━━━━╮");
  console.log("┃     SHAN MINI BOT V1     ┃");
  console.log("┃   MULTI SESSION SYSTEM   ┃");
  console.log("┃        STARTING...       ┃");
  console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯");
  console.log("");

  // API server එක මුලින්ම පටන් ගන්නවා (port scan + healthcheck pass වෙන්න)
  startApiServer();
  startKeepAlive();

  await connectMongo();
  await expirePremiumUsers();
  await loadPlugins();

  // Main bot (pairing prompt එකක් තිබුණොත් user sessions වලට බාධා නොවෙන්න await නැහැ)
  startSession("main", { pairNumber: MAIN_PAIR_NUMBER }).catch(error => {
    console.error("❌ Main session error:", error?.stack || error?.message || error);
  });

  await restoreUserSessions();

  startBackupLoop();
}

/* =====================================================
PROCESS ERROR HANDLERS
===================================================== */

process.on("uncaughtException", error => {
  console.error(
    "❌ Uncaught Exception:",
    error?.stack || error?.message || error
  );
});

process.on("unhandledRejection", reason => {
  console.error(
    "❌ Unhandled Rejection:",
    reason?.stack || reason?.message || reason
  );
});

/* =====================================================
SHUTDOWN
===================================================== */

async function shutdown(signal) {
  console.log("");
  console.log(`🛑 ${signal} received. Shutting down...`);

  // අන්තිම backup
  for (const ctx of sessions.values()) {
    try {
      clearTimeout(ctx.reconnectTimer);
      clearTimeout(ctx.backupTimer);
      clearTimeout(ctx.pairTimer);

      ctx.stopped = true;

      await backupSession(ctx.id, ctx.dir);
    } catch {}
  }

  for (const ctx of sessions.values()) {
    try {
      detachSocket(ctx);
    } catch {}
  }

  try {
    rl?.close();
  } catch {}

  try {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  } catch {}

  console.log("👋 SHAN MINI BOT stopped.");

  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

/* =====================================================
START
===================================================== */

main().catch(error => {
  console.error(
    "❌ Fatal startup error:",
    error?.stack || error?.message || error
  );

  process.exit(1);
});

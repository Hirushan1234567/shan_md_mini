import fs from "fs";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

/* =========================================================
   PER-USER SETTINGS PLUGIN
   හැම බොට් එකකම (sock.botNumber) settings වෙන වෙනම save වේ.
   Storage: index.js ඇතුලේ globalThis.SHAN (Mongo / JSON file)
========================================================= */

const SHAN = () => globalThis.SHAN;
const getS = sock => SHAN().getSettings(sock.botNumber);
const setS = (sock, patch) => SHAN().updateSettings(sock.botNumber, patch);

const state = v => (v ? "ON" : "OFF");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function clean(v = "") {
  return String(v).split("@")[0].split(":")[0].replace(/\D/g, "");
}

/** Owner = fromMe | main owner | මේ බොට් link කරපු කෙනා */
function isOwner(msg, sock) {
  if (msg?.key?.fromMe === true) return true;
  const allowed = new Set([SHAN().MAIN_OWNER_NUMBER, sock.botNumber].map(clean));
  const k = msg?.key || {};
  return [k.senderPn, k.participantPn, k.participantAlt, k.participant, k.remoteJidAlt, k.remoteJid]
    .filter(Boolean)
    .some(v => allowed.has(clean(v)));
}

function getRandomEmoji(list, fallback = "❤️") {
  const arr = Array.isArray(list) && list.length ? list : [fallback];
  return arr[Math.floor(Math.random() * arr.length)];
}

function validPrefix(p) {
  return Boolean(p) && p.length <= 3 && !/\s/.test(p);
}

function unwrap(message) {
  let m = message;
  for (let i = 0; i < 3; i++) {
    m =
      m?.ephemeralMessage?.message ||
      m?.viewOnceMessage?.message ||
      m?.viewOnceMessageV2?.message ||
      m;
  }
  return m;
}

function getText(msg) {
  const m = unwrap(msg?.message);
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    ""
  );
}

/* =========================
   GROUP HELPERS
========================= */

const metaCache = new Map();

async function getGroupMeta(sock, jid) {
  const key = `${sock.botNumber}:${jid}`;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(key, { meta, at: Date.now() });
  return meta;
}

function idsOf(p) {
  return [p?.id, p?.lid, p?.jid, p?.phoneNumber].filter(Boolean).map(clean);
}

function isAdminIn(meta, targets) {
  const want = new Set(targets.filter(Boolean).map(clean));
  return (meta?.participants || []).some(
    p => (p.admin === "admin" || p.admin === "superadmin") && idsOf(p).some(i => want.has(i))
  );
}

function botIds(sock) {
  return [sock?.user?.id, sock?.user?.lid, sock?.user?.jid];
}

/* =========================
   ALWAYS ONLINE (per socket)
========================= */

const timers = new WeakMap();

async function applyPresence(sock, enabled) {
  try {
    await sock.sendPresenceUpdate(enabled ? "available" : "unavailable");
  } catch {}
}

function ensureTimer(sock) {
  if (timers.has(sock)) return;

  const t = setInterval(async () => {
    try {
      const s = await getS(sock);
      if (s.alwaysOnline) await sock.sendPresenceUpdate("available");
    } catch {}
  }, 15000);

  timers.set(sock, t);

  sock.ev.on("connection.update", u => {
    if (u?.connection === "close") {
      clearInterval(t);
      timers.delete(sock);
    }
  });
}

/* =========================
   WELCOME / GOODBYE
========================= */

const hooked = new WeakSet();

function hookGroupEvents(sock) {
  if (!sock?.ev || hooked.has(sock)) return;
  hooked.add(sock);

  sock.ev.on("group-participants.update", async update => {
    try {
      const s = await getS(sock);
      const { id: groupJid, participants = [], action } = update || {};
      if (!groupJid) return;

      const isAdd = action === "add";
      const isLeave = action === "remove" || action === "leave";

      if ((isAdd && !s.welcome) || (isLeave && !s.goodbye) || (!isAdd && !isLeave)) return;

      let subject = "Group";
      try {
        subject = (await getGroupMeta(sock, groupJid)).subject || subject;
      } catch {}

      for (const p of participants) {
        const jid = typeof p === "string" ? p : p?.phoneNumber || p?.id;
        if (!jid) continue;

        const num = clean(jid);
        const text = isAdd
          ? `👋 *Welcome* @${num}\n\n🎉 Welcome to *${subject}*!\nPlease read the rules and enjoy your stay. 💖`
          : `👋 *Goodbye* @${num}\n\n😢 Left *${subject}*. See you again!`;

        let image = null;
        try {
          image = await sock.profilePictureUrl(jid, "image");
        } catch {}

        try {
          if (image) {
            await sock.sendMessage(groupJid, { image: { url: image }, caption: text, mentions: [jid] });
          } else {
            await sock.sendMessage(groupJid, { text, mentions: [jid] });
          }
        } catch (error) {
          if (s.debugMode) console.error("Welcome/Goodbye send error:", error.message);
        }
      }
    } catch (error) {
      console.error("Group event error:", error.message);
    }
  });

  sock.ev.on("groups.update", updates => {
    for (const u of updates || []) metaCache.delete(`${sock.botNumber}:${u.id}`);
  });
}

function init(sock) {
  ensureTimer(sock);
  hookGroupEvents(sock);
}

/* =========================
   FEATURES (every message)
========================= */

const LINK_REGEX = /(https?:\/\/|www\.|chat\.whatsapp\.com\/)\S+/i;
const YT_REGEX = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/i;

const spamMap = new Map();
const spamWarned = new Map();
const repliedAt = new Map();
const AUTO_REPLY_TEXT =
  "👋 Hi! I'm busy right now. I'll reply to you soon.\n\n🤖 _SHAN MINI BOT_";

async function runAntiLink(sock, msg, s, text) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith("@g.us") || !LINK_REGEX.test(text)) return false;
  if (isOwner(msg, sock)) return false;

  const meta = await getGroupMeta(sock, jid);
  const sender = msg.key.participant || msg.key.participantAlt;

  if (isAdminIn(meta, [sender, msg.key.participantAlt])) return false;
  if (!isAdminIn(meta, botIds(sock))) {
    if (s.debugMode) console.log("[ANTILINK] Bot is not admin in", jid);
    return false;
  }

  await sock.sendMessage(jid, { delete: msg.key });
  await sock.sendMessage(jid, {
    text: `🚫 @${clean(sender)} links are not allowed here!`,
    mentions: [sender]
  });
  return true;
}

async function runAntiSpam(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith("@g.us") || isOwner(msg, sock)) return false;

  const sender = msg.key.participant || msg.key.participantAlt;
  const key = `${sock.botNumber}:${jid}:${clean(sender)}`;
  const now = Date.now();

  const list = (spamMap.get(key) || []).filter(t => now - t < 8000);
  list.push(now);
  spamMap.set(key, list);

  if (list.length < 6) return false;

  const meta = await getGroupMeta(sock, jid);
  if (isAdminIn(meta, [sender])) return false;

  if (isAdminIn(meta, botIds(sock))) {
    try {
      await sock.sendMessage(jid, { delete: msg.key });
    } catch {}
  }

  if (now - (spamWarned.get(key) || 0) > 30000) {
    spamWarned.set(key, now);
    await sock.sendMessage(jid, {
      text: `⚠️ @${clean(sender)} please don't spam!`,
      mentions: [sender]
    });
  }

  return true;
}

async function runAutoSticker(sock, msg, s) {
  const m = unwrap(msg.message);
  const isImage = Boolean(m?.imageMessage);
  const isVideo = Boolean(m?.videoMessage);
  if (!isImage && !isVideo) return;
  if (isVideo && (m.videoMessage.seconds || 0) > 10) return;

  const { Sticker, StickerTypes } = await import("wa-sticker-formatter");

  const buffer = await downloadMediaMessage(msg, "buffer", {});
  const sticker = new Sticker(buffer, {
    pack: "SHAN MINI BOT",
    author: "Kingdom of Devil",
    type: s.autoCrop ? StickerTypes.CROPPED : StickerTypes.FULL,
    quality: 50
  });

  await sock.sendMessage(msg.key.remoteJid, { sticker: await sticker.toBuffer() }, { quoted: msg });
}

async function runAutoDownload(sock, msg, text) {
  const url = text.match(YT_REGEX)?.[0];
  if (!url) return;

  const full = url.startsWith("http") ? url : `https://${url}`;
  const mod = await import(`./video.js?v=${Date.now()}`);
  await mod.default.execute(sock, msg, [full]);
}

async function runFeatures(sock, msg) {
  const jid = msg?.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;
  if (msg.key.fromMe) return;
  if (!msg.message || msg.message.protocolMessage || msg.message.reactionMessage) return;

  const s = await getS(sock);
  const text = getText(msg).trim();
  const isCommand = Boolean(text) && text.startsWith(s.prefix || ".");

  /* Anti Link / Anti Spam */
  try {
    if (s.antiLink && text && (await runAntiLink(sock, msg, s, text))) return;
  } catch (error) {
    if (s.debugMode) console.error("AntiLink error:", error.message);
  }

  try {
    if (s.antiSpam && (await runAntiSpam(sock, msg))) return;
  } catch (error) {
    if (s.debugMode) console.error("AntiSpam error:", error.message);
  }

  /* Auto Typing */
  if (s.autoTyping) {
    try {
      await sock.sendPresenceUpdate("composing", jid);
      setTimeout(() => sock.sendPresenceUpdate("paused", jid).catch(() => {}), 3000);
    } catch {}
  }

  /* Auto React */
  if (s.autoReact && !isCommand) {
    try {
      const emoji = getRandomEmoji(["❤️", "🔥", "😍", "👍", "😂", "✨", "💯", "😮"]);
      await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
    } catch {}
  }

  /* Auto Reply (private chats, once per hour per person) */
  if (s.autoReply && !isCommand && !jid.endsWith("@g.us")) {
    const rKey = `${sock.botNumber}:${jid}`;
    const last = repliedAt.get(rKey) || 0;
    if (Date.now() - last > 60 * 60 * 1000) {
      repliedAt.set(rKey, Date.now());
      try {
        await sleep(1500);
        await sock.sendMessage(jid, { text: AUTO_REPLY_TEXT }, { quoted: msg });
      } catch {}
    }
  }

  /* Auto Download (YouTube link) */
  if (s.autoDownload && text && !isCommand && YT_REGEX.test(text)) {
    try {
      await runAutoDownload(sock, msg, text);
    } catch (error) {
      if (s.debugMode) console.error("AutoDownload error:", error.message);
    }
    return;
  }

  /* Auto Sticker */
  if (s.autoSticker && !isCommand) {
    try {
      await runAutoSticker(sock, msg, s);
    } catch (error) {
      if (s.debugMode) console.error("AutoSticker error:", error.message);
    }
  }
}

/* =========================
   STATUS (seen / react)
========================= */

async function runStatus(sock, msg) {
  if (msg?.key?.remoteJid !== "status@broadcast") return;
  if (msg?.key?.fromMe === true) return;

  const s = await getS(sock);
  const statusJid = msg?.key?.participant || msg?.key?.participantAlt;
  if (!statusJid) return;

  if (s.statusAutoSeen) {
    try {
      await sock.readMessages([msg.key]);
    } catch (error) {
      console.error("Status seen error:", error.message);
    }
  }

  if (!s.statusAutoReact) return;

  let emoji = s.statusReactEmoji || "❤️";
  if (s.statusReactMode === "random") {
    emoji = getRandomEmoji(s.statusReactEmojis, "❤️");
  }

  await sock.sendMessage(
    "status@broadcast",
    { react: { text: emoji, key: msg.key } },
    { statusJidList: [statusJid] }
  );

  if (s.debugMode) console.log(`[STATUS REACT] ${statusJid} -> ${emoji}`);
}

/* =========================
   MENU
========================= */

function createMenu(s) {
  return `╭━━〔 ⚙️ SHAN SETTINGS 〕━━╮

🌐 GENERAL
1.1 Public       [ ${state(s.publicMode)} ]
1.2 Private      [ ${state(!s.publicMode)} ]
1.3 Owner Only   [ ${state(s.ownerOnly)} ]
1.4 Prefix       [ ${s.prefix} ]

🤖 AUTO
2.1 Auto Seen    [ ${state(s.autoSeen)} ]
2.2 Auto React   [ ${state(s.autoReact)} ]
2.3 Auto Typing  [ ${state(s.autoTyping)} ]
2.4 Auto Reply   [ ${state(s.autoReply)} ]

📱 STATUS
6.1 Status Seen  [ ${state(s.statusAutoSeen)} ]
6.2 Status React [ ${state(s.statusAutoReact)} ]
6.3 React Mode   [ ${s.statusReactMode} ]
6.4 React Emoji  [ ${s.statusReactEmoji} ]

👥 GROUP
3.1 Welcome      [ ${state(s.welcome)} ]
3.2 Goodbye      [ ${state(s.goodbye)} ]
3.3 Anti Link    [ ${state(s.antiLink)} ]
3.4 Anti Spam    [ ${state(s.antiSpam)} ]

🎨 MEDIA
4.1 Sticker      [ ${state(s.autoSticker)} ]
4.2 Download     [ ${state(s.autoDownload)} ]
4.3 Auto Crop    [ ${state(s.autoCrop)} ]

⚡ SYSTEM
5.1 Reconnect    [ ${state(s.autoReconnect)} ]
5.2 Debug        [ ${state(s.debugMode)} ]
5.3 Always Online [ ${state(s.alwaysOnline)} ]

💡 Reply with a number
╰━━━━━━━━━━━━━━━━━━━━━━╯

SHAN_SETTINGS_MENU_V1`;
}

async function sendMenu(sock, jid, msg) {
  const s = await getS(sock);
  const menu = createMenu(s);

  if (fs.existsSync("./logo.jpg")) {
    return sock.sendMessage(
      jid,
      { image: fs.readFileSync("./logo.jpg"), caption: menu },
      { quoted: msg }
    );
  }

  return sock.sendMessage(jid, { text: menu }, { quoted: msg });
}

/* =========================
   SETTING TABLE
========================= */

// code -> [label, field, valueFormatter]
const TOGGLES = {
  "1.3": ["Owner Only", "ownerOnly"],
  "2.1": ["Auto Seen", "autoSeen"],
  "2.2": ["Auto React", "autoReact"],
  "2.3": ["Auto Typing", "autoTyping"],
  "2.4": ["Auto Reply", "autoReply"],
  "6.1": ["Status Seen", "statusAutoSeen"],
  "6.2": ["Status React", "statusAutoReact"],
  "3.1": ["Welcome", "welcome"],
  "3.2": ["Goodbye", "goodbye"],
  "3.3": ["Anti Link", "antiLink"],
  "3.4": ["Anti Spam", "antiSpam"],
  "4.1": ["Auto Sticker", "autoSticker"],
  "4.2": ["Auto Download", "autoDownload"],
  "4.3": ["Auto Crop", "autoCrop"],
  "5.1": ["Auto Reconnect", "autoReconnect"],
  "5.2": ["Debug Mode", "debugMode"],
  "5.3": ["Always Online", "alwaysOnline"]
};

/** code එකට අදාළ වෙනස් කිරීම save කර [label, newValueText] ආපසු දෙයි */
async function applyChange(code, sock) {
  const s = await getS(sock);

  if (code === "1.1") {
    await setS(sock, { publicMode: true });
    return ["Public Mode", "ON"];
  }

  if (code === "1.2") {
    await setS(sock, { publicMode: false });
    return ["Private Mode", "ON"];
  }

  if (code === "6.3") {
    const mode = s.statusReactMode === "fixed" ? "random" : "fixed";
    await setS(sock, { statusReactMode: mode });
    return ["React Mode", mode.toUpperCase()];
  }

  const t = TOGGLES[code];
  if (!t) return null;

  const [label, field] = t;
  const value = !s[field];
  await setS(sock, { [field]: value });

  if (field === "alwaysOnline") await applyPresence(sock, value);

  return [label, state(value)];
}

/* =========================
   PLUGIN
========================= */

export default {
  commands: ["settings"],

  async onConnect(sock) {
    init(sock);
    try {
      const s = await getS(sock);
      await applyPresence(sock, s.alwaysOnline);
    } catch {}
  },

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;
    init(sock);

    if (!isOwner(msg, sock)) {
      return sock.sendMessage(jid, { text: "👑 Only the owner can change settings." }, { quoted: msg });
    }

    try {
      await sendMenu(sock, jid, msg);
    } catch (error) {
      console.error("Settings error:", error.message);
      await sock.sendMessage(jid, { text: "❌ Unable to load settings." }, { quoted: msg });
    }
  },

  async handleReply(sock, msg, text) {
    const jid = msg.key.remoteJid;
    const value = String(text || "").trim();
    init(sock);

    if (!isOwner(msg, sock)) return;

    const send = t => sock.sendMessage(jid, { text: t }, { quoted: msg });

    try {
      if (value === "1.4") {
        return send(`╭─〔 🔧 PREFIX 〕─╮

Send your new prefix like this:

PREFIX:!

Maximum: 3 characters

╰────────────────╯`);
      }

      if (value === "6.4") {
        return send(`╭─〔 ❤️ STATUS EMOJI 〕─╮

Send your new emoji like this:

EMOJI:❤️

Examples:
EMOJI:🔥
EMOJI:😍
EMOJI:💯

╰────────────────────╯`);
      }

      if (value.startsWith("PREFIX:")) {
        const newPrefix = value.slice(7).trim();

        if (!validPrefix(newPrefix)) {
          return send("❌ Invalid prefix. Maximum 3 characters; spaces are not allowed.");
        }

        await setS(sock, { prefix: newPrefix });

        return send(
          `✅ Prefix changed to *${newPrefix}*\n\nAll commands now work only with ${newPrefix}\nExample: ${newPrefix}settings`
        );
      }

      if (value.startsWith("EMOJI:")) {
        const emoji = value.slice(6).trim();
        if (!emoji) return send("❌ Emoji missing.");

        await setS(sock, { statusReactEmoji: emoji });

        return send(`✅ Status React Emoji changed to *${emoji}*`);
      }

      const result = await applyChange(value, sock);
      if (!result) return;

      await send(`✅ ${result[0]} changed to *${result[1]}*`);
    } catch (error) {
      console.error("Settings update error:", error);
      await send("❌ Settings update failed. Please try again.");
    }
  },

  async handleMessage(sock, msg) {
    init(sock);

    try {
      await runStatus(sock, msg);
    } catch (error) {
      console.error("Status handler error:", error.message);
    }

    try {
      await runFeatures(sock, msg);
    } catch (error) {
      console.error("Features error:", error.message);
    }
  },

  // sock (හෝ bot number) දුන්නාම ඒ බොට්ගේ settings දෙයි
  async getSettings(target) {
    const number = typeof target === "string" ? target : target?.botNumber;
    return await SHAN().getSettings(number);
  }
};

// plugins/activegrp.js
// SHAN MINI BOT V1 — ACTIVE GROUP MANAGER

import mongoose from "mongoose";

const PREFIX = process.env.PREFIX || ".";
const OWNER_NUMBER = "94752661225";

const INACTIVE_DAYS = 3;
const WARNING_HOURS = 1;

const INACTIVE_MS = INACTIVE_DAYS * 86400000;
const WARNING_MS = WARNING_HOURS * 3600000;
const CHECK_INTERVAL = 60000;

const settingsSchema = new mongoose.Schema(
  {
    groupJid: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    enabledAt: { type: Date, default: Date.now }
  },
  { timestamps: true, collection: "activegrp_settings" }
);

const activitySchema = new mongoose.Schema(
  {
    groupJid: { type: String, required: true },
    memberJid: { type: String, required: true },
    lastMessageAt: { type: Date, default: Date.now },
    warnedAt: { type: Date, default: null }
  },
  { timestamps: true, collection: "activegrp_activity" }
);

activitySchema.index(
  { groupJid: 1, memberJid: 1 },
  { unique: true }
);

const Settings =
  mongoose.models.ActiveGroupSettings ||
  mongoose.model("ActiveGroupSettings", settingsSchema);

const Activity =
  mongoose.models.ActiveGroupActivity ||
  mongoose.model("ActiveGroupActivity", activitySchema);

/* =========================
   HELPERS
========================= */

function cleanNumber(value = "") {
  return String(value)
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");
}

function isGroup(jid = "") {
  return String(jid).endsWith("@g.us");
}

function dbReady() {
  return mongoose.connection.readyState === 1;
}

function getSenderJid(msg) {
  return msg?.key?.participant || msg?.key?.remoteJid || "";
}

function getSenderNumber(msg) {
  if (msg?.key?.fromMe) return OWNER_NUMBER;

  const key = msg?.key || {};

  for (const value of [
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid
  ]) {
    const number = cleanNumber(value);
    if (number.length >= 8) return number;
  }

  return "";
}

function isOwner(msg) {
  return (
    msg?.key?.fromMe === true ||
    getSenderNumber(msg) === OWNER_NUMBER
  );
}

async function sendText(sock, jid, text, quoted) {
  if (!jid) return;

  return sock.sendMessage(
    jid,
    { text },
    quoted ? { quoted } : {}
  );
}

/* =========================
   PARTICIPANT MATCHING
========================= */

function participantMatches(participant, jid) {
  if (!participant || !jid) return false;

  const wanted = String(jid);

  const identifiers = [
    participant.id,
    participant.jid,
    participant.phoneNumber,
    participant.lid
  ].filter(Boolean).map(String);

  if (identifiers.includes(wanted)) return true;

  // Compare numbers only for regular phone-number JIDs.
  if (wanted.endsWith("@s.whatsapp.net")) {
    const wantedNumber = cleanNumber(wanted);

    return identifiers.some(id =>
      id.endsWith("@s.whatsapp.net") &&
      cleanNumber(id) === wantedNumber
    );
  }

  return false;
}

function findParticipant(metadata, jid) {
  return metadata.participants.find(p =>
    participantMatches(p, jid)
  );
}

function getBotParticipant(sock, metadata) {
  const botJids = [
    sock.user?.id,
    sock.user?.lid,
    sock.user?.phoneNumber
  ].filter(Boolean);

  for (const jid of botJids) {
    const found = findParticipant(metadata, jid);
    if (found) return found;
  }

  // Fallback: compare the bot's phone number when available.
  const botNumber = cleanNumber(sock.user?.id || "");

  if (botNumber) {
    const found = metadata.participants.find(p => {
      const phone = p.phoneNumber || p.id || "";
      return (
        String(phone).endsWith("@s.whatsapp.net") &&
        cleanNumber(phone) === botNumber
      );
    });

    if (found) return found;
  }

  return null;
}

async function isGroupAdmin(sock, groupJid, senderJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const participant = findParticipant(metadata, senderJid);

    return Boolean(
      participant?.admin === "admin" ||
      participant?.admin === "superadmin"
    );
  } catch (error) {
    console.error("[ActiveGroup] Admin check:", error.message);
    return false;
  }
}

async function isBotAdmin(sock, groupJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const bot = getBotParticipant(sock, metadata);

    console.log("[ActiveGroup] Bot identity:", {
      id: sock.user?.id,
      lid: sock.user?.lid,
      found: Boolean(bot),
      role: bot?.admin || "not found"
    });

    return Boolean(
      bot?.admin === "admin" ||
      bot?.admin === "superadmin"
    );
  } catch (error) {
    console.error("[ActiveGroup] Bot admin check:", error.message);
    return false;
  }
}

/* =========================
   ACTIVITY TRACKING
========================= */

async function recordActivity(groupJid, memberJid) {
  if (!dbReady() || !groupJid || !memberJid) return;

  try {
    await Activity.updateOne(
      { groupJid, memberJid },
      {
        $set: {
          lastMessageAt: new Date(),
          warnedAt: null
        },
        $setOnInsert: { groupJid, memberJid }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("[ActiveGroup] Save activity:", error.message);
  }
}

async function handleMessage(sock, msg) {
  if (!dbReady() || msg?.key?.fromMe) return;

  const groupJid = msg?.key?.remoteJid;
  if (!isGroup(groupJid)) return;

  const memberJid = getSenderJid(msg);
  if (!memberJid || memberJid === groupJid) return;

  await recordActivity(groupJid, memberJid);
}

/* =========================
   INITIALIZE GROUP MEMBERS
========================= */

async function seedMembers(sock, groupJid) {
  const metadata = await sock.groupMetadata(groupJid);
  const now = new Date();

  for (const participant of metadata.participants) {
    const memberJid = participant.id;
    if (!memberJid) continue;

    await Activity.updateOne(
      { groupJid, memberJid },
      {
        $setOnInsert: {
          groupJid,
          memberJid,
          lastMessageAt: now,
          warnedAt: null
        }
      },
      { upsert: true }
    );
  }

  return metadata.participants.length;
}

/* =========================
   SCHEDULER
========================= */

let schedulerTimer = null;
let schedulerSocket = null;
let schedulerRunning = false;

async function checkGroups(sock) {
  if (!dbReady() || schedulerRunning) return;

  schedulerRunning = true;

  try {
    const configs = await Settings.find({ enabled: true }).lean();
    const now = Date.now();

    for (const config of configs) {
      const groupJid = config.groupJid;

      try {
        const metadata = await sock.groupMetadata(groupJid);
        const bot = getBotParticipant(sock, metadata);

        if (
          !bot ||
          !["admin", "superadmin"].includes(bot.admin)
        ) {
          console.log(
            `[ActiveGroup] Bot is not admin in ${groupJid}`
          );
          continue;
        }

        const members = await Activity.find({ groupJid });

        for (const member of members) {
          const participant = findParticipant(
            metadata,
            member.memberJid
          );

          if (!participant) continue;

          // Never automatically remove group admins.
          if (
            participant.admin === "admin" ||
            participant.admin === "superadmin"
          ) {
            continue;
          }

          const lastMessageAt = new Date(
            member.lastMessageAt
          ).getTime();

          if (!Number.isFinite(lastMessageAt)) continue;

          const inactiveFor = now - lastMessageAt;

          // Stage 1: warn after three days.
          if (!member.warnedAt && inactiveFor >= INACTIVE_MS) {
            await sock.sendMessage(groupJid, {
              text:
                `╭━━〔 ⚠️ ACTIVE GROUP WARNING 〕━━╮\n\n` +
                `👤 සාමාජිකයා: @${cleanNumber(member.memberJid)}\n\n` +
                `⏳ ඔබ දින 3ක් Group එකේ Message එකක් දමා නැහැ.\n` +
                `🕐 ඉදිරි පැය 1 ඇතුළත Message එකක් දමන්න.\n` +
                `❌ නැත්නම් Group එකෙන් ඉවත් කිරීමට සිදුවිය හැකියි.\n\n` +
                `╰━━━━━━━━━━━━━━━━━━━━╯`,
              mentions: [member.memberJid]
            });

            member.warnedAt = new Date();
            await member.save();

            continue;
          }

          // Stage 2: remove if one hour passed and no new message.
          if (member.warnedAt) {
            const warnedAt = new Date(member.warnedAt).getTime();

            if (
              Number.isFinite(warnedAt) &&
              now - warnedAt >= WARNING_MS &&
              now - lastMessageAt >= INACTIVE_MS
            ) {
              try {
                const result = await sock.groupParticipantsUpdate(
                  groupJid,
                  [member.memberJid],
                  "remove"
                );

                const failure = Array.isArray(result) &&
                  result.some(item =>
                    item.status &&
                    !["200", "ok"].includes(
                      String(item.status).toLowerCase()
                    )
                  );

                if (failure) {
                  console.error(
                    "[ActiveGroup] WhatsApp removal result:",
                    JSON.stringify(result)
                  );
                  continue;
                }

                await Activity.deleteOne({ _id: member._id });

                await sock.sendMessage(groupJid, {
                  text:
                    `╭━━〔 ❌ MEMBER REMOVAL 〕━━╮\n\n` +
                    `👤 සාමාජිකයා: @${cleanNumber(member.memberJid)}\n` +
                    `📌 හේතුව: දින 3ක් Inactive වීම සහ Warning එකෙන් පසු පැයක් ගතවීම.\n\n` +
                    `╰━━━━━━━━━━━━━━━━━━━━╯`,
                  mentions: [member.memberJid]
                });
              } catch (error) {
                console.error(
                  "[ActiveGroup] Remove failed:",
                  error.message
                );
              }
            }
          }
        }
      } catch (error) {
        console.error(
          `[ActiveGroup] Group check failed (${groupJid}):`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("[ActiveGroup] Scheduler error:", error.message);
  } finally {
    schedulerRunning = false;
  }
}

function startScheduler(sock) {
  schedulerSocket = sock;

  if (schedulerTimer) return;

  schedulerTimer = setInterval(() => {
    if (schedulerSocket) {
      checkGroups(schedulerSocket).catch(error =>
        console.error("[ActiveGroup] Scheduler:", error.message)
      );
    }
  }, CHECK_INTERVAL);

  schedulerTimer.unref?.();
  console.log("[ActiveGroup] Scheduler started.");
}

/* =========================
   COMMAND HANDLER
========================= */

async function execute(sock, msg, args = []) {
  const groupJid = msg?.key?.remoteJid;

  if (!isGroup(groupJid)) {
    await sendText(
      sock,
      groupJid,
      "❌ මේ Command එක WhatsApp Group එකක් ඇතුළේ භාවිත කරන්න.",
      msg
    );
    return;
  }

  if (!dbReady()) {
    await sendText(
      sock,
      groupJid,
      "❌ MongoDB සම්බන්ධ වී නැහැ. MONGODB_URI පරීක්ෂා කරන්න.",
      msg
    );
    return;
  }

  const action = String(args?.[0] || "on").toLowerCase();

  if (!isOwner(msg)) {
    const admin = await isGroupAdmin(
      sock,
      groupJid,
      getSenderJid(msg)
    );

    if (!admin) {
      await sendText(
        sock,
        groupJid,
        "⛔ මේ Command එක භාවිත කළ හැක්කේ Group Admin කෙනෙකුට හෝ Bot Ownerට පමණයි.",
        msg
      );
      return;
    }
  }

  if (action === "off") {
    await Settings.updateOne(
      { groupJid },
      {
        $set: { enabled: false },
        $setOnInsert: { groupJid }
      },
      { upsert: true }
    );

    await sendText(
      sock,
      groupJid,
      "🔴 Active Group System එක OFF කළා.",
      msg
    );
    return;
  }

  if (action === "status") {
    const config = await Settings.findOne({ groupJid }).lean();
    const total = await Activity.countDocuments({ groupJid });
    const warned = await Activity.countDocuments({
      groupJid,
      warnedAt: { $ne: null }
    });

    await sendText(
      sock,
      groupJid,
      `╭━━〔 🔥 ACTIVE GROUP STATUS 〕━━╮\n\n` +
      `📌 System: ${config?.enabled ? "🟢 ON" : "🔴 OFF"}\n` +
      `📡 MongoDB: 🟢 CONNECTED\n` +
      `👥 Tracked Members: ${total}\n` +
      `⚠️ Pending Warnings: ${warned}\n` +
      `⏳ Inactive Limit: 3 days\n` +
      `🕐 Warning Time: 1 hour\n\n` +
      `╰━━━━━━━━━━━━━━━━━━━━╯`,
      msg
    );
    return;
  }

  if (action !== "on") {
    await sendText(
      sock,
      groupJid,
      `භාවිතය:\n${PREFIX}activegrp\n${PREFIX}activegrp status\n${PREFIX}activegrp off`,
      msg
    );
    return;
  }

  try {
    const botAdmin = await isBotAdmin(sock, groupJid);

    if (!botAdmin) {
      await sendText(
        sock,
        groupJid,
        "❌ Bot Admin හඳුනාගන්න බැහැ.\n\n" +
        "1. Bot Number එක Group එකේ Admin කරන්න.\n" +
        "2. Bot එක Group එකෙන් ඉවත් කර නැවත Add කරලා බලන්න.\n" +
        "3. ඉන්පසු .activegrp නැවත යවන්න.\n\n" +
        "තවමත් වැඩ නැත්නම් Console එකේ [ActiveGroup] Bot identity log එක එවන්න.",
        msg
      );
      return;
    }

    const count = await seedMembers(sock, groupJid);

    await Settings.updateOne(
      { groupJid },
      {
        $set: {
          enabled: true,
          enabledAt: new Date()
        },
        $setOnInsert: { groupJid }
      },
      { upsert: true }
    );

    startScheduler(sock);

    await sendText(
      sock,
      groupJid,
      `╭━━〔 🔥 ACTIVE GROUP ENABLED 〕━━╮\n\n` +
      `✅ System: ON\n` +
      `👥 Group Members: ${count}\n` +
      `⏳ Inactive Limit: දවස් 3යි\n` +
      `⚠️ Warning Time: පැය 1යි\n` +
      `🤖 Auto Remove: ENABLED\n\n` +
      `📌 දැන් සිට Group Messages Track කරනවා.\n` +
      `📌 කලින් WhatsApp Message History එක භාවිත කරන්නේ නැහැ.\n\n` +
      `🔎 Status: ${PREFIX}activegrp status\n` +
      `🛑 OFF: ${PREFIX}activegrp off\n\n` +
      `╰━━━━━━━━━━━━━━━━━━━━╯`,
      msg
    );
  } catch (error) {
    console.error(
      "[ActiveGroup] Enable error:",
      error.stack || error.message
    );

    await sendText(
      sock,
      groupJid,
      "❌ System එක ON කරන්න බැරි වුණා. Hosting Console එකේ Error එක පරීක්ෂා කරන්න.",
      msg
    );
  }
}

/* =========================
   PLUGIN EXPORT
========================= */

export default {
  command: "activegrp",
  description: "Warn and remove inactive group members",
  category: "group",
  premium: false,
  execute,

  async handleMessage(sock, msg) {
    await handleMessage(sock, msg);
  }
};

/* =========================================
   EXPORT FUNCTIONS FOR INDEX.JS
========================================= */

export async function executeGroupActivityCommand(sock, msg) {
  return await execute(sock, msg, []);
}

export async function handleGroupActivityReply(sock, msg) {
  return false;
}

export async function trackGroupMessage(sock, msg) {
  return await handleMessage(sock, msg);
}

export async function startActivityScheduler(sock) {
  return startScheduler(sock);
}

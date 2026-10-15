import mongoose from "mongoose";

const OWNER_NUMBER = cleanNumber(
  process.env.OWNER_NUMBER || "94752661225"
);

/* =========================
   NUMBER HELPERS
========================= */

function cleanNumber(value) {
  return String(value || "")
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@lid$/i, "")
    .replace(/@g\.us$/i, "")
    .replace(/\D/g, "");
}

function normalizeNumber(value) {
  return cleanNumber(value);
}

/* =========================
   SENDER / OWNER
========================= */

function getSenderCandidates(msg) {
  const key = msg?.key || {};

  return [
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid
  ]
    .filter(Boolean)
    .map(normalizeNumber)
    .filter(Boolean);
}

function getSenderNumber(msg) {
  const key = msg?.key || {};

  // Bot's own WhatsApp account sent the message
  if (key.fromMe === true) {
    return OWNER_NUMBER;
  }

  const candidates = getSenderCandidates(msg);

  // If owner number exists anywhere, always use owner
  if (candidates.includes(OWNER_NUMBER)) {
    return OWNER_NUMBER;
  }

  return candidates[0] || "";
}

function isOwner(number, msg = null) {
  // Bot's own outgoing message
  if (msg?.key?.fromMe === true) {
    return true;
  }

  return normalizeNumber(number) === OWNER_NUMBER;
}

/* =========================
   SEND TEXT
========================= */

async function sendText(sock, jid, text, quoted = null) {
  if (!jid) return;

  return sock.sendMessage(
    jid,
    { text },
    quoted ? { quoted } : {}
  );
}

/* =========================
   PREMIUM MODEL
========================= */

const premiumSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    addedBy: {
      type: String,
      default: OWNER_NUMBER
    },

    expiresAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true,
    collection: "premiumusers"
  }
);

const PremiumUser =
  mongoose.models.PremiumUser ||
  mongoose.model("PremiumUser", premiumSchema);

/* =========================
   CHANNEL REACT MODEL
========================= */

const channelReactSchema = new mongoose.Schema(
  {
    owner: {
      type: String,
      required: true,
      index: true
    },

    channelJid: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    channelLink: {
      type: String,
      required: true
    },

    emojis: {
      type: [String],
      default: ["❤️", "🔥", "👍", "😂", "😮"]
    },

    nextIndex: {
      type: Number,
      default: 0
    },

    active: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    collection: "channelreacts"
  }
);

const ChannelReact =
  mongoose.models.ChannelReact ||
  mongoose.model("ChannelReact", channelReactSchema);

/* =========================
   PREMIUM FUNCTIONS
========================= */

async function expirePremiumUsers() {
  try {
    await PremiumUser.deleteMany({
      expiresAt: {
        $lte: new Date()
      }
    });
  } catch (error) {
    console.error(
      "❌ Premium expiry error:",
      error?.message || error
    );
  }
}

async function getPremiumUser(number) {
  await expirePremiumUsers();

  const clean = normalizeNumber(number);

  if (!clean) return null;

  return PremiumUser.findOne({
    number: clean,
    expiresAt: {
      $gt: new Date()
    }
  });
}

async function isPremium(number, msg = null) {
  // Owner is always premium
  if (isOwner(number, msg)) {
    return true;
  }

  return !!(await getPremiumUser(number));
}

async function addPremium(number, days) {
  const clean = normalizeNumber(number);

  if (!clean) {
    throw new Error("Invalid number.");
  }

  const durationDays = Number(days);

  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    throw new Error("Invalid premium days.");
  }

  const expiresAt = new Date(
    Date.now() + durationDays * 24 * 60 * 60 * 1000
  );

  return PremiumUser.findOneAndUpdate(
    { number: clean },
    {
      number: clean,
      addedBy: OWNER_NUMBER,
      expiresAt
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  );
}

async function removePremium(number) {
  const clean = normalizeNumber(number);

  if (!clean) return null;

  return PremiumUser.findOneAndDelete({
    number: clean
  });
}

/* =========================
   MENUS
========================= */

function ownerMenu() {
  return `
╭━━━〔 👑 OWNER MENU 〕━━━╮
┃
┃ 👑 .addpremium
┃ ➖ .delpremium
┃ 💎 .mypremium
┃ 📡 .activechanreact
┃ 🛑 .deactivechanreact
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯
`;
}

function premiumMenu() {
  return `
╭━━━〔 💎 PREMIUM MENU 〕━━━╮
┃
┃ 💎 .mypremium
┃ 📡 .activechanreact
┃ 🛑 .deactivechanreact
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━╯
`;
}

function normalUserMenu() {
  return `
╭━━━〔 📋 MENU 〕━━━╮
┃
┃ 💎 .mypremium
┃
╰━━━━━━━━━━━━━━━━━━╯
`;
}

/* =========================
   ADD PREMIUM
========================= */

async function addPremiumCommand(sock, msg, args) {
  const sender = getSenderNumber(msg);

  if (!isOwner(sender, msg)) {
    return sendText(
      sock,
      msg.key.remoteJid,
      "❌ Owner only command.",
      msg
    );
  }

  const target = normalizeNumber(args?.[0]);
  const days = Number(args?.[1]);

  if (!target || !Number.isFinite(days) || days <= 0) {
    return sendText(
      sock,
      msg.key.remoteJid,
      `❌ Usage:
.addpremium 947XXXXXXXXX 30

Example:
.addpremium 94752661225 30`,
      msg
    );
  }

  if (target === OWNER_NUMBER) {
    return sendText(
      sock,
      msg.key.remoteJid,
      "👑 Owner is already permanently Premium.",
      msg
    );
  }

  try {
    const premium = await addPremium(target, days);

    const date = premium.expiresAt
      ? premium.expiresAt.toLocaleString()
      : "Unknown";

    return sendText(
      sock,
      msg.key.remoteJid,
      `✅ Premium added successfully.

👤 Number: ${target}
💎 Days: ${days}
⏰ Expires: ${date}`,
      msg
    );
  } catch (error) {
    console.error("❌ addpremium error:", error);

    return sendText(
      sock,
      msg.key.remoteJid,
      "❌ Failed to add Premium.",
      msg
    );
  }
}

/* =========================
   DELETE PREMIUM
========================= */

async function delPremiumCommand(sock, msg, args) {
  const sender = getSenderNumber(msg);

  if (!isOwner(sender, msg)) {
    return sendText(
      sock,
      msg.key.remoteJid,
      "❌ Owner only command.",
      msg
    );
  }

  const target = normalizeNumber(args?.[0]);

  if (!target) {
    return sendText(
      sock,
      msg.key.remoteJid,
      `❌ Usage:
.delpremium 947XXXXXXXXX`,
      msg
    );
  }

  if (target === OWNER_NUMBER) {
    return sendText(
      sock,
      msg.key.remoteJid,
      "❌ Owner Premium cannot be removed.",
      msg
    );
  }

  try {
    const deleted = await removePremium(target);

    if (!deleted) {
      return sendText(
        sock,
        msg.key.remoteJid,
        "⚠️ This number is not a Premium user.",
        msg
      );
    }

    return sendText(
      sock,
      msg.key.remoteJid,
      `✅ Premium removed.

👤 Number: ${target}`,
      msg
    );
  } catch (error) {
    console.error("❌ delpremium error:", error);

    return sendText(
      sock,
      msg.key.remoteJid,
      "❌ Failed to remove Premium.",
      msg
    );
  }
}

/* =========================
   MY PREMIUM
========================= */

async function myPremiumCommand(sock, msg) {
  const sender = getSenderNumber(msg);
  const jid = msg.key.remoteJid;

  // Owner
  if (isOwner(sender, msg)) {
    return sendText(
      sock,
      jid,
      `👑 OWNER PREMIUM

💎 Status: ACTIVE
♾️ Plan: PERMANENT
👤 Number: ${OWNER_NUMBER}

${ownerMenu()}`,
      msg
    );
  }

  const premium = await getPremiumUser(sender);

  if (!premium) {
    return sendText(
      sock,
      jid,
      `❌ You are not a Premium user.

${normalUserMenu()}`,
      msg
    );
  }

  const expires = premium.expiresAt
    ? premium.expiresAt.toLocaleString()
    : "Unknown";

  return sendText(
    sock,
    jid,
    `💎 PREMIUM STATUS

👤 Number: ${sender}
✅ Status: ACTIVE
⏰ Expires: ${expires}

${premiumMenu()}`,
    msg
  );
}

/* =========================
   CHANNEL LINK
========================= */

function extractChannelInvite(link) {
  const text = String(link || "").trim();

  const match = text.match(
    /https?:\/\/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
  );

  return match?.[1] || null;
}

/* =========================
   ACTIVE CHANNEL REACT
========================= */

async function activeChannelReactCommand(sock, msg, args) {
  const sender = getSenderNumber(msg);
  const jid = msg.key.remoteJid;

  if (!(await isPremium(sender, msg))) {
    return sendText(
      sock,
      jid,
      "❌ Premium only command.",
      msg
    );
  }

  const channelLink = String(args?.[0] || "").trim();

  if (!channelLink) {
    return sendText(
      sock,
      jid,
      `❌ Usage:

.activechanreact https://whatsapp.com/channel/XXXXXXXX`,
      msg
    );
  }

  const inviteCode = extractChannelInvite(channelLink);

  if (!inviteCode) {
    return sendText(
      sock,
      jid,
      "❌ Invalid WhatsApp Channel invite link.",
      msg
    );
  }

  if (
    typeof sock.newsletterMetadata !== "function"
  ) {
    return sendText(
      sock,
      jid,
      "❌ Your Baileys version does not support newsletterMetadata().",
      msg
    );
  }

  try {
    const metadata = await sock.newsletterMetadata(
      "invite",
      inviteCode
    );

    const channelJid = metadata?.id;

    if (!channelJid) {
      return sendText(
        sock,
        jid,
        "❌ Could not find Channel JID.",
        msg
      );
    }

    // Try following the channel
    try {
      if (
        typeof sock.newsletterFollow === "function"
      ) {
        await sock.newsletterFollow(channelJid);
      }
    } catch (followError) {
      console.log(
        "⚠️ Channel follow failed:",
        followError?.message || followError
      );
    }

    const emojis = [
      "❤️️",
      "🔥",
      "👍",
      "😂",
      "😮"
    ];

    await ChannelReact.findOneAndUpdate(
      { channelJid },
      {
        owner: sender,
        channelJid,
        channelLink,
        emojis,
        nextIndex: 0,
        active: true
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    return sendText(
      sock,
      jid,
      `✅ Channel React activated.

📡 Channel: ${channelJid}
🔗 Link: ${channelLink}
❤️ Status: ACTIVE

Reactions:
${emojis.join(" ")}`,
      msg
    );
  } catch (error) {
    console.error(
      "❌ activechanreact error:",
      error
    );

    return sendText(
      sock,
      jid,
      `❌ Failed to activate Channel React.

${error?.message || ""}`,
      msg
    );
  }
}

/* =========================
   DEACTIVE CHANNEL REACT
========================= */

async function deactiveChannelReactCommand(
  sock,
  msg,
  args
) {
  const sender = getSenderNumber(msg);
  const jid = msg.key.remoteJid;

  if (!(await isPremium(sender, msg))) {
    return sendText(
      sock,
      jid,
      "❌ Premium only command.",
      msg
    );
  }

  const channelLink = String(args?.[0] || "").trim();

  if (!channelLink) {
    return sendText(
      sock,
      jid,
      `❌ Usage:

.deactivechanreact https://whatsapp.com/channel/XXXXXXXX`,
      msg
    );
  }

  const inviteCode = extractChannelInvite(channelLink);

  if (!inviteCode) {
    return sendText(
      sock,
      jid,
      "❌ Invalid WhatsApp Channel invite link.",
      msg
    );
  }

  try {
    let channelJid = null;

    if (
      typeof sock.newsletterMetadata === "function"
    ) {
      try {
        const metadata =
          await sock.newsletterMetadata(
            "invite",
            inviteCode
          );

        channelJid = metadata?.id || null;
      } catch {}
    }

    let result = null;

    if (channelJid) {
      result =
        await ChannelReact.findOneAndUpdate(
          {
            owner: sender,
            channelJid
          },
          {
            active: false
          },
          {
            new: true
          }
        );
    }

    // Fallback to link match
    if (!result) {
      result =
        await ChannelReact.findOneAndUpdate(
          {
            owner: sender,
            channelLink
          },
          {
            active: false
          },
          {
            new: true
          }
        );
    }

    if (!result) {
      return sendText(
        sock,
        jid,
        "⚠️ No active Channel React found for this channel.",
        msg
      );
    }

    return sendText(
      sock,
      jid,
      `🛑 Channel React deactivated.

📡 Channel: ${result.channelJid}
🔗 Link: ${result.channelLink}
❌ Status: INACTIVE`,
      msg
    );
  } catch (error) {
    console.error(
      "❌ deactivechanreact error:",
      error
    );

    return sendText(
      sock,
      jid,
      "❌ Failed to deactivate Channel React.",
      msg
    );
  }
}

/* =========================
   CHANNEL MESSAGE HANDLER
========================= */

async function handleChannelMessage(sock, msg) {
  const jid = msg?.key?.remoteJid;

  if (
    !jid ||
    !jid.endsWith("@newsletter")
  ) {
    return false;
  }

  if (
    typeof sock.newsletterReactMessage !==
    "function"
  ) {
    console.log(
      "❌ newsletterReactMessage() is not available."
    );
    return false;
  }

  const serverId =
    msg?.key?.server_id ||
    msg?.key?.serverId;

  if (!serverId) {
    console.log(
      "⚠️ Newsletter message server_id not found."
    );

    console.log(
      "🔎 Message key:",
      msg?.key
    );

    return false;
  }

  try {
    const config =
      await ChannelReact.findOne({
        channelJid: jid,
        active: true
      });

    if (!config) {
      return false;
    }

    const emojis =
      Array.isArray(config.emojis) &&
      config.emojis.length
        ? config.emojis
        : ["❤️"];

    const index =
      Number(config.nextIndex || 0) %
      emojis.length;

    const emoji = emojis[index];

    await sock.newsletterReactMessage(
      jid,
      serverId,
      emoji
    );

    config.nextIndex =
      (index + 1) % emojis.length;

    await config.save();

    console.log(
      `❤️ Channel React: ${emoji} -> ${jid}`
    );

    return true;
  } catch (error) {
    console.error(
      "❌ Channel React error:",
      error?.message || error
    );

    return false;
  }
}

/* =========================
   PLUGIN
========================= */

const plugin = {
  commands: [
    "addpremium",
    "delpremium",
    "mypremium",
    "activechanreact",
    "deactivechanreact"
  ],

  async execute(
    sock,
    msg,
    args,
    command
  ) {
    switch (
      String(command || "").toLowerCase()
    ) {
      case "addpremium":
        return addPremiumCommand(
          sock,
          msg,
          args
        );

      case "delpremium":
        return delPremiumCommand(
          sock,
          msg,
          args
        );

      case "mypremium":
        return myPremiumCommand(
          sock,
          msg
        );

      case "activechanreact":
        return activeChannelReactCommand(
          sock,
          msg,
          args
        );

      case "deactivechanreact":
        return deactiveChannelReactCommand(
          sock,
          msg,
          args
        );

      default:
        return false;
    }
  },

  async handleMessage(sock, msg) {
    return handleChannelMessage(
      sock,
      msg
    );
  }
};

export default plugin;
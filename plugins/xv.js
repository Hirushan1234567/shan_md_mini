// plugins/xvideos.js
// SHAN MINI BOT V1 format
//
// 1) .xv <නම>            → ප්‍රතිඵල 25ක් දක්වා (අංක එක්ක) පෙන්නනවා
// 2) ඒ list එකට අංකයක් reply කරන්න   → Video / Document අහනවා
// 3) 1 (Video) හෝ 2 (Document) reply කරන්න → එවනවා
//
// කෙටි ක්‍රම:  .xv <අංකය>   |   .xv <xvideos url>   (ඒවත් Video/Document අහනවා)
//
// Variables (අවශ්‍ය නම්):
//   XV_API_KEY       = API key එක
//   XV_RESULTS       = search ප්‍රතිඵල ගණන (default 25)
//   XV_PRIVATE_ONLY  = true   (groups වල වැඩ කරන්නේ නැහැ)

const API_KEY =
  process.env.XV_API_KEY || "chama_api_aca7937aadbe4e84593bb8652f63d033";

const BASE_SEARCH = "https://api.chamindu.site/api/adult/xvideos/search";
const BASE_DL = "https://api.chamindu.site/api/adult/xvideos/dl";

const MAX_RESULTS = Math.max(1, Number(process.env.XV_RESULTS || 25));

const PRIVATE_ONLY =
  String(process.env.XV_PRIVATE_ONLY ?? "false").toLowerCase() === "true";

/* =========================================
   STATE  (bot යවපු message එකකට reply කළාම හඳුනාගන්න)
========================================= */

const STATE_TTL = 30 * 60 * 1000;
const STATE_MAX = 500;

// bot message id -> { type: "list" | "format", chat, results | url/title, at }
const states = new Map();

// chat -> අන්තිම search ප්‍රතිඵල (.xv <අංකය> සඳහා)
const lastSearch = new Map();

function setState(id, data) {
  if (!id) return;

  if (states.size >= STATE_MAX) {
    states.delete(states.keys().next().value);
  }

  states.set(id, { ...data, at: Date.now() });
}

function getState(id) {
  const st = states.get(id);

  if (!st) return null;

  if (Date.now() - st.at > STATE_TTL) {
    states.delete(id);
    return { expired: true };
  }

  return st;
}

/* =========================================
   HELPERS
========================================= */

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

function getQuotedId(msg) {
  const m = unwrap(msg?.message);

  return (
    m?.extendedTextMessage?.contextInfo?.stanzaId ||
    m?.imageMessage?.contextInfo?.stanzaId ||
    null
  );
}

function short(text = "", max = 70) {
  const value = String(text).replace(/\s+/g, " ").trim();
  return value.length > max ? value.slice(0, max - 1).trim() + "…" : value;
}

async function getPrefix(sock) {
  try {
    return (await sock.getSettings())?.prefix || ".";
  } catch {
    return ".";
  }
}

async function callApi(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });

  let data = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok && !data) {
    throw new Error(`API error (${res.status})`);
  }

  return data || {};
}

/* =========================================
   FORMAT MENU  (Video / Document)
========================================= */

async function askFormat(sock, msg, chat, url, title, duration) {
  const lines = [
    "🎬 *DOWNLOAD*",
    "",
    title ? `📌 ${short(title, 90)}` : `🔗 ${url}`,
    duration ? `⏱ ${duration}` : null,
    "",
    "📥 *Reply with:*",
    "1️⃣  Video 🎥",
    "2️⃣  Document 📄"
  ].filter(line => line !== null);

  const sent = await sock.sendMessage(
    chat,
    { text: lines.join("\n") },
    { quoted: msg }
  );

  setState(sent?.key?.id, { type: "format", chat, url, title });
}

/* =========================================
   DOWNLOAD
========================================= */

async function sendVideo(sock, msg, chat, url, mode) {
  const reply = text =>
    sock.sendMessage(chat, { text }, { quoted: msg }).catch(() => {});

  let data;

  try {
    data = await callApi(
      `${BASE_DL}?url=${encodeURIComponent(url)}&api_key=${API_KEY}`
    );
  } catch (error) {
    return reply(`❌ API Connection Error: ${error.message}`);
  }

  if (!data.success || !data.download_url) {
    return reply(
      `❌ Failed to process download.\n${data.error || data.message || "Unknown error"}`
    );
  }

  const videoUrl = data.download_url;
  const sourceUrl = data.original_url || url;

  // API එකෙන් ලැබෙන file එකේ ඇත්ත quality එක
  const quality =
    String(data.raw_link || data.download_url || "").match(/video_(\d{3,4})p/i)?.[1];

  const filename = `XVIDEOS_${Date.now()}.mp4`;

  const caption =
    `🎬 *XVIDEOS DOWNLOAD*\n\n` +
    (quality ? `📺 Quality: ${quality}p\n` : "") +
    `🔗 *Source:* ${sourceUrl}`;

  const asDocument = () =>
    sock.sendMessage(
      chat,
      { document: { url: videoUrl }, fileName: filename, caption, mimetype: "video/mp4" },
      { quoted: msg }
    );

  const asVideo = () =>
    sock.sendMessage(
      chat,
      { video: { url: videoUrl }, caption, mimetype: "video/mp4" },
      { quoted: msg }
    );

  const order = mode === "document" ? [asDocument, asVideo] : [asVideo, asDocument];

  for (const send of order) {
    try {
      await send();
      return;
    } catch (error) {
      console.log("[xv] send failed:", error?.message || error);
    }
  }

  return reply(
    `⚠️ *Could not send file directly (Size/Network Limit).*\n\n` +
      `🔗 *Source:* ${sourceUrl}\n` +
      `⬇️ *Direct Link:* ${videoUrl}`
  );
}

/* =========================================
   SEARCH
========================================= */

async function handleSearch(sock, msg, chat, args, prefix) {
  const reply = text =>
    sock.sendMessage(chat, { text }, { quoted: msg }).catch(() => {});

  let pageNum = 1;
  let query = args.join(" ").trim();

  const last = args[args.length - 1];

  if (last && /^\d+$/.test(last) && args.length > 1) {
    pageNum = parseInt(last, 10);
    query = args.slice(0, -1).join(" ").trim();
  }

  if (!query) {
    return reply("❌ Enter something to search.");
  }

  let data;

  try {
    data = await callApi(
      `${BASE_SEARCH}?q=${encodeURIComponent(query)}&page=${pageNum}&api_key=${API_KEY}`
    );
  } catch (error) {
    console.error("[xv] Search error:", error?.message || error);
    return reply(`❌ Search error: ${error.message}`);
  }

  if (!data.success || !data.results?.length) {
    return reply(`⚠️ No results found for "${query}".`);
  }

  const results = data.results.slice(0, MAX_RESULTS);

  lastSearch.set(chat, results);

  let text = `🎬 *SEARCH: "${query}"* (Page ${pageNum})\n\n`;

  results.forEach((video, index) => {
    text += `${index + 1}. ${short(video.title)}${video.duration ? `  ⏱ ${video.duration}` : ""}\n`;
  });

  text += `\n📥 *Reply to this message with a number.*`;
  text += `\n➡️ Next page: ${prefix}xv ${query} ${pageNum + 1}`;

  let sent = null;
  const thumb = results[0]?.thumbnail;

  if (thumb) {
    try {
      sent = await sock.sendMessage(
        chat,
        { image: { url: thumb }, caption: text },
        { quoted: msg }
      );
    } catch {
      sent = null;
    }
  }

  if (!sent) {
    sent = await sock.sendMessage(chat, { text }, { quoted: msg });
  }

  setState(sent?.key?.id, { type: "list", chat, results });
}

/* =========================================
   PLUGIN EXPORT
========================================= */

export default {
  command: ["xv"],
  alias: ["xvideos", "xvsearch", "xvdl"],
  help: ["xv"],
  tags: ["downloader"],
  replyHandler: true,

  async execute(sock, msg, args) {
    const chat = msg.key.remoteJid;

    const reply = text =>
      sock.sendMessage(chat, { text }, { quoted: msg }).catch(() => {});

    if (PRIVATE_ONLY && String(chat).endsWith("@g.us")) {
      return reply("🔒 This command does not work in groups.");
    }

    const prefix = await getPrefix(sock);
    const input = (args || []).join(" ").trim();

    if (!input) {
      return reply(
        `🎬 *XVIDEOS TOOLKIT*\n\n` +
          `1️⃣ *Search:* ${prefix}xv <query>\n` +
          `2️⃣ Reply to the list with a number\n` +
          `3️⃣ Choose Video or Document\n\n` +
          `⚡ By URL: ${prefix}xv <xvideos_url>\n` +
          `⚡ By number: ${prefix}xv <1-${MAX_RESULTS}>\n\n` +
          `Example:\n${prefix}xv latina milf`
      );
    }

    try {
      await sock.sendMessage(chat, { react: { text: "🎬", key: msg.key } });
    } catch {}

    // URL එකක්ද
    if (/xvideos\.com/i.test(input)) {
      const url = input.match(/https?:\/\/\S+/i)?.[0] || input;
      return askFormat(sock, msg, chat, url, "", "");
    }

    // අංකයක්ද
    if (/^\d{1,2}$/.test(input)) {
      const results = lastSearch.get(chat);
      const index = parseInt(input, 10);

      if (!results?.length) {
        return reply(`⚠️ No previous search found.\nSearch first: ${prefix}xv <query>`);
      }

      if (index < 1 || index > results.length) {
        return reply(`❌ Enter a number between 1 and ${results.length}.`);
      }

      const video = results[index - 1];

      return askFormat(sock, msg, chat, video.url, video.title, video.duration);
    }

    return handleSearch(sock, msg, chat, args, prefix);
  },

  // bot යවපු message එකකට reply කළාම index.js මේක call කරනවා
  async handleReply(sock, msg, text) {
    const quotedId = getQuotedId(msg);

    if (!quotedId) return false;

    const st = getState(quotedId);

    if (!st) return false;

    const chat = msg.key.remoteJid;

    const reply = t =>
      sock.sendMessage(chat, { text: t }, { quoted: msg }).catch(() => {});

    if (st.expired) {
      await reply("⌛ This search has expired. Please search again.");
      return true;
    }

    if (st.chat !== chat) return false;

    const value = String(text || "").trim();

    // අංකයක් නොවේ නම් අපේ reply එකක් නෙවෙයි, ඉතිරි handlers වලට දෙනවා
    if (!/^\d{1,2}$/.test(value)) return false;

    const n = parseInt(value, 10);

    /* ---- list එකෙන් video එකක් තේරීම ---- */
    if (st.type === "list") {
      if (n < 1 || n > st.results.length) {
        await reply(`❌ Enter a number between 1 and ${st.results.length}.`);
        return true;
      }

      const video = st.results[n - 1];

      await askFormat(sock, msg, chat, video.url, video.title, video.duration);

      return true;
    }

    /* ---- Video / Document තේරීම ---- */
    if (st.type === "format") {
      if (n !== 1 && n !== 2) {
        await reply("❌ Reply with 1 (Video) or 2 (Document) only.");
        return true;
      }

      try {
        await sock.sendMessage(chat, { react: { text: "⬇️", key: msg.key } });
      } catch {}

      await sendVideo(sock, msg, chat, st.url, n === 1 ? "video" : "document");

      return true;
    }

    return false;
  }
};

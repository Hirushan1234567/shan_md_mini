import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

/* =========================
CONFIG (.env)
UPDATE_REPO=username/repo
UPDATE_BRANCH=main
GITHUB_TOKEN=   (private repo නම් විතරක්)
========================= */

const OWNER = "94752661225";
const PLUGINS_DIR = process.env.PLUGINS_DIR || "./plugins";

function cleanNumber(v = "") {
  return String(v).split(":")[0].split("@")[0].replace(/\D/g, "");
}

function isOwner(msg) {
  if (msg?.key?.fromMe === true) return true;
  const k = msg?.key || {};
  return [k.senderPn, k.participantPn, k.participantAlt, k.participant, k.remoteJid, k.remoteJidAlt]
    .filter(Boolean)
    .some(v => cleanNumber(v) === OWNER);
}

// Update වෙන්න පුළුවන් ඒවා විතරයි. sessions / .env / node_modules කවදාවත් touch වෙන්නේ නෑ.
function mapTarget(rel) {
  if (rel === "index.js") return "./index.js";
  if (rel.startsWith("plugins/")) {
    return path.join(PLUGINS_DIR, rel.slice("plugins/".length));
  }
  return null;
}

export default {
  commands: ["update"],

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;
    const reply = text => sock.sendMessage(jid, { text }, { quoted: msg });

    if (!isOwner(msg)) return reply("👑 Owner only command.");

    const repo = process.env.UPDATE_REPO;
    const branch = process.env.UPDATE_BRANCH || "main";

    if (!repo) return reply("❌ .env එකේ UPDATE_REPO=username/repo දාන්න.");

    try {
      await reply("⏳ Checking for updates...");

      const headers = { "User-Agent": "shan-mini-bot" };
      if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const res = await fetch(
        `https://codeload.github.com/${repo}/zip/refs/heads/${branch}`,
        { headers }
      );
      if (!res.ok) throw new Error(`Download failed (${res.status})`);

      const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
      const entries = zip.getEntries();
      const root = entries[0].entryName.split("/")[0] + "/";

      const updated = [];
      const added = [];
      let indexChanged = false;

      for (const entry of entries) {
        if (entry.isDirectory) continue;

        const rel = entry.entryName.slice(root.length);
        if (rel.includes("..")) continue;

        const target = mapTarget(rel);
        if (!target) continue;

        const data = entry.getData();
        const exists = fs.existsSync(target);

        if (exists && Buffer.compare(fs.readFileSync(target), data) === 0) continue;

        fs.mkdirSync(path.dirname(target), { recursive: true });

        // atomic write: අඩක් ලියවෙලා file කැඩෙන්න බෑ
        const tmp = target + ".tmp";
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, target);

        (exists ? updated : added).push(rel);
        if (rel === "index.js") indexChanged = true;
      }

      if (!updated.length && !added.length) {
        return reply("✅ Already up to date.");
      }

      let note = "";
      if (typeof globalThis.reloadPlugins === "function") {
        await globalThis.reloadPlugins();
        note = "\n🔄 Plugins reloaded (restart ඕන නෑ).";
      } else {
        note = "\n⚠️ Restart එකක් ඕන.";
      }

      if (indexChanged) {
        note += "\n⚠️ index.js update වුණා — .restart / panel restart එකක් ඕන.";
      }

      await reply(
        `╭━━〔 ⬆️ UPDATE DONE 〕━━╮\n\n` +
        `🆕 Added: ${added.length}\n` +
        `♻️ Updated: ${updated.length}\n\n` +
        [...added, ...updated].map(f => `• ${f}`).join("\n") +
        `\n${note}\n\n🔐 Session untouched\n╰━━━━━━━━━━━━━━━━━━━━╯`
      );
    } catch (error) {
      console.error("Update error:", error);
      await reply(`❌ Update failed\n\n${error?.message || error}`);
    }
  }
};

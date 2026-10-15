// ===================== plugins/video.js =====================
import yts from "yt-search";
import ytdl from "@distube/ytdl-core";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const QUALITIES = [144, 240, 360, 480, 720, 1080];
const DEFAULT_QUALITY = 360;
const MAX_SECONDS = 20 * 60;
const MAX_BYTES = 90 * 1024 * 1024;

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n < 1000) return String(n);
  const s = ["", "k", "M", "B", "T"];
  const i = Math.min(Math.floor((String(n).length - 1) / 3), 4);
  return (n / Math.pow(1000, i)).toFixed(1).replace(/\.0$/, "") + s[i];
}

function download(info, format, file) {
  return new Promise((resolve, reject) => {
    const stream = ytdl.downloadFromInfo(info, { format });
    const out = fs.createWriteStream(file);
    stream.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    stream.pipe(out);
  });
}

function merge(videoFile, audioFile, outFile) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      "-y", "-i", videoFile, "-i", audioFile,
      "-c:v", "copy", "-c:a", "aac",
      "-movflags", "+faststart", outFile
    ]);
    let err = "";
    ff.stderr.on("data", d => (err += d));
    ff.on("error", reject);
    ff.on("close", code =>
      code === 0 ? resolve() : reject(new Error("ffmpeg merge failed: " + err.slice(-200)))
    );
  });
}

const size = f => Number(f?.contentLength) || 0;

export default {
  command: "video",

  async execute(sock, msg, args) {
    const chat = msg.key.remoteJid;
    const list = [...args];

    let quality = DEFAULT_QUALITY;
    const last = list[list.length - 1];
    const m = last && String(last).match(/^(\d{3,4})p?$/i);
    if (m && QUALITIES.includes(Number(m[1]))) {
      quality = Number(m[1]);
      list.pop();
    }

    const text = list.join(" ").trim();

    if (!text) {
      return sock.sendMessage(
        chat,
        {
          text:
            "✳️ වීඩියෝ නමක් හෝ link එකක් දෙන්න.\n\n" +
            "Example:\n.video alone marshmello 720\n\n" +
            "📺 Qualities: " + QUALITIES.map(q => q + "p").join(", ")
        },
        { quoted: msg }
      );
    }

    const stamp = Date.now();
    const files = [];
    const tmp = name => {
      const f = path.join(os.tmpdir(), `yt_${stamp}_${name}`);
      files.push(f);
      return f;
    };

    try {
      let video;
      if (ytdl.validateURL(text)) {
        video = await yts({ videoId: ytdl.getURLVideoID(text) });
      } else {
        const res = await yts(text);
        video = res.videos?.[0];
      }

      if (!video) {
        return sock.sendMessage(chat, { text: "❌ Result එකක් හම්බුණේ නෑ." }, { quoted: msg });
      }

      const seconds = video.seconds || video.duration?.seconds || 0;
      if (seconds > MAX_SECONDS) {
        return sock.sendMessage(
          chat,
          { text: `⚠️ වීඩියෝ එක ගොඩක් දිගයි (${video.timestamp}). මිනිත්තු ${MAX_SECONDS / 60} ට අඩු එකක් තෝරන්න.` },
          { quoted: msg }
        );
      }

      const info = await ytdl.getInfo(video.url);

      const audio = info.formats
        .filter(f => f.hasAudio && !f.hasVideo && f.container === "mp4")
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];

      const videoOnly = info.formats.filter(
        f => f.hasVideo && !f.hasAudio && f.container === "mp4" && /avc1/i.test(f.codecs || "")
      );

      const combined = info.formats.filter(
        f => f.hasVideo && f.hasAudio && f.container === "mp4"
      );

      const candidates = QUALITIES.filter(q => q <= quality).reverse();
      let chosen = null;

      for (const q of candidates) {
        const v = videoOnly.find(f => f.height === q);
        if (v && audio && size(v) + size(audio) <= MAX_BYTES) {
          chosen = { type: "merge", video: v, height: q };
          break;
        }
        const c = combined.find(f => f.height === q);
        if (c && (!size(c) || size(c) <= MAX_BYTES)) {
          chosen = { type: "single", video: c, height: q };
          break;
        }
      }

      if (!chosen) {
        throw new Error("ඒ quality එකට සුදුසු format එකක් නෑ, නැත්නම් file එක ලොකු වැඩියි. අඩු quality එකක් try කරන්න.");
      }

      const note =
        chosen.height !== quality
          ? `\n⚠️ ${quality}p නැති නිසා ${chosen.height}p යවනවා.`
          : "";

      const caption =
        `📺 *${video.title}*\n` +
        `👤 ${video.author?.name || "Unknown"}\n` +
        `⏰ ${video.timestamp || seconds + "s"}\n` +
        `👀 ${formatNumber(video.views)} views\n` +
        `⌚ ${video.ago || ""}\n` +
        `🎞️ Quality: ${chosen.height}p${note}\n` +
        `🔗 ${video.url}\n\n` +
        `⏳ Download වෙනවා...`;

      try {
        await sock.sendMessage(
          chat,
          { image: { url: video.thumbnail || video.image }, caption },
          { quoted: msg }
        );
      } catch {
        await sock.sendMessage(chat, { text: caption }, { quoted: msg });
      }

      let finalFile;

      if (chosen.type === "single") {
        finalFile = tmp("final.mp4");
        await download(info, chosen.video, finalFile);
      } else {
        const vFile = tmp("v.mp4");
        const aFile = tmp("a.m4a");
        finalFile = tmp("final.mp4");

        await Promise.all([
          download(info, chosen.video, vFile),
          download(info, audio, aFile)
        ]);

        await merge(vFile, aFile, finalFile);
      }

      if (fs.statSync(finalFile).size > MAX_BYTES) {
        throw new Error("File size ගොඩක් විශාලයි. අඩු quality එකක් try කරන්න.");
      }

      await sock.sendMessage(
        chat,
        {
          video: { url: finalFile },
          mimetype: "video/mp4",
          caption: `🎬 ${video.title} (${chosen.height}p)`
        },
        { quoted: msg }
      );
    } catch (error) {
      console.error("❌ video error:", error?.stack || error?.message || error);

      await sock.sendMessage(
        chat,
        { text: `❌ Video එක ගන්න බැරි වුණා.\n\n${error?.message || error}` },
        { quoted: msg }
      );
    } finally {
      for (const f of files) fs.unlink(f, () => {});
    }
  }
};


// ===================== plugins/song.js =====================
import yts from "yt-search";
import ytdl from "@distube/ytdl-core";
import fs from "fs";
import os from "os";
import path from "path";

const MAX_SECONDS = 30 * 60;
const MAX_BYTES = 90 * 1024 * 1024;

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n < 1000) return String(n);
  const s = ["", "k", "M", "B", "T"];
  const i = Math.min(Math.floor((String(n).length - 1) / 3), 4);
  return (n / Math.pow(1000, i)).toFixed(1).replace(/\.0$/, "") + s[i];
}

export default {
  command: ["song", "audio"],

  async execute(sock, msg, args) {
    const chat = msg.key.remoteJid;
    const text = args.join(" ").trim();

    if (!text) {
      return sock.sendMessage(
        chat,
        { text: "✳️ ගීතයේ නමක් හෝ link එකක් දෙන්න.\n\nExample: .song alone marshmello" },
        { quoted: msg }
      );
    }

    const file = path.join(os.tmpdir(), `yt_${Date.now()}.m4a`);

    try {
      let video;
      if (ytdl.validateURL(text)) {
        video = await yts({ videoId: ytdl.getURLVideoID(text) });
      } else {
        const res = await yts(text);
        video = res.videos?.[0];
      }

      if (!video) {
        return sock.sendMessage(chat, { text: "❌ Result එකක් හම්බුණේ නෑ." }, { quoted: msg });
      }

      const seconds = video.seconds || video.duration?.seconds || 0;
      if (seconds > MAX_SECONDS) {
        return sock.sendMessage(
          chat,
          { text: `⚠️ වීඩියෝ එක ගොඩක් දිගයි (${video.timestamp}). මිනිත්තු ${MAX_SECONDS / 60} ට අඩු එකක් තෝරන්න.` },
          { quoted: msg }
        );
      }

      const caption =
        `🎵 *${video.title}*\n` +
        `👤 ${video.author?.name || "Unknown"}\n` +
        `⏰ ${video.timestamp || seconds + "s"}\n` +
        `👀 ${formatNumber(video.views)} views\n` +
        `🔗 ${video.url}\n\n` +
        `⏳ Download වෙනවා...`;

      try {
        await sock.sendMessage(
          chat,
          { image: { url: video.thumbnail || video.image }, caption },
          { quoted: msg }
        );
      } catch {
        await sock.sendMessage(chat, { text: caption }, { quoted: msg });
      }

      const info = await ytdl.getInfo(video.url);

      const audio = info.formats
        .filter(f => f.hasAudio && !f.hasVideo && f.container === "mp4")
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];

      if (!audio) {
        throw new Error("Audio format එකක් හම්බුණේ නෑ.");
      }

      await new Promise((resolve, reject) => {
        const stream = ytdl.downloadFromInfo(info, { format: audio });
        const out = fs.createWriteStream(file);
        stream.on("error", reject);
        out.on("error", reject);
        out.on("finish", resolve);
        stream.pipe(out);
      });

      if (fs.statSync(file).size > MAX_BYTES) {
        throw new Error("File size ගොඩක් විශාලයි.");
      }

      await sock.sendMessage(
        chat,
        {
          audio: { url: file },
          mimetype: "audio/mp4",
          fileName: `${video.title}.m4a`
        },
        { quoted: msg }
      );
    } catch (error) {
      console.error("❌ song error:", error?.stack || error?.message || error);

      await sock.sendMessage(
        chat,
        { text: `❌ Audio එක ගන්න බැරි වුණා.\n\n${error?.message || error}` },
        { quoted: msg }
      );
    } finally {
      fs.unlink(file, () => {});
    }
  }
};
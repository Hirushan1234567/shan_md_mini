import express from "express";
import pino from "pino";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestWaWebVersion
} from "@whiskeysockets/baileys";

const app = express();
app.use(express.json({ limit: "10kb" }));

const PORT = Number(process.env.API_PORT || 2618);
const API_KEY = process.env.API_KEY;
const SESSION_DIR = path.resolve("./user-sessions");

fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessions = new Map();
const requests = new Map();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",
    process.env.WEBSITE_ORIGIN || "https://hirushan1234567.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/", (_req, res) => {
  res.json({
    name: "SHAN MINI BOT V1",
    status: "online",
    mode: "multi-session"
  });
});

app.post("/api/pair", async (req, res) => {
  try {
    if (!API_KEY || req.get("x-api-key") !== API_KEY) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    let phone = String(req.body.phone || "").replace(/\D/g, "");

    if (!/^\d{8,15}$/.test(phone)) {
      return res.status(400).json({
        error: "Invalid phone number. Use country code without +."
      });
    }

    if (requests.has(phone)) {
      return res.status(429).json({
        error: "A pairing request is already active for this number."
      });
    }

    requests.set(phone, Date.now());

    const userId = crypto
      .createHash("sha256")
      .update(phone)
      .digest("hex")
      .slice(0, 24);

    const userDir = path.join(SESSION_DIR, userId);

    fs.mkdirSync(userDir, { recursive: true });

    const { state, saveCreds } =
      await useMultiFileAuthState(userDir);

    if (state.creds.registered) {
      requests.delete(phone);
      return res.status(409).json({
        error: "This session is already registered."
      });
    }

    const { version } = await fetchLatestWaWebVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["SHAN MINI BOT", "Chrome", "1.0.0"]
    });

    sessions.set(userId, {
      sock,
      phone,
      userDir,
      saveCreds
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection }) => {
      if (connection === "close") {
        sessions.delete(userId);
        requests.delete(phone);
      }
    });

    const code = await sock.requestPairingCode(phone);

    res.json({
      success: true,
      pairCode: code,
      message: "Enter this code in WhatsApp Linked Devices."
    });
  } catch (error) {
    console.error("Pairing request failed:", error.message);

    res.status(500).json({
      error: "Could not generate pairing code. Try again later."
    });
  } finally {
    // Keep active requests reserved briefly to avoid duplicate sockets.
    setTimeout(() => {
      for (const [phone, started] of requests) {
        if (Date.now() - started > 120000) {
          requests.delete(phone);
        }
      }
    }, 120000).unref();
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SHAN MINI BOT API listening on ${PORT}`);
});
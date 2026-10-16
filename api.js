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

/* =========================================
   SHAN MINI BOT V1 - CONFIGURATION
========================================= */

const PORT = Number(process.env.PORT || process.env.API_PORT || 3000);

const SESSION_DIR = path.resolve(
  process.env.USER_SESSIONS_DIR || "./user-sessions"
);

const API_ENABLED = process.env.API_ENABLED !== "false";

const ALLOW_PUBLIC_PAIR =
  process.env.ALLOW_PUBLIC_PAIR !== "false";

const API_KEY = process.env.API_KEY || "";

const WEBSITE_ORIGIN =
  process.env.WEBSITE_ORIGIN ||
  "https://hirushan1234567.github.io";

const PAIR_TIMEOUT_MS = 120000;

fs.mkdirSync(SESSION_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

/* =========================================
   CORS
========================================= */

app.use((req, res, next) => {
  const allowedOrigins = WEBSITE_ORIGIN
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  const origin = req.headers.origin;

  if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      allowedOrigins.includes("*") ? "*" : (origin || allowedOrigins[0] || "*")
    );
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-api-key"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/* =========================================
   SESSION STORAGE
========================================= */

const sessions = new Map();
const requests = new Map();

function makeUserId(phone) {
  return crypto
    .createHash("sha256")
    .update(phone)
    .digest("hex")
    .slice(0, 24);
}

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/", (_req, res) => {
  res.json({
    name: "SHAN MINI BOT V1",
    status: "online",
    mode: "multi-session"
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "SHAN MINI BOT API",
    timestamp: new Date().toISOString()
  });
});

/* =========================================
   API STATUS
========================================= */

app.get("/api/status", (req, res) => {
  const phone = String(req.query.number || "").replace(/\D/g, "");

  if (phone) {
    const userId = makeUserId(phone);
    const session = sessions.get(userId);

    return res.json({
      success: true,
      connected: Boolean(session?.sock?.user),
      active: Boolean(session)
    });
  }

  return res.json({
    success: true,
    status: "online",
    activeSessions: sessions.size,
    activePairRequests: requests.size
  });
});

/* =========================================
   PAIRING API
========================================= */

app.post("/api/pair", async (req, res) => {
  if (!API_ENABLED) {
    return res.status(503).json({
      success: false,
      error: "Pairing API is disabled."
    });
  }

  if (!ALLOW_PUBLIC_PAIR) {
    return res.status(403).json({
      success: false,
      error: "Public pairing is disabled."
    });
  }

  if (API_KEY && req.get("x-api-key") !== API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized."
    });
  }

  // Accept both "phone" and "number" from the website.
  const rawPhone = req.body?.phone ?? req.body?.number ?? "";

  const phone = String(rawPhone).replace(/\D/g, "");

  if (!/^\d{8,15}$/.test(phone)) {
    return res.status(400).json({
      success: false,
      error: "Invalid phone number. Include your country code without +."
    });
  }

  if (requests.has(phone)) {
    return res.status(429).json({
      success: false,
      error: "A pairing request is already active. Please wait."
    });
  }

  const userId = makeUserId(phone);
  const userDir = path.join(SESSION_DIR, userId);

  let sock;
  let requestReserved = false;

  try {
    requests.set(phone, Date.now());
    requestReserved = true;

    fs.mkdirSync(userDir, { recursive: true });

    const { state, saveCreds } =
      await useMultiFileAuthState(userDir);

    if (state.creds.registered) {
      return res.status(409).json({
        success: false,
        error: "This WhatsApp account already has a saved session. Use the existing session."
      });
    }

    const { version } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
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
      }
    });

    const code = await sock.requestPairingCode(phone);

    return res.json({
      success: true,
      code,
      pairCode: code,
      pairingCode: code,
      number: phone,
      message: "Open WhatsApp > Linked Devices > Link with phone number and enter the code."
    });

  } catch (error) {
    console.error(
      "Pairing request failed:",
      error?.message || error
    );

    if (sock) {
      try {
        sock.end(undefined);
      } catch {}
    }

    sessions.delete(userId);

    return res.status(500).json({
      success: false,
      error: "Could not generate a pairing code. Please try again later."
    });

  } finally {
    if (requestReserved) {
      setTimeout(() => {
        requests.delete(phone);
      }, PAIR_TIMEOUT_MS).unref();
    }
  }
});

/* =========================================
   ERROR HANDLER
========================================= */

app.use((error, _req, res, _next) => {
  console.error("API error:", error?.message || error);

  if (res.headersSent) return;

  res.status(500).json({
    success: false,
    error: "Internal server error."
  });
});

/* =========================================
   START SERVER
========================================= */

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("╭─────────────────────────────╮");
  console.log("│     💙 SHAN MINI BOT V1     │");
  console.log("│      PAIRING API ONLINE     │");
  console.log("╰─────────────────────────────╯");
  console.log(`🌐 Port: ${PORT}`);
  console.log(`📂 Sessions: ${SESSION_DIR}`);
  console.log(`🔗 Website: ${WEBSITE_ORIGIN}`);
});

function shutdown() {
  console.log("Shutting down SHAN MINI BOT API...");

  for (const session of sessions.values()) {
    try {
      session.sock.end(undefined);
    } catch {}
  }

  server.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

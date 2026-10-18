/*
 * Website server: serves the static site/ folder and a tiny accounts API.
 * No dependencies. Only Node built-ins, so the Docker build needs no npm install.
 *
 * Accounts are stored in a JSON file (DATA_DIR/accounts.json), outside site/
 * so the file can never be downloaded by visitors.
 *
 * API (all JSON):
 *   POST  /api/register { email, username, password }  -> 201 { account }  (also signs in)
 *   POST  /api/login    { identifier, password }       -> 200 { account }  (identifier = email or username)
 *   POST  /api/logout                                   -> 200 { ok: true }
 *   GET   /api/me                                       -> 200 { account | null }
 *
 * Environment (all optional):
 *   PORT            default 3000
 *   DATA_DIR        default <project>/data
 *   SESSION_SECRET  default: generated once and kept in DATA_DIR/session.key
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(__dirname, "..");
const SITE_DIR = path.join(ROOT, "site");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SECRET_FILE = path.join(DATA_DIR, "session.key");

const SESSION_DAYS = 7;
const MAX_BODY = 10 * 1024;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Usernames: 3 to 20 letters (any alphabet), digits, dot, underscore or dash. No "@",
// so a username can never be confused with an email when signing in.
const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;

/* ------------------------------------------------------------------ *
 * Storage: one JSON file, written atomically, writes serialized.
 *
 *   { "version": 1, "accounts": [ { id, email, username, passwordHash, createdAt } ] }
 *
 * To store more details later, add fields to the account object where it
 * is created (createAccount) and to publicAccount() if the browser should
 * see them. Old records simply lack the new fields.
 * ------------------------------------------------------------------ */
let db = { version: 1, accounts: [] };
let writeQueue = Promise.resolve();

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(ACCOUNTS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    if (!parsed || !Array.isArray(parsed.accounts)) {
      throw new Error("accounts.json has an unexpected format");
    }
    db = parsed;
    // Older records may lack newer fields: fill in defaults.
    db.accounts.forEach((acc) => {
      if (acc.username === undefined) acc.username = null;
    });
  } else {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(db, null, 2) + "\n");
  }
}

// Atomic write (tmp file + rename). All writes go through one queue.
function writeJson(file, data) {
  const json = JSON.stringify(data, null, 2) + "\n";
  const run = writeQueue.then(async () => {
    const tmp = file + ".tmp";
    await fsp.writeFile(tmp, json);
    await fsp.rename(tmp, file);
  });
  writeQueue = run.catch(() => {});
  return run;
}

function saveDb() { return writeJson(ACCOUNTS_FILE, db); }

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch (e) {
    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(SECRET_FILE, secret + "\n", { mode: 0o600 });
    return secret;
  }
}

/* ------------------------------------------------------------------ *
 * Passwords and sessions
 * ------------------------------------------------------------------ */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return "scrypt$" + salt.toString("hex") + "$" + hash.toString("hex");
}

function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Pre-computed so a login for an unknown email takes as long as a real one.
const DUMMY_HASH = hashPassword("not-a-real-password");

let SECRET = "";

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

function makeSessionToken(accountId) {
  const expires = Date.now() + SESSION_DAYS * 864e5;
  const body = accountId + "." + expires;
  return body + "." + sign(body);
}

function readSession(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const body = parts[0] + "." + parts[1];
  const a = Buffer.from(sign(body));
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return db.accounts.find((acc) => acc.id === parts[0]) || null;
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return;
    try {
      out[decodeURIComponent(pair.slice(0, eq).trim())] = decodeURIComponent(pair.slice(eq + 1).trim());
    } catch (e) { /* ignore malformed cookie */ }
  });
  return out;
}

function sessionCookie(req, value, maxAgeSeconds) {
  const secure = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
  return (
    "session=" + encodeURIComponent(value) +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAgeSeconds +
    (secure ? "; Secure" : "")
  );
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function publicAccount(acc) {
  return {
    id: acc.id,
    email: acc.email,
    username: acc.username,
    createdAt: acc.createdAt,
  };
}

function sendJson(res, status, body, headers) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  }, headers || {}));
  res.end(data);
}

function readJsonBody(req, maxBytes) {
  const limit = maxBytes || MAX_BODY;
  return new Promise((resolve, reject) => {
    const type = (req.headers["content-type"] || "").split(";")[0].trim();
    if (type !== "application/json") return reject({ status: 415, error: "unsupported_media_type" });
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject({ status: 413, error: "too_large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        resolve(parsed);
      } catch (e) {
        reject({ status: 400, error: "bad_json" });
      }
    });
    req.on("error", () => reject({ status: 400, error: "bad_request" }));
  });
}

/* Very small in-memory limiter: max attempts per IP per window. */
const attempts = new Map();
function tooManyAttempts(req, limit, windowMs) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) {
    attempts.set(ip, { count: 1, reset: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}
setInterval(() => {
  const now = Date.now();
  attempts.forEach((v, k) => { if (v.reset < now) attempts.delete(k); });
}, 60 * 1000).unref();

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cleanUsername(value) {
  return typeof value === "string" ? value.trim().normalize("NFC") : "";
}

function usernameTaken(username, exceptId) {
  const lower = username.toLowerCase();
  return db.accounts.some((a) => a.id !== exceptId && a.username && a.username.toLowerCase() === lower);
}

function saveFailed(res, err) {
  console.error("Could not save accounts:", err);
  return sendJson(res, 500, { error: "server_error" });
}

/* ------------------------------------------------------------------ *
 * API routes
 * ------------------------------------------------------------------ */
async function handleApi(req, res, pathname) {
  try {
    if (pathname === "/api/me" && req.method === "GET") {
      const acc = readSession(req);
      return sendJson(res, 200, { account: acc ? publicAccount(acc) : null });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
    }

    if (pathname === "/api/register" && req.method === "POST") {
      if (tooManyAttempts(req, 10, 15 * 60 * 1000)) return sendJson(res, 429, { error: "too_many_attempts" });
      const body = await readJsonBody(req);
      const email = normalizeEmail(body.email);
      const username = cleanUsername(body.username);
      const password = typeof body.password === "string" ? body.password : "";

      if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return sendJson(res, 400, { error: "invalid_email" });
      if (!USERNAME_RE.test(username)) return sendJson(res, 400, { error: "invalid_username" });
      if (password.length < PASSWORD_MIN) return sendJson(res, 400, { error: "password_short" });
      if (password.length > PASSWORD_MAX) return sendJson(res, 400, { error: "password_long" });
      if (db.accounts.some((a) => a.email === email)) return sendJson(res, 409, { error: "email_taken" });
      if (usernameTaken(username)) return sendJson(res, 409, { error: "username_taken" });

      const account = {
        id: crypto.randomUUID(),
        email: email,
        username: username,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      db.accounts.push(account);
      try {
        await saveDb();
      } catch (e) {
        db.accounts.pop();
        return saveFailed(res, e);
      }
      return sendJson(res, 201, { account: publicAccount(account) }, {
        "Set-Cookie": sessionCookie(req, makeSessionToken(account.id), SESSION_DAYS * 86400),
      });
    }

    if (pathname === "/api/login" && req.method === "POST") {
      if (tooManyAttempts(req, 20, 15 * 60 * 1000)) return sendJson(res, 429, { error: "too_many_attempts" });
      const body = await readJsonBody(req);
      const rawId = typeof body.identifier === "string" ? body.identifier : body.email;
      const identifier = typeof rawId === "string" ? rawId.trim().normalize("NFC").toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password.slice(0, PASSWORD_MAX) : "";
      const account = identifier.includes("@")
        ? db.accounts.find((a) => a.email === identifier)
        : db.accounts.find((a) => a.username && a.username.toLowerCase() === identifier);
      const ok = verifyPassword(password, account ? account.passwordHash : DUMMY_HASH) && !!account;
      if (!ok) return sendJson(res, 401, { error: "invalid_credentials" });
      return sendJson(res, 200, { account: publicAccount(account) }, {
        "Set-Cookie": sessionCookie(req, makeSessionToken(account.id), SESSION_DAYS * 86400),
      });
    }

    if (pathname.startsWith("/api/")) {
      const known = ["/api/me", "/api/logout", "/api/register", "/api/login"];
      return sendJson(res, known.includes(pathname) ? 405 : 404, { error: known.includes(pathname) ? "method_not_allowed" : "not_found" });
    }
  } catch (err) {
    if (err && err.status) return sendJson(res, err.status, { error: err.error });
    console.error(err);
    return sendJson(res, 500, { error: "server_error" });
  }
}

/* ------------------------------------------------------------------ *
 * Static files
 * ------------------------------------------------------------------ */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (rel.includes("\0")) {
    res.writeHead(400);
    return res.end("Bad request");
  }
  let file = path.join(SITE_DIR, rel);
  if (file !== SITE_DIR && !file.startsWith(SITE_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    let stat = await fsp.stat(file);
    if (stat.isDirectory()) {
      file = path.join(file, "index.html");
      stat = await fsp.stat(file);
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */
loadDb();
SECRET = loadSecret();

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch (e) {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log("Site running on port " + PORT + ", data folder: " + DATA_DIR);
});

function shutdown() {
  server.close(() => writeQueue.then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

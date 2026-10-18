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
 *   PATCH /api/profile  { username?, firstName?, lastName?, phone?, address? } -> 200 { account }  (must be signed in)
 *
 *   POST  /api/orders              { cake, fulfilment, date, slot, contact, payment } -> 201 { order }
 *                                  (guests may order too; signed-in orders are linked to the account)
 *   GET   /api/orders              -> 200 { orders }      (signed in: your own orders)
 *   POST  /api/orders/:id/cancel   -> 200 { order }       (signed in, until the day before the date)
 *   GET   /api/orders/:id/image    -> the inspiration picture (signed in, own orders only)
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
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const Cake = require(path.join(SITE_DIR, "js", "cake-catalog.js"));

const SESSION_DAYS = 7;
const MAX_BODY = 10 * 1024;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Usernames: 3 to 20 letters (any alphabet), digits, dot, underscore or dash. No "@",
// so a username can never be confused with an email when signing in.
const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;
// First/last name: optional, up to 50 characters, letters plus space . ' -
const NAME_MAX = 50;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'\u2019-]*$/u;
// Phone: digits with optional +, spaces, dashes, slashes, brackets; 6 to 15 digits.
const PHONE_RE = /^\+?[0-9 ()\/-]{6,24}$/;
const ADDRESS_MIN = 5;
const ADDRESS_MAX = 150;
const ORDER_MAX_BODY = 2.5 * 1024 * 1024; // the inspiration picture travels as base64
const IMAGE_MAX = 1.5 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * Storage: one JSON file, written atomically, writes serialized.
 *
 *   { "version": 1, "accounts": [ { id, email, username, firstName, lastName,
 *                                    passwordHash, createdAt } ] }
 *
 * To store more details later, add fields to the account object where it
 * is created (createAccount) and to publicAccount() if the browser should
 * see them. Old records simply lack the new fields.
 * ------------------------------------------------------------------ */
let db = { version: 1, accounts: [] };
let ordersDb = { version: 1, orders: [] };
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
      if (acc.firstName === undefined) acc.firstName = "";
      if (acc.lastName === undefined) acc.lastName = "";
      if (acc.phone === undefined) acc.phone = "";
      if (acc.address === undefined) acc.address = "";
    });
  } else {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(db, null, 2) + "\n");
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (fs.existsSync(ORDERS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
    if (!parsed || !Array.isArray(parsed.orders)) throw new Error("orders.json has an unexpected format");
    ordersDb = parsed;
    if (ordersDb.orders.map(upgradeOrder).some(Boolean)) {
      fs.writeFileSync(ORDERS_FILE, JSON.stringify(ordersDb, null, 2) + "\n");
    }
  } else {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(ordersDb, null, 2) + "\n");
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
function saveOrders() { return writeJson(ORDERS_FILE, ordersDb); }

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
    firstName: acc.firstName,
    lastName: acc.lastName,
    phone: acc.phone || "",
    address: acc.address || "",
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

// Returns the cleaned name, or null when the value is not acceptable. "" is allowed.
function cleanName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").normalize("NFC");
  if (name === "") return "";
  return name.length <= NAME_MAX && NAME_RE.test(name) ? name : null;
}

function cleanPhone(value, allowEmpty) {
  if (typeof value !== "string") return null;
  const phone = value.trim().replace(/\s+/g, " ");
  if (phone === "") return allowEmpty ? "" : null;
  const digits = phone.replace(/\D/g, "").length;
  return PHONE_RE.test(phone) && digits >= 6 && digits <= 15 ? phone : null;
}

function cleanAddress(value, allowEmpty) {
  if (typeof value !== "string") return null;
  const address = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").normalize("NFC");
  if (address === "") return allowEmpty ? "" : null;
  return address.length >= ADDRESS_MIN && address.length <= ADDRESS_MAX ? address : null;
}

function cleanText(value, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().normalize("NFC");
  return text.length <= max ? text : null;
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
        firstName: "",
        lastName: "",
        phone: "",
        address: "",
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

    if (pathname === "/api/profile" && req.method === "PATCH") {
      const account = readSession(req);
      if (!account) return sendJson(res, 401, { error: "unauthorized" });
      const body = await readJsonBody(req);
      const next = {
        username: account.username, firstName: account.firstName, lastName: account.lastName,
        phone: account.phone || "", address: account.address || "",
      };

      if ("username" in body) {
        const username = cleanUsername(body.username);
        if (!USERNAME_RE.test(username)) return sendJson(res, 400, { error: "invalid_username" });
        if (usernameTaken(username, account.id)) return sendJson(res, 409, { error: "username_taken" });
        next.username = username;
      }
      ["firstName", "lastName"].forEach((field) => {
        if (field in body) next[field] = cleanName(body[field]);
      });
      if (next.firstName === null || next.lastName === null) return sendJson(res, 400, { error: "invalid_name" });
      if ("phone" in body) {
        next.phone = cleanPhone(body.phone, true);
        if (next.phone === null) return sendJson(res, 400, { error: "invalid_phone" });
      }
      if ("address" in body) {
        next.address = cleanAddress(body.address, true);
        if (next.address === null) return sendJson(res, 400, { error: "invalid_address" });
      }

      const previous = {
        username: account.username, firstName: account.firstName, lastName: account.lastName,
        phone: account.phone, address: account.address,
      };
      Object.assign(account, next);
      try {
        await saveDb();
      } catch (e) {
        Object.assign(account, previous);
        return saveFailed(res, e);
      }
      return sendJson(res, 200, { account: publicAccount(account) });
    }

    if (pathname === "/api/orders" || pathname.startsWith("/api/orders/")) {
      const handled = await handleOrders(req, res, pathname);
      if (handled !== false) return handled;
    }

    if (pathname.startsWith("/api/")) {
      const known = ["/api/me", "/api/logout", "/api/register", "/api/login", "/api/profile", "/api/orders"];
      return sendJson(res, known.includes(pathname) ? 405 : 404, { error: known.includes(pathname) ? "method_not_allowed" : "not_found" });
    }
  } catch (err) {
    if (err && err.status) return sendJson(res, err.status, { error: err.error });
    console.error(err);
    return sendJson(res, 500, { error: "server_error" });
  }
}

/* ------------------------------------------------------------------ *
 * Orders
 *
 *   orders.json: { "version": 1, "orders": [ {
 *     id, code, accountId (null for guests), createdAt,
 *     cake: { type: "base", base (cake id), shape: "round"|"square"|"rectangle"|"design", size,
 *             message, notes, image (file name or null; only for shape "design") },
 *           (orders from the first versions: type "custom" with tastes: [ids], no shape),
 *     allergens: [ids]  (saved with the order, so a later menu change does not alter it),
 *     fulfilment: "delivery" | "pickup", date: "YYYY-MM-DD", slot: "14-16",
 *     contact: { name, email, phone, address },
 *     payment: "online" | "card" | "cash", paid: bool,
 *     price: { cake, delivery, total }, cancelledAt: null | ISO } ] }
 *
 * The site shows only the order details (no progress states). The one rule kept: an order can be
 * cancelled online until the day before its date (canCancel), after that the customer calls.
 * Pictures are saved as DATA_DIR/uploads/<order id>.<ext>, never inside site/.
 * ------------------------------------------------------------------ */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const IMAGE_TYPES = {
  "image/jpeg": { ext: ".jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: ".png", magic: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { ext: ".webp", magic: (b) => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP" },
};

function newOrderCode() {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    let code = "CK-";
    for (let i = 0; i < 6; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    if (!ordersDb.orders.some((o) => o.code === code)) return code;
  }
}

// An order can be cancelled online until the day before its date; after that, the customer calls.
function canCancel(order) {
  return !order.cancelledAt && Cake.today() < Cake.addDays(order.date, -1);
}

function publicOrder(order) {
  return {
    id: order.id,
    code: order.code,
    createdAt: order.createdAt,
    cake: {
      type: order.cake.type,
      base: order.cake.base,
      shape: order.cake.shape || (order.cake.type === "custom" ? null : "round"),
      size: order.cake.size,
      tastes: order.cake.tastes,
      message: order.cake.message,
      notes: order.cake.notes,
    },
    allergens: order.allergens,
    imageUrl: order.cake.image ? "/api/orders/" + order.id + "/image" : null,
    fulfilment: order.fulfilment,
    date: order.date,
    slot: order.slot,
    contact: order.contact,
    payment: order.payment,
    paid: order.paid,
    price: order.price,
    cancelled: !!order.cancelledAt,
    canCancel: canCancel(order),
    linked: !!order.accountId,
  };
}

// Orders saved by the first version had layers + frosting + complexity. Turn them into the
// simple shape once when the file is loaded: the layers' tastes become the custom tastes.
function upgradeOrder(order) {
  const c = order.cake;
  if (c.type) return false;
  const tastes = Array.from(new Set(c.layers || []));
  order.cake = {
    type: "custom", base: null, size: c.size, tastes: tastes,
    message: c.message || "", notes: c.notes || "", image: c.image || null,
  };
  order.allergens = Cake.allergensOf({ type: "custom", tastes: tastes });
  delete order.complexity;
  return true;
}

// "data:image/jpeg;base64,...." -> { type, buffer } or an error code
function decodeImage(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return { error: "invalid_image" };
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) return { error: "invalid_image" };
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > IMAGE_MAX) return { error: "image_large" };
  const type = IMAGE_TYPES[m[1]];
  if (buffer.length < 12 || !type.magic(buffer)) return { error: "invalid_image" };
  return { type: m[1], ext: type.ext, buffer: buffer };
}

function accountDisplayName(acc) {
  return [acc.firstName, acc.lastName].filter(Boolean).join(" ") || acc.username || "";
}

async function createOrder(req, res) {
  if (tooManyAttempts(req, 30, 60 * 60 * 1000)) return sendJson(res, 429, { error: "too_many_attempts" });
  const account = readSession(req);
  const body = await readJsonBody(req, ORDER_MAX_BODY);
  const bad = (code, extra) => sendJson(res, 400, Object.assign({ error: code }, extra || {}));

  /* the cake: one of our cakes, in a shape ("design" = your own design, with a picture) and a size */
  const c = body.cake && typeof body.cake === "object" ? body.cake : {};
  const has = (obj, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
  if (!has(Cake.sizes, c.size)) return bad("invalid_size");
  if (c.type !== "base" || !has(Cake.cakes, c.base)) return bad("invalid_cake");
  if (!Cake.shapes.includes(c.shape)) return bad("invalid_shape");
  const message = cleanText(c.message, Cake.messageMax);
  if (message === null) return bad("message_long");
  const notes = cleanText(c.notes, Cake.notesMax);
  if (notes === null) return bad("notes_long");
  // the inspiration picture belongs to "own design"
  const image = c.shape === "design" ? decodeImage(c.image) : null;
  if (image && image.error) return bad(image.error);

  const cake = { type: "base", base: c.base, shape: c.shape, size: c.size };

  /* when and how: three days of notice, sooner means calling the bakery */
  const fulfilment = body.fulfilment;
  if (fulfilment !== "delivery" && fulfilment !== "pickup") return bad("invalid_fulfilment");
  const today = Cake.today();
  const earliest = Cake.earliest();
  if (!Cake.isDate(body.date) || body.date > Cake.addDays(today, Cake.maxDaysAhead)) return bad("invalid_date");
  if (body.date < earliest) return bad("date_too_soon", { earliest: earliest, leadDays: Cake.leadDays });
  if (!Cake.slots.includes(body.slot)) return bad("invalid_slot");

  /* who: a signed-in account fills in whatever the form leaves empty */
  const k = body.contact && typeof body.contact === "object" ? body.contact : {};
  const pick = (v, fallback) => (typeof v === "string" && v.trim() !== "" ? v : fallback);
  const name = cleanName(pick(k.name, account ? accountDisplayName(account) : ""));
  if (!name || name.length < 2) return bad("invalid_contact_name");
  const email = account ? account.email : normalizeEmail(k.email);
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return bad("invalid_email");
  const phone = cleanPhone(pick(k.phone, account ? account.phone || "" : ""), fulfilment === "pickup");
  if (phone === null) return bad("invalid_phone");
  let address = "";
  if (fulfilment === "delivery") {
    address = cleanAddress(pick(k.address, account ? account.address || "" : ""), false);
    if (address === null) return bad("invalid_address");
  }

  /* payment (a demo: "online" is marked as paid, nothing is charged) */
  if (!["online", "card", "cash"].includes(body.payment)) return bad("invalid_payment");

  const order = {
    id: crypto.randomUUID(),
    code: newOrderCode(),
    accountId: account ? account.id : null,
    createdAt: new Date().toISOString(),
    cake: { type: cake.type, base: cake.base, shape: cake.shape, size: cake.size, message: message, notes: notes, image: null },
    allergens: Cake.allergensOf(cake),
    fulfilment: fulfilment,
    date: body.date,
    slot: body.slot,
    contact: { name: name, email: email, phone: phone, address: address },
    payment: body.payment,
    paid: body.payment === "online",
    price: Cake.price(cake, fulfilment),
    cancelledAt: null,
  };

  if (image) {
    order.cake.image = order.id + image.ext;
    try {
      await fsp.writeFile(path.join(UPLOADS_DIR, order.cake.image), image.buffer);
    } catch (e) {
      return saveFailed(res, e);
    }
  }

  ordersDb.orders.push(order);
  try {
    await saveOrders();
  } catch (e) {
    ordersDb.orders.pop();
    return saveFailed(res, e);
  }

  // "Save these details to my profile": fill in a phone/address the account did not have yet.
  if (account && body.saveDetails === true) {
    let changed = false;
    if (phone && !account.phone) { account.phone = phone; changed = true; }
    if (address && !account.address) { account.address = address; changed = true; }
    if (changed) await saveDb().catch((e) => console.error("Could not save accounts:", e));
  }

  return sendJson(res, 201, { order: publicOrder(order), account: account ? publicAccount(account) : null });
}

async function handleOrders(req, res, pathname) {
  if (pathname === "/api/orders") {
    if (req.method === "POST") return createOrder(req, res);
    if (req.method === "GET") {
      const account = readSession(req);
      if (!account) return sendJson(res, 401, { error: "unauthorized" });
      const mine = ordersDb.orders.filter((o) => o.accountId === account.id).map(publicOrder);
      return sendJson(res, 200, { orders: mine });
    }
    return false;
  }

  const m = /^\/api\/orders\/([0-9a-f-]{36})\/(cancel|image)$/.exec(pathname);
  if (!m) return false;
  const account = readSession(req);
  if (!account) return sendJson(res, 401, { error: "unauthorized" });
  const order = ordersDb.orders.find((o) => o.id === m[1] && o.accountId === account.id);
  if (!order) return sendJson(res, 404, { error: "not_found" });

  if (m[2] === "cancel" && req.method === "POST") {
    if (!canCancel(order)) return sendJson(res, 409, { error: "cannot_cancel" });
    order.cancelledAt = new Date().toISOString();
    try {
      await saveOrders();
    } catch (e) {
      order.cancelledAt = null;
      return saveFailed(res, e);
    }
    return sendJson(res, 200, { order: publicOrder(order) });
  }

  if (m[2] === "image" && req.method === "GET") {
    if (!order.cake.image) return sendJson(res, 404, { error: "not_found" });
    const file = path.join(UPLOADS_DIR, path.basename(order.cake.image));
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(data);
    } catch (e) {
      return sendJson(res, 404, { error: "not_found" });
    }
  }
  return sendJson(res, 405, { error: "method_not_allowed" });
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

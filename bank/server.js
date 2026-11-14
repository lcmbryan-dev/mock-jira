"use strict";
// Mock bank: zero-dependency REST API + static frontend. Data lives in SQLite (built-in node:sqlite).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  console.error(`node:sqlite is not available in Node ${process.version}. Install Node 22.13 or newer (https://nodejs.org) and check with: node -v`);
  process.exit(1);
}

const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "bank.db");
const MAX_FAILED_LOGINS = 5;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    failed INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL REFERENCES users(username),
    type TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    type TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    description TEXT NOT NULL,
    counterparty TEXT,
    balance_after_cents INTEGER NOT NULL,
    date TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id, seq DESC);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES users(username),
    expires INTEGER NOT NULL
  );
`;

const toDollars = (cents) => cents / 100;
const toCents = (dollars) => Math.round(dollars * 100);

function hashPassword(pw, salt = crypto.randomBytes(8).toString("hex")) {
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(":");
  const a = Buffer.from(hash, "hex");
  const b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createApp({ dbPath = DEFAULT_DB_PATH } = {}) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  // Rollback journal (not WAL): no -wal/-shm side files to go stale or lock up when the db is copied, deleted or viewed.
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = DELETE;");
  db.exec(SCHEMA);

  const q = {
    userByName: db.prepare("SELECT * FROM users WHERE username = ?"),
    insertUser: db.prepare("INSERT INTO users (username, full_name, password_hash, locked) VALUES (?, ?, ?, ?)"),
    setFailed: db.prepare("UPDATE users SET failed = ?, locked = ? WHERE username = ?"),
    userCount: db.prepare("SELECT COUNT(*) AS n FROM users"),
    accountById: db.prepare("SELECT * FROM accounts WHERE id = ?"),
    accountsByOwner: db.prepare("SELECT * FROM accounts WHERE owner = ? ORDER BY id"),
    insertAccount: db.prepare("INSERT INTO accounts (id, owner, type, balance_cents) VALUES (?, ?, ?, ?)"),
    setBalance: db.prepare("UPDATE accounts SET balance_cents = ? WHERE id = ?"),
    insertTx: db.prepare(`INSERT INTO transactions (id, account_id, type, amount_cents, description, counterparty, balance_after_cents, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    txCount: db.prepare("SELECT COUNT(*) AS n FROM transactions"),
    txList: db.prepare("SELECT * FROM transactions WHERE account_id = ? AND (? IS NULL OR type = ?) ORDER BY seq DESC LIMIT ?"),
    txTotal: db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND (? IS NULL OR type = ?)"),
    insertSession: db.prepare("INSERT INTO sessions (token, username, expires) VALUES (?, ?, ?)"),
    sessionByToken: db.prepare("SELECT * FROM sessions WHERE token = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  };

  const inTransaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
  };

  const addUser = (username, password, fullName, locked = false) =>
    q.insertUser.run(username, fullName, hashPassword(password), locked ? 1 : 0);
  const addAccount = (id, owner, type, balance) => q.insertAccount.run(id, owner, type, toCents(balance));
  // `acct.balance_cents` must already reflect the post-transaction balance.
  const addTx = (acct, type, amountCents, description, counterparty = null) => {
    const id = `TX-${String(q.txCount.get().n + 1).padStart(5, "0")}`;
    q.insertTx.run(id, acct.id, type, amountCents, description, counterparty, acct.balance_cents, new Date().toISOString());
    return id;
  };
  const txView = (t) => ({
    id: t.id, type: t.type, amount: toDollars(t.amount_cents), description: t.description,
    counterparty: t.counterparty, balanceAfter: toDollars(t.balance_after_cents), date: t.date,
  });

  function seed() {
    inTransaction(() => {
      db.exec("DELETE FROM sessions; DELETE FROM transactions; DELETE FROM accounts; DELETE FROM users;");
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'transactions'");
      addUser("alice", "Password123!", "Alice Tan");
      addUser("bob", "Password123!", "Bob Lim");
      addUser("locked", "Password123!", "Locked User", true);
      addAccount("1001", "alice", "Checking", 2500.0);
      addAccount("1002", "alice", "Savings", 10000.0);
      addAccount("2001", "bob", "Checking", 800.0);
      for (const id of ["1001", "1002", "2001"]) {
        const a = q.accountById.get(id);
        addTx(a, "deposit", a.balance_cents, "Opening balance");
      }
    });
  }
  // Seed only an empty database so data survives restarts.
  if (q.userCount.get().n === 0) seed();

  // ---- helpers ----
  const send = (res, status, body) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(data);
  };
  const fail = (res, status, code, message) => send(res, status, { error: { code, message } });
  const publicAccount = (a) => ({ id: a.id, type: a.type, currency: a.currency, balance: toDollars(a.balance_cents) });

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 1e5) reject(Object.assign(new Error("too large"), { status: 413 })); });
      req.on("end", () => {
        if (!raw) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
      });
    });
  }

  function authenticate(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
    const s = m && q.sessionByToken.get(m[1]);
    if (!s) return null;
    if (s.expires < Date.now()) { q.deleteSession.run(m[1]); return null; }
    const user = q.userByName.get(s.username);
    return { token: m[1], user: { username: user.username, fullName: user.full_name } };
  }

  // ---- routes ----
  const routes = [];
  const route = (method, pattern, handler, { auth = true } = {}) => {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
    routes.push({ method, re, keys, handler, auth });
  };

  route("POST", "/api/auth/login", (req, res, ctx) => {
    const { username, password } = ctx.body;
    if (typeof username !== "string" || typeof password !== "string" || !username || !password)
      return fail(res, 400, "VALIDATION_ERROR", "username and password are required");
    const user = q.userByName.get(username.toLowerCase());
    if (user && user.locked) return fail(res, 423, "ACCOUNT_LOCKED", "Account is locked. Contact support.");
    if (!user || !verifyPassword(password, user.password_hash)) {
      if (user) {
        const failed = user.failed + 1;
        q.setFailed.run(failed, failed >= MAX_FAILED_LOGINS ? 1 : 0, user.username);
      }
      return fail(res, 401, "INVALID_CREDENTIALS", "Invalid username or password");
    }
    q.setFailed.run(0, 0, user.username);
    const token = crypto.randomBytes(24).toString("hex");
    q.insertSession.run(token, user.username, Date.now() + TOKEN_TTL_MS);
    send(res, 200, { token, tokenType: "Bearer", expiresIn: TOKEN_TTL_MS / 1000, user: { username: user.username, fullName: user.full_name } });
  }, { auth: false });

  route("POST", "/api/auth/logout", (req, res, ctx) => {
    q.deleteSession.run(ctx.session.token);
    send(res, 204);
  });

  route("GET", "/api/me", (req, res, ctx) => {
    const { username, fullName } = ctx.session.user;
    send(res, 200, { username, fullName });
  });

  route("GET", "/api/accounts", (req, res, ctx) => {
    send(res, 200, { accounts: q.accountsByOwner.all(ctx.session.user.username).map(publicAccount) });
  });

  const ownAccount = (res, ctx, id) => {
    const a = q.accountById.get(id);
    if (!a) { fail(res, 404, "ACCOUNT_NOT_FOUND", "Account not found"); return null; }
    if (a.owner !== ctx.session.user.username) { fail(res, 403, "FORBIDDEN", "You do not own this account"); return null; }
    return a;
  };

  route("GET", "/api/accounts/:id", (req, res, ctx) => {
    const a = ownAccount(res, ctx, ctx.params.id);
    if (a) send(res, 200, publicAccount(a));
  });

  route("GET", "/api/accounts/:id/transactions", (req, res, ctx) => {
    const a = ownAccount(res, ctx, ctx.params.id);
    if (!a) return;
    const limit = Math.min(Math.max(parseInt(ctx.query.get("limit") || "20", 10) || 20, 1), 100);
    const type = ctx.query.get("type") || null;
    send(res, 200, {
      accountId: a.id,
      total: q.txTotal.get(a.id, type, type).n,
      transactions: q.txList.all(a.id, type, type, limit).map(txView),
    });
  });

  route("POST", "/api/transfers", (req, res, ctx) => {
    const { fromAccountId, toAccountId, amount, description = "" } = ctx.body;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100)
      return fail(res, 400, "VALIDATION_ERROR", "amount must be a positive number with at most 2 decimals");
    if (typeof fromAccountId !== "string" || typeof toAccountId !== "string")
      return fail(res, 400, "VALIDATION_ERROR", "fromAccountId and toAccountId are required");
    if (fromAccountId === toAccountId) return fail(res, 400, "VALIDATION_ERROR", "Cannot transfer to the same account");
    if (!ownAccount(res, ctx, fromAccountId)) return;
    if (!q.accountById.get(toAccountId)) return fail(res, 404, "ACCOUNT_NOT_FOUND", "Destination account not found");
    const cents = toCents(amount);
    // Balance check, both updates and both ledger rows commit or roll back together.
    const result = inTransaction(() => {
      const from = { ...q.accountById.get(fromAccountId) };
      const to = { ...q.accountById.get(toAccountId) };
      if (from.balance_cents < cents) return null;
      from.balance_cents -= cents;
      to.balance_cents += cents;
      q.setBalance.run(from.balance_cents, from.id);
      q.setBalance.run(to.balance_cents, to.id);
      const transferId = addTx(from, "transfer_out", cents, description || `Transfer to ${to.id}`, to.id);
      addTx(to, "transfer_in", cents, description || `Transfer from ${from.id}`, from.id);
      return { transferId, fromBalance: toDollars(from.balance_cents) };
    });
    if (!result) return fail(res, 422, "INSUFFICIENT_FUNDS", "Insufficient funds");
    send(res, 201, { transferId: result.transferId, fromAccountId, toAccountId, amount, status: "completed", fromBalance: result.fromBalance });
  });

  // Test-only helper to restore seed data between runs (wipes the database).
  route("POST", "/api/test/reset", (req, res) => { seed(); send(res, 204); }, { auth: false });

  function serveStatic(req, res, pathname) {
    const rel = pathname === "/" ? "/index.html" : pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, "FORBIDDEN", "Forbidden");
    fs.readFile(file, (err, data) => {
      if (err) return fail(res, 404, "NOT_FOUND", "Not found");
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url.pathname);
    try {
      const matches = routes.filter((r) => r.re.test(url.pathname));
      if (!matches.length) return fail(res, 404, "NOT_FOUND", "Route not found");
      const r = matches.find((x) => x.method === req.method);
      if (!r) return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      const ctx = { params: {}, query: url.searchParams, body: {} };
      const m = r.re.exec(url.pathname);
      r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      if (r.auth) {
        ctx.session = authenticate(req);
        if (!ctx.session) return fail(res, 401, "UNAUTHORIZED", "Missing or invalid token");
      }
      if (req.method === "POST") ctx.body = await readJson(req);
      await r.handler(req, res, ctx);
    } catch (e) {
      fail(res, e.status || 500, e.status === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR", e.message);
    }
  });
  server.on("close", () => db.close());
  return server;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`Mock bank running at http://localhost:${port} (db: ${DEFAULT_DB_PATH})`));
}

module.exports = { createApp };

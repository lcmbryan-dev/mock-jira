"use strict";
// Baseline API tests. Runs against an in-process server on a random port,
// or against BASE_URL if set (e.g. BASE_URL=http://localhost:3000 npm test).
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");

let server;
let base = process.env.BASE_URL;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const login = async (username = "alice", password = "Password123!") =>
  (await call("POST", "/api/auth/login", { body: { username, password } }));

before(async () => {
  if (base) return;
  server = createApp({ dbPath: ":memory:" });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server?.close());
beforeEach(() => call("POST", "/api/test/reset"));

test("login: valid credentials return a bearer token", async () => {
  const r = await login();
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^[0-9a-f]{48}$/);
  assert.equal(r.body.tokenType, "Bearer");
  assert.equal(r.body.user.username, "alice");
});

test("login: wrong password -> 401 INVALID_CREDENTIALS", async () => {
  const r = await login("alice", "nope");
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "INVALID_CREDENTIALS");
});

test("login: missing fields -> 400 VALIDATION_ERROR", async () => {
  const r = await call("POST", "/api/auth/login", { body: { username: "alice" } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
});

test("login: locked account -> 423", async () => {
  const r = await login("locked");
  assert.equal(r.status, 423);
  assert.equal(r.body.error.code, "ACCOUNT_LOCKED");
});

test("login: 5 bad attempts lock the account, even for the right password", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login("bob", "bad")).status, 401);
  assert.equal((await login("bob")).status, 423);
});

test("protected routes reject missing / bad tokens", async () => {
  assert.equal((await call("GET", "/api/accounts")).status, 401);
  assert.equal((await call("GET", "/api/accounts", { token: "bogus" })).status, 401);
});

test("logout invalidates the token", async () => {
  const { body: { token } } = await login();
  assert.equal((await call("POST", "/api/auth/logout", { token })).status, 204);
  assert.equal((await call("GET", "/api/me", { token })).status, 401);
});

test("accounts: lists only the caller's accounts", async () => {
  const { body: { token } } = await login();
  const r = await call("GET", "/api/accounts", { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.accounts.map((a) => a.id).sort(), ["1001", "1002"]);
});

test("accounts: cannot read another user's account (403) or a missing one (404)", async () => {
  const { body: { token } } = await login();
  assert.equal((await call("GET", "/api/accounts/2001", { token })).status, 403);
  assert.equal((await call("GET", "/api/accounts/9999", { token })).status, 404);
});

test("transfer: moves money and records both transactions", async () => {
  const { body: { token } } = await login();
  const r = await call("POST", "/api/transfers", { token, body: { fromAccountId: "1001", toAccountId: "2001", amount: 100.5, description: "Lunch" } });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "completed");
  assert.equal(r.body.fromBalance, 2399.5);

  const from = await call("GET", "/api/accounts/1001/transactions?type=transfer_out", { token });
  assert.equal(from.body.transactions[0].amount, 100.5);
  assert.equal(from.body.transactions[0].description, "Lunch");

  const bob = await login("bob");
  const to = await call("GET", "/api/accounts/2001", { token: bob.body.token });
  assert.equal(to.body.balance, 900.5);
});

test("transfer: insufficient funds -> 422 and balances untouched", async () => {
  const { body: { token } } = await login();
  const r = await call("POST", "/api/transfers", { token, body: { fromAccountId: "1001", toAccountId: "1002", amount: 999999 } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "INSUFFICIENT_FUNDS");
  assert.equal((await call("GET", "/api/accounts/1001", { token })).body.balance, 2500);
});

test("transfer: validation and ownership rules", async () => {
  const { body: { token } } = await login();
  const t = (body) => call("POST", "/api/transfers", { token, body });
  assert.equal((await t({ fromAccountId: "1001", toAccountId: "1002", amount: -5 })).status, 400);
  assert.equal((await t({ fromAccountId: "1001", toAccountId: "1002", amount: 1.005 })).status, 400);
  assert.equal((await t({ fromAccountId: "1001", toAccountId: "1001", amount: 5 })).status, 400);
  assert.equal((await t({ fromAccountId: "2001", toAccountId: "1001", amount: 5 })).status, 403);
  assert.equal((await t({ fromAccountId: "1001", toAccountId: "9999", amount: 5 })).status, 404);
});

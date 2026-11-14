"use strict";
// Generated from sample.har by tools/har-to-test.js — review the assertions before committing.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");

let server;
let base = process.env.BASE_URL;
let token; // set by the login step

async function call(method, path, { auth = true, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
// Checks that every key in `expected` exists in `actual` with the same type.
function assertShape(actual, expected, where = "body") {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where} should be an array`);
    if (expected.length && actual.length) assertShape(actual[0], expected[0], `${where}[0]`);
  } else if (expected && typeof expected === "object") {
    assert.equal(typeof actual, "object", `${where} should be an object`);
    for (const [k, v] of Object.entries(expected)) { assert.ok(k in actual, `${where}.${k} missing`); assertShape(actual[k], v, `${where}.${k}`); }
  } else {
    assert.equal(actual === null ? "null" : typeof actual, expected, `${where} type`);
  }
}

before(async () => {
  if (base) return;
  server = createApp({ dbPath: ":memory:" });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  await call("POST", "/api/test/reset", { auth: false });
});
after(() => server?.close());

// Steps share state (token), so run them in order.
test("01 POST /api/auth/login -> 200", async () => {
  const r = await call("POST", "/api/auth/login", { auth: false, body: {"username":"alice","password":"Password123!"} });
  assert.equal(r.status, 200);
  assertShape(r.body, {"token":"string","tokenType":"string","expiresIn":"number","user":{"username":"string","fullName":"string"}});
  token = r.body.token; // reused as the Bearer token by later steps
});

test("02 GET /api/me -> 200", async () => {
  const r = await call("GET", "/api/me");
  assert.equal(r.status, 200);
  assertShape(r.body, {"username":"string","fullName":"string"});
});

test("03 GET /api/accounts -> 200", async () => {
  const r = await call("GET", "/api/accounts");
  assert.equal(r.status, 200);
  assertShape(r.body, {"accounts":[{"id":"string","type":"string","currency":"string","balance":"number"}]});
});

test("04 GET /api/accounts/1001/transactions -> 200", async () => {
  const r = await call("GET", "/api/accounts/1001/transactions?limit=10");
  assert.equal(r.status, 200);
  assertShape(r.body, {"accountId":"string","total":"number","transactions":[{"id":"string","type":"string","amount":"number","description":"string","counterparty":"null","balanceAfter":"number","date":"string"}]});
});

test("05 POST /api/transfers -> 201", async () => {
  const r = await call("POST", "/api/transfers", { body: {"fromAccountId":"1001","toAccountId":"1002","amount":25,"description":"Rent"} });
  assert.equal(r.status, 201);
  assertShape(r.body, {"transferId":"string","fromAccountId":"string","toAccountId":"string","amount":"number","status":"string","fromBalance":"number"});
});

test("06 POST /api/transfers -> 400", async () => {
  const r = await call("POST", "/api/transfers", { body: {"fromAccountId":"1001","toAccountId":"1002","amount":-1} });
  assert.equal(r.status, 400);
  assertShape(r.body, {"error":{"code":"string","message":"string"}});
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
});

test("07 POST /api/auth/logout -> 204", async () => {
  const r = await call("POST", "/api/auth/logout");
  assert.equal(r.status, 204);
});

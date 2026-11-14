#!/usr/bin/env node
"use strict";
// Turn a browser HAR capture into a runnable API test file (node:test + fetch).
//
//   node tools/har-to-test.js captures/session.har [out.test.js] [--host=localhost:3000]
//
// - keeps only XHR/fetch calls to /api/ on the chosen host
// - the login response token is captured into a variable and reused as the Bearer header
// - asserts the recorded status code and the *shape* (keys + types) of each JSON response
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flag = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
const [harFile, outArg] = args.filter((a) => !a.startsWith("--"));
if (!harFile) { console.error("usage: har-to-test.js <file.har> [out.test.js] [--host=localhost:3000]"); process.exit(1); }

const har = JSON.parse(fs.readFileSync(harFile, "utf8"));
const entries = har.log.entries
  .filter((e) => {
    const u = new URL(e.request.url);
    return u.pathname.startsWith("/api/") && (!flag("host") || u.host === flag("host")) && e.request.method !== "OPTIONS";
  })
  .sort((a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime));

function shape(v) {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return v === null ? "null" : typeof v;
}
const header = (list, name) => (list.find((h) => h.name.toLowerCase() === name) || {}).value;
const parseJson = (s) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };

let tokenSeen = false;
const lines = [];
const out = (s = "") => lines.push(s);

out(`"use strict";`);
out(`// Generated from ${path.basename(harFile)} by tools/har-to-test.js — review the assertions before committing.`);
out(`const { test, before, after } = require("node:test");`);
out(`const assert = require("node:assert/strict");`);
out(`const { createApp } = require("../server");`);
out();
out(`let server;`);
out(`let base = process.env.BASE_URL;`);
out(`let token; // set by the login step`);
out();
out(`async function call(method, path, { auth = true, body } = {}) {`);
out(`  const res = await fetch(base + path, {`);
out(`    method,`);
out(`    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(auth && token ? { Authorization: \`Bearer \${token}\` } : {}) },`);
out(`    body: body ? JSON.stringify(body) : undefined,`);
out(`  });`);
out(`  const text = await res.text();`);
out(`  return { status: res.status, body: text ? JSON.parse(text) : null };`);
out(`}`);
out(`// Checks that every key in \`expected\` exists in \`actual\` with the same type.`);
out(`function assertShape(actual, expected, where = "body") {`);
out(`  if (Array.isArray(expected)) {`);
out(`    assert.ok(Array.isArray(actual), \`\${where} should be an array\`);`);
out(`    if (expected.length && actual.length) assertShape(actual[0], expected[0], \`\${where}[0]\`);`);
out(`  } else if (expected && typeof expected === "object") {`);
out(`    assert.equal(typeof actual, "object", \`\${where} should be an object\`);`);
out(`    for (const [k, v] of Object.entries(expected)) { assert.ok(k in actual, \`\${where}.\${k} missing\`); assertShape(actual[k], v, \`\${where}.\${k}\`); }`);
out(`  } else {`);
out(`    assert.equal(actual === null ? "null" : typeof actual, expected, \`\${where} type\`);`);
out(`  }`);
out(`}`);
out();
out(`before(async () => {`);
out(`  if (base) return;`);
out(`  server = createApp({ dbPath: ":memory:" });`);
out(`  await new Promise((r) => server.listen(0, r));`);
out(`  base = \`http://localhost:\${server.address().port}\`;`);
out(`  await call("POST", "/api/test/reset", { auth: false });`);
out(`});`);
out(`after(() => server?.close());`);
out();
out(`// Steps share state (token), so run them in order.`);

entries.forEach((e, i) => {
  const req = e.request;
  const u = new URL(req.url);
  const pathAndQuery = u.pathname + u.search;
  const reqBody = parseJson(req.postData && req.postData.text);
  const resText = e.response.content && e.response.content.text;
  const resBody = parseJson(e.response.content && e.response.content.encoding === "base64" ? Buffer.from(resText, "base64").toString() : resText);
  const status = e.response.status;
  // Chrome redacts Authorization in exported HARs, so infer it: once we hold a token, send it on
  // every call except login and recorded 401s (which are the "no/bad token" cases).
  const sendAuth = tokenSeen && u.pathname !== "/api/auth/login" && u.pathname !== "/api/test/reset" && (status !== 401 || !!header(req.headers, "authorization"));
  const isLogin = u.pathname === "/api/auth/login" && status === 200 && resBody && resBody.token;

  const title = `${String(i + 1).padStart(2, "0")} ${req.method} ${u.pathname} -> ${status}`;
  const opts = [];
  if (!sendAuth) opts.push("auth: false");
  if (reqBody !== undefined) opts.push(`body: ${JSON.stringify(reqBody)}`);
  const optStr = opts.length ? `, { ${opts.join(", ")} }` : "";

  out(`test(${JSON.stringify(title)}, async () => {`);
  out(`  const r = await call(${JSON.stringify(req.method)}, ${JSON.stringify(pathAndQuery)}${optStr});`);
  out(`  assert.equal(r.status, ${status});`);
  if (resBody !== undefined && resBody !== null) {
    const s = shape(resBody);
    out(`  assertShape(r.body, ${JSON.stringify(s)});`);
    if (resBody.error && resBody.error.code) out(`  assert.equal(r.body.error.code, ${JSON.stringify(resBody.error.code)});`);
  }
  if (isLogin) {
    tokenSeen = true;
    out(`  token = r.body.token; // reused as the Bearer token by later steps`);
  }
  out(`});`);
  out();
});

if (!entries.length) console.error("warning: no /api/ calls found in the HAR (did you record with 'Preserve log' on?)");

const outFile = outArg || path.join(__dirname, "..", "tests", path.basename(harFile, ".har") + ".generated.test.js");
fs.writeFileSync(outFile, lines.join("\n"));
console.log(`Wrote ${entries.length} test(s) -> ${outFile}`);

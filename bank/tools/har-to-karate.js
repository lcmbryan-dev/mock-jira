#!/usr/bin/env node
"use strict";
// Turn a browser HAR capture into a Karate .feature file.
//
//   node tools/har-to-karate.js captures/session.har [out.feature] [--host=localhost:3000] [--tags=@regression]
//
// - keeps only XHR/fetch calls to /api/ (optionally on one host)
// - one Scenario for the whole flow, because later steps reuse the login token
// - asserts the recorded status and the response *shape* using Karate's '#string' / '#number' markers
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flag = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=");
const [harFile, outArg] = args.filter((a) => !a.startsWith("--"));
if (!harFile) { console.error("usage: har-to-karate.js <file.har> [out.feature] [--host=localhost:3000] [--tags=@regression]"); process.exit(1); }

const har = JSON.parse(fs.readFileSync(harFile, "utf8"));
const entries = har.log.entries
  .filter((e) => {
    const u = new URL(e.request.url);
    return u.pathname.startsWith("/api/") && (!flag("host") || u.host === flag("host")) && e.request.method !== "OPTIONS";
  })
  .sort((a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime));

const q = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`; // Karate/JS string literal
const parseJson = (s) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };
const header = (list, name) => (list.find((h) => h.name.toLowerCase() === name) || {}).value;
const MARK = { string: "#string", number: "#number", boolean: "#boolean", null: "#present" };

// Response -> Karate schema object. Arrays become '#array' here; their items are checked with `match each`.
function schema(v) {
  if (Array.isArray(v)) return "#array";
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, schema(x)]));
  return MARK[v === null ? "null" : typeof v];
}
function arrays(v, p = "response", acc = []) {
  if (Array.isArray(v)) { if (v.length && v[0] && typeof v[0] === "object") acc.push([p, schema(v[0])]); }
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) arrays(x, /^[A-Za-z_]\w*$/.test(k) ? `${p}.${k}` : `${p}[${q(k)}]`, acc);
  return acc;
}
const lit = (o) => JSON.stringify(o).replace(/"/g, "'"); // JSON with single quotes is valid Karate; safe because values are plain markers/keys

const name = path.basename(harFile, ".har");
const out = [];
const L = (s = "") => out.push(s);

const tags = flag("tags") || "@regression";
L(tags);
L(`Feature: ${name} (generated from ${path.basename(harFile)})`);
L(`  Review the assertions before committing: shapes are generated, exact values are not.`);
L();
L(`  Background:`);
L(`    * url baseUrl`);
L();
L(`  @generated`);
L(`  Scenario: ${name} flow`);
L(`    # start from known seed data`);
L(`    Given path 'api', 'test', 'reset'`);
L(`    When method post`);
L(`    Then status 204`);

let hasToken = false;
entries.forEach((e, i) => {
  const req = e.request;
  const u = new URL(req.url);
  const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const reqBody = parseJson(req.postData && req.postData.text);
  const c = e.response.content || {};
  const resBody = parseJson(c.encoding === "base64" && c.text ? Buffer.from(c.text, "base64").toString() : c.text);
  const status = e.response.status;
  // Chrome redacts Authorization in exported HARs, so infer it: once we hold a token, send it on
  // every call except login and recorded 401s (which are the "no/bad token" cases).
  const sendAuth = hasToken && u.pathname !== "/api/auth/login" && u.pathname !== "/api/test/reset" && (status !== 401 || !!header(req.headers, "authorization"));

  L();
  L(`    # ${i + 1}. ${req.method} ${u.pathname}${u.search} -> ${status}`);
  L(`    Given path ${segs.map(q).join(", ")}`);
  for (const [k, v] of u.searchParams) L(`    And param ${k} = ${q(v)}`);
  if (sendAuth) L(`    And header Authorization = 'Bearer ' + token`);
  if (reqBody !== undefined) L(`    And request ${JSON.stringify(reqBody)}`);
  L(`    When method ${req.method.toLowerCase()}`);
  L(`    Then status ${status}`);
  if (resBody !== undefined && resBody !== null) {
    L(`    And match response == ${lit(schema(resBody))}`);
    for (const [p, s] of arrays(resBody)) L(`    And match each ${p} == ${lit(s)}`);
    if (resBody.error && resBody.error.code) L(`    And match response.error.code == ${q(resBody.error.code)}`);
  }
  if (req.method === "POST" && u.pathname === "/api/auth/login" && status === 200 && resBody && resBody.token) {
    hasToken = true;
    L(`    * def token = response.token`);
  }
});
L();

if (!entries.length) console.error("warning: no /api/ calls found in the HAR (did you record with 'Preserve log' on?)");

const outFile = outArg || path.join(__dirname, "..", "karate", "src", "test", "java", "bank", name + ".feature");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out.join("\n"));
console.log(`Wrote ${entries.length} step(s) -> ${outFile}`);

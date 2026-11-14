# Mock Bank

A small banking app for practicing **browser capture → automated API tests**. Node 20+, no dependencies.

```
npm start        # http://localhost:3000
npm test         # baseline API suite (starts its own server)
```

Demo logins (password `Password123!`): `alice` (accounts 1001 checking, 1002 savings), `bob` (2001), `locked` (always 423).

## API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | – | `{username,password}` → `{token,...}`; 401 bad creds, 423 locked (5 failures lock the user) |
| POST | `/api/auth/logout` | Bearer | 204 |
| GET | `/api/me` | Bearer | |
| GET | `/api/accounts` | Bearer | caller's accounts only |
| GET | `/api/accounts/:id` | Bearer | 403 if not yours, 404 if unknown |
| GET | `/api/accounts/:id/transactions?limit=&type=` | Bearer | newest first |
| POST | `/api/transfers` | Bearer | `{fromAccountId,toAccountId,amount,description}` → 201; 400 / 403 / 404 / 422 |
| POST | `/api/test/reset` | – | restores seed data (test helper) |

Errors always look like `{ "error": { "code": "...", "message": "..." } }`.

## Workflow: capture in the browser, generate tests

1. `npm start`, open http://localhost:3000.
2. DevTools (F12) → **Network** tab → tick **Preserve log**, filter **Fetch/XHR**.
3. Do the flow you want covered: sign in, view accounts, make a transfer, try a failing transfer, sign out.
4. Right-click in the request list → **Save all as HAR with content** → save into `captures/` (e.g. `captures/transfer-flow.har`).
5. Generate a test file:
   ```
   npm run har2test -- captures/transfer-flow.har
   ```
   This writes `tests/transfer-flow.generated.test.js`: one test per request, in order, with the recorded status code, the response *shape*, and the login token reused as the Bearer header.
6. Run it: `node --test tests/transfer-flow.generated.test.js` (or point at a running server with `BASE_URL=http://localhost:3000`).
7. Or generate **Karate** instead (see below).
8. Ask Claude to refine it: add exact-value assertions, negative cases, data cleanup, and fold repeated steps into helpers. `captures/sample.har` and `tests/sample.generated.test.js` show the input and output.

## Karate output

The same HAR can produce a Karate feature. The `karate/` folder is a Maven project (Karate 1.5.0, Java 11+) laid out like a standard Karate project: features in `src/test/java/bank/`, base URL in `karate-config.js`.

```
npm run har2karate -- captures/transfer-flow.har    # writes karate/src/test/java/bank/transfer-flow.feature
npm start                                           # in one terminal
cd karate && mvn test                               # in another; HTML report: karate/target/karate-reports/karate-summary.html
```

- Options: `--host=localhost:3000` (only keep calls to that host), `--tags=@smoke` (default `@regression`), or pass an output path as the second argument.
- Point at another server with `mvn test -Dbase.url=http://host:port`.
- The whole flow is one Scenario so the login token (`* def token = response.token`) can be reused by later steps. Each step asserts status and response shape (`'#string'`, `'#number'`, `match each` for arrays) plus the exact `error.code` on failures.
- `captures/sample.har` -> `karate/src/test/java/bank/sample.feature` is a worked example.

### Negative tests

Each generated feature has a hand-written companion that covers the failure paths of the same endpoints. The generator never overwrites them.

| Feature | Negative companion | Covers |
|---|---|---|
| `Login.feature` | `Login-negative.feature` | wrong password, unknown user (same 401, no enumeration), 6 invalid-body variants (400), malformed JSON, locked user (423), lockout after 5 failures, wrong method (405), missing/bogus/wrong-scheme/empty tokens (401), other user's account (403), unknown account (404), token dead after logout |
| `sample.feature` | `sample-negative.feature` | 8 invalid-transfer variants (400), insufficient funds (422) with balances unchanged, failed transfer not in history, transferring from someone else's account (403), unknown destination (404), no token (401), logged-out token |

`helpers/*.feature` are `@ignore`d reusable steps (`login`, `bad-login`) that the runner skips. Scenarios reset the server's data in `Background`, so the suite must run sequentially (`BankTest` does).

**Caution:** HAR files contain real bearer tokens and passwords. Keep captures of anything other than this demo out of git.

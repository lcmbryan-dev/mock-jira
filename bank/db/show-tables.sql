-- List every table in the bank database.
SELECT name AS table_name
FROM sqlite_master
WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
ORDER BY name;

-- Users (password hashes omitted).
SELECT username, full_name, failed, locked FROM users ORDER BY username;

-- Accounts with balances in dollars.
SELECT id, owner, type, currency, balance_cents / 100.0 AS balance FROM accounts ORDER BY id;

-- Transactions, newest first.
SELECT seq, id, account_id, type, amount_cents / 100.0 AS amount, description,
       counterparty, balance_after_cents / 100.0 AS balance_after, date
FROM transactions
ORDER BY seq DESC;

-- Active login sessions.
SELECT token, username, datetime(expires / 1000, 'unixepoch') AS expires_utc FROM sessions ORDER BY expires DESC;

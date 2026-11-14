"use strict";
// Runs a .sql file against the bank database and prints each SELECT as a table.
// Usage: node db/run-sql.js [file.sql] [dbPath]   (defaults: db/show-tables.sql, data/bank.db)
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const sqlFile = process.argv[2] || path.join(__dirname, "show-tables.sql");
const dbPath = process.argv[3] || process.env.DB_PATH || path.join(__dirname, "..", "data", "bank.db");
if (!fs.existsSync(dbPath)) { console.error(`Database not found: ${dbPath} (start the server once to create it)`); process.exit(1); }

const db = new DatabaseSync(dbPath, { readOnly: true });
// Split on ';' at end of statement; the script has no semicolons inside strings.
const statements = fs.readFileSync(sqlFile, "utf8").split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
for (const sql of statements) {
  const title = (sql.match(/^--\s*(.*)$/m) || [])[1];
  if (title) console.log(`\n== ${title}`);
  const rows = db.prepare(sql).all().map((r) => ({ ...r }));
  if (rows.length) console.table(rows); else console.log("(no rows)");
}
db.close();

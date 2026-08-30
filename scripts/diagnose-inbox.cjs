const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, isMain, options) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const { getDb } = require("../lib/db.ts");
const db = getDb();

console.log("=== 1. ACCOUNTS IN DB ===");
const accounts = db.prepare("SELECT id, name, email, is_authenticated, linkedin_inbox_synced_at, linkedin_inbox_sync_error FROM accounts").all();
console.log(JSON.stringify(accounts, null, 2));

console.log("\n=== 2. CAMPAIGNS (RUNS) ===");
const runs = db.prepare("SELECT r.id, r.workflow_id, r.account_id, r.status, w.name as workflow_name FROM runs r LEFT JOIN workflows w ON w.id = r.workflow_id").all();
console.log(JSON.stringify(runs, null, 2));

console.log("\n=== 3. TARGETS IN CAMPAIGNS ===");
const targets = db.prepare("SELECT t.id, t.full_name, t.linkedin_url, t.degree, t.connection_requested_at, t.connected_at, t.message_sent_at, t.last_replied_at, t.last_replied_account_id FROM targets t").all();
console.log(JSON.stringify(targets, null, 2));

console.log("\n=== 4. RECENT LOGS ===");
const logs = db.prepare("SELECT l.id, l.run_id, l.target_id, l.message, l.created_at FROM logs l ORDER BY l.created_at DESC LIMIT 15").all();
console.log(JSON.stringify(logs, null, 2));

console.log("\n=== 5. LINKEDIN INBOX MESSAGES TABLE ===");
const messages = db.prepare("SELECT * FROM linkedin_inbox_messages").all();
console.log(JSON.stringify(messages, null, 2));

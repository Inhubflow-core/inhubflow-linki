#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, isMain, options) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};
const originalTsLoader = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const {
  sdrThreadMatchesTarget,
  targetBelongsToEmailAccount,
  targetBelongsToLinkedInAccount,
} = require("../lib/authz.ts");

const db = new Database(":memory:");
try {
  db.exec(`
    CREATE TABLE targets (
      id TEXT PRIMARY KEY,
      last_replied_account_id TEXT
    );
    CREATE TABLE linkedin_inbox_messages (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      account_id TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      email_account_id TEXT
    );
    CREATE TABLE run_profiles (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      target_id TEXT,
      email_account_id TEXT
    );
    CREATE TABLE email_replies (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      email_account_id TEXT
    );
    CREATE TABLE sdr_threads (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL
    );

    INSERT INTO targets(id, last_replied_account_id) VALUES
      ('target-a', NULL),
      ('target-b', 'linkedin-b'),
      ('target-c', NULL);
    INSERT INTO runs(id, account_id, email_account_id) VALUES
      ('run-a', 'linkedin-a', 'email-a'),
      ('run-b', 'linkedin-b', 'email-b');
    INSERT INTO run_profiles(id, run_id, target_id, email_account_id) VALUES
      ('profile-a', 'run-a', 'target-a', 'email-a'),
      ('profile-b', 'run-b', 'target-b', NULL);
    INSERT INTO linkedin_inbox_messages(id, target_id, account_id) VALUES
      ('message-c', 'target-c', 'linkedin-c');
    INSERT INTO email_replies(id, target_id, email_account_id) VALUES
      ('reply-c', 'target-c', 'email-c');
    INSERT INTO sdr_threads(id, target_id) VALUES
      ('thread-a', 'target-a');
  `);

  assert.equal(targetBelongsToLinkedInAccount(db, "target-a", "linkedin-a"), true);
  assert.equal(targetBelongsToLinkedInAccount(db, "target-a", "linkedin-b"), false);
  assert.equal(targetBelongsToLinkedInAccount(db, "target-b", "linkedin-b"), true);
  assert.equal(targetBelongsToLinkedInAccount(db, "target-c", "linkedin-c"), true);
  assert.equal(targetBelongsToLinkedInAccount(db, "missing", "linkedin-a"), false);

  assert.equal(targetBelongsToEmailAccount(db, "target-a", "email-a"), true);
  assert.equal(targetBelongsToEmailAccount(db, "target-a", "email-b"), false);
  assert.equal(targetBelongsToEmailAccount(db, "target-b", "email-b"), true);
  assert.equal(targetBelongsToEmailAccount(db, "target-c", "email-c"), true);
  assert.equal(targetBelongsToEmailAccount(db, "missing", "email-a"), false);

  assert.equal(sdrThreadMatchesTarget(db, "thread-a", "target-a"), true);
  assert.equal(sdrThreadMatchesTarget(db, "thread-a", "target-b"), false);
  assert.equal(sdrThreadMatchesTarget(db, "missing", "target-a"), false);

  console.log("SDR Inbox authorization context tests passed");
} finally {
  db.close();
  Module._resolveFilename = originalResolve;
  if (originalTsLoader) Module._extensions[".ts"] = originalTsLoader;
  else delete Module._extensions[".ts"];
}

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

// Execute the real TypeScript module without adding a test-runner dependency.
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

const { createDisabledSdrBridge } = require("../lib/sdr-agent/noop.ts");
const { applySdrSchema, SDR_SCHEMA_MIGRATIONS } = require("../lib/sdr-agent/schema.ts");

async function testDisabledBridge() {
  const validLinkedinEvent = {
    eventId: "evt-linkedin-1",
    channel: "linkedin",
    targetId: "target-1",
    accountId: "account-1",
    externalThreadId: "thread-1",
    externalMessageId: "message-1",
    body: "Hello",
    receivedAt: new Date().toISOString(),
  };

  const off = createDisabledSdrBridge({ mode: "off" });
  assert.deepEqual(off.getStatus(), {
    available: false,
    requestedMode: "off",
    effectiveMode: "off",
    outboundEnabled: false,
    reason: "disabled",
  });
  assert.deepEqual(await off.publishInboundMessage(validLinkedinEvent), {
    accepted: false,
    reason: "disabled",
    eventId: validLinkedinEvent.eventId,
  });

  const auto = createDisabledSdrBridge({ mode: "auto" });
  assert.deepEqual(auto.getStatus(), {
    available: false,
    requestedMode: "auto",
    effectiveMode: "off",
    outboundEnabled: false,
    reason: "module_unavailable",
  });
  assert.deepEqual(await auto.runWorkerTick(), {
    processed: 0,
    failed: 0,
    skipped: true,
    reason: "module_unavailable",
  });

  const invalidConfig = createDisabledSdrBridge({ mode: "unexpected" });
  assert.equal(invalidConfig.getStatus().reason, "invalid_configuration");
  assert.equal((await invalidConfig.publishInboundMessage(validLinkedinEvent)).reason, "invalid_configuration");
  assert.equal((await invalidConfig.runWorkerTick()).reason, "invalid_configuration");

  const invalidEvent = await off.publishInboundMessage({});
  assert.equal(invalidEvent.accepted, false);
  assert.equal(invalidEvent.reason, "invalid_event");
  assert.ok(invalidEvent.validationErrors.length > 0);

  const emailWithoutAccount = await off.publishInboundMessage({
    ...validLinkedinEvent,
    eventId: "evt-email-1",
    channel: "email",
    accountId: null,
  });
  assert.equal(emailWithoutAccount.reason, "invalid_event");
}

function testAdditiveSchema() {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE accounts(id TEXT PRIMARY KEY);
      CREATE TABLE email_accounts(id TEXT PRIMARY KEY);
      CREATE TABLE targets(id TEXT PRIMARY KEY);
      INSERT INTO targets(id) VALUES ('core-target');
    `);

    applySdrSchema(db);
    applySdrSchema(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sdr_%' ORDER BY name"
    ).all();
    assert.equal(tables.length, 13);
    assert.equal(SDR_SCHEMA_MIGRATIONS.length, 29);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM targets").get().count, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    db.exec(`
      INSERT INTO users(id) VALUES ('user-1');
      INSERT INTO accounts(id) VALUES ('account-1');
      INSERT INTO email_accounts(id) VALUES ('email-account-1');
      INSERT INTO sdr_agents(id, name, created_by_user_id)
        VALUES ('agent-1', 'Test SDR', 'user-1');
      INSERT INTO sdr_agent_versions(id, agent_id, version_number, system_prompt)
        VALUES ('version-1', 'agent-1', 1, 'Test prompt');
      UPDATE sdr_agents SET active_version_id = 'version-1' WHERE id = 'agent-1';
      INSERT INTO sdr_agent_accounts(agent_id, account_id)
        VALUES ('agent-1', 'account-1');
      INSERT INTO sdr_threads(
        id, target_id, channel, linkedin_account_id, external_thread_id, agent_id, agent_version_id
      ) VALUES (
        'thread-1', 'core-target', 'linkedin', 'account-1', 'external-thread-1', 'agent-1', 'version-1'
      );
      INSERT INTO sdr_messages(
        id, thread_id, direction, external_message_id, body, sent_at
      ) VALUES (
        'message-1', 'thread-1', 'inbound', 'external-message-1', 'Hello', datetime('now')
      );
    `);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO sdr_messages(id, thread_id, direction, external_message_id, body, sent_at)
        VALUES (?, ?, 'inbound', ?, 'Duplicate', datetime('now'))
      `).run("message-2", "thread-1", "external-message-1");
    }, /UNIQUE constraint failed/);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO sdr_threads(id, target_id, channel, external_thread_id)
        VALUES (?, ?, 'linkedin', ?)
      `).run("thread-invalid", "core-target", "external-thread-invalid");
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
}

async function main() {
  await testDisabledBridge();
  testAdditiveSchema();
  console.log("SDR Phase 1A foundation tests passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (originalTsLoader) Module._extensions[".ts"] = originalTsLoader;
    else delete Module._extensions[".ts"];
  });

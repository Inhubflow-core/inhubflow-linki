/* eslint-disable @typescript-eslint/no-require-imports */
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
const {
  enqueueSdrJob,
  getSdrJobByIdempotencyKey,
  leaseNextSdrJob,
  renewSdrJobLease,
  completeSdrJob,
  failSdrJob,
  recoverExpiredSdrLeases,
} = require("../lib/sdr-agent/jobs.ts");
const { captureSdrInboundMessage, listSdrMessages } = require("../lib/sdr-agent/repository.ts");

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

function testJobQueue() {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE accounts(id TEXT PRIMARY KEY);
      CREATE TABLE email_accounts(id TEXT PRIMARY KEY);
      CREATE TABLE targets(id TEXT PRIMARY KEY);
    `);
    applySdrSchema(db);
    db.exec(`
      INSERT INTO targets(id) VALUES ('queue-target');
      INSERT INTO accounts(id) VALUES ('queue-account');
      INSERT INTO sdr_threads(id, target_id, channel, linkedin_account_id, external_thread_id)
        VALUES ('queue-thread', 'queue-target', 'linkedin', 'queue-account', 'queue-external-thread');
      INSERT INTO sdr_messages(id, thread_id, direction, body, sent_at)
        VALUES ('queue-message', 'queue-thread', 'inbound', 'Hello', datetime('now'));
    `);

    const first = enqueueSdrJob(db, {
      threadId: "queue-thread",
      messageId: "queue-message",
      jobType: "classify",
      idempotencyKey: "classify:queue-message",
      payload: { messageId: "queue-message" },
      maxAttempts: 2,
    });
    const duplicate = enqueueSdrJob(db, {
      threadId: "queue-thread",
      messageId: "queue-message",
      jobType: "classify",
      idempotencyKey: "classify:queue-message",
      payload: { shouldNotReplace: true },
      maxAttempts: 99,
    });
    assert.equal(duplicate.id, first.id);
    assert.deepEqual(JSON.parse(duplicate.payload_json), { messageId: "queue-message" });
    assert.equal(getSdrJobByIdempotencyKey(db, "classify:queue-message").id, first.id);

    const base = new Date("2026-08-27T12:00:00.000Z");
    const leased = leaseNextSdrJob(db, { workerId: "worker-a", leaseMs: 10_000, now: base });
    assert.ok(leased);
    assert.equal(leased.state, "leased");
    assert.equal(leased.attempts, 1);
    assert.equal(leaseNextSdrJob(db, { workerId: "worker-b", leaseMs: 10_000, now: base }), null);
    assert.equal(renewSdrJobLease(db, leased.id, "wrong-token", 10_000, base), false);
    assert.equal(renewSdrJobLease(db, leased.id, leased.lease_token, 10_000, base), true);
    assert.equal(completeSdrJob(db, leased.id, "wrong-token", base), false);
    assert.equal(completeSdrJob(db, leased.id, leased.lease_token, base), true);
    assert.equal(db.prepare("SELECT state FROM sdr_jobs WHERE id = ?").get(leased.id).state, "completed");

    const retryJob = enqueueSdrJob(db, {
      threadId: "queue-thread",
      jobType: "decide",
      idempotencyKey: "decide:queue-message",
      maxAttempts: 2,
    });
    const retryLease = leaseNextSdrJob(db, { workerId: "worker-a", leaseMs: 10_000, now: base });
    assert.equal(retryLease.id, retryJob.id);
    const requeued = failSdrJob(db, retryJob.id, {
      leaseToken: retryLease.lease_token,
      error: "temporary provider failure",
      retryDelayMs: 5_000,
      now: base,
    });
    assert.equal(requeued.state, "queued");
    assert.equal(requeued.attempts, 1);
    assert.equal(requeued.last_error, "temporary provider failure");

    const retryLease2 = leaseNextSdrJob(db, { workerId: "worker-a", leaseMs: 10_000, now: new Date("2026-08-27T12:00:05.000Z") });
    assert.equal(retryLease2.id, retryJob.id);
    const permanentlyFailed = failSdrJob(db, retryJob.id, {
      leaseToken: retryLease2.lease_token,
      error: "second failure",
      now: new Date("2026-08-27T12:00:05.000Z"),
    });
    assert.equal(permanentlyFailed.state, "failed");
    assert.equal(permanentlyFailed.attempts, 2);

    const expiredJob = enqueueSdrJob(db, {
      threadId: "queue-thread",
      jobType: "handoff",
      idempotencyKey: "handoff:queue-message",
      maxAttempts: 2,
    });
    const expiredLease = leaseNextSdrJob(db, { workerId: "worker-a", leaseMs: 10_000, now: base });
    assert.equal(expiredLease.id, expiredJob.id);
    assert.equal(recoverExpiredSdrLeases(db, new Date("2026-08-27T12:00:11.000Z")), 1);
    const recovered = db.prepare("SELECT state, lease_token, attempts FROM sdr_jobs WHERE id = ?").get(expiredJob.id);
    assert.equal(recovered.state, "queued");
    assert.equal(recovered.lease_token, null);
    assert.equal(recovered.attempts, 1);
  } finally {
    db.close();
  }
}

function testInboundRepository() {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE accounts(id TEXT PRIMARY KEY);
      CREATE TABLE email_accounts(id TEXT PRIMARY KEY);
      CREATE TABLE targets(id TEXT PRIMARY KEY);
    `);
    applySdrSchema(db);
    db.exec(`
      INSERT INTO targets(id) VALUES ('capture-target');
      INSERT INTO accounts(id) VALUES ('capture-account');
      INSERT INTO sdr_threads(id, target_id, channel, linkedin_account_id, external_thread_id)
        VALUES ('existing-thread', 'capture-target', 'linkedin', 'capture-account', 'external-thread');
    `);

    const event = {
      eventId: "event-1",
      channel: "linkedin",
      targetId: "capture-target",
      accountId: "capture-account",
      externalThreadId: "external-thread",
      externalMessageId: "external-message",
      senderName: "Contact",
      body: "Can you tell me more?",
      receivedAt: "2026-08-27T12:00:00.000Z",
      metadata: { source: "fixture" },
    };
    const captured = captureSdrInboundMessage(db, event);
    assert.equal(captured.duplicate, false);
    assert.equal(captured.thread.id, "existing-thread");
    assert.equal(captured.message.delivery_status, "captured");
    assert.equal(captured.job.job_type, "classify");
    assert.equal(captured.job.state, "queued");
    assert.equal(listSdrMessages(db, "existing-thread").length, 1);

    const duplicate = captureSdrInboundMessage(db, event);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.message.id, captured.message.id);
    assert.equal(listSdrMessages(db, "existing-thread").length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sdr_jobs").get().count, 1);

    assert.throws(() => captureSdrInboundMessage(db, {
      ...event,
      eventId: "bad-event",
      accountId: "other-account",
    }), /FOREIGN KEY|could not be loaded|different target|SDR/);

    assert.throws(() => captureSdrInboundMessage(db, {
      ...event,
      eventId: "bad-email",
      channel: "email",
      emailAccountId: null,
    }), /Invalid SDR inbound event/);
  } finally {
    db.close();
  }
}

async function main() {
  await testDisabledBridge();
  testAdditiveSchema();
  testJobQueue();
  testInboundRepository();
  console.log("SDR Phase 1B foundation tests passed");
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

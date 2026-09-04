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
const {
  captureLinkedInInboxObservations,
  syncLinkedInInboxReadOnly,
  LinkedInInboxAccountError,
  LinkedInInboxAuthenticationError,
} = require("../lib/linkedin/inbox-sync.ts");

function readInboxFixture(name) {
  return JSON.parse(fs.readFileSync(`${__dirname}/../fixtures/linkedin-inbox/${name}`, "utf8"));
}

const validInboxFixture = readInboxFixture("normalized-observations-valid.json");
const invalidInboxFixture = readInboxFixture("normalized-observations-invalid.json");

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
    assert.equal(tables.length, 21);
    assert.ok(tables.some((table) => table.name === "sdr_outbox"));
    assert.ok(tables.some((table) => table.name === "sdr_runtime_state"));
    assert.ok(tables.some((table) => table.name === "sdr_knowledge_chunks"));
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

function createInboxDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE accounts(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      is_authenticated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE email_accounts(id TEXT PRIMARY KEY);
    CREATE TABLE targets(
      id TEXT PRIMARY KEY,
      linkedin_url TEXT,
      messaging_urn TEXT,
      linkedin_member_urn TEXT
    );
    CREATE TABLE workflows(id TEXT PRIMARY KEY);
    CREATE TABLE runs(
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      workflow_id TEXT,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE run_profiles(
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      target_id TEXT NOT NULL REFERENCES targets(id),
      created_at TEXT
    );
  `);
  applySdrSchema(db);
  db.exec(`
    INSERT INTO accounts(id, name, email, is_authenticated) VALUES
      ('account-a', 'Slot A', 'slot-a@example.test', 1),
      ('account-b', 'Slot B', 'slot-b@example.test', 1),
      ('account-off', 'Slot Off', 'slot-off@example.test', 0);
    INSERT INTO targets(id, linkedin_url, messaging_urn, linkedin_member_urn) VALUES
      ('target-a', 'https://www.linkedin.com/in/person-a/', 'urn:li:fsd_profile:person-a', 'urn:li:member:person-a'),
      ('target-vanity', 'https://www.linkedin.com/in/person-vanity/', NULL, 'urn:li:member:person-vanity'),
      ('target-member-only', 'https://www.linkedin.com/in/member-only/', NULL, 'urn:li:member:member-only'),
      ('target-b', 'https://www.linkedin.com/in/person-b/', 'urn:li:fsd_profile:person-b', 'urn:li:member:person-b'),
      ('target-ambiguous-1', 'https://www.linkedin.com/in/ambiguous-one/', 'urn:li:fsd_profile:ambiguous', 'urn:li:member:ambiguous-one'),
      ('target-ambiguous-2', 'https://www.linkedin.com/in/ambiguous-two/', 'urn:li:fsd_profile:ambiguous', 'urn:li:member:ambiguous-two'),
      ('target-conflict', 'https://www.linkedin.com/in/conflict/', 'urn:li:fsd_profile:conflict-urn', 'urn:li:member:conflict');
    INSERT INTO runs(id, account_id, workflow_id, status, created_at) VALUES
      ('run-a-1', 'account-a', 'workflow-a', 'running', datetime('now')),
      ('run-a-2', 'account-a', 'workflow-a-2', 'paused', datetime('now')),
      ('run-b-1', 'account-b', 'workflow-b', 'running', datetime('now'));
    INSERT INTO run_profiles(id, run_id, target_id, created_at) VALUES
      ('profile-a', 'run-a-1', 'target-a', datetime('now')),
      ('profile-a-duplicate-run', 'run-a-2', 'target-a', datetime('now')),
      ('profile-vanity', 'run-a-1', 'target-vanity', datetime('now')),
      ('profile-member-only', 'run-a-1', 'target-member-only', datetime('now')),
      ('profile-b', 'run-b-1', 'target-b', datetime('now')),
      ('profile-ambiguous-1', 'run-a-1', 'target-ambiguous-1', datetime('now')),
      ('profile-ambiguous-2', 'run-a-1', 'target-ambiguous-2', datetime('now')),
      ('profile-conflict', 'run-a-1', 'target-conflict', datetime('now'));
  `);
  return db;
}

function inboxObservation(overrides = {}) {
  return {
    externalThreadId: "thread-test-1",
    externalMessageId: "message-test-1",
    direction: "inbound",
    body: "  First line\r\nSecond line  ",
    receivedAt: "2026-08-27T12:00:00-04:00",
    senderMessagingUrn: "urn:li:fsd_profile:person-a",
    senderProfileUrl: "https://www.linkedin.com/in/person-a/?trk=synthetic#section",
    senderExternalId: "sender-a",
    senderName: "Synthetic Sender",
    rawKind: "message",
    ...overrides,
  };
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function testLinkedInInboxCapture() {
  const db = createInboxDb();
  try {
    assert.equal(validInboxFixture.fixture_status, "synthetic-provider-neutral");
    assert.equal(Array.isArray(validInboxFixture.observations), true);
    assert.equal(invalidInboxFixture.fixture_status, "synthetic-provider-neutral");
    assert.equal(Array.isArray(invalidInboxFixture.observations), true);

    const beforeLegacy = db.prepare(
      "SELECT id, linkedin_url, messaging_urn, linkedin_member_urn FROM targets ORDER BY id"
    ).all();
    const first = captureLinkedInInboxObservations(db, "account-a", validInboxFixture.observations);
    assert.equal(first.captured, 1);
    assert.equal(first.duplicates, 0);
    assert.deepEqual(first.skipped, []);
    assert.equal(countRows(db, "sdr_threads"), 1);
    assert.equal(countRows(db, "sdr_messages"), 1);
    assert.equal(countRows(db, "sdr_jobs"), 1);

    const message = db.prepare("SELECT * FROM sdr_messages").get();
    assert.equal(message.thread_id, db.prepare("SELECT id FROM sdr_threads").get().id);
    assert.equal(message.body, "First line\nSecond line");
    assert.equal(message.sent_at, "2026-08-27T16:00:00.000Z");
    assert.deepEqual(JSON.parse(message.metadata_json), {
      adapter_version: "2a-contract",
      identity_mode: "messaging_urn+profile_url",
      raw_kind: "message",
    });
    assert.equal(db.prepare("SELECT linkedin_account_id, target_id FROM sdr_threads").get().linkedin_account_id, "account-a");
    assert.equal(db.prepare("SELECT target_id FROM sdr_threads").get().target_id, "target-a");

    const duplicate = captureLinkedInInboxObservations(db, "account-a", validInboxFixture.observations);
    assert.equal(duplicate.captured, 0);
    assert.equal(duplicate.duplicates, 1);
    assert.equal(countRows(db, "sdr_messages"), 1);
    assert.equal(countRows(db, "sdr_jobs"), 1);

    const secondMessage = captureLinkedInInboxObservations(db, "account-a", [
      inboxObservation({ externalMessageId: "message-test-2", body: "Second", receivedAt: "2026-08-27T13:00:00Z" }),
    ]);
    assert.equal(secondMessage.captured, 1);
    assert.equal(countRows(db, "sdr_messages"), 2);
    assert.equal(countRows(db, "sdr_jobs"), 2);

    const vanity = captureLinkedInInboxObservations(db, "account-a", [inboxObservation({
      externalThreadId: "thread-vanity",
      externalMessageId: "message-vanity",
      senderMessagingUrn: null,
      senderProfileUrl: "https://linkedin.com/in/PERSON-VANITY/",
    })]);
    assert.equal(vanity.captured, 1);
    assert.equal(db.prepare("SELECT target_id FROM sdr_threads WHERE external_thread_id = ?").get("thread-vanity").target_id, "target-vanity");

    const memberOnly = captureLinkedInInboxObservations(db, "account-a", [inboxObservation({
      externalThreadId: "thread-member-only",
      externalMessageId: "message-member-only",
      senderMessagingUrn: null,
      senderProfileUrl: "https://www.linkedin.com/in/member-only/",
    })]);
    assert.equal(memberOnly.captured, 1, "vanity matching is allowed even when only member URN is stored");

    const fixtureInvalid = captureLinkedInInboxObservations(db, "account-a", invalidInboxFixture.observations);
    assert.equal(fixtureInvalid.captured, 0);
    assert.deepEqual(fixtureInvalid.skipped.map((item) => item.reason), ["outbound_or_system", "invalid_identity"]);

    const checks = [
      [inboxObservation({ externalMessageId: "message-name-only", senderMessagingUrn: null, senderProfileUrl: null }), "invalid_identity"],
      [inboxObservation({ externalMessageId: "message-bad-urn", senderMessagingUrn: "urn:li:member:person-a", senderProfileUrl: null }), "invalid_identity"],
      [inboxObservation({ externalMessageId: "message-bad-url", senderMessagingUrn: null, senderProfileUrl: "https://linkedin.com/company/not-a-person" }), "invalid_identity"],
      [inboxObservation({ externalMessageId: "message-no-target", senderMessagingUrn: "urn:li:fsd_profile:unknown", senderProfileUrl: null }), "unmatched_target"],
      [inboxObservation({ externalMessageId: "message-wrong-slot", senderMessagingUrn: "urn:li:fsd_profile:person-b", senderProfileUrl: null }), "wrong_account_ownership"],
      [inboxObservation({ externalMessageId: "message-ambiguous", senderMessagingUrn: "urn:li:fsd_profile:ambiguous", senderProfileUrl: null }), "ambiguous_target"],
      [inboxObservation({ externalMessageId: "message-conflict", senderMessagingUrn: "urn:li:fsd_profile:conflict-urn", senderProfileUrl: "https://linkedin.com/in/person-a/" }), "identity_conflict"],
      [inboxObservation({ externalMessageId: "message-outbound", direction: "outbound" }), "outbound_or_system"],
      [inboxObservation({ externalMessageId: "message-system", direction: "system" }), "outbound_or_system"],
      [inboxObservation({ externalMessageId: "message-unknown-direction", direction: "future" }), "invalid_observation"],
      [inboxObservation({ externalMessageId: "message-blank-body", body: " \r\n " }), "invalid_observation"],
      [inboxObservation({ externalMessageId: "message-bad-time", receivedAt: "2026-08-27 12:00:00" }), "invalid_observation"],
      [inboxObservation({ externalMessageId: "message-epoch", receivedAt: 1787846400000 }), "invalid_observation"],
    ];
    const checked = captureLinkedInInboxObservations(db, "account-a", checks.map(([observation]) => observation));
    assert.equal(checked.captured, 0);
    assert.equal(checked.skipped.length, checks.length);
    assert.deepEqual(checked.skipped.map((item) => item.reason), checks.map(([, reason]) => reason));

    const beforeBatchMessages = countRows(db, "sdr_messages");
    const batch = captureLinkedInInboxObservations(db, "account-a", [
      inboxObservation({ externalMessageId: "message-batch-invalid", senderMessagingUrn: null, senderProfileUrl: null }),
      inboxObservation({ externalMessageId: "message-batch-valid", senderMessagingUrn: "urn:li:fsd_profile:person-a", senderProfileUrl: null }),
    ]);
    assert.equal(batch.captured, 1);
    assert.equal(batch.skipped[0].reason, "invalid_identity");
    assert.equal(countRows(db, "sdr_messages"), beforeBatchMessages + 1);

    assert.deepEqual(db.prepare(
      "SELECT id, linkedin_url, messaging_urn, linkedin_member_urn FROM targets ORDER BY id"
    ).all(), beforeLegacy);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM runs").get().count, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM run_profiles").get().count, 8);
  } finally {
    db.close();
  }
}

async function testLinkedInInboxSessionWrapper() {
  const db = createInboxDb();
  try {
    let closed = 0;
    let saved = 0;
    let reauthed = 0;
    const page = { url: () => "https://www.linkedin.com/messaging/", close: async () => { closed++; } };
    const result = await syncLinkedInInboxReadOnly({
      accountId: "account-a",
      db,
      pageFactory: async () => page,
      source: { observe: async () => [inboxObservation({ externalMessageId: "message-wrapper" })] },
      saveState: async () => { saved++; },
      markReauth: async () => { reauthed++; },
    });
    assert.equal(result.captured, 1);
    assert.equal(saved, 1);
    assert.equal(reauthed, 0);
    assert.equal(closed, 1);

    let wallClosed = 0;
    let wallSaved = 0;
    let wallReauthed = 0;
    await assert.rejects(
      syncLinkedInInboxReadOnly({
        accountId: "account-a",
        db,
        pageFactory: async () => ({ url: () => "https://www.linkedin.com/checkpoint/challenge", close: async () => { wallClosed++; } }),
        source: { observe: async () => { throw new Error("must not observe an auth wall"); } },
        saveState: async () => { wallSaved++; },
        markReauth: async () => { wallReauthed++; },
      }),
      (error) => error instanceof LinkedInInboxAuthenticationError,
    );
    assert.equal(wallClosed, 1);
    assert.equal(wallSaved, 0);
    assert.equal(wallReauthed, 1);

    let sourceWallClosed = 0;
    let sourceWallReauthed = 0;
    await assert.rejects(
      syncLinkedInInboxReadOnly({
        accountId: "account-a",
        db,
        pageFactory: async () => ({ url: () => "https://www.linkedin.com/checkpoint/challenge", close: async () => { sourceWallClosed++; } }),
        source: { observe: async () => { throw new Error("source failed after checkpoint"); } },
        saveState: async () => { throw new Error("must not save after checkpoint"); },
        markReauth: async () => { sourceWallReauthed++; },
      }),
      (error) => error instanceof LinkedInInboxAuthenticationError,
    );
    assert.equal(sourceWallClosed, 1);
    assert.equal(sourceWallReauthed, 1);

    assert.throws(
      () => captureLinkedInInboxObservations(db, "account-off", [inboxObservation()]),
      (error) => error instanceof LinkedInInboxAccountError && error.reason === "unauthenticated_account",
    );
  } finally {
    db.close();
  }
}
async function main() {
  await testDisabledBridge();
  testAdditiveSchema();
  testJobQueue();
  testInboundRepository();
  testLinkedInInboxCapture();
  await testLinkedInInboxSessionWrapper();
  console.log("SDR Phase 2A read-only inbox foundation tests passed");
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

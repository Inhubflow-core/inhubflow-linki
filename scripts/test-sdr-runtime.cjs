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

const { applySdrSchema } = require("../lib/sdr-agent/schema.ts");
const { captureSdrInboundMessage } = require("../lib/sdr-agent/repository.ts");
const { leaseNextSdrJob } = require("../lib/sdr-agent/jobs.ts");
const { processLeasedClassificationJob } = require("../lib/sdr-agent/orchestrator.ts");
const { FakeSdrProvider } = require("../lib/sdr-agent/providers/fake.ts");
const { takeHumanControl, releaseHumanControl } = require("../lib/sdr-agent/handoff.ts");
const { evaluatePreProviderGuardrails } = require("../lib/sdr-agent/guardrails/pre-provider.ts");
const { evaluatePostProviderGuardrails } = require("../lib/sdr-agent/guardrails/post-provider.ts");

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, role TEXT, owner_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, is_authenticated INTEGER DEFAULT 1,
      owner_id TEXT, assigned_user_id TEXT, sdr_enabled INTEGER DEFAULT 0,
      sdr_outbound_enabled INTEGER DEFAULT 0, sdr_canary_percentage INTEGER DEFAULT 0
    );
    CREATE TABLE email_accounts (
      id TEXT PRIMARY KEY, owner_id TEXT, sdr_enabled INTEGER DEFAULT 0,
      sdr_outbound_enabled INTEGER DEFAULT 0
    );
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, full_name TEXT, first_name TEXT, company TEXT, title TEXT,
      sdr_autopilot INTEGER DEFAULT 0
    );
  `);
  applySdrSchema(db);
  db.exec(`
    INSERT INTO users(id, email, role, owner_id) VALUES
      ('owner-1', 'owner@example.test', 'admin', NULL),
      ('seller-1', 'seller@example.test', 'member', 'owner-1');
    INSERT INTO accounts(id, name, email, is_authenticated, owner_id, assigned_user_id, sdr_enabled)
      VALUES ('account-1', 'Slot 1', 'slot@example.test', 1, 'owner-1', 'seller-1', 1);
    INSERT INTO targets(id, full_name, first_name, company, title, sdr_autopilot) VALUES
      ('target-1', 'Lead Test', 'Lead', 'Example Co', 'Buyer', 1),
      ('target-2', 'Unknown Lead', 'Unknown', 'Unknown Co', 'Founder', 1),
      ('target-3', 'Stop Lead', 'Stop', 'Stop Co', 'Buyer', 1);
    INSERT INTO sdr_agents(
      id, workspace_owner_id, name, status, mode, default_language, model,
      confidence_threshold, max_auto_turns, created_by_user_id,
      runtime_enabled, provider_enabled, outbound_enabled
    ) VALUES ('agent-1', 'owner-1', 'Test Agent', 'active', 'shadow', 'es',
      'fake-sdr-v1', 0.85, 3, 'owner-1', 1, 1, 0);
    INSERT INTO sdr_agent_versions(
      id, agent_id, version_number, model, system_prompt, policy_json,
      config_json, publication_state, published_by_user_id
    ) VALUES ('version-1', 'agent-1', 1, 'fake-sdr-v1', 'Test system prompt',
      '{"company_context":"Example context","handoff_rules":"Always ground facts"}',
      '{}', 'published', 'owner-1');
    UPDATE sdr_agents SET active_version_id = 'version-1' WHERE id = 'agent-1';
    INSERT INTO sdr_agent_accounts(agent_id, account_id, enabled, inbound_enabled)
      VALUES ('agent-1', 'account-1', 1, 1);
    INSERT INTO sdr_knowledge_sources(
      id, agent_id, workspace_owner_id, status, title, source_type,
      content, metadata_json, revision, checksum, approved_by_user_id, approved_at
    ) VALUES ('source-1', 'agent-1', 'owner-1', 'approved', 'Product facts', 'catalog',
      'Example automation saves sales teams five hours per week.',
      '{"content":"Example automation saves sales teams five hours per week."}',
      1, 'checksum', 'owner-1', datetime('now'));
    INSERT INTO sdr_knowledge_chunks(
      id, source_id, workspace_owner_id, revision, ordinal, content, checksum
    ) VALUES ('chunk-1', 'source-1', 'owner-1', 1, 0,
      'Example automation saves sales teams five hours per week.', 'chunk-checksum');
  `);
  return db;
}

function inbound(targetId, messageId, body) {
  return {
    eventId: `event-${messageId}`,
    channel: "linkedin",
    targetId,
    accountId: "account-1",
    externalThreadId: `thread-${targetId}`,
    externalMessageId: messageId,
    senderExternalId: `sender-${targetId}`,
    senderName: "Lead Test",
    body,
    receivedAt: new Date().toISOString(),
  };
}

async function main() {
  process.env.SDR_RUNTIME_ENABLED = "true";
  process.env.SDR_PROVIDER_ENABLED = "true";
  process.env.SDR_AGENT_MODE = "shadow";
  process.env.SDR_OUTBOUND_ENABLED = "false";
  delete process.env.NATIVE_CALENDAR_ENABLED;

  const db = createDb();
  try {
    const safe = captureSdrInboundMessage(
      db,
      inbound("target-1", "message-grounded", "How many hours does Example automation save sales teams?"),
    );
    assert.ok(safe.job);
    assert.equal(safe.thread.workspace_owner_id, "owner-1");
    assert.equal(safe.thread.agent_id, "agent-1");
    assert.equal(safe.thread.automation_enabled, 1);

    const provider = new FakeSdrProvider({
      decision: {
        intent: "product_question",
        confidence: 0.97,
        risk_level: "low",
        language: "en",
        reasoning_summary: "The approved product source answers this question.",
        recommended_action: "answer",
        requires_human: false,
        reason_code: null,
        reply_draft: "Example automation saves sales teams five hours per week.",
        knowledge_status: "grounded",
        knowledge_citations: ["chunk-1"],
        missing_information: [],
      },
    });
    const lease = leaseNextSdrJob(db, { workerId: "test-worker", leaseMs: 300000 });
    const processed = await processLeasedClassificationJob(db, lease, { provider });
    assert.equal(processed.status, "completed");
    assert.equal(processed.policy.outcome, "allow");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_decisions").get().c, 1);
    assert.equal(db.prepare("SELECT state FROM sdr_actions").get().state, "proposed");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_outbox").get().c, 0);

    const unknown = captureSdrInboundMessage(
      db,
      inbound("target-2", "message-unknown", "Can you build a custom quantum proposal for our hospital?"),
    );
    const unknownLease = leaseNextSdrJob(db, { workerId: "test-worker", leaseMs: 300000 });
    assert.equal(unknownLease.id, unknown.job.id);
    const handed = await processLeasedClassificationJob(db, unknownLease, { provider });
    assert.equal(handed.status, "completed");
    assert.ok(handed.handoffId);
    assert.equal(db.prepare("SELECT state FROM sdr_threads WHERE target_id = 'target-2'").get().state, "HUMAN_REVIEW");
    const handoff = db.prepare("SELECT assigned_user_id, assignment_source FROM sdr_handoffs WHERE id = ?").get(handed.handoffId);
    assert.deepEqual(handoff, { assigned_user_id: "seller-1", assignment_source: "account_assignee" });
    const notification = db.prepare("SELECT user_id, href, state FROM app_notifications WHERE handoff_id = ?").get(handed.handoffId);
    assert.equal(notification.user_id, "seller-1");
    assert.match(notification.href, new RegExp(`thread=${unknown.thread.id}`));
    assert.equal(notification.state, "unread");

    const takeover = takeHumanControl(db, {
      threadId: unknown.thread.id,
      actorUserId: "seller-1",
      workspaceOwnerId: "owner-1",
    });
    assert.equal(takeover.state, "HUMAN_ACTIVE");
    const lockedEpoch = takeover.controlEpoch;
    const lockedCapture = captureSdrInboundMessage(
      db,
      { ...inbound("target-2", "message-while-human", "One more question"), externalThreadId: unknown.thread.external_thread_id },
    );
    assert.equal(lockedCapture.job, null);
    assert.equal(db.prepare("SELECT state FROM app_notifications WHERE handoff_id = ?").get(handed.handoffId).state, "read");

    const released = releaseHumanControl(db, {
      threadId: unknown.thread.id,
      actorUserId: "seller-1",
      workspaceOwnerId: "owner-1",
      nextState: "AI_ACTIVE",
    });
    assert.equal(released.state, "AI_ACTIVE");
    assert.ok(released.controlEpoch > lockedEpoch);

    const stopped = captureSdrInboundMessage(
      db,
      inbound("target-3", "message-stop", "Please do not contact me again and remove me."),
    );
    const stopLease = leaseNextSdrJob(db, { workerId: "test-worker", leaseMs: 300000 });
    assert.equal(stopLease.id, stopped.job.id);
    const stopResult = await processLeasedClassificationJob(db, stopLease, { provider });
    assert.equal(stopResult.policy.outcome, "stop");
    assert.equal(db.prepare("SELECT state FROM sdr_threads WHERE target_id = 'target-3'").get().state, "DO_NOT_CONTACT");

    const duplicate = captureSdrInboundMessage(
      db,
      inbound("target-1", "message-grounded", "Changed duplicate body"),
    );
    assert.equal(duplicate.duplicate, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_messages WHERE thread_id = ?").get(safe.thread.id).c, 1);

    const preHuman = evaluatePreProviderGuardrails({
      message: "I want to speak with a person",
      thread: {
        state: "AI_ACTIVE", automationEnabled: true, controlEpoch: 0,
        aiTurnCount: 0, maxAutoTurns: 3, confidenceThreshold: 0.85, effectiveMode: "auto",
      },
      calendarEnabled: false,
    });
    assert.equal(preHuman.outcome, "handoff");
    const postMissingCitation = evaluatePostProviderGuardrails({
      decision: {
        intent: "product_question", confidence: 0.99, risk_level: "low", language: "en",
        reasoning_summary: "test", recommended_action: "answer", requires_human: false,
        reply_draft: "Unsupported 99% guarantee", knowledge_status: "grounded",
        knowledge_citations: ["not-available"], missing_information: [],
      },
      thread: {
        state: "AI_ACTIVE", automationEnabled: true, controlEpoch: 0,
        aiTurnCount: 0, maxAutoTurns: 3, confidenceThreshold: 0.85, effectiveMode: "auto",
      },
      knowledgeChunks: [{ id: "chunk-1", sourceId: "source-1", sourceTitle: "Facts", revision: 1, content: "Example fact" }],
      availableCitationIds: new Set(["chunk-1"]),
      calendarEnabled: false,
    });
    assert.equal(postMissingCitation.outcome, "handoff");

    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    console.log("SDR runtime, grounding, handoff, notification, and control tests passed");
  } finally {
    db.close();
    Module._resolveFilename = originalResolve;
    if (originalTsLoader) Module._extensions[".ts"] = originalTsLoader;
    else delete Module._extensions[".ts"];
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

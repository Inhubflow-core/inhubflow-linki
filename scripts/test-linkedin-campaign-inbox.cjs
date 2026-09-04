#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");
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
  captureCampaignInboxObservations,
  loadCampaignTargetScopes,
  listCampaignInboxAccountIds,
  shouldSyncLinkedInCampaignInbox,
} = require("../lib/linkedin/campaign-inbox.ts");
const {
  parseLegacyCampaignInboxFixture,
  selectCampaignMessages,
} = require("../lib/linkedin/campaign-inbox-source.ts");
const { applySdrSchema } = require("../lib/sdr-agent/schema.ts");

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, owner_id TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, email TEXT, is_authenticated INTEGER DEFAULT 1,
      linkedin_inbox_synced_at TEXT, linkedin_inbox_sync_error TEXT, linkedin_inbox_contract_version TEXT);
    CREATE TABLE targets (id TEXT PRIMARY KEY, full_name TEXT, linkedin_url TEXT, messaging_urn TEXT,
      connection_requested_at TEXT, message_sent_at TEXT,
      last_replied_at TEXT, last_replied_account_id TEXT REFERENCES accounts(id), sdr_autopilot INTEGER DEFAULT 0);
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id), workflow_id TEXT REFERENCES workflows(id), status TEXT);
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), target_id TEXT REFERENCES targets(id), created_at TEXT);
    CREATE TABLE logs (id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), target_id TEXT REFERENCES targets(id), message TEXT, created_at TEXT);
    CREATE TABLE run_profile_tracks (id TEXT PRIMARY KEY, run_profile_id TEXT REFERENCES run_profiles(id), state TEXT, next_step_at TEXT, error_message TEXT);
    CREATE TABLE linkedin_inbox_messages (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
      external_thread_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound' CHECK(direction IN ('inbound', 'outbound')),
      sender_external_id TEXT,
      sender_name TEXT,
      body TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      identity_mode TEXT NOT NULL CHECK(identity_mode IN ('messaging_urn', 'profile_url', 'messaging_urn+profile_url')),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(account_id, external_thread_id, external_message_id)
    );
  `);
  applySdrSchema(db);
  return db;
}

function scopeDb() {
  const db = createDb();
  db.exec(`
    INSERT INTO accounts(id, name, email, is_authenticated) VALUES
      ('account-a', 'A', 'a@example.test', 1),
      ('account-b', 'B', 'b@example.test', 1);
    INSERT INTO workflows(id, name) VALUES ('workflow-a', 'Campaign A');
    INSERT INTO targets(id, full_name, linkedin_url, messaging_urn) VALUES
      ('campaign-target', 'Campaign Contact', 'https://linkedin.com/in/campaign-contact/', 'urn:li:fsd_profile:campaign-contact'),
      ('connection-only', 'Connection Only', 'https://linkedin.com/in/connection-only/', 'urn:li:fsd_profile:connection-only'),
      ('personal-target', 'Personal Contact', 'https://linkedin.com/in/personal-target/', 'urn:li:fsd_profile:personal-target');
    INSERT INTO runs(id, account_id, workflow_id, status) VALUES
      ('run-a', 'account-a', 'workflow-a', 'completed'),
      ('run-b', 'account-b', 'workflow-a', 'completed');
    INSERT INTO run_profiles(id, run_id, target_id, created_at) VALUES
      ('profile-campaign', 'run-a', 'campaign-target', datetime('now')),
      ('profile-connection', 'run-a', 'connection-only', datetime('now')),
      ('profile-personal', 'run-a', 'personal-target', datetime('now'));
    INSERT INTO logs(id, run_id, target_id, message, created_at) VALUES
      ('log-message', 'run-a', 'campaign-target', 'Message sent to Campaign Contact', '2026-08-28 10:00:00'),
      ('log-connect', 'run-a', 'connection-only', 'Connection request sent to Connection Only', '2026-08-28 10:00:00'),
      ('log-personal', 'run-a', 'personal-target', 'Visited Personal Contact', '2026-08-28 10:00:00');
    INSERT INTO run_profile_tracks(id, run_profile_id, state) VALUES
      ('track-campaign', 'profile-campaign', 'in_progress'),
      ('track-connection', 'profile-connection', 'in_progress'),
      ('track-personal', 'profile-personal', 'in_progress');
  `);
  return db;
}

const db = scopeDb();
try {
  const scopes = loadCampaignTargetScopes(db, "account-a");
  assert.deepEqual(scopes.map((s) => s.targetId), ["campaign-target"]);
  assert.deepEqual(listCampaignInboxAccountIds(db), ["account-a"]);

  const inbound = {
    externalThreadId: "thread-campaign",
    externalMessageId: "message-reply",
    direction: "inbound",
    body: "Thanks, tell me more.",
    receivedAt: "2026-08-28T11:00:00.000Z",
    senderExternalId: "urn:li:fsd_profile:campaign-contact",
    senderName: "Campaign Contact",
    senderMessagingUrn: "urn:li:fsd_profile:campaign-contact",
    senderProfileUrl: "https://www.linkedin.com/in/campaign-contact/?trk=test",
    campaignOutboundObservedAt: "2026-08-28T10:00:00.000Z",
    campaignRunId: "run-a",
  };
  let result = captureCampaignInboxObservations(db, "account-a", [inbound], scopes);
  assert.equal(result.captured, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_threads").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_messages").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_jobs").get().c, 1);
  assert.equal(db.prepare("SELECT external_thread_id FROM sdr_threads").get().external_thread_id, inbound.externalThreadId);
  assert.equal(db.prepare("SELECT external_message_id FROM sdr_messages").get().external_message_id, inbound.externalMessageId);
  assert.equal(db.prepare("SELECT body FROM linkedin_inbox_messages").get().body, inbound.body);
  assert.equal(db.prepare("SELECT last_replied_account_id FROM targets WHERE id = 'campaign-target'").get().last_replied_account_id, "account-a");
  assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id = 'track-campaign'").get().state, "skipped");

  result = captureCampaignInboxObservations(db, "account-a", [inbound], scopes);
  assert.equal(result.captured, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_threads").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_messages").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sdr_jobs").get().c, 1);

  result = captureCampaignInboxObservations(db, "account-a", [{
    ...inbound,
    externalMessageId: "personal-message",
    body: "A personal note",
    senderMessagingUrn: "urn:li:fsd_profile:unknown",
    senderProfileUrl: "https://www.linkedin.com/in/unknown/",
  }], scopes);
  assert.equal(result.captured, 0);
  assert.equal(result.skipped[0].reason, "unmatched_target");
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM linkedin_inbox_messages").get().c, 1);

  result = captureCampaignInboxObservations(db, "account-a", [{
    ...inbound,
    externalMessageId: "outbound-message",
    direction: "outbound",
  }], scopes);
  assert.equal(result.skipped[0].reason, "invalid_observation");
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM linkedin_inbox_messages").get().c, 1);

  result = captureCampaignInboxObservations(db, "account-a", [{
    ...inbound,
    externalMessageId: "stale-message",
    body: "Historical reply",
    receivedAt: "2026-08-28T09:59:00.000Z",
  }], scopes);
  assert.equal(result.captured, 0);
  assert.equal(result.skipped[0].reason, "stale_message");

  result = captureCampaignInboxObservations(db, "account-a", [{
    ...inbound,
    externalMessageId: "unverified-outbound",
    body: "Reply after unrelated outbound",
    campaignOutboundObservedAt: "2026-08-28T09:30:00.000Z",
  }], scopes);
  assert.equal(result.captured, 0);
  assert.equal(result.skipped[0].reason, "not_campaign_message");

  result = captureCampaignInboxObservations(db, "account-a", [{
    ...inbound,
    externalMessageId: "wrong-run",
    body: "Reply attributed to another run",
    campaignRunId: "run-b",
  }], scopes);
  assert.equal(result.captured, 0);
  assert.equal(result.skipped[0].reason, "not_campaign_message");

  result = captureCampaignInboxObservations(db, "account-a", [{
    ...inbound,
    externalMessageId: "message-repeated-body",
    body: "Another campaign reply",
    receivedAt: "2026-08-28T11:05:00.000Z",
  }], scopes);
  assert.equal(result.captured, 1);
  assert.equal(result.duplicates, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM linkedin_inbox_messages").get().c, 2);

  const self = {
    profileUrn: "urn:li:fsd_profile:self",
    publicIdentifier: "self",
    profileUrl: "https://linkedin.com/in/self/",
    name: "Self",
  };
  const contact = {
    profileUrn: "urn:li:fsd_profile:campaign-contact",
    publicIdentifier: "campaign-contact",
    profileUrl: "https://linkedin.com/in/campaign-contact/",
    name: "Campaign Contact",
  };
  const selectedMessages = selectCampaignMessages([
    { messageId: "old-outbound", sender: self, body: "Old outreach", sentAt: "2026-08-01T09:00:00.000Z", isFromCurrentUser: true },
    { messageId: "old-inbound", sender: contact, body: "Old reply", sentAt: "2026-08-01T09:05:00.000Z", isFromCurrentUser: false },
    { messageId: "campaign-outbound", sender: self, body: "Campaign outreach", sentAt: "2026-08-28T09:58:00.000Z", isFromCurrentUser: true },
    { messageId: "campaign-inbound", sender: contact, body: "Campaign reply", sentAt: "2026-08-28T10:10:00.000Z", isFromCurrentUser: false },
  ], "2026-08-28 10:00:00");
  assert.equal(selectedMessages.outbound.messageId, "campaign-outbound");
  assert.deepEqual(selectedMessages.inbound.map((message) => message.messageId), ["campaign-inbound"]);
  assert.equal(selectCampaignMessages([
    { messageId: "too-old-outbound", sender: self, body: "Old outreach", sentAt: "2026-08-28T09:40:00.000Z", isFromCurrentUser: true },
  ], "2026-08-28 10:00:00"), null);

  db.prepare("UPDATE accounts SET linkedin_inbox_synced_at = datetime('now') WHERE id = 'account-a'").run();
  assert.equal(shouldSyncLinkedInCampaignInbox("account-a", db), false);
  assert.equal(shouldSyncLinkedInCampaignInbox("account-b", db), true);
  const fixtureMessages = parseLegacyCampaignInboxFixture({
    elements: ["urn:li:msg_message:test"],
    included: [
      {
        entityUrn: "urn:li:msg_message:test",
        createdAt: 1787914800000,
        from: "urn:li:fsd_profile:campaign-contact",
        eventContent: { attributedBody: { text: "Thanks, tell me more." } },
      },
      {
        entityUrn: "urn:li:fsd_profile:campaign-contact",
        firstName: "Campaign",
        lastName: "Contact",
        publicIdentifier: "campaign-contact",
      },
    ],
  }, new Set(["urn:li:fsd_profile:self"]), {
    profileUrn: "urn:li:fsd_profile:campaign-contact",
    publicIdentifier: "campaign-contact",
    profileUrl: "https://linkedin.com/in/campaign-contact/",
    name: "Campaign Contact",
  });
  assert.equal(fixtureMessages.length, 1);
  assert.equal(fixtureMessages[0].body, "Thanks, tell me more.");

  assert.throws(() => parseLegacyCampaignInboxFixture({ unknown: true }, new Set(), {
    profileUrn: null, publicIdentifier: null, profileUrl: null, name: null,
  }), /not recognized/);

  console.log("LinkedIn campaign inbox tests passed");
} finally {
  db.close();
  Module._resolveFilename = originalResolve;
  if (originalTsLoader) Module._extensions[".ts"] = originalTsLoader;
  else delete Module._extensions[".ts"];
}

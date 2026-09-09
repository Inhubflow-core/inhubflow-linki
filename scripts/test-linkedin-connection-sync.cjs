#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

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
  canonicalLinkedInVanity,
  calculateConnectionScanFloor,
  matchAcceptedConnection,
  parseVoyagerConnections,
} = require("../lib/linkedin/connection-reconciliation.ts");
const {
  dedupeLinkedInCookies,
  hasValidLinkedInLiAt,
  linkedinCsrfFromCookies,
  normalizeLinkedInCookie,
  normalizeLinkedInCookieList,
  normalizeLinkedInSameSite,
} = require("../lib/linkedin/cookie-state.ts");
const {
  isLinkedInAuthenticationWall,
  LinkedInAuthenticationError,
} = require("../lib/linkedin/auth-wall.ts");
const {
  backfillLinkedInConnectionAttempts,
  countLinkedInConnectionAttemptsToday,
  createLinkedInConnectionAttempt,
  updateLinkedInConnectionAttempt,
} = require("../lib/linkedin/connection-attempts.ts");

function target(id, url, urn = null, memberUrn = null) {
  return {
    id,
    linkedinUrl: url,
    messagingUrn: urn,
    linkedinMemberUrn: memberUrn,
    connectionRequestedAt: "2026-08-26T20:44:16.350Z",
  };
}

assert.equal(canonicalLinkedInVanity("https://www.linkedin.com/in/RobertoOrSe-Agencia/?trk=foo#x"), "robertoorse-agencia");
assert.equal(canonicalLinkedInVanity("RobertoOrSe%2DAgencia"), "robertoorse-agencia");
assert.equal(canonicalLinkedInVanity("https://linkedin.com/company/not-a-person"), null);

const parsed = parseVoyagerConnections({
  data: { "*elements": ["urn:connection:1"] },
  included: [
    { $type: "com.linkedin.voyager.dash.relationships.Connection", connectedMember: "urn:li:fsd_profile:person-1", createdAt: 1787780000000 },
    { $type: "com.linkedin.voyager.dash.identity.profile.Profile", entityUrn: "urn:li:fsd_profile:person-1", publicIdentifier: "RobertoOrSe-Agencia" },
  ],
});
assert.equal(parsed.connections.length, 1);
assert.equal(parsed.connections[0].vanity, "robertoorse-agencia");
assert.equal(matchAcceptedConnection(parsed.connections[0], [target("t1", "https://linkedin.com/in/robertoorse-agencia/")]).targetId, "t1");

const urnConnection = { vanity: null, memberUrn: "urn:li:fsd_profile:exact", createdAt: 1 };
assert.equal(matchAcceptedConnection(urnConnection, [target("t2", null, "urn:li:fsd_profile:exact")]).matchedBy, "urn");
assert.equal(matchAcceptedConnection(urnConnection, [target("t2", null, "urn:li:fsd_profile:exact"), target("t3", null, "urn:li:fsd_profile:exact")]).targetId, null);

const now = Date.parse("2026-08-28T12:00:00.000Z");
const boundary = Date.parse("2026-08-28T01:08:45.000Z");
const floor = calculateConnectionScanFloor({
  boundaryMs: boundary,
  pendingRequestedAt: ["2026-08-26T20:44:16.350Z"],
  nowMs: now,
  overlapMs: 24 * 60 * 60 * 1000,
  maxWaitMs: 7 * 24 * 60 * 60 * 1000,
  requestMarginMs: 24 * 60 * 60 * 1000,
});
assert.ok(floor < boundary - 24 * 60 * 60 * 1000);
assert.equal(calculateConnectionScanFloor({
  boundaryMs: null,
  pendingRequestedAt: [],
  nowMs: now,
  overlapMs: 1,
  maxWaitMs: 1,
  requestMarginMs: 1,
}), null);

const { detectExplicitProfileDegree } = require("../lib/linkedin/visit.ts");

assert.equal(detectExplicitProfileDegree("Roberto • 1st degree connection"), "first");
assert.equal(detectExplicitProfileDegree("Contacto de 1er grado"), "first");
assert.equal(detectExplicitProfileDegree("Conexão de 1º grau"), "first");
assert.equal(detectExplicitProfileDegree("Mariana • 2º"), "second_or_third");
assert.equal(detectExplicitProfileDegree("3rd degree connection"), "second_or_third");
assert.equal(detectExplicitProfileDegree("Message Roberto"), null);

assert.equal(normalizeLinkedInSameSite("no_restriction"), "None");
assert.equal(normalizeLinkedInSameSite("Strict"), "Strict");
assert.equal(normalizeLinkedInSameSite(undefined), "Lax");

const sessionCookie = normalizeLinkedInCookie({
  name: "li_at",
  value: "synthetic-linkedin-session-token",
  domain: ".linkedin.com",
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "no_restriction",
});
assert.ok(sessionCookie);
assert.equal(sessionCookie.sameSite, "None");
assert.equal("expires" in sessionCookie, false);
assert.equal(hasValidLinkedInLiAt([sessionCookie]), true);
assert.equal(normalizeLinkedInCookie({
  name: "li_at",
  value: "synthetic-linkedin-session-token",
  domain: ".example.com",
  path: "/",
}), null);
assert.equal(normalizeLinkedInCookie({
  name: "invalid cookie",
  value: "x",
  domain: ".linkedin.com",
  path: "/",
}), null);
assert.equal(normalizeLinkedInCookieList([
  sessionCookie,
  { name: "bad cookie", value: "x", domain: ".linkedin.com", path: "/" },
]), null);

const duplicateCookies = dedupeLinkedInCookies([
  sessionCookie,
  { ...sessionCookie, value: "ignored-duplicate" },
  { ...sessionCookie, path: "/sales", value: "path-specific" },
]);
assert.equal(duplicateCookies.length, 2);
assert.equal(duplicateCookies[0].value, "synthetic-linkedin-session-token");
assert.equal(linkedinCsrfFromCookies([{ name: "JSESSIONID", value: '"ajax:123456"' }]), "ajax:123456");
assert.equal(linkedinCsrfFromCookies([]), null);

assert.equal(isLinkedInAuthenticationWall("https://www.linkedin.com/checkpoint/challenge/"), true);
assert.equal(isLinkedInAuthenticationWall("https://www.linkedin.com/in/example/"), false);
assert.equal(new LinkedInAuthenticationError("post-submit", true).submissionAttempted, true);
assert.equal(new LinkedInAuthenticationError("pre-submit").submissionAttempted, false);

const attemptDb = new Database(":memory:");
attemptDb.exec(`
  CREATE TABLE linkedin_connection_attempts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    run_id TEXT,
    target_id TEXT,
    outcome TEXT NOT NULL,
    error_message TEXT,
    attempted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT);
  CREATE TABLE runs (id TEXT PRIMARY KEY, account_id TEXT);
  CREATE TABLE logs (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    target_id TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  INSERT INTO run_profiles VALUES ('profile-a', 'run-a', 'shared-target');
  INSERT INTO runs VALUES
    ('run-a', 'account-a'),
    ('run-b', 'account-b'),
    ('legacy-run', 'account-c');
`);
const attemptedAt = new Date().toISOString();
const attemptA = createLinkedInConnectionAttempt(attemptDb, {
  accountId: "account-a",
  runId: "run-a",
  targetId: "shared-target",
  attemptedAt,
});
createLinkedInConnectionAttempt(attemptDb, {
  accountId: "account-b",
  runId: "run-b",
  targetId: "shared-target",
  attemptedAt,
});
attemptDb.prepare("INSERT INTO logs VALUES (?, ?, ?, ?, ?)").run(
  "current-success-log",
  "run-a",
  "shared-target",
  "Connection request sent and confirmed for Test",
  attemptedAt
);
attemptDb.prepare("INSERT INTO logs VALUES (?, ?, ?, ?, ?)").run(
  "legacy-success-log",
  "legacy-run",
  "legacy-target",
  "Connection request confirmed for Legacy Test",
  attemptedAt
);
backfillLinkedInConnectionAttempts(attemptDb);
backfillLinkedInConnectionAttempts(attemptDb);
assert.equal(countLinkedInConnectionAttemptsToday(attemptDb, "account-a"), 1);
assert.equal(countLinkedInConnectionAttemptsToday(attemptDb, "account-b"), 1);
assert.equal(countLinkedInConnectionAttemptsToday(attemptDb, "account-c"), 1);
assert.match(
  attemptDb.prepare("SELECT message FROM logs WHERE id = 'legacy-success-log'").get().message,
  /^Connection request sent and confirmed/
);
attemptDb.prepare("DELETE FROM run_profiles WHERE id = 'profile-a'").run();
assert.equal(countLinkedInConnectionAttemptsToday(attemptDb, "account-a"), 1);
updateLinkedInConnectionAttempt(attemptDb, attemptA, "confirmed");
assert.equal(
  attemptDb.prepare("SELECT outcome FROM linkedin_connection_attempts WHERE id = ?").get(attemptA).outcome,
  "confirmed"
);
attemptDb.close();

// Guard the irreversible connection-send boundary. The durable marker must be
// created by the callback immediately before the click, never before profile or
// modal navigation, and all post-submit auth-wall errors must retain that fact.
const connectSource = fs.readFileSync(require.resolve("../lib/linkedin/connect.ts"), "utf8");
const runnerSource = fs.readFileSync(require.resolve("../lib/linkedin/runner.ts"), "utf8");
const dbSource = fs.readFileSync(require.resolve("../lib/db.ts"), "utf8");
const beforeSubmitCall = connectSource.indexOf("await lifecycle.beforeSubmit?.();");
const sendClick = connectSource.indexOf("await sendButton.click", beforeSubmitCall);
const afterSubmitCall = connectSource.indexOf("await lifecycle.afterSubmit?.();", sendClick);
const confirmationCall = connectSource.indexOf("await confirmConnectionRequest", afterSubmitCall);
assert.ok(
  beforeSubmitCall > 0 &&
  sendClick > beforeSubmitCall &&
  afterSubmitCall > sendClick &&
  confirmationCall > afterSubmitCall
);
assert.equal(
  connectSource.split("\n").filter((line) =>
    line.includes("authentication wall after connection submission") && line.includes(", true)")
  ).length,
  2
);
assert.match(
  runnerSource,
  /sendConnectionRequest\(page, linkedinUrl, \{[\s\S]*?beforeSubmit:[\s\S]*?UPDATE targets SET connection_requested_at/
);
assert.match(runnerSource, /createLinkedInConnectionAttempt\(db, \{[\s\S]*?accountId,[\s\S]*?runId,[\s\S]*?targetId/);
assert.match(runnerSource, /countLinkedInConnectionAttemptsToday\(db, accountId\)/);
assert.match(runnerSource, /Connection request sent and confirmed for/);
assert.match(dbSource, /CREATE TABLE IF NOT EXISTS linkedin_connection_attempts/);
assert.match(dbSource, /backfillLinkedInConnectionAttempts\(db\)/);
assert.doesNotMatch(runnerSource, /UPDATE accounts SET active_hours_start = 0/);
assert.match(runnerSource, /const bypassSchedule = forcedTrackRuns\.delete\(tr\.id\)/);
assert.match(runnerSource, /for \(const track of trackRows\) forcedTrackRuns\.add\(track\.id\)/);

console.log("LinkedIn accepted-connection reconciliation tests passed");

if (originalTsLoader) Module._extensions[".ts"] = originalTsLoader;
else delete Module._extensions[".ts"];

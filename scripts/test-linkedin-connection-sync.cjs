#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

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

console.log("LinkedIn accepted-connection reconciliation tests passed");

if (originalTsLoader) Module._extensions[".ts"] = originalTsLoader;
else delete Module._extensions[".ts"];

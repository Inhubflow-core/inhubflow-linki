#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

// Register in-memory TypeScript compiler for testing
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
  XRaySearchError,
  resolveSubdomain,
  buildXRayQuery,
  normalizeXRayUrl,
  parseXRaySnippet,
} = require("../lib/linkedin/xray.ts");

console.log("▶ [Test 1] Resolving national subdomains");
assert.equal(resolveSubdomain("Santiago, Chile").code, "cl");
assert.equal(resolveSubdomain("Chile").name, "Chile");
assert.equal(resolveSubdomain("São Paulo, Brasil").code, "br");
assert.equal(resolveSubdomain("Madrid, España").code, "es");
assert.equal(resolveSubdomain("Bogotá, Colombia").code, "co");
assert.equal(resolveSubdomain("Global").code, "www");
console.log("  ✔ Subdomains resolved correctly");

console.log("▶ [Test 2] Query building - national & global expansion");
const qChile = buildXRayQuery({ title: "CEO", location: "Santiago, Chile" });
assert.equal(
  qChile.query.includes("(site:cl.linkedin.com/in/ OR site:linkedin.com/in/ OR site:www.linkedin.com/in/)"),
  true,
  "Must include national subdomain AND www/global domain to capture all indexed profiles"
);
assert.equal(
  qChile.query.includes("pub/"),
  false,
  "Must NOT include /pub/ since it is deprecated and discarded by the normalizer"
);
assert.equal(qChile.query.includes('"Santiago"'), true);
assert.equal(qChile.query.includes('-intitle:"profiles"'), true);
assert.equal(qChile.query.includes('-inurl:"dir/"'), true);
assert.equal(qChile.subdomain, "cl");
assert.equal(qChile.countryName, "Chile");

const qGlobal = buildXRayQuery({ title: "Founder", location: "" });
assert.equal(
  qGlobal.query.includes("(site:linkedin.com/in/ OR site:www.linkedin.com/in/)"),
  true
);
assert.equal(qGlobal.subdomain, "www");
console.log("  ✔ Query structure and boolean clauses validated");

console.log("▶ [Test 3] Synonyms expansion & industry OR groups");
const qCeo = buildXRayQuery({ title: "CEO" });
assert.equal(qCeo.query.includes('"Chief Executive Officer"'), true);
assert.equal(qCeo.query.includes('"Director General"'), true);
assert.equal(qCeo.query.includes('"Gerente General"'), true);

const qMultiComp = buildXRayQuery({ title: "Director", company: "Codelco, BHP" });
assert.equal(qMultiComp.query.includes('("Codelco" OR "BHP")'), true);
console.log("  ✔ Synonyms and multi-company OR groups expanded");

console.log("▶ [Test 4] LinkedIn profile URL normalization");
assert.equal(
  normalizeXRayUrl("https://cl.linkedin.com/in/marko-didyk-123/"),
  "https://www.linkedin.com/in/marko-didyk-123/"
);
assert.equal(
  normalizeXRayUrl("https://www.google.com/url?q=https://www.linkedin.com/in/juan-perez-456/&sa=U"),
  "https://www.linkedin.com/in/juan-perez-456/"
);
assert.equal(normalizeXRayUrl("https://www.linkedin.com/dir/Juan/Perez"), null);
assert.equal(normalizeXRayUrl("https://www.linkedin.com/in"), null);
assert.equal(normalizeXRayUrl("https://google.com/search?q=test"), null);
console.log("  ✔ URL normalization correctly strips redirects and rejects non-profile paths");

console.log("▶ [Test 5] Google Snippet parsing & contact extraction");
const parsed = parseXRaySnippet(
  "Marko Didyk - Director de Minería en Codelco | LinkedIn",
  "Santiago, Chile. Especialista en procesos mineros. Contacto: marko@example.com +56912345678"
);
assert.equal(parsed.fullName, "Marko Didyk");
assert.equal(parsed.firstName, "Marko");
assert.equal(parsed.lastName, "Didyk");
assert.equal(parsed.title, "Director de Minería en Codelco");
assert.equal(parsed.company, "Codelco");
assert.equal(parsed.email, "marko@example.com");
assert.equal(parsed.phone, "+56912345678");
console.log("  ✔ Snippet parsed into clean lead structure with contact details");

console.log("▶ [Test 6] XRaySearchError classification");
const errBlocked = new XRaySearchError("Desafío de verificación detectado", "google_blocked");
assert.equal(errBlocked.name, "XRaySearchError");
assert.equal(errBlocked.code, "google_blocked");
assert.equal(errBlocked instanceof Error, true);

const errBrowser = new XRaySearchError("Chromium no disponible", "browser_unavailable");
assert.equal(errBrowser.code, "browser_unavailable");

const errTimeout = new XRaySearchError("Timeout", "timeout");
assert.equal(errTimeout.code, "timeout");
console.log("  ✔ XRaySearchError correctly instantiated and classified");

console.log("\n✅ ALL GOOGLE X-RAY TESTS PASSED CLEANLY!");

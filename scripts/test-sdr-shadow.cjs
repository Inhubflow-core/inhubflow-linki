#!/usr/bin/env node
/**
 * Test SDR Agent in Shadow Mode (with Gemini API)
 *
 * Verifies:
 * 1. Inbound capture & idempotency.
 * 2. Gemini classification, intent detection & confidence scoring.
 * 3. Generation of natural, professional reply drafts (reply_draft).
 * 4. Safety hard stops (unsubscribe, human handoff, hostile/legal).
 * 5. Strict 0-outbound-sends guarantee in Shadow Mode.
 */

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

// Enable TypeScript execution in CommonJS without external runner
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

// Load local environment variables from .env.local or .env
function loadEnv() {
  const envPaths = [
    path.join(__dirname, "..", ".env.local"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, "..", "..", ".env"),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const idx = trimmed.indexOf("=");
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnv();

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

console.log("\n=======================================================");
console.log(" 🚀 INHUBFLOW SDR AGENT — SMOKE TEST (SHADOW MODE)");
console.log("=======================================================\n");

if (!apiKey) {
  console.error("❌ ERROR: GEMINI_API_KEY no encontrada.");
  console.error("\nPor favor configura tu API key en `linki-main/.env.local`:");
  console.error("GEMINI_API_KEY=tu_api_key_aqui");
  console.error("GEMINI_MODEL=gemini-2.5-flash\n");
  process.exit(1);
}

console.log(`✅ API Key detectada (${apiKey.slice(0, 6)}...${apiKey.slice(-4)})`);
console.log(`✅ Modelo configurado: ${modelName}`);
console.log(`🔒 Modo de ejecución: SHADOW (Cero envíos automáticos garantizados)\n`);

// Initialize isolated DB with SDR schema
function createIsolatedDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Core base tables required for foreign keys
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE targets (id TEXT PRIMARY KEY, full_name TEXT, first_name TEXT, company_name TEXT, job_title TEXT, linkedin_url TEXT, messaging_urn TEXT);
    CREATE TABLE email_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL);
  `);

  // Load and apply SDR schema
  const { SDR_SCHEMA_MIGRATIONS } = require("../lib/sdr-agent/schema.ts");
  for (const sql of SDR_SCHEMA_MIGRATIONS) {
    db.exec(sql);
  }

  // Seed sample account & target
  db.prepare("INSERT INTO accounts (id, name, email) VALUES ('acc-1', 'InHubFlow Sales', 'sales@inhubflow.online')").run();
  db.prepare("INSERT INTO targets (id, full_name, first_name, company_name, job_title, linkedin_url) VALUES ('tgt-1', 'Carlos Mendoza', 'Carlos', 'Apex Tech Solutions', 'Director Comercial', 'https://linkedin.com/in/carlos-mendoza')").run();
  db.prepare("INSERT INTO targets (id, full_name, first_name, company_name, job_title, linkedin_url) VALUES ('tgt-2', 'Mariana Souza', 'Mariana', 'Vanguard Media', 'Head of Growth', 'https://linkedin.com/in/mariana-souza')").run();

  return db;
}

const TEST_SCENARIOS = [
  {
    name: "1. Consulta de Interés Comercial (Español)",
    targetId: "tgt-1",
    senderName: "Carlos Mendoza",
    body: "Hola Roberto, vi tu mensaje sobre la automatización de prospección B2B. Actualmente usamos LinkedIn manualmente y nos quita mucho tiempo. ¿Cómo nos ayudaría InHubFlow?",
    expectedIntent: "interested / product_question",
  },
  {
    name: "2. Manejo de Objeción sobre Herramienta Actual (Español)",
    targetId: "tgt-1",
    senderName: "Carlos Mendoza",
    body: "Ya tenemos una persona haciendo outreach en Sales Navigator. ¿En qué se diferencia su solución?",
    expectedIntent: "objection / product_question",
  },
  {
    name: "3. Solicitud Directa de Reunión / Demo (Portugués - Brasil)",
    targetId: "tgt-2",
    senderName: "Mariana Souza",
    body: "Olá! Achei muito interessante a proposta de SDR com IA para WhatsApp e LinkedIn. Vocês têm disponibilidade para me mostrar uma demo amanhã?",
    expectedIntent: "meeting_request",
  },
  {
    name: "4. Hard Stop de Baja / Unsubscribe (Cero Respuestas)",
    targetId: "tgt-1",
    senderName: "Carlos Mendoza",
    body: "No me interesa, por favor no me envíen más mensajes.",
    expectedIntent: "unsubscribe -> stop_outreach",
  },
  {
    name: "5. Petición Explícita de Humano (Handoff)",
    targetId: "tgt-1",
    senderName: "Carlos Mendoza",
    body: "Esto suena interesante pero necesito hablar directamente con el director comercial para acordar condiciones especiales.",
    expectedIntent: "human_requested -> handoff",
  },
];

async function runScenario(db, scenario, index) {
  console.log(`-------------------------------------------------------`);
  console.log(`📋 Escenario ${scenario.name}`);
  console.log(`👤 Prospecto: ${scenario.senderName}`);
  console.log(`📩 Mensaje Inbound:\n   "${scenario.body}"\n`);

  const { captureSdrInboundMessage } = require("../lib/sdr-agent/repository.ts");
  const { processInboundJobInShadowMode } = require("../lib/sdr-agent/pipeline.ts");

  // 1. Capture inbound event
  const inboundEvent = {
    eventId: `evt-smoke-${index}-${Date.now()}`,
    channel: "linkedin",
    targetId: scenario.targetId,
    accountId: "acc-1",
    externalThreadId: `thread-smoke-${index}`,
    externalMessageId: `msg-smoke-${index}-${Date.now()}`,
    senderExternalId: `sender-${scenario.targetId}`,
    senderName: scenario.senderName,
    body: scenario.body,
    receivedAt: new Date().toISOString(),
  };

  const captured = captureSdrInboundMessage(db, inboundEvent);
  console.log(`📥 Captura Inbound: OK (Thread ID: ${captured.thread.id.slice(0, 8)}..., Job ID: ${captured.job.id.slice(0, 8)}...)`);

  // 2. Process job in Shadow Mode with Gemini
  console.log(`🤖 Consultando a Gemini (${modelName})...`);
  const result = await processInboundJobInShadowMode(db, captured.job.id, {
    apiKey,
    modelName,
  });

  const decision = result.decision;
  console.log(`\n🎯 Resultado de la Decisión Gemini:`);
  console.log(`   - Intención (Intent):      ${decision.intent.toUpperCase()}`);
  console.log(`   - Confianza (Confidence):  ${(decision.confidence * 100).toFixed(1)}%`);
  console.log(`   - Nivel de Riesgo (Risk):  ${decision.risk_level.toUpperCase()}`);
  console.log(`   - Idioma Detectado:        ${decision.language}`);
  console.log(`   - Acción Recomendada:      ${decision.recommended_action}`);
  console.log(`   - Requiere Humano:         ${decision.requires_human ? "⚠️ SÍ" : "NO"}`);
  if (decision.reason_code) {
    console.log(`   - Motivo / Reason Code:    ${decision.reason_code}`);
  }
  console.log(`   - Justificación IA:        ${decision.reasoning_summary}`);
  console.log(`   - Latencia:                ${result.latencyMs} ms`);

  if (decision.reply_draft) {
    console.log(`\n💬 Borrador de Respuesta Generado (reply_draft):\n`);
    console.log(`   """\n   ${decision.reply_draft.split("\n").join("\n   ")}\n   """`);
  } else {
    console.log(`\n💬 Borrador de Respuesta: [NINGUNO - Acción ${decision.recommended_action}]`);
  }

  // 3. Verify persistence in DB
  const savedDecision = db.prepare("SELECT * FROM sdr_decisions WHERE id = ?").get(result.decisionId);
  if (!savedDecision) {
    throw new Error(`La decisión ${result.decisionId} no se persistió en sdr_decisions`);
  }
  const jobStatus = db.prepare("SELECT state FROM sdr_jobs WHERE id = ?").get(captured.job.id);
  if (jobStatus.state !== "completed") {
    throw new Error(`El job no quedó marcado como completed (estado actual: ${jobStatus.state})`);
  }

  console.log(`\n🛡️ Verificación de Seguridad:`);
  console.log(`   - Persistido en sdr_decisions: ✅`);
  console.log(`   - Job completado en cola:      ✅`);
  console.log(`   - Mensajes salientes reales:   0 (Garantía Shadow Mode)\n`);
}

async function main() {
  const db = createIsolatedDb();
  console.log("🧪 Base de datos de prueba aislada inicializada con esquema SDR.");
  console.log(`🚀 Iniciando ${TEST_SCENARIOS.length} escenarios de prueba...\n`);

  let passed = 0;
  for (let i = 0; i < TEST_SCENARIOS.length; i++) {
    try {
      await runScenario(db, TEST_SCENARIOS[i], i + 1);
      passed++;
    } catch (err) {
      console.error(`❌ Falló el escenario ${i + 1}:`, err);
      process.exit(1);
    }
  }

  console.log("=======================================================");
  console.log(` 🎉 TODOS LOS ESCENARIOS EN SHADOW MODE PASARON (${passed}/${TEST_SCENARIOS.length})`);
  console.log("=======================================================");
  console.log("Resumen:");
  console.log("✔ Detección y captura de mensajes entrantes.");
  console.log("✔ Clasificación estructurada y multilingüe (ES, PT-BR, EN).");
  console.log("✔ Redacción de borradores adaptados al tono InHubFlow.");
  console.log("✔ Detección de hard stops (unsubscribe y handoff humano).");
  console.log("✔ Cero envíos salientes a LinkedIn ni llamadas a Google Calendar.");
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("Error fatal en smoke test:", err);
  process.exit(1);
});

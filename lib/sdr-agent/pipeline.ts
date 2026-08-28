import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { GeminiSdrProvider, type SdrDecisionOutput } from "./gemini";
import { completeSdrJob, failSdrJob, leaseSdrJob, type SdrJob } from "./jobs";
import { getSdrThread, listSdrMessages, type SdrMessageRecord, type SdrThreadRecord } from "./repository";

export interface ProcessShadowResult {
  jobId: string;
  threadId: string;
  messageId: string;
  decision: SdrDecisionOutput;
  decisionId: string;
  senderName: string | null;
  inboundBody: string;
  latencyMs: number;
}

export interface ShadowPipelineOptions {
  apiKey?: string;
  modelName?: string;
  workerId?: string;
  customInstructions?: string;
}

/**
 * Executes a single inbound classification job strictly in Shadow Mode.
 * It computes the structured classification and reply draft with Gemini,
 * saves the decision to `sdr_decisions`, and completes the job with ZERO outbound actions.
 */
export async function processInboundJobInShadowMode(
  db: Database.Database,
  jobId: string,
  options: ShadowPipelineOptions = {}
): Promise<ProcessShadowResult> {
  const workerId = options.workerId || `shadow-worker-${randomUUID().slice(0, 8)}`;
  const leased = leaseSdrJob(db, jobId, { workerId, leaseMs: 300_000 });
  if (!leased) {
    throw new Error(`No se pudo obtener el lease para el job ${jobId} (posiblemente ya procesado o leased).`);
  }

  const startTime = Date.now();

  try {
    const threadId = leased.thread_id;
    const messageId = leased.message_id;

    if (!threadId || !messageId) {
      throw new Error(`El job ${jobId} no tiene thread_id o message_id asociados.`);
    }

    const thread = getSdrThread(db, threadId);
    if (!thread) {
      throw new Error(`No se encontró el thread SDR ${threadId}`);
    }

    const messages = listSdrMessages(db, threadId);
    const targetMessage = messages.find((m) => m.id === messageId);
    if (!targetMessage) {
      throw new Error(`No se encontró el mensaje SDR ${messageId} en el thread ${threadId}`);
    }

    // Contexto del prospecto (si existe en la tabla targets)
    let prospectName = targetMessage.sender_name || "Prospecto";
    try {
      const targetRow = db.prepare("SELECT full_name, first_name, company_name, job_title FROM targets WHERE id = ?").get(thread.target_id) as
        | { full_name?: string; first_name?: string; company_name?: string; job_title?: string }
        | undefined;
      if (targetRow) {
        if (targetRow.full_name) prospectName = targetRow.full_name;
        else if (targetRow.first_name) prospectName = targetRow.first_name;
      }
    } catch {
      // Si targets no está presente en un test aislado, ignoramos
    }

    const conversationHistory = messages
      .filter((m) => m.id !== messageId)
      .map((m) => ({
        direction: m.direction,
        body: m.body,
        sentAt: m.sent_at,
      }));

    const gemini = new GeminiSdrProvider(options.apiKey, options.modelName);
    const decision = await gemini.classifyAndDraft({
      inboundMessage: targetMessage.body,
      senderName: prospectName,
      conversationHistory,
      customInstructions: options.customInstructions,
    });

    const latencyMs = Date.now() - startTime;
    const decisionId = randomUUID();

    db.prepare(`
      INSERT INTO sdr_decisions (
        id, job_id, thread_id, message_id, intent, confidence, risk_level,
        language, recommended_action, requires_human, reason_code, reply_draft,
        citations_json, decision_json, model, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decisionId,
      jobId,
      threadId,
      messageId,
      decision.intent,
      decision.confidence,
      decision.risk_level,
      decision.language,
      decision.recommended_action,
      decision.requires_human ? 1 : 0,
      decision.reason_code ?? null,
      decision.reply_draft ?? null,
      JSON.stringify(decision.knowledge_citations ?? []),
      JSON.stringify(decision),
      options.modelName || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      latencyMs
    );

    // Si requiere humano, actualizamos el estado del thread a HUMAN_REVIEW
    if (decision.requires_human) {
      db.prepare(`
        UPDATE sdr_threads
        SET state = 'HUMAN_REVIEW', updated_at = datetime('now')
        WHERE id = ? AND state = 'AI_ACTIVE'
      `).run(threadId);
    }

    completeSdrJob(db, jobId, leased.lease_token);

    return {
      jobId,
      threadId,
      messageId,
      decision,
      decisionId,
      senderName: prospectName,
      inboundBody: targetMessage.body,
      latencyMs,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    failSdrJob(db, jobId, {
      leaseToken: leased.lease_token,
      error: errorMsg,
    });
    throw err;
  }
}

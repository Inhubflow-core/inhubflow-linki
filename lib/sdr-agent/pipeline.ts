import type Database from "better-sqlite3";
import { leaseSdrJob } from "./jobs";
import { processLeasedClassificationJob } from "./orchestrator";
import { GeminiSdrProvider } from "./providers/gemini";
import type { SdrDecisionOutput, SdrProvider } from "./providers/provider";

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
  provider?: SdrProvider;
}

/**
 * Compatibility helper for controlled one-job Shadow tests. Production workers
 * call processLeasedClassificationJob after leasing from the durable queue.
 */
export async function processInboundJobInShadowMode(
  db: Database.Database,
  jobId: string,
  options: ShadowPipelineOptions = {},
): Promise<ProcessShadowResult> {
  const leased = leaseSdrJob(db, jobId, {
    workerId: options.workerId ?? `shadow-test-${process.pid}`,
    leaseMs: 300_000,
  });
  if (!leased) throw new Error(`Unable to lease SDR job ${jobId}`);
  const provider = options.provider ?? new GeminiSdrProvider({
    apiKey: options.apiKey,
    modelName: options.modelName,
  });
  const result = await processLeasedClassificationJob(db, leased, { provider });
  if (result.status !== "completed" || !result.decision || !result.decisionId) {
    throw new Error(`SDR shadow job ${jobId} ended in ${result.status}`);
  }
  const message = db.prepare(
    "SELECT sender_name, body FROM sdr_messages WHERE id = ?",
  ).get(result.messageId) as { sender_name: string | null; body: string };
  return {
    jobId: result.jobId,
    threadId: result.threadId,
    messageId: result.messageId,
    decision: result.decision,
    decisionId: result.decisionId,
    senderName: message.sender_name,
    inboundBody: message.body,
    latencyMs: result.latencyMs ?? 0,
  };
}

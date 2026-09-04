import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  SdrInboundMessageSchema,
  type SdrModuleBridge,
  type SdrModuleStatus,
  type SdrPublishResult,
  type SdrTickResult,
} from "./contracts";
import { captureSdrInboundMessage } from "./repository";
import { resolveSdrOperationalStatus } from "./runtime";
import type { SdrAgentRecord, SdrAgentVersionRecord } from "./seed";
import { runSdrWorkerTick } from "./worker";

export interface SdrBridgeOptions {
  getDatabase?: () => Database.Database;
}

function unavailable(reason: SdrModuleStatus["reason"], blocker: string): SdrModuleStatus {
  return {
    available: false,
    requestedMode: "off",
    effectiveMode: "off",
    outboundEnabled: false,
    inboundEnabled: false,
    providerEnabled: false,
    linkedinOutboundEnabled: false,
    emailOutboundEnabled: false,
    calendarEnabled: false,
    blockers: [blocker],
    reason,
  };
}

class OperationalSdrBridge implements SdrModuleBridge {
  private readonly database: () => Database.Database;

  constructor(options: SdrBridgeOptions) {
    this.database = options.getDatabase ?? getDb;
  }

  getStatus(workspaceOwnerId?: string): SdrModuleStatus {
    try {
      const db = this.database();
      const agent = workspaceOwnerId
        ? db.prepare(`
            SELECT * FROM sdr_agents
            WHERE workspace_owner_id = ? AND status != 'archived'
            ORDER BY created_at ASC LIMIT 1
          `).get(workspaceOwnerId) as SdrAgentRecord | undefined
        : db.prepare(`
            SELECT * FROM sdr_agents
            WHERE status != 'archived'
            ORDER BY created_at ASC LIMIT 1
          `).get() as SdrAgentRecord | undefined;
      if (!agent) return unavailable("module_unavailable", "agent_missing");
      const version = agent.active_version_id
        ? db.prepare(
            "SELECT * FROM sdr_agent_versions WHERE id = ? AND agent_id = ?",
          ).get(agent.active_version_id, agent.id) as SdrAgentVersionRecord | undefined
        : undefined;
      const status = resolveSdrOperationalStatus(db, agent, version ?? null);
      const worker = db.prepare(
        "SELECT * FROM sdr_runtime_state WHERE scope_key = 'global'",
      ).get() as Record<string, unknown> | undefined;
      const queueRows = db.prepare(`
        SELECT state, COUNT(*) AS count FROM sdr_jobs
        WHERE workspace_owner_id IS ? GROUP BY state
      `).all(agent.workspace_owner_id) as Array<{ state: string; count: number }>;
      return {
        ...status,
        worker: worker ?? null,
        queue: Object.fromEntries(queueRows.map((row) => [row.state, row.count])),
      };
    } catch {
      return unavailable("module_unavailable", "schema_or_database_unavailable");
    }
  }

  async publishInboundMessage(event: unknown): Promise<SdrPublishResult> {
    const parsed = SdrInboundMessageSchema.safeParse(event);
    if (!parsed.success) {
      return {
        accepted: false,
        reason: "invalid_event",
        eventId: null,
        validationErrors: parsed.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      };
    }
    try {
      const captured = captureSdrInboundMessage(this.database(), parsed.data);
      return {
        accepted: true,
        reason: captured.job ? "queued" : "captured",
        eventId: parsed.data.eventId,
      };
    } catch {
      return {
        accepted: false,
        reason: "module_unavailable",
        eventId: parsed.data.eventId,
      };
    }
  }

  async runWorkerTick(): Promise<SdrTickResult> {
    try {
      return await runSdrWorkerTick(this.database());
    } catch {
      return {
        processed: 0,
        failed: 1,
        cancelled: 0,
        skipped: true,
        reason: "worker_error",
      };
    }
  }
}

export function createSdrBridge(options: SdrBridgeOptions = {}): SdrModuleBridge {
  return new OperationalSdrBridge(options);
}

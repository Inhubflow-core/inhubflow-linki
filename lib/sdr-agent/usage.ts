import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SdrProviderResult } from "./providers/provider";

function envNumber(name: string): number | null {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function estimateProviderCost(result: SdrProviderResult): number | null {
  const inputRate = envNumber("GEMINI_INPUT_COST_PER_MILLION_USD");
  const outputRate = envNumber("GEMINI_OUTPUT_COST_PER_MILLION_USD");
  if (inputRate === null || outputRate === null) return null;
  const input = result.usage.inputTokens ?? 0;
  const output = result.usage.outputTokens ?? 0;
  return (input * inputRate + output * outputRate) / 1_000_000;
}

export function hasProviderBudget(
  db: Database.Database,
  workspaceOwnerId: string,
  agentId: string,
  dailyBudgetUsd: number | null,
): boolean {
  if (dailyBudgetUsd === null) return true;
  const row = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) AS spent
    FROM sdr_usage_ledger
    WHERE workspace_owner_id = ? AND agent_id = ?
      AND date(occurred_at) = date('now') AND status = 'success'
  `).get(workspaceOwnerId, agentId) as { spent: number };
  return row.spent < dailyBudgetUsd;
}

export function recordProviderSuccess(
  db: Database.Database,
  input: {
    workspaceOwnerId: string;
    agentId: string;
    decisionId: string;
    result: SdrProviderResult;
  },
): number | null {
  const cost = estimateProviderCost(input.result);
  db.prepare(`
    INSERT INTO sdr_usage_ledger (
      id, workspace_owner_id, agent_id, decision_id, provider, model,
      input_tokens, output_tokens, cost_usd, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')
  `).run(
    randomUUID(),
    input.workspaceOwnerId,
    input.agentId,
    input.decisionId,
    input.result.provider,
    input.result.model,
    input.result.usage.inputTokens,
    input.result.usage.outputTokens,
    cost,
  );
  db.prepare(`
    INSERT INTO sdr_circuit_breakers (
      id, workspace_owner_id, agent_id, capability, state, failure_count, updated_at
    ) VALUES (?, ?, ?, 'provider', 'closed', 0, datetime('now'))
    ON CONFLICT(workspace_owner_id, agent_id, capability) DO UPDATE SET
      state = 'closed', failure_count = 0, opened_at = NULL,
      retry_after = NULL, last_error = NULL, updated_at = datetime('now')
  `).run(randomUUID(), input.workspaceOwnerId, input.agentId);
  return cost;
}

export function recordProviderFailure(
  db: Database.Database,
  input: {
    workspaceOwnerId: string;
    agentId: string;
    provider: string;
    model: string;
    errorCode: string;
  },
): void {
  db.prepare(`
    INSERT INTO sdr_usage_ledger (
      id, workspace_owner_id, agent_id, provider, model, status, error_code
    ) VALUES (?, ?, ?, ?, ?, 'failed', ?)
  `).run(
    randomUUID(),
    input.workspaceOwnerId,
    input.agentId,
    input.provider,
    input.model,
    input.errorCode,
  );
  db.prepare(`
    INSERT INTO sdr_circuit_breakers (
      id, workspace_owner_id, agent_id, capability, state, failure_count,
      opened_at, retry_after, last_error, updated_at
    ) VALUES (?, ?, ?, 'provider', 'closed', 1, NULL, NULL, ?, datetime('now'))
    ON CONFLICT(workspace_owner_id, agent_id, capability) DO UPDATE SET
      failure_count = failure_count + 1,
      state = CASE WHEN failure_count + 1 >= 5 THEN 'open' ELSE state END,
      opened_at = CASE WHEN failure_count + 1 >= 5 THEN datetime('now') ELSE opened_at END,
      retry_after = CASE WHEN failure_count + 1 >= 5 THEN datetime('now', '+5 minutes') ELSE retry_after END,
      last_error = excluded.last_error,
      updated_at = datetime('now')
  `).run(
    randomUUID(),
    input.workspaceOwnerId,
    input.agentId,
    input.errorCode.slice(0, 500),
  );
}

import type Database from "better-sqlite3";
import { evaluatePostProviderGuardrails } from "./guardrails/post-provider";
import { evaluatePreProviderGuardrails } from "./guardrails/pre-provider";
import { policyDecision, type SdrPolicyResult, type ThreadPolicyContext } from "./guardrails/types";
import { retrieveApprovedKnowledge } from "./knowledge/retrieval";
import { deterministicDecision } from "./orchestrator";
import { GeminiSdrProvider } from "./providers/gemini";
import type { SdrConversationMessage, SdrDecisionOutput, SdrProvider } from "./providers/provider";
import { ensureSdrAgent } from "./seed";

export interface SdrSimulationInput {
  workspaceOwnerId: string;
  message: string;
  senderName?: string | null;
  history?: SdrConversationMessage[];
  provider?: SdrProvider;
  useLiveProvider?: boolean;
}

export interface SdrSimulationResult {
  decision: SdrDecisionOutput;
  policy: SdrPolicyResult;
  provider: string;
  model: string;
  latencyMs: number;
  knowledgeChunkCount: number;
}

function parseObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function simulateSdrDecision(
  db: Database.Database,
  input: SdrSimulationInput,
): Promise<SdrSimulationResult> {
  const startedAt = Date.now();
  const { agent, activeVersion } = ensureSdrAgent(db, input.workspaceOwnerId);
  if (!activeVersion) throw new Error("The SDR agent has no active version");
  const context = retrieveApprovedKnowledge(db, {
    workspaceOwnerId: input.workspaceOwnerId,
    agentId: agent.id,
    query: input.message,
  });
  const thread: ThreadPolicyContext = {
    state: "AI_ACTIVE",
    automationEnabled: true,
    controlEpoch: 0,
    aiTurnCount: 0,
    maxAutoTurns: agent.max_auto_turns,
    confidenceThreshold: agent.confidence_threshold,
    effectiveMode: "approval",
  };
  const prePolicy = evaluatePreProviderGuardrails({
    message: input.message,
    thread,
    calendarEnabled: false,
  });
  if (["handoff", "stop", "block"].includes(prePolicy.outcome)) {
    return {
      decision: deterministicDecision(prePolicy),
      policy: prePolicy,
      provider: "policy",
      model: "deterministic-guardrails-v1",
      latencyMs: Date.now() - startedAt,
      knowledgeChunkCount: context.chunks.length,
    };
  }
  if (context.chunks.length === 0) {
    const policy: SdrPolicyResult = {
      outcome: "handoff",
      reasons: ["missing_approved_knowledge"],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
    return {
      decision: deterministicDecision(policy),
      policy,
      provider: "policy",
      model: "knowledge-gate-v1",
      latencyMs: Date.now() - startedAt,
      knowledgeChunkCount: 0,
    };
  }

  const provider = input.provider ?? (() => {
    if (!input.useLiveProvider || process.env.SDR_SIMULATION_LIVE_ENABLED !== "true") {
      throw new Error("Live SDR simulation is disabled");
    }
    return new GeminiSdrProvider({ modelName: activeVersion.model ?? agent.model ?? undefined });
  })();
  const policyJson = parseObject(activeVersion.policy_json);
  const configJson = parseObject(activeVersion.config_json);
  const providerResult = await provider.classifyAndDraft({
    inboundMessage: input.message,
    senderName: input.senderName ?? "Prospecto",
    conversationHistory: input.history?.slice(-20) ?? [],
    systemPrompt: activeVersion.system_prompt,
    companyContext: typeof policyJson.company_context === "string" ? policyJson.company_context : "",
    handoffRules: typeof policyJson.handoff_rules === "string" ? policyJson.handoff_rules : "",
    customInstructions: typeof configJson.custom_instructions === "string" ? configJson.custom_instructions : "",
    knowledgeChunks: context.chunks,
  });
  const postPolicy = evaluatePostProviderGuardrails({
    decision: providerResult.decision,
    thread,
    knowledgeChunks: context.chunks,
    availableCitationIds: context.availableCitationIds,
    calendarEnabled: false,
  });
  return {
    decision: policyDecision(providerResult.decision, postPolicy),
    policy: postPolicy,
    provider: providerResult.provider,
    model: providerResult.model,
    latencyMs: Date.now() - startedAt,
    knowledgeChunkCount: context.chunks.length,
  };
}

import type { SdrActionType, SdrDecisionOutput, SdrIntent } from "../providers/provider";

export type PolicyOutcome = "allow" | "require_approval" | "handoff" | "stop" | "block";

export interface SdrPolicyResult {
  outcome: PolicyOutcome;
  reasons: string[];
  forcedIntent?: SdrIntent;
  forcedAction?: SdrActionType;
  requiresHuman: boolean;
  replyDraft: string | null;
}

export interface ThreadPolicyContext {
  state: string;
  automationEnabled: boolean;
  controlEpoch: number;
  aiTurnCount: number;
  maxAutoTurns: number;
  confidenceThreshold: number;
  effectiveMode: "off" | "shadow" | "approval" | "auto";
}

export function policyDecision(
  decision: SdrDecisionOutput,
  policy: SdrPolicyResult,
): SdrDecisionOutput {
  return {
    ...decision,
    intent: policy.forcedIntent ?? decision.intent,
    recommended_action: policy.forcedAction ?? decision.recommended_action,
    requires_human: policy.requiresHuman || decision.requires_human,
    reason_code: policy.reasons[0] ?? decision.reason_code ?? null,
    reply_draft: policy.replyDraft,
  };
}

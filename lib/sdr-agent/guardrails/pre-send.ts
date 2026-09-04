import type { SdrPolicyResult } from "./types";

export interface PreSendGuardrailInput {
  expectedControlEpoch: number;
  currentControlEpoch: number;
  threadState: string;
  effectiveMode: "off" | "shadow" | "approval" | "auto";
  actionWasApproved: boolean;
  agentOutboundEnabled: boolean;
  accountOutboundEnabled: boolean;
  globalOutboundEnabled: boolean;
  channelOutboundEnabled: boolean;
  targetDoNotContact: boolean;
  hasNewerInbound: boolean;
  quotaAvailable: boolean;
  circuitClosed: boolean;
  body: string;
}

export function evaluatePreSendGuardrails(input: PreSendGuardrailInput): SdrPolicyResult {
  const reasons: string[] = [];
  if (input.currentControlEpoch !== input.expectedControlEpoch) reasons.push("stale_control_epoch");
  if (input.threadState !== "AI_ACTIVE") reasons.push(`thread_state_${input.threadState.toLowerCase()}`);
  if (input.effectiveMode === "off" || input.effectiveMode === "shadow") reasons.push("effective_mode_disallows_send");
  if (input.effectiveMode === "approval" && !input.actionWasApproved) reasons.push("approval_required");
  if (!input.agentOutboundEnabled) reasons.push("agent_outbound_disabled");
  if (!input.accountOutboundEnabled) reasons.push("account_outbound_disabled");
  if (!input.globalOutboundEnabled) reasons.push("global_outbound_disabled");
  if (!input.channelOutboundEnabled) reasons.push("channel_outbound_disabled");
  if (input.targetDoNotContact) reasons.push("do_not_contact");
  if (input.hasNewerInbound) reasons.push("newer_inbound_exists");
  if (!input.quotaAvailable) reasons.push("quota_exhausted");
  if (!input.circuitClosed) reasons.push("circuit_open");
  if (!input.body.trim()) reasons.push("empty_body");

  return reasons.length > 0
    ? { outcome: "block", reasons, requiresHuman: false, replyDraft: null }
    : { outcome: "allow", reasons: [], requiresHuman: false, replyDraft: input.body.trim() };
}

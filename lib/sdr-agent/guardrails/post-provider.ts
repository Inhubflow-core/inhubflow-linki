import { citationsAreValid } from "../knowledge/retrieval";
import type { SdrDecisionOutput, SdrKnowledgeChunk } from "../providers/provider";
import type { SdrPolicyResult, ThreadPolicyContext } from "./types";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unsupportedClaims(reply: string, chunks: readonly SdrKnowledgeChunk[]): string[] {
  const evidence = normalize(chunks.map((chunk) => chunk.content).join("\n"));
  const reasons: string[] = [];
  const urls = reply.match(/https?:\/\/[^\s)]+/gi) ?? [];
  if (urls.some((url) => !evidence.includes(normalize(url.replace(/[.,;!?]+$/, ""))))) {
    reasons.push("unsupported_url");
  }

  const numbers = reply.match(/(?:[$€£]\s*)?\b\d+(?:[.,]\d+)?%?\b/g) ?? [];
  if (numbers.some((number) => !evidence.includes(normalize(number)))) {
    reasons.push("unsupported_numeric_claim");
  }

  const commercialTerms = [
    "garantizado", "garantia", "guaranteed", "sin riesgo", "no risk", "0% riesgo",
    "descuento", "discount", "desconto", "sla", "contrato", "contract",
  ];
  const normalizedReply = normalize(reply);
  if (commercialTerms.some((term) => normalizedReply.includes(term) && !evidence.includes(term))) {
    reasons.push("unsupported_commercial_claim");
  }
  return [...new Set(reasons)];
}

export interface PostProviderInput {
  decision: SdrDecisionOutput;
  thread: ThreadPolicyContext;
  knowledgeChunks: readonly SdrKnowledgeChunk[];
  availableCitationIds: ReadonlySet<string>;
  calendarEnabled: boolean;
}

export function evaluatePostProviderGuardrails(input: PostProviderInput): SdrPolicyResult {
  const { decision, thread } = input;
  if (thread.effectiveMode === "off") {
    return {
      outcome: "block",
      reasons: ["effective_mode_off"],
      requiresHuman: false,
      replyDraft: null,
    };
  }
  if (["HUMAN_REVIEW", "HUMAN_ACTIVE", "RESOLVED", "DO_NOT_CONTACT"].includes(thread.state)) {
    return {
      outcome: "block",
      reasons: [`thread_state_${thread.state.toLowerCase()}`],
      requiresHuman: thread.state.startsWith("HUMAN_"),
      replyDraft: null,
    };
  }
  if (decision.intent === "unsubscribe" || decision.recommended_action === "stop_outreach") {
    return {
      outcome: "stop",
      reasons: ["unsubscribe_or_stop_action"],
      forcedIntent: "unsubscribe",
      forcedAction: "stop_outreach",
      requiresHuman: false,
      replyDraft: null,
    };
  }

  const handoffReasons: string[] = [];
  if (decision.requires_human || decision.recommended_action === "handoff") {
    handoffReasons.push(decision.reason_code ?? "provider_requested_handoff");
  }
  if (decision.risk_level === "high") handoffReasons.push("high_risk");
  if (decision.confidence < thread.confidenceThreshold) handoffReasons.push("low_confidence");
  if (decision.knowledge_status !== "grounded") handoffReasons.push("missing_approved_knowledge");
  if (input.knowledgeChunks.length === 0) handoffReasons.push("missing_approved_knowledge");
  if (!citationsAreValid(decision.knowledge_citations, input.availableCitationIds)) {
    handoffReasons.push("invalid_or_missing_citations");
  }
  if (["human_requested", "hostile_or_legal", "proposal_request"].includes(decision.intent)) {
    handoffReasons.push("intent_requires_human");
  }
  if (["create_proposal"].includes(decision.recommended_action)) {
    handoffReasons.push("proposal_requires_human");
  }
  if (!input.calendarEnabled && (decision.intent === "meeting_request" || decision.recommended_action === "offer_slots")) {
    handoffReasons.push("native_calendar_not_available");
  }
  if (thread.aiTurnCount >= thread.maxAutoTurns) handoffReasons.push("max_ai_turns_reached");
  if (
    ["answer", "ask_clarification", "offer_slots"].includes(decision.recommended_action) &&
    !decision.reply_draft?.trim()
  ) {
    handoffReasons.push("missing_reply_draft");
  }
  if (decision.reply_draft) {
    handoffReasons.push(...unsupportedClaims(decision.reply_draft, input.knowledgeChunks));
  }

  if (handoffReasons.length > 0) {
    return {
      outcome: "handoff",
      reasons: [...new Set(handoffReasons)],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }

  if (decision.recommended_action === "no_action") {
    return {
      outcome: "block",
      reasons: ["provider_no_action"],
      requiresHuman: false,
      replyDraft: null,
    };
  }

  if (thread.effectiveMode === "shadow") {
    return {
      outcome: "allow",
      reasons: ["shadow_only"],
      requiresHuman: false,
      replyDraft: decision.reply_draft ?? null,
    };
  }
  if (thread.effectiveMode === "approval") {
    return {
      outcome: "require_approval",
      reasons: ["approval_mode"],
      requiresHuman: false,
      replyDraft: decision.reply_draft ?? null,
    };
  }
  if (!["answer", "ask_clarification"].includes(decision.recommended_action)) {
    return {
      outcome: "handoff",
      reasons: ["action_not_auto_eligible"],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }

  return {
    outcome: "allow",
    reasons: ["auto_eligible"],
    requiresHuman: false,
    replyDraft: decision.reply_draft ?? null,
  };
}

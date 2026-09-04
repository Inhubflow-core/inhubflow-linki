import type { SdrPolicyResult, ThreadPolicyContext } from "./types";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

const UNSUBSCRIBE_PATTERNS = [
  /\b(no me (?:contactes|escribas|envies)|deja de (?:contactarme|escribirme)|darme de baja|borrame|no me interesa|unsubscribe|remove me|stop (?:emailing|messaging|contacting)|do not contact|nao me (?:contate|mande)|remova meu contato|pare de enviar)\b/,
];
const HUMAN_PATTERNS = [
  /\b(hablar|conversar|falar|speak|talk)\b.{0,40}\b(persona|person|humano|human|gerente|director|dono|owner|representante|agent)\b/,
  /\b(persona|person|humano|human|gerente|director|dono|owner|representante)\b.{0,40}\b(hablar|conversar|falar|speak|talk)\b/,
];
const LEGAL_PATTERNS = [
  /\b(legal|ilegal|lawyer|attorney|lawsuit|demanda|abogado|advogado|gdpr|rgpd|compliance|denuncia|report you|acciones legales|acao judicial)\b/,
];
const HOSTILE_PATTERNS = [
  /\b(estafa|scam|fraude|fraud|acoso|harassment|assedio|amenaza|threat)\b/,
];
const PROPOSAL_PATTERNS = [
  /\b(propuesta|proposal|proposta|cotizacion|cotacao|quote|rfp|contrato|contract|scope|alcance personalizado|custom scope|termos especiais|condiciones especiales)\b/,
];
const NEGOTIATION_PATTERNS = [
  /\b(descuento|discount|desconto|rebaja|negociar|negotiate|negociacao|precio especial|special price|preco especial|sla|garantia|guarantee)\b/,
];
const PROMPT_INJECTION_PATTERNS = [
  /\b(ignore|ignora|ignore todas|disregard|olvide|esquece)\b.{0,60}\b(instrucciones|instructions|regras|reglas|prompt|system)\b/,
  /\b(system prompt|developer message|mensaje del sistema|mensagem do sistema|reveal your prompt|muestra tu prompt)\b/,
  /\b(actua como|act as|aja como)\b.{0,80}\b(system|administrador|developer|desenvolvedor)\b/,
];
const MEETING_PATTERNS = [
  /\b(reunion|reuniao|meeting|demo|llamada|call|agendar|schedule|calendar|calendario|horario|availability|disponibilidade)\b/,
];

export interface PreProviderInput {
  message: string;
  thread: ThreadPolicyContext;
  calendarEnabled: boolean;
}

export function evaluatePreProviderGuardrails(input: PreProviderInput): SdrPolicyResult {
  const message = normalize(input.message);
  const blockedStates = new Set(["HUMAN_REVIEW", "HUMAN_ACTIVE", "RESOLVED", "DO_NOT_CONTACT"]);
  if (blockedStates.has(input.thread.state)) {
    return {
      outcome: "block",
      reasons: [`thread_state_${input.thread.state.toLowerCase()}`],
      requiresHuman: input.thread.state === "HUMAN_REVIEW" || input.thread.state === "HUMAN_ACTIVE",
      replyDraft: null,
    };
  }

  if (matchesAny(message, UNSUBSCRIBE_PATTERNS)) {
    return {
      outcome: "stop",
      reasons: ["unsubscribe_detected"],
      forcedIntent: "unsubscribe",
      forcedAction: "stop_outreach",
      requiresHuman: false,
      replyDraft: null,
    };
  }
  if (matchesAny(message, PROMPT_INJECTION_PATTERNS)) {
    return {
      outcome: "handoff",
      reasons: ["prompt_injection_detected"],
      forcedIntent: "ambiguous",
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }
  if (matchesAny(message, HUMAN_PATTERNS)) {
    return {
      outcome: "handoff",
      reasons: ["human_explicit_request"],
      forcedIntent: "human_requested",
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }
  if (matchesAny(message, LEGAL_PATTERNS) || matchesAny(message, HOSTILE_PATTERNS)) {
    return {
      outcome: "handoff",
      reasons: ["legal_or_compliance_risk"],
      forcedIntent: "hostile_or_legal",
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }
  if (matchesAny(message, PROPOSAL_PATTERNS)) {
    return {
      outcome: "handoff",
      reasons: ["proposal_requires_human"],
      forcedIntent: "proposal_request",
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }
  if (matchesAny(message, NEGOTIATION_PATTERNS)) {
    return {
      outcome: "handoff",
      reasons: ["commercial_exception_requires_human"],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }
  if (!input.calendarEnabled && matchesAny(message, MEETING_PATTERNS)) {
    return {
      outcome: "handoff",
      reasons: ["native_calendar_not_available"],
      forcedIntent: "meeting_request",
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }
  if (!input.thread.automationEnabled) {
    return {
      outcome: "block",
      reasons: ["thread_automation_disabled"],
      requiresHuman: false,
      replyDraft: null,
    };
  }
  if (input.thread.effectiveMode === "off") {
    return {
      outcome: "block",
      reasons: ["effective_mode_off"],
      requiresHuman: false,
      replyDraft: null,
    };
  }
  if (input.thread.aiTurnCount >= input.thread.maxAutoTurns) {
    return {
      outcome: "handoff",
      reasons: ["max_ai_turns_reached"],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
  }

  return {
    outcome: input.thread.effectiveMode === "approval" ? "require_approval" : "allow",
    reasons: [],
    requiresHuman: false,
    replyDraft: null,
  };
}

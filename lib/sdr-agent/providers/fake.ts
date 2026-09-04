import {
  SdrDecisionOutputSchema,
  type SdrClassificationInput,
  type SdrDecisionOutput,
  type SdrProvider,
  type SdrProviderResult,
} from "./provider";

export interface FakeSdrProviderOptions {
  decision?: Partial<SdrDecisionOutput>;
  handler?: (input: SdrClassificationInput) => SdrDecisionOutput | Promise<SdrDecisionOutput>;
  error?: Error;
  modelName?: string;
}

const SAFE_DEFAULT: SdrDecisionOutput = {
  intent: "ambiguous",
  confidence: 0,
  risk_level: "high",
  language: "es",
  reasoning_summary: "El provider de prueba requiere revisión humana.",
  recommended_action: "handoff",
  requires_human: true,
  reason_code: "fake_provider_default",
  reply_draft: null,
  knowledge_status: "missing",
  knowledge_citations: [],
  missing_information: ["No se configuró una decisión de prueba."],
};

export class FakeSdrProvider implements SdrProvider {
  readonly providerName = "fake";
  readonly modelName: string;

  constructor(private readonly options: FakeSdrProviderOptions = {}) {
    this.modelName = options.modelName ?? "fake-sdr-v1";
  }

  async classifyAndDraft(input: SdrClassificationInput): Promise<SdrProviderResult> {
    if (this.options.error) throw this.options.error;
    const raw = this.options.handler
      ? await this.options.handler(input)
      : { ...SAFE_DEFAULT, ...this.options.decision };
    const decision = SdrDecisionOutputSchema.parse(raw);
    return {
      provider: this.providerName,
      model: this.modelName,
      decision,
      responseId: "fake-response",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}

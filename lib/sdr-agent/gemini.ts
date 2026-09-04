import {
  GeminiSdrProvider as GeminiProvider,
  type GeminiSdrProviderOptions,
} from "./providers/gemini";

export {
  SdrActionTypeSchema,
  SdrDecisionOutputSchema,
  SdrIntentSchema,
  SdrKnowledgeStatusSchema,
  SdrProviderError,
  unavailableDecision,
  type SdrActionType,
  type SdrClassificationInput,
  type SdrDecisionOutput,
  type SdrIntent,
  type SdrKnowledgeChunk,
  type SdrKnowledgeStatus,
  type SdrProvider,
  type SdrProviderResult,
  type SdrProviderUsage,
} from "./providers/provider";

/**
 * Compatibility export for existing callers. New code should pass the options
 * object and depend on the provider-neutral SdrProvider contract.
 */
export class GeminiSdrProvider extends GeminiProvider {
  constructor(apiKeyOrOptions?: string | GeminiSdrProviderOptions, modelName?: string) {
    super(
      typeof apiKeyOrOptions === "string" || apiKeyOrOptions === undefined
        ? { apiKey: apiKeyOrOptions, modelName }
        : apiKeyOrOptions,
    );
  }
}

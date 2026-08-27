import {
  SdrInboundMessageSchema,
  SdrModeSchema,
  type SdrMode,
  type SdrModuleBridge,
  type SdrModuleStatus,
  type SdrPublishResult,
  type SdrTickResult,
} from "./contracts";

export interface DisabledSdrBridgeOptions {
  mode?: string | null;
}

type DisabledSdrStatus = SdrModuleStatus & {
  available: false;
  effectiveMode: "off";
  outboundEnabled: false;
  reason: "disabled" | "module_unavailable" | "invalid_configuration";
};

class DisabledSdrBridge implements SdrModuleBridge {
  private readonly status: DisabledSdrStatus;

  constructor(status: DisabledSdrStatus) {
    this.status = status;
  }

  getStatus(): SdrModuleStatus {
    return { ...this.status };
  }

  async publishInboundMessage(event: unknown): Promise<SdrPublishResult> {
    const parsed = SdrInboundMessageSchema.safeParse(event);
    if (!parsed.success) {
      return {
        accepted: false,
        reason: "invalid_event",
        eventId: null,
        validationErrors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }

    return {
      accepted: false,
      reason: this.status.reason,
      eventId: parsed.data.eventId,
    };
  }

  async runWorkerTick(): Promise<SdrTickResult> {
    return {
      processed: 0,
      failed: 0,
      skipped: true,
      reason: this.status.reason,
    };
  }
}

/**
 * Fail-closed factory used until the real module is implemented. Requesting
 * shadow/approval/auto cannot accidentally enable processing or outbound sends.
 */
export function createDisabledSdrBridge(options: DisabledSdrBridgeOptions = {}): SdrModuleBridge {
  const configuredMode = options.mode ?? process.env.SDR_AGENT_MODE ?? "off";
  const parsedMode = SdrModeSchema.safeParse(configuredMode);
  const requestedMode: SdrMode = parsedMode.success ? parsedMode.data : "off";

  const reason: DisabledSdrStatus["reason"] = !parsedMode.success
    ? "invalid_configuration"
    : requestedMode === "off"
      ? "disabled"
      : "module_unavailable";

  return new DisabledSdrBridge({
    available: false,
    requestedMode,
    effectiveMode: "off",
    outboundEnabled: false,
    reason,
  });
}

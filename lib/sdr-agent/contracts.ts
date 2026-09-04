import { z } from "zod";

export const SdrModeSchema = z.enum(["off", "shadow", "approval", "auto"]);
export type SdrMode = z.infer<typeof SdrModeSchema>;

export const SdrChannelSchema = z.enum(["linkedin", "email"]);
export type SdrChannel = z.infer<typeof SdrChannelSchema>;

export const SdrThreadStateSchema = z.enum([
  "AI_ACTIVE",
  "HUMAN_REVIEW",
  "HUMAN_ACTIVE",
  "WAITING_LEAD",
  "RESOLVED",
  "DO_NOT_CONTACT",
]);
export type SdrThreadState = z.infer<typeof SdrThreadStateSchema>;

export const SdrInboundMessageSchema = z.discriminatedUnion("channel", [
  z.object({
    eventId: z.string().min(1).max(512),
    channel: z.literal("linkedin"),
    targetId: z.string().min(1),
    accountId: z.string().min(1),
    emailAccountId: z.null().optional(),
    externalThreadId: z.string().min(1).max(1024),
    externalMessageId: z.string().min(1).max(1024),
    senderExternalId: z.string().max(1024).nullable().optional(),
    senderName: z.string().max(500).nullable().optional(),
    body: z.string().min(1).max(100_000),
    receivedAt: z.string().datetime({ offset: true }),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    eventId: z.string().min(1).max(512),
    channel: z.literal("email"),
    targetId: z.string().min(1),
    accountId: z.string().min(1).nullable().optional(),
    emailAccountId: z.string().min(1),
    externalThreadId: z.string().min(1).max(1024),
    externalMessageId: z.string().min(1).max(1024),
    senderExternalId: z.string().max(1024).nullable().optional(),
    senderName: z.string().max(500).nullable().optional(),
    body: z.string().min(1).max(100_000),
    receivedAt: z.string().datetime({ offset: true }),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type SdrInboundMessage = z.infer<typeof SdrInboundMessageSchema>;

export type SdrPublishReason = "queued" | "captured" | "disabled" | "module_unavailable" | "invalid_configuration" | "invalid_event";

export interface SdrPublishResult {
  accepted: boolean;
  reason: SdrPublishReason;
  eventId: string | null;
  validationErrors?: string[];
}

export interface SdrTickResult {
  processed: number;
  failed: number;
  cancelled?: number;
  skipped: boolean;
  reason?: string;
}

export interface SdrModuleStatus {
  available: boolean;
  requestedMode: SdrMode;
  effectiveMode: SdrMode;
  outboundEnabled: boolean;
  inboundEnabled?: boolean;
  providerEnabled?: boolean;
  linkedinOutboundEnabled?: boolean;
  emailOutboundEnabled?: boolean;
  calendarEnabled?: boolean;
  blockers?: string[];
  worker?: Record<string, unknown> | null;
  queue?: Record<string, number>;
  reason: "ready" | "disabled" | "module_unavailable" | "invalid_configuration";
}

/**
 * The only contract InHubFlow core is allowed to call. Provider, calendar, RAG,
 * policies, and channel-specific implementations stay behind this boundary.
 */
export interface SdrModuleBridge {
  getStatus(workspaceOwnerId?: string): SdrModuleStatus;
  publishInboundMessage(event: unknown): Promise<SdrPublishResult>;
  runWorkerTick(): Promise<SdrTickResult>;
}

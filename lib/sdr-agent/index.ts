export * from "./contracts";
export * from "./jobs";
export * from "./repository";
export * from "./gemini";
export * from "./pipeline";
export * from "./runtime";
export * from "./worker";
export * from "./orchestrator";
export * from "./handoff";
export * from "./dispatcher";
export { createDisabledSdrBridge, type DisabledSdrBridgeOptions } from "./noop";
export { createSdrBridge, type SdrBridgeOptions } from "./bridge";

import { createSdrBridge } from "./bridge";

/** Stable core bridge. Every capability remains fail-closed behind runtime gates. */
export const sdrAgentBridge = createSdrBridge();

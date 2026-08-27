export * from "./contracts";
export { createDisabledSdrBridge, type DisabledSdrBridgeOptions } from "./noop";

import { createDisabledSdrBridge } from "./noop";

/**
 * Stable core bridge. It is intentionally fail-closed in Phase 1A: importing
 * this module cannot initialize Gemini, access LinkedIn, or send anything.
 */
export const sdrAgentBridge = createDisabledSdrBridge();

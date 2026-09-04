export async function register() {
  // Only run on the Node.js server runtime, not in the browser/edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const [{ ensureGlobalRunnerStarted }, { ensureSdrWorkerStarted }] = await Promise.all([
        import("@/lib/linkedin/runner"),
        import("@/lib/sdr-agent/worker"),
      ]);
      ensureGlobalRunnerStarted();
      ensureSdrWorkerStarted();
    } catch (err) {
      console.error("[instrumentation] Failed to start runner:", err);
    }
  }
}

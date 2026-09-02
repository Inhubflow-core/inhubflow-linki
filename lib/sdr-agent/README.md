# SDR Agent module boundary

Everything under this directory belongs to the optional SDR module. InHubFlow core may interact with it only through the `SdrModuleBridge` exported by `index.ts`.

## Phase 1A guarantees

- The module is disabled by default.
- `shadow`, `approval`, or `auto` configuration still fails closed until a real runtime is introduced.
- No Gemini, Google Calendar, LinkedIn, email, or RAG SDK is imported here.
- No inbound event is persisted or processed.
- No outbound action can execute.
- Invalid events return structured validation errors.
- Missing configuration never prevents InHubFlow from starting.

## Boundary rules

- Provider-specific code belongs in `providers/` behind an interface.
- Channel-specific code belongs in channel adapters, not in the orchestrator.
- Core changes are limited to additive migrations and a single bridge call for inbound events/worker ticks.
- `applySdrSchema` applies module-owned tables atomically and fails startup rather than accepting a partial schema.
- `GET /api/sdr/status` exposes only fail-closed operational state; it never returns credentials or prompts.
- With the bridge disabled, existing campaigns, Inbox, runner, and traditional sends must behave exactly as before.
- Never import `@/ee` or copy proprietary reply logic into this module.

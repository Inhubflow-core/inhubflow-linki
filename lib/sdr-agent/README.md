# SDR Agent module boundary

Everything under this directory belongs to the optional SDR module. InHubFlow core interacts with it through the `SdrModuleBridge` exported by `index.ts`; reviewed Inbox, email, LinkedIn, startup, and notification adapters are the explicit integration points.

## Current runtime guarantees

- The module and every outbound capability are disabled by default.
- `SDR_RUNTIME_ENABLED`, `SDR_PROVIDER_ENABLED`, mode caps, agent flags, publication state, approved knowledge, circuit breakers, and channel-specific outbound gates fail closed.
- Gemini is behind the provider-neutral `SdrProvider` contract in `providers/`.
- Inbound events are captured idempotently by account-scoped thread and message IDs, then processed through a durable leased queue.
- Active configuration, published prompt/version, approved knowledge, recent conversation history, confidence, maximum AI turns, and deterministic pre/post-provider guardrails are applied by the orchestrator.
- Missing or partial grounding, invalid citations, unsupported claims, proposals/custom terms, legal/compliance risk, prompt injection, explicit human requests, unavailable native calendar, and provider failures create a durable handoff rather than an automated answer.
- Human handoff increments the thread control epoch, blocks AI work, cancels pending actions, and remains active until an authorized user explicitly releases control.
- Handoffs produce persistent in-app notifications and optionally Web Push; the active application can play a beep and opens the exact Inbox thread.
- `shadow` persists decisions and proposed actions without sending. `approval` and `auto` remain subject to promotion and outbound gates.
- No autonomous outbox dispatcher is enabled in this checkpoint. Existing Inbox replies are explicit human actions and acquire human control before sending.
- Native calendar is intentionally unavailable until the non-calendar SDR safety checkpoints are complete.

## Boundary rules

- Provider-specific code belongs in `providers/` behind an interface.
- Channel-specific network code belongs in channel adapters, not in the orchestrator.
- Every external action must re-read ownership, thread state, control epoch, idempotency, quota, circuit, mode, agent, account, and global/channel gates immediately before execution.
- Unknown or malformed configuration must degrade to no processing or handoff, never permissive behavior.
- `applySdrSchema` uses additive module-owned migrations and fails startup rather than accepting a partial schema.
- `GET /api/sdr/status` exposes operational state without credentials or prompts.
- Do not import `@/ee` or copy proprietary reply logic into this module.
- Do not enable outbound or native calendar merely because an agent mode is stored as `approval` or `auto`.

See `docs/SDR_AGENT_RUNBOOK.md` for activation, rollback, and promotion requirements.

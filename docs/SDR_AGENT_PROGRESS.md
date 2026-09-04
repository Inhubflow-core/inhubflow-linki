# SDR Agent — Progress

Updated: 2026-09-04

## Current checkpoint

- Phase: **operational non-calendar runtime through durable handoff; outbound execution still disabled**
- Status: **implemented, locally verified, committed, and pushed to `origin/main`; not deployed**
- Runtime checkpoint commit: `12efd84` (`feat(sdr): add grounded runtime and human handoff`)
- Provider: Gemini behind the provider-neutral `SdrProvider` adapter.
- LinkedIn inbox contract: `CANDIDATE_CANARY`; automatic scheduler remains gated off until the controlled canary passes.
- SDR worker/provider: fail-closed environment and database gates; checked-in example defaults are off.
- Autonomous LinkedIn/email sending: **not implemented/enabled in this checkpoint**.
- Calendar: **not implemented**; the product decision is an InHubFlow-native enterprise calendar after the non-calendar SDR is complete, not Google Calendar or Calendly.

## Decisions locked

- Keep SDR domain logic under `lib/sdr-agent/**` with stable provider/channel boundaries and reviewed integration points in Inbox, email, LinkedIn, notifications, and startup.
- Treat inbound messages, history, and retrieved documents as untrusted data.
- Answer factual/commercial questions only from approved, retrieved knowledge with valid citations.
- Missing/partial grounding, unsupported claims, custom proposals/terms, legal/compliance risk, prompt injection, explicit human requests, unavailable tools, or low confidence require durable human handoff.
- Handoff hard-locks AI via thread state plus control epoch; human control continues until explicit authorized release.
- Assignment order is account assignee, workspace owner, then authorized workspace admin.
- Notifications are durable in-app plus optional real Web Push; an active page may beep, and every alert deep-links to the exact Inbox thread.
- Promote only `off -> shadow -> approval -> auto`; no stored mode or UI switch may bypass environment, agent, account, publication, knowledge, circuit, quota, or promotion gates.
- Build the native calendar only after Shadow/approval/auto safety and non-calendar operation are complete.

## Completed foundations and ingestion

- [x] Additive SDR schema for agents, immutable versions, knowledge, threads/messages, durable jobs, decisions, actions, handoffs, notifications, usage, circuits, quotas, outbox, audit, and promotion gates.
- [x] Idempotent account-scoped inbound capture and durable lease/retry/recovery queue.
- [x] LinkedIn campaign-only source against an explicit candidate Voyager contract with auth-wall handling and bounded pagination.
- [x] Exact target identity matching by messaging URN/canonical vanity and slot ownership; names are never identity.
- [x] Campaign attribution now requires the exact campaign run and an observed outbound at/after the campaign timestamp tolerance; only later inbound events are captured.
- [x] Duplicate external messages are harmless while distinct repeated message bodies remain valid events.
- [x] Email inbound metadata includes account/thread/message identity required by the canonical SDR capture path.

## Completed runtime and guardrails

- [x] Operational bridge and startup worker behind `SDR_RUNTIME_ENABLED`.
- [x] Active agent/version loading, effective-mode caps, provider credentials/publication/knowledge checks, circuit breaker, and daily provider budget.
- [x] Gemini structured output validated with Zod and bounded history/knowledge input.
- [x] Approved-knowledge retrieval with workspace/agent/revision isolation and citation IDs.
- [x] Deterministic pre-provider rules for DNC/unsubscribe, human request, prompt injection, legal/hostile content, proposals/custom terms, missing native calendar, disabled automation, and max AI turns.
- [x] Deterministic post-provider rules for grounding/citations, unsupported URLs/numbers/commercial claims, risk/confidence, action eligibility, and missing drafts.
- [x] Provider errors retry when safe, otherwise fail closed to handoff; usage and provider circuit state are persisted.
- [x] Control epoch is checked after provider work and again while persisting the decision, preventing stale work from surviving a human takeover.
- [x] Shadow persists decisions/proposed actions without outbox insertion or external send.

## Completed human handoff and notifications

- [x] Idempotent durable handoff with AI lock, pending job/action cancellation, assignment, and audit.
- [x] Explicit authorized takeover and release APIs with workspace/thread authorization.
- [x] DNC transition cancels queued work/actions and records audit evidence.
- [x] Persistent in-app notification center, unread state, exact Inbox deep links, foreground beep, service worker, Push subscriptions, and queued Web Push delivery.
- [x] Inbox surfaces canonical thread/action/handoff state and provides takeover/release controls.
- [x] Manual Inbox replies acquire human control server-side before sending.
- [x] Every Inbox read/mutation route now requires an authenticated actor and validates target-to-thread/account ownership before reading IMAP/LinkedIn data, suggesting, toggling, cancelling, or sending.
- [x] LinkedIn sync/live-diagnostic routes enforce slot access; the diagnostic screenshot contract is aligned between API and UI.
- [x] IMAP certificate verification is secure by default with an explicit development-only compatibility flag.

## Safety boundary still intentionally incomplete

- There is no autonomous `sdr_outbox` dispatcher or action approval/rejection API/UI yet.
- `evaluatePreSendGuardrails` exists, but no automatic send path is wired to it; therefore all SDR outbound environment flags must remain false.
- Approval/auto promotion gates have not been populated with controlled production evidence.
- The LinkedIn candidate contract has not yet passed the authorized live canary recorded in `docs/LINKEDIN_INBOX_CONTRACT.md`.
- Web Push requires production VAPID credentials and an end-to-end browser test.
- No native calendar work should begin yet.

## Verification record — 2026-09-04

```text
npm run test:sdr-foundation                       PASS
npm run test:sdr-runtime                          PASS
npm run test:sdr-authorization                    PASS
npm run test:linkedin-campaign-inbox              PASS
npx tsc --noEmit --incremental false              PASS
focused ESLint (SDR/Inbox changes)                PASS (0 errors; legacy UI warnings remain)
npm run build                                     PASS
                                                    expected public-build warning: optional @/ee absent
git diff --check                                  PASS (line-ending notices only)
```

Repository-wide ESLint still reports pre-existing issues outside this SDR checkpoint; focused changed-file lint has no errors. The real Gemini shadow suite is not rerun automatically because it makes external billable calls.

## Environment/deployment blockers

- Configure production Gemini credentials and cost rates without committing secrets.
- Generate VAPID keys and configure `WEB_PUSH_ENABLED`, subject, public key, and private key.
- Run the authorized LinkedIn controlled canary with one test slot/conversation before enabling its scheduler.
- Back up the production SQLite database and verify additive migration application before Shadow rollout.
- Keep `SDR_OUTBOUND_ENABLED`, `SDR_LINKEDIN_OUTBOUND_ENABLED`, `SDR_EMAIL_OUTBOUND_ENABLED`, and `NATIVE_CALENDAR_ENABLED` false.

## Next exact action

1. Review commit `09e8123` and push/deploy it only with explicit approval.
2. Configure a non-production authorized environment and run the LinkedIn contract canary plus Shadow runtime with outbound gates false.
3. Verify exact grounding, citations, handoff assignment, control lock, in-app alert, beep, Web Push, and deep link end to end.
4. Only after that evidence, implement the action approval/rejection API and UI, then the idempotent outbox dispatcher guarded by `evaluatePreSendGuardrails`; do not enable auto.
5. Build the native enterprise calendar only after approval and controlled auto checkpoints pass.

## Resume instruction

> Continue the SDR plan from `docs/SDR_AGENT_PROGRESS.md`. Verify HEAD, working tree, and all recorded tests first. Keep every outbound and calendar gate disabled until the documented canary/promotion evidence exists.

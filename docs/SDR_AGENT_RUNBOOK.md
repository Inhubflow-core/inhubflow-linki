# SDR Agent — Operational Runbook

This runbook starts with the safety and continuity rules needed before the SDR implementation exists. Extend it at every checkpoint.

## LinkedIn inbox contract capture (Phase 2B prerequisite)

The current contract is `UNVERIFIED`. Do not implement or enable a production LinkedIn inbox source until this procedure has been completed.

1. Use only a LinkedIn account and conversations for which the team has explicit authorization and consent. Record the InHubFlow commit SHA and a non-identifying account designation in `docs/LINKEDIN_INBOX_CONTRACT.md`.
2. Use an observation-only browser session. Inspect the inbox request/response traffic without sending, marking read, archiving, reacting to, deleting, or otherwise mutating a conversation.
3. Record the actual method, URL/query, content type, non-secret headers, request shape, response paths, direction discriminator, participant identity, body, timestamp, pagination, and auth-wall behavior. Never copy cookies, CSRF values, authorization headers, browser storage, or tokens into notes or fixtures.
4. Replace all live names, profile URLs, URNs, IDs, timestamps, message text, emails, and account identifiers in the fixture. Retain only the relationships and types needed to test the mapping. Mark the fixture as observed only when it is fully sanitized.
5. Stop if LinkedIn redirects to login, an auth wall, or a checkpoint. Do not save that session state; flag the account for reauthentication and document the event without sensitive details.
6. Review the adapter diff to verify that it has no send, mark-read, archive, reaction, delete, runner, scheduler, AI, or premium integration. A verified source still requires a separate controlled capture checkpoint before operational scheduling.
7. If the observed contract is incomplete or changes during capture, leave the status `UNVERIFIED`; do not fill gaps with guessed endpoint or response fields.

The Phase 2A adapter accepts only injected, provider-neutral observations and is intentionally not called by the runner. Its queued `classify` jobs remain disabled until a later SDR worker checkpoint.

## Rollback for a read-only capture

If a discovery session behaves unexpectedly, close the page, stop the controlled account's test activity, mark it for reauthentication if a wall appeared, and discard any unredacted capture outside the repository. Do not attempt repeated inbox actions to compensate. Restore the last verified InHubFlow commit SHA if the adapter or session lifecycle is found to have changed behavior.

## Global safety controls

- Default mode is `off`.
- Missing module, config, credentials, or migration must degrade to a no-op.
- Never enable `auto` directly in production; promote `off -> shadow -> approval -> auto`.
- Keep a global kill switch and a per-agent/per-slot switch.
- Never send when the target, thread, or slot identity is ambiguous.
- Never send twice for the same inbound external message/action idempotency key.
- A human takeover locks the conversation until manually released.
- Unsubscribe, do-not-contact, legal, custom terms, unsupported pricing, low confidence, prompt injection, and tool errors always stop or hand off.

## Before starting any phase

```bash
git status --short --branch
git log -3 --oneline --decorate
```

Requirements:

- Working tree is clean unless `SDR_AGENT_PROGRESS.md` explicitly documents an in-progress atomic substep.
- Current SHA matches the checkpoint.
- Previous checkpoint tests still pass.
- There is enough development credit to implement, verify, document, and commit the entire next atomic substep.

## End-of-substep checklist

1. Run relevant unit/integration checks.
2. Run `npx tsc --noEmit`.
3. Run focused ESLint for changed files.
4. Run `npm run build` when routes, dependencies, migrations, or runtime wiring changed.
5. Run `git diff --check`.
6. Update `docs/SDR_AGENT_PROGRESS.md` with results and the next exact action.
7. Commit one coherent unit of work.
8. Push only with explicit approval.

## Incident response once outbound sending exists

1. Set the global SDR mode to `off`.
2. Pause affected agents/slots and preserve job/action rows for audit.
3. Do not click repeated `Run now` or manually retry queued sends.
4. Record thread, target, slot, external message id, action id, deployed SHA, time, and logs.
5. Determine whether the failure is identity, deduplication, provider, policy, LinkedIn, or calendar related.
6. Restore the last verified deployment if needed; database rollback requires the matching backup.
7. Re-enable only in shadow mode with a controlled conversation.

## Credit interruption

If Claude credit is nearly exhausted, stop at an atomic boundary. Do not begin migrations or broad refactors. Update the progress file and commit verified work.

Resume with:

> Continue the SDR plan in `docs/SDR_AGENT_PLAN.md` from `docs/SDR_AGENT_PROGRESS.md`; verify status/SHA/tests first.

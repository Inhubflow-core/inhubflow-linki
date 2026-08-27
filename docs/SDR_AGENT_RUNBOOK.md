# SDR Agent — Operational Runbook

This runbook starts with the safety and continuity rules needed before the SDR implementation exists. Extend it at every checkpoint.

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

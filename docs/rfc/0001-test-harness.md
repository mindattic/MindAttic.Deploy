---
codex: 1
project: MindAttic.Deploy
code: DEP
layer: rfc
status: planned
updated: 2026-06-07
---

# RFC 0001 — A test harness for the deploy pipeline

## Problem
The repo ships a real deploy pipeline (`src/build.js`, `src/deploy.js`, the C# CLI) but has **no automated test project**. Per [HOUSE-LAW-8](../../../MindAttic.HouseRules.md#HOUSE-LAW-8) and [DEP-§8](../BIBLE.md#DEP-§8), behaviors can only be marked ✅ when a test or build proves them. Today nearly every [user story](USER_STORIES.md) is stuck at 🟡 because the only proof is a clean build or an ad-hoc manual run. We want behaviors to graduate to ✅ without requiring a live FTP server or a real `git push`.

## Options compared
1. **Node test runner (`node:test`) on the pure functions.** Test `effectiveProjects`, `expandFiles` glob escaping, `stampIndex` idempotency, flag rejection, and `substitute`. Zero new deps, no network. Downside: requires light refactoring to export the pure functions.
2. **C# xUnit project for the CLI.** Tests argument→`DeployRunner` wiring and `ProjectRoster` loading. Natural fit for `dotnet test`, but covers only the thin C# shell, not the engine where logic lives ([DEP-LAW-1](../BIBLE.md#DEP-LAW-1)).
3. **End-to-end against a mock FTP server + a throwaway git remote.** Highest fidelity, highest cost/flakiness; better as a later CI smoke step.

## Decision
Start with **Option 1** for the engine (where the logic is) plus a thin slice of **Option 2** for the CLI wiring. Defer Option 3 to a CI smoke step (backlog item DEP-US-F3).

## What NOT to do
- Do NOT duplicate deploy logic into the C# CLI just to make it testable — logic stays in `src/deploy.js` ([DEP-LAW-1](../BIBLE.md#DEP-LAW-1)).
- Do NOT require live FTP credentials or real pushes in the default test run.
- Do NOT add heavy test frameworks to the Node side; use the built-in `node:test`.

## Phased plan (with risk)
1. Extract the pure helpers into a small importable module without changing runtime behavior. *Risk: accidental behavior change — mitigate by keeping the CLI entrypoints byte-identical in output.*
2. Add `node:test` cases for those helpers; wire `npm test`. *Risk: low.*
3. Add a minimal xUnit project for `ProjectRoster.Load` + `DeployRunner` arg assembly; wire into `MindAttic.Deploy.slnx`. *Risk: low.*
4. (Later) CI smoke deploy against a mock FTP server. *Risk: flakiness — keep it a separate, non-blocking job.*

## Graduates into
- [BIBLE.md §6 — Verified state](../BIBLE.md#DEP-§6) (promote proven capabilities to ✅).
- [USER_STORIES.md](USER_STORIES.md) Epics A/B (cite the new test names) and backlog items DEP-US-F1/F2/F3.

---
layer: release
status: living
---
# MindAttic.Deploy — Release charter

> The one finish line this repo is working toward. Every open ticket in this repo sits under one of the epics
> below, and every epic is part of the milestone. Work that does not fit is out of scope until this milestone is
> reached (owner, 2026-11-27, MAT-T319).

## 1. What this is
One registry-driven pipeline (`projects.json` + `src/deploy.js`, fronted by the `MindAttic.Deploy` CLI) that
FTPS-deploys the MindAttic root sites, including the MindAttic.Components linked group, for the owner's own use.

## 2. The milestone: MindAttic.Deploy sites-first 1.0 {#milestone}
- **Milestone:** MS-48, "Deploy matches the post-Azure world"
- **Published means:** internal tool, installed at `R:\MindAttic\Apps\MindAttic.Deploy\{Debug,Release}` by
  `run.ps1`, plus `npm run deploy` from this checkout.
- **The natural stopping point:** Azure is decommissioned (MAT-T297), so every `apps[]` target that pushes to
  Azure App Service is dead weight. Done means the registry only offers targets that can really deploy, the
  root-site and linked-group pipeline is proven clean, the CLI logs like the rest of the family, and the docs say
  what the tool does today. After that the tool is finished until a new hosting target exists.

## 3. Done when (acceptance checks)
1. build — `MindAttic.Deploy.slnx` builds clean on main.
2. exists — `R:\MindAttic\Apps\MindAttic.Deploy\Release\MindAttic.Deploy.exe`.
3. harness — `npm run deploy -- --sites --dry-run` and `npm run deploy -- --apps --dry-run` finish with no
   `FAIL` line, and `--apps` lists no Azure App Service target as deployable.
4. signoff — the owner deploys a root site (or the linked group) end to end from the CLI.

## 4. Epics, in priority order
| Priority | Epic (ticket) | What it delivers | Features |
|---|---|---|---|
| 900 | M.DPLY-T42 Registry matches reality | Only real, reachable targets are enabled; sites pipeline proven | M.DPLY-T43 Retire Azure app targets (990), M.DPLY-T44 Sites pipeline proven (980) |
| 800 | M.DPLY-T45 Logged and documented | Family logging and docs that match the code | M.DPLY-T46 Family logging (890), M.DPLY-T47 Docs match the code (880) |

## 5. Out of scope (not before this milestone)
- A new app-hosting target to replace Azure App Service (Hetzner or otherwise) — no host exists; when one does,
  it gets its own charter revision.
- NUnit seams and tests for DeployRunner / MainMenuCommand batching (M.DPLY-T4/T5/T6/T31–T34) — audit-generated
  coverage; the CLI is a thin shell over `deploy.js`, which has its own `npm test`.
- Generic cleanup / bughunt / "run the whole suite" sweeps (M.DPLY-T10, T11, T36).
- Remote file cleanup on the FTP host, per-project page rendering (BIBLE §3).

## 6. Current verified state
- Run menu adopted; Debug and Release exes present under `R:\MindAttic\Apps\MindAttic.Deploy` (c6da244, MAT-T304).
- Docs-site pipeline adopted (cc939bc, M.DPLY-T22).
- Spectre markup escaping for bracketed paths/slugs (f9dde28, M.DPLY-T38).
- knowyourmech registered as a root site (b12d6bf, M.DPLY-T37); gadfly disabled after its Azure script was
  removed (49a88f9, M.DPLY-T40).

## 7. Decision record
- 2026-11-27 — charter drafted from README/BIBLE/projects.json/tickets; Legion vote: Approve, 9/9 voters, plurality quorum reached, consensus 1.0; no dissent.
- Triage: 18 open (incl. job ticket M.DPLY-T41) → done 3 (T16, T22, T39), duplicate 0, wont-do 10 (T4, T5, T6, T10, T11, T31–T34, T36), kept 4 (T12 reworded, T13, T18, T19), new tasks 2 (M.DPLY-T48 disable Azure app targets, M.DPLY-T49 clean dry runs).

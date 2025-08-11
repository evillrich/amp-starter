# Amp – v0 Design Document

## Vision (target state, guiding v0)

* **Document-centric project.** Everything you work on lives in the project with immutable versions, diffs, and run history.
* **Progressive complexity.** v0 supports **Markdown, text, CSV**; later we add native viewers/merges for Office & Google without changing the UX or storage model.
* **Same flow always:** import → version → diff/merge → export (and, later, sync/suggest).

## v0 scope (what ships now)

* File types: **.md, .txt, .csv** only.
* Core loops: import → version → diff (pick any two) → merge (md/txt three-way) → export.
* Agents: basic engine run, run-scoped grouping/labels, **auto-approve** mode (auto-accept changes).
* History: VS Code‑style comparisons (current vs previous or any two versions).

## CLI (initial surface)

### Projects
* `amp project create <name>` → `ws_...`
* `amp project list`
* `amp project show <projectId>`

### Artifacts / versions
* `amp project artifact add <projectId> <path> --name "Label" [--comment "..."]`
* `amp project artifact list <projectId> [--path "folder/sub"]`
* `amp project artifact history <artifactId>`
* `amp project artifact diff <artifactId> --from vN --to vM`
* `amp project artifact diff <artifactId> --with-prev vN`
* `amp project artifact merge <artifactId> --base vB --ours vO --theirs vT` (md/txt)
* `amp project artifact revert <artifactId> --to vN` (creates new version equal to vN)
* `amp project artifact export <artifactId> --version vN --out ./file.md|.txt|.csv`

### Runs (agents)
* `amp run <assistantId> <projectId> --input "Prompt" [--auto-approve] [--label "..."] [--tag t]`
* `amp log tail [--project <id> | --run <id>]`
* `amp project run diff <runId>` (show all file deltas this run produced)

### Config / env
* Global flags: `--data <dir>`, `--endpoint <url>`, `--model <name>`
* `amp config show`

## Storage / DB schema (SQLite via Drizzle)

(see `packages/storage-sqlite/src/schema.ts`)

## Content handling (v0)

* **MIME registry** maps type → handlers.
* v0 handlers:
  * `text/markdown`, `text/plain`: viewer, two‑way diff, three‑way merge.
  * `text/csv`: viewer (table), diff (cell/row), export. (Merge optional in v0.)

## Agent engine (v0)

* **basic-loop** engine:
  * Tool‑augmented chat, writes outputs as **new versions** (`sourceRunId` set).
  * `--auto-approve` skips review and commits changes directly (with guardrails).

## Guardrails & review

* **Auto‑approve flags:** `--auto-approve`, `--max-changes`, `--max-size-mb`, `--abort-on-conflict`.
* **History UX:** `history` lists versions with (author | at | comment | run label).
* **Run grouping:** `project run diff <runId>` shoproject everything changed that run.

## Monorepo structure (pnpm)



## Near‑term roadmap (after v0)

1. Better CSV merge (keyed row‑level, selective accept).
2. Markdown visual diff viewer (inline word‑level).
3. Planner engine (plan → approve → execute).
4. Postgres/S3 backend (same StorageBundle).
5. Office/Google handlers: snapshots → tracked changes/suggestions → merge back.

# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node.js terminal TUI prototype with a real LLM adapter.

- `bin/echo-tui.ts`: source CLI entry shim; compiled output runs from `dist/bin/echo-tui.js`.
- `src/cli/`: command-line argument parsing for `echo-tui`, user setup bootstrap, help/version output, and TUI startup handoff.
- `src/app/`: application orchestration, runtime state contexts, command host/runtime, tool approval, and user-question flows.
- `src/commands/`: slash command handlers for `/help`, `/config`, `/model`, `/effort`, `/mode`, `/status`, `/context`, `/usage`, `/clear`, `/compact`, `/diff`, `/undo`, `/resume`, `/mcp`, `/skills`, `/themes`, `/init`, `/review`, and direct skill invocation.
- `src/agent/`: provider-neutral agent loop, context compaction, AGENTS.md instruction loading, reasoning summaries, OpenAI Responses/OpenAI Chat/Anthropic adapters, and fake agent fixture.
- `src/tools/`: built-in tool registry, executors, risk classification, local shell/file/web tools, web fetch/search, patching, skill loading, and user-question tool support.
- `src/skills/`: project/user skill discovery, enablement state, and skill instruction loading.
- `src/config/`: user-level LLM, MCP, tool, render, theme, and setup configuration readers/editors.
- `src/mcp/`: MCP client, manager, and provider-neutral tool adapter.
- `src/hooks/`: lifecycle hook configuration, dispatching, and subprocess execution.
- `src/debug/`: optional debug context and redacted runtime diagnostics.
- `src/persistence/`: cwd-partitioned transcript session storage.
- `src/input/`: key parsing, input event types, and composer state.
- `src/render/`: transcript blocks, Markdown/table/code projection, tool rendering, footer/status-line redraw logic, and layout helpers.
- `src/terminal/`: ANSI helpers and TTY raw-mode setup/cleanup.
- `src/types/`: pure TypeScript protocol types shared across layers.
- `test/`: Node built-in test runner coverage (`node:test`).
- `docs/`, `openspec/`: user/architecture documentation and proposals.
- `scripts/`: small build-support scripts such as copying built-in theme assets.
- `dist/`: generated build output; ignored by git.

## Build, Test, and Development Commands

- `npm run clean`: removes `dist/`.
- `npm run build`: removes `dist/`, compiles `bin/`, `src/`, and `test/` through `tsc`, copies built-in theme JSON assets, and marks `dist/bin/echo-tui.js` executable.
- `npm run typecheck`: runs `tsc --noEmit` without writing `dist/`.
- `npm start`: builds, then runs the TUI via `node dist/bin/echo-tui.js`.
- `npm test`: builds, then runs the full test suite with `node --test dist/test`.
- `find bin src test scripts -name '*.js' -exec node --check {} \;`: batch syntax-check JS files.

TypeScript source is compiled by `tsc` to CommonJS under `dist/`. Do not introduce bundlers, Babel, ts-node, tsx, custom loaders, ESM conversion, or third-party TUI libraries.

## Coding Style & Naming Conventions

Target Node.js >= 20. Keep modules small and responsibility-focused. Prefer direct names such as `createFooterRenderer`, `parseKeyChunk`, `runFakeAgent`.

Avoid complexity that does not pay for itself: defensive branches, fallback paths, one-line forwarding helpers, wrapper functions, or abstraction seams are only justified when they protect a real trust boundary, preserve an invariant, clarify non-obvious domain semantics, or remove meaningful duplication. Allowed, but must have a concrete purpose.

When editing source modules, follow the file's existing style. Source uses `.ts`; tests use `*.test.js` and may `require(...)` compiled extensionless paths.

Write code comments in Chinese. Comments should explain module responsibilities, terminal control, input parsing, rendering strategy, or other non-obvious logic—never restate the obvious. For core runtime files under `src/app/`, `src/render/`, and `src/terminal/`, add JSDoc-style method-level comments when creating or materially editing functions: describe behavior, key inputs/outputs, and terminal assumptions. Do not describe types (TS signatures are the source of truth).

Terminal behavior should remain based on ANSI control sequences and stdin raw mode; do not introduce third-party TUI libraries.

## Testing Guidelines

Use the built-in Node test runner (`node:test`) under `test/` with `*.test.js` files. Prefer pure-function and controller-level tests over terminal byte-stream snapshots.

Tests should adapt to runtime code, not the other way around. Do not add production parameters, branches, or callbacks that exist only to make tests convenient; prefer public runtime seams, real handler/context composition, or more appropriate fixtures.

When adding new code or changing behavior, add or update automated tests unless the change is documentation-only or a purely visual/manual terminal tweak with no stable programmatic seam.

Before finishing a code change, run in order:

1. `npm run typecheck`
2. `npm test`
3. `find bin src test scripts -name '*.js' -exec node --check {} \;`

For interactive TUI changes, also do targeted manual verification:

1. `npm start`
2. Input editing, `Ctrl+J` newline insertion, Enter submit, and real/fake streaming response
3. Colored role prefixes, Markdown/table/code rendering, tool call/result rendering, footer status line, footer redraw, resize behavior, and `Ctrl+C` / `Ctrl+D` cleanup
4. Slash commands and surfaces: `/help`, `/config`, `/model`, `/effort`, `/mode`, `/status`, `/context`, `/usage`, `/clear`, `/compact`, `/diff`, `/undo`, `/resume`, `/mcp`, `/skills`, `/themes`, `/init`, `/review`, slash suggestions, Tab completion, and direct `/<skill-name>` invocation
5. Interaction modes and local flows: Tab mode cycling, `/mode normal|plan|shell|shell-local`, shell/shell-local execution, `@` file picker selection, and Esc cancellation/interruption where supported
6. Tool/user interaction flows: apply-patch approval, high-risk bash approval, MCP approval where configured, `ask_user_questions` choice/inline input, `/skills` checkbox state changes, and Esc cancellation where supported
7. Response lifecycle edges: response lock blocking Enter, Esc interrupting an active assistant turn, partial assistant persistence, local notices, and late callback isolation

## Architecture Notes

Transcript records are append-only, but the visible app snapshot is re-renderable.

Transcript roles include user, assistant, system, error, local notice, reasoning summary, shell, tool call, tool result, and provider-private reasoning records such as OpenAI Responses, OpenAI Chat, and Anthropic thinking records. Local notices, errors, shell records, and reasoning summaries are visible/persisted app facts; provider adapters filter records according to their own request model.

Provider requests prepend transient built-in context with runtime environment, AGENTS.md instructions loaded from `~/.echo/AGENTS.md` and applicable project paths, plan-mode constraints when active, and the current skill catalog. These instructions do not become transcript records.

Footer state is transient and re-renderable: normal input shows composer, optional slash suggestions, optional file picker, and a status line with model/project/mode/key hints; command, approval, and user-question flows replace the input area with surfaces such as `info`, `select`, `resume`, `checkbox`, `skills`, `mcp`, `scale`, `choice`, `confirm`, `config`, `context`, `usage`, `file_picker`, and `diff`.

Normal redraw clears the previous app-owned region before writing the next snapshot. When terminal columns change, or terminal rows shrink, the app may perform destructive recovery by clearing the visible screen and scrollback, then repainting from the top-left. **The app must not switch to alternate screen.**

## Commit, Pull Request & Release Workflow

Use short conventional-style prefixes:

- `feat: add streaming support`
- `fix: handle abort edge case`
- `chore: add chinese comments`
- `docs: update architecture notes`
- `refactor: extract tool converter`
- `test: add prompt cache key stability`

PR descriptions should include a concise summary, validation commands run, and notes for interactive TUI behavior that reviewers should manually verify.

Branch model:

Permanent branches:

- `main`: stable release branch; every release is tagged with `v*` (e.g. `v1.0.1`).
- `dev`: day-to-day development integration branch; all feature work is merged here before release.

Temporary branches:

- `feature/<name>`: created from `dev` for a single feature or fix; merged back into `dev` when complete, then deleted.

Workflow rules:

1. Start new work from `dev`: `git checkout dev && git checkout -b feature/<name>`.
2. Commit on the feature branch using conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
3. Before merging into `dev`, run the full validation sequence: `npm run typecheck`, `npm test`, and `find bin src test scripts -name '*.js' -exec node --check {} \;`.
4. Merge into `dev` with `--no-ff` to preserve branch history: `git checkout dev && git merge --no-ff feature/<name>`.
5. Delete the feature branch after merge: `git branch -d feature/<name>`.
6. When `dev` is ready for release, merge into `main` with `--no-ff`, then tag: `git tag v<version>`.
7. Always push both the branch and the tag: `git push && git push --tags`.

Do not commit directly to `main` except for the version bump and release merge. Do not push untested or broken code to `dev`.

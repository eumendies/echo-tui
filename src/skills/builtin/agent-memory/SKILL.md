---
name: agent-memory
description: Read or maintain agent-generated persistent memory when relevant context is folded or the user explicitly asks to remember stable information.
---

# Agent Memory

Use this skill only for stable, reusable agent knowledge:

- Use project scope for repository-specific facts and working conventions.
- Use global scope only for preferences or facts that apply across projects.
- Do not store credentials, secrets, transient task state, guesses, or conversation summaries.
- User-managed memory is controlled only through `/memory`; never modify `~/.echo/memories.json`.
- Never directly read, edit, patch, or delete files under `~/.echo/agent-memory/`.
- Never change catalog or item enabled state. The user controls enablement through `/memory`.

All agent memory operations must use `scripts/memory.js` from this skill directory through `run_bash_command`. Resolve the script from the absolute `source` path returned by `use_skill`; do not assume a global npm installation path.

Invoke the script with Node.js from the current project:

```bash
node '<skill-dir>/scripts/memory.js' <action> [flags]
```

Quote every value as one shell argument. For a single quote inside a single-quoted value, close the quote, append an escaped quote, then reopen it, for example: `'can'\''t'`.

```text
read             --catalog <name> [--scope global|project]
add              --catalog <name> --content <text> [--description <text>] [--scope global|project]
update-item      --catalog <name> --item-id <id> --content <text> --scope global|project
update-catalog   --catalog <name> [--name <new-name>] [--description <text>] --scope global|project
remove-item      --catalog <name> --item-id <id> --scope global|project
remove-catalog   --catalog <name> --scope global|project
validate
```

For `add`, omitted scope defaults to the current project; use `--scope global` only for cross-project knowledge. `add` requires `--description` when creating a catalog. `read` returns the resolved catalog scope and only enabled items. Use that scope and an item id from `read` for every update or removal. The script refuses to mutate disabled catalogs. `validate` checks accessible global/current-project catalogs without repairing files.

Successful commands print JSON to stdout. Invalid arguments, unavailable targets, disabled catalogs, or invalid storage print a diagnostic to stderr and exit non-zero. Never retry by editing storage files directly.

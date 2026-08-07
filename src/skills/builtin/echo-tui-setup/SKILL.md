---
name: echo-tui-setup
description: Explain how to install echo-tui skills and configure MCP servers, providers, and models.
---

# Echo TUI Setup

Use this skill when the user asks how to configure echo-tui, install skills, add MCP servers, set up lifecycle hooks, or set up LLM providers/models.

## Skills

- User-level skills live at `~/.echo/skills/<skill-name>/SKILL.md`.
- Project-level skills live at `<project>/.echo/skills/<skill-name>/SKILL.md`.
- Echo TUI may ship built-in skills; user-level skills override built-ins with the same `name`, and project-level skills override both.
- Each `SKILL.md` needs YAML frontmatter with `name` and `description`, followed by markdown instructions.
- Skill enablement is managed by `/skills`; built-in and user-level skill state is recorded in `~/.echo/skills/skills.json`, never in the npm installation directory.

## MCP servers

Configure MCP in `~/.echo/config.json` under `mcp`:

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"],
        "env": {},
        "cwd": "/path/to/project",
        "approval": "always",
        "timeoutMs": 30000
      },
      "docs": {
        "transport": "http",
        "url": "https://example.com/mcp",
        "headers": {"Authorization": "Bearer <token>"},
        "approval": "always",
        "timeoutMs": 30000
      }
    }
  }
}
```

- `transport` is `stdio` or `http`.
- `mcp.enabled` controls MCP globally, and `mcp.servers` holds named server profiles.
- `stdio` servers use `command`, optional `args`, optional `env`, optional `cwd`, optional `timeoutMs`, and optional `approval`.
- `http` servers use `url`, optional string `headers`, optional `timeoutMs`, and optional `approval`.
- `approval: "always"` asks before tool calls; `approval: "never"` trusts that server.

## Lifecycle hooks

Configure optional lifecycle hooks in `~/.echo/config.json` under `hooks`:

```json
{
  "hooks": {
    "assistant_turn_end": [
      {"command": "node ~/.echo/hooks/log-turn.js", "timeoutMs": 5000}
    ],
    "tool_call_end": [
      "node ~/.echo/hooks/tool-audit.js"
    ]
  }
}
```

- Supported events: `assistant_turn_start`, `assistant_turn_end`, `assistant_turn_error`, `assistant_turn_cancelled`, `tool_call_start`, `tool_call_end`, `tool_approval_request`, `tool_approval_response`, `user_question_request`, `user_question_response`, and `compaction_end`.
- Hook commands receive a JSON payload on stdin and `ECHO_HOOK_EVENT` / `ECHO_HOOK_CWD` environment variables.
- Tool approval and user question response payloads may include user feedback or answer text for local auditing.
- Hooks are best-effort observers: they cannot intercept execution, are not shown in the TUI, are not written to transcript/session files, and are not returned to the model.

## Providers

Configure providers under `llm.providers`:

```json
{
  "llm": {
    "providers": {
      "default": {
        "preset": "openai-responses-api",
        "apiKey": "<api-key>",
        "baseURL": "https://api.openai.com/v1",
        "headers": {"x-source": "echo-tui"}
      }
    }
  }
}
```

- `preset` selects the runtime protocol, such as `fake-agent`, `openai-responses-api`, `openai-chat-compatible-api`, `anthropic-compatible-api`, `openai-codex-oauth`, or `ollama`.
- `apiKey` is required for most real remote providers; `fake-agent`, `openai-codex-oauth`, and `ollama` do not need a configured API key.
- `ollama` calls a local Ollama server through its OpenAI-compatible endpoint at `http://localhost:11434/v1`; leave `apiKey` empty. For a custom Ollama endpoint, use `openai-chat-compatible-api` instead.
- `baseURL` is optional, required, fixed, or hidden depending on the preset.
- `openai-codex-oauth` requires an existing Codex/ChatGPT OAuth auth cache. echo-tui does not start a login flow; it reads `codexAuthFile`, then `CODEX_HOME/auth.json`, then `~/.codex/auth.json`. Expired access tokens are refreshed in memory only and are not written back to the Codex auth file.
- `headers` can hold provider-specific string headers; never expose secret values in chat unless explicitly needed.

## Models

Configure model profiles under `llm.models` and choose one with `llm.selectedModel`:

```json
{
  "llm": {
    "models": [
      {
        "id": "default",
        "provider": "default",
        "model": "gpt-4.1",
        "contextWindow": 128000
      }
    ],
    "selectedModel": "default"
  }
}
```

- `id` is the local model profile id used by echo-tui.
- `provider` references a key in `llm.providers`.
- `model` is the provider's API model name.
- `contextWindow` is optional and controls context usage calculations.
- `selectedModel` must reference an existing model profile id.

## Tool approval

Interactive tool approval is configured independently from interaction mode under `tools.approval`:

```json
{
  "tools": {
    "approval": {
      "mode": "auto",
      "modelProfileId": "default"
    }
  }
}
```

- `mode` is `manual` or `auto`; missing or invalid values default to `manual`.
- `modelProfileId` must exactly reference an existing `llm.models[].id` when saving auto mode.
- Auto review uses a separate request with no tools or reasoning configuration. Only an exact `yes` response (ignoring surrounding whitespace and case) allows that call once.
- `no`, invalid output, missing configuration, and provider failures fall back to the existing manual approval choices. Session grants still bypass review.
- This setting does not change normal/plan/shell modes and does not affect headless `--once` deny/full-access policy.

Use `/config` inside echo-tui to edit providers and models interactively.

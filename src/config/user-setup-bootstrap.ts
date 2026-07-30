import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type BootstrapEchoUserSetupOptions = {
  configPath?: string;
  echoDir?: string;
  existsSync?: (filePath: string) => boolean;
  mkdirSync?: (dirPath: string, options: {recursive: boolean}) => unknown;
  userSkillsDir?: string;
  writeFileSync?: (filePath: string, data: string, options?: {flag?: string}) => unknown;
};

type BootstrapEchoUserSetupResult = {
  configCreated: boolean;
  configPath: string;
  echoDir: string;
  setupSkillCreated: boolean;
  setupSkillPath: string;
  userSkillsDir: string;
};

const DEFAULT_SETUP_SKILL_NAME = 'echo-tui-setup';
const DEFAULT_FAKE_PROVIDER_ID = 'default';
const DEFAULT_FAKE_MODEL_ID = 'default';

function getDefaultEchoDir(): string {
  return path.join(os.homedir(), '.echo');
}

function getDefaultUserSetupSkillPath(): string {
  return path.join(getDefaultEchoDir(), 'skills', DEFAULT_SETUP_SKILL_NAME, 'SKILL.md');
}

/**
 * 初始化 echo-tui 用户目录；只补齐缺失的默认配置和 setup skill，避免覆盖用户已有内容。
 */
function bootstrapEchoUserSetup(options: BootstrapEchoUserSetupOptions = {}): BootstrapEchoUserSetupResult {
  const echoDir = options.echoDir || path.join(os.homedir(), '.echo');
  const configPath = options.configPath || path.join(echoDir, 'config.json');
  const userSkillsDir = options.userSkillsDir || path.join(echoDir, 'skills');
  const setupSkillPath = path.join(userSkillsDir, DEFAULT_SETUP_SKILL_NAME, 'SKILL.md');
  const existsSync = options.existsSync || fs.existsSync;
  const mkdirSync = options.mkdirSync || fs.mkdirSync;
  const writeFileSync = options.writeFileSync || fs.writeFileSync;
  const configCreated = createFileIfMissing(configPath, `${JSON.stringify(createDefaultUserConfig(), null, 2)}\n`, {existsSync, mkdirSync, writeFileSync});
  const setupSkillCreated = createFileIfMissing(setupSkillPath, DEFAULT_SETUP_SKILL_CONTENT, {existsSync, mkdirSync, writeFileSync});

  return {
    configCreated,
    configPath,
    echoDir,
    setupSkillCreated,
    setupSkillPath,
    userSkillsDir
  };
}

function createFileIfMissing(filePath: string, content: string, dependencies: Required<Pick<BootstrapEchoUserSetupOptions, 'existsSync' | 'mkdirSync' | 'writeFileSync'>>): boolean {
  if (dependencies.existsSync(filePath)) {
    return false;
  }

  dependencies.mkdirSync(path.dirname(filePath), {recursive: true});

  try {
    dependencies.writeFileSync(filePath, content, {flag: 'wx'});
    return true;
  } catch (error: unknown) {
    if (isNodeErrorCode(error, 'EEXIST')) {
      return false;
    }

    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function createDefaultUserConfig(): Record<string, unknown> {
  return {
    llm: {
      models: [
        {
          id: DEFAULT_FAKE_MODEL_ID,
          provider: DEFAULT_FAKE_PROVIDER_ID,
          model: 'echo-fake-agent',
          contextWindow: 128000
        }
      ],
      selectedModel: DEFAULT_FAKE_MODEL_ID,
      providers: {
        [DEFAULT_FAKE_PROVIDER_ID]: {
          preset: 'fake-agent',
          label: 'Fake Agent'
        }
      }
    }
  };
}

const DEFAULT_SETUP_SKILL_CONTENT = `---
name: echo-tui-setup
description: Explain how to install echo-tui skills and configure MCP servers, providers, and models.
---

# Echo TUI Setup

Use this skill when the user asks how to configure echo-tui, install skills, add MCP servers, set up lifecycle hooks, or set up LLM providers/models.

## Skills

- User-level skills live at \`~/.echo/skills/<skill-name>/SKILL.md\`.
- Project-level skills live at \`<project>/.echo/skills/<skill-name>/SKILL.md\`.
- Echo TUI may ship built-in skills; user-level skills override built-ins with the same \`name\`, and project-level skills override both.
- Each \`SKILL.md\` needs YAML frontmatter with \`name\` and \`description\`, followed by markdown instructions.
- Skill enablement is managed by \`/skills\`; built-in and user-level skill state is recorded in \`~/.echo/skills/skills.json\`, never in the npm installation directory.

## MCP servers

Configure MCP in \`~/.echo/config.json\` under \`mcp\`:

\`\`\`json
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
\`\`\`

- \`transport\` is \`stdio\` or \`http\`.
- \`mcp.enabled\` controls MCP globally, and \`mcp.servers\` holds named server profiles.
- \`stdio\` servers use \`command\`, optional \`args\`, optional \`env\`, optional \`cwd\`, optional \`timeoutMs\`, and optional \`approval\`.
- \`http\` servers use \`url\`, optional string \`headers\`, optional \`timeoutMs\`, and optional \`approval\`.
- \`approval: "always"\` asks before tool calls; \`approval: "never"\` trusts that server.

## Lifecycle hooks

Configure optional lifecycle hooks in \`~/.echo/config.json\` under \`hooks\`:

\`\`\`json
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
\`\`\`

- Supported events: \`assistant_turn_start\`, \`assistant_turn_end\`, \`assistant_turn_error\`, \`assistant_turn_cancelled\`, \`tool_call_start\`, \`tool_call_end\`, \`tool_approval_request\`, \`tool_approval_response\`, \`user_question_request\`, \`user_question_response\`, and \`compaction_end\`.
- Hook commands receive a JSON payload on stdin and \`ECHO_HOOK_EVENT\` / \`ECHO_HOOK_CWD\` environment variables.
- Tool approval and user question response payloads may include user feedback or answer text for local auditing.
- Hooks are best-effort observers: they cannot intercept execution, are not shown in the TUI, are not written to transcript/session files, and are not returned to the model.

## Providers

Configure providers under \`llm.providers\`:

\`\`\`json
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
\`\`\`

- \`preset\` selects the runtime protocol, such as \`fake-agent\`, \`openai-responses-api\`, \`openai-chat-compatible-api\`, \`anthropic-compatible-api\`, or \`openai-codex-oauth\`.
- \`apiKey\` is required for most real remote providers; \`fake-agent\` and \`openai-codex-oauth\` do not need a configured API key.
- \`baseURL\` is optional, required, fixed, or hidden depending on the preset.
- \`openai-codex-oauth\` requires an existing Codex/ChatGPT OAuth auth cache. echo-tui does not start a login flow; it reads \`codexAuthFile\`, then \`CODEX_HOME/auth.json\`, then \`~/.codex/auth.json\`. Expired access tokens are refreshed in memory only and are not written back to the Codex auth file.
- \`headers\` can hold provider-specific string headers; never expose secret values in chat unless explicitly needed.

## Models

Configure model profiles under \`llm.models\` and choose one with \`llm.selectedModel\`:

\`\`\`json
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
\`\`\`

- \`id\` is the local model profile id used by echo-tui.
- \`provider\` references a key in \`llm.providers\`.
- \`model\` is the provider's API model name.
- \`contextWindow\` is optional and controls context usage calculations.
- \`selectedModel\` must reference an existing model profile id.

Use \`/config\` inside echo-tui to edit providers and models interactively.
`;

export {
  DEFAULT_SETUP_SKILL_CONTENT,
  DEFAULT_SETUP_SKILL_NAME,
  bootstrapEchoUserSetup,
  createDefaultUserConfig,
  getDefaultEchoDir,
  getDefaultUserSetupSkillPath
};

export type {
  BootstrapEchoUserSetupOptions,
  BootstrapEchoUserSetupResult
};

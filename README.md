# echo-tui

`@eumendies/echo-tui` 是一个运行在当前终端里的 Node.js LLM TUI。它不切换 alternate screen、不依赖第三方 TUI 框架，支持流式回答、Markdown/代码高亮、会话恢复、slash 命令、skills、MCP 工具和受控本地工具调用，并提供普通对话、只读规划和 shell 执行多种模式。

实现细节见 [docs/tui-architecture.md](./docs/tui-architecture.md)。

## 前置要求

- Node.js >= 20
- 支持 ANSI 控制序列和 stdin raw mode 的终端
- Windows 下建议在 Windows Terminal + WSL2 中使用；终端需较完整支持 ANSI 控制序列，否则可能出现渲染错位、颜色残留或按键处理异常。
- `rg`（ripgrep），供 `glob` / `grep` 工具使用
- 一个兼容 OpenAI Responses / OpenAI Chat Completions / Anthropic Messages 的模型服务（首次启动可先用内置 fake agent，无需 API key）

## 安装与运行

全局安装后可在任意目录用 `echo-tui` 启动：

```bash
npm install -g @eumendies/echo-tui
echo-tui --help
```

更新到最新版：

```bash
npm install -g @eumendies/echo-tui@latest
echo-tui --version
```

卸载程序：

```bash
npm uninstall -g @eumendies/echo-tui
```

卸载只会移除全局安装的程序本体，不会自动删除 `~/.echo` 下的配置和会话数据。如需彻底清理，可先备份再删除：

```bash
cp -R ~/.echo ~/.echo.backup
rm -rf ~/.echo
```

从源码开发运行：

```bash
npm install
npm run build
npm start        # 等价于 build 后 node dist/bin/echo-tui.js
```

## 配置模型

首次启动会在缺失时创建 `~/.echo/config.json`（预置内置 fake agent，可直接进入界面）和内置 setup skill，不覆盖已有内容。

进入界面后用 `/config` 配置真实 provider 和 model：选择 provider preset、填写 API key / Base URL、添加模型，保存后即可对话。也可以直接编辑 `~/.echo/config.json`：

```json
{
  "llm": {
    "providers": {
      "default": { "preset": "openai-responses-api", "apiKey": "<your-api-key>" }
    },
    "selectedModel": "fast",
    "models": [
      { "id": "fast", "provider": "default", "model": "<model-name>" }
    ]
  }
}
```

- `preset` 选择运行时协议，常用 `openai-responses-api`、`openai-chat-compatible-api`、`anthropic-compatible-api`，以及一组固定 Base URL、只需填 API key 的厂商 preset（DeepSeek、Kimi、Z.ai、Minimax、StepFun、OpenRouter、Xiaomi 等）。
- `model` 是 provider 的 API 模型名；`contextWindow` 可选，留空时按内置模型映射或默认窗口推断。
- `reasoning.effort` 可选，用 `/effort` 调整；`tools.bash.maxOutputBytes` 可限制 bash 工具输出上限。bash 工具默认无固定超时，可用 Esc 中断；如确实需要自动终止，可显式配置 `tools.bash.timeoutMs` 为正整数。

也可以选择 `openai-codex-oauth` preset，通过本机已有 Codex/ChatGPT OAuth 登录态使用 Codex 订阅模型。本项目不会发起 OpenAI 登录流程，只读取现有 auth cache：优先使用 provider 的 `codexAuthFile`，其次是 `CODEX_HOME/auth.json`，最后是 `~/.codex/auth.json`。示例：

```json
{
  "llm": {
    "providers": {
      "codex": { "preset": "openai-codex-oauth" }
    },
    "selectedModel": "codex-gpt",
    "models": [
      { "id": "codex-gpt", "provider": "codex", "model": "gpt-5.5" }
    ]
  }
}
```

Codex OAuth access token 过期时，echo-tui 会用 auth cache 中的 refresh token 请求刷新接口，并只在当前进程内使用新的 token；不会回写或更新 Codex 的 `auth.json`。如果 Codex 登录态失效，需要用户用 Codex/OpenAI 自己的登录流程重新生成 auth cache。

API key 不要提交到仓库。更多配置说明见内置 `echo-tui-setup` skill。

## 交互模式

底部状态行显示当前模式。Tab 在四种模式间循环，也可用 `/mode` 切换：

| 模式 | 行为 |
| --- | --- |
| `normal` | 普通对话，模型可使用全部默认工具和 MCP 工具 |
| `plan` | 只读规划，模型只能探索和制定方案 |
| `shell` | 本地执行输入的 bash 命令，结果进入模型上下文 |
| `shell-local` | 本地执行 bash 命令，结果只在本地显示 |

## 常用按键

| 按键 | 行为 |
| --- | --- |
| Enter / Ctrl+J | 发送 / 插入换行 |
| Up / Down | 历史、多行移动或选择候选 |
| Tab | 补全 slash/skill 候选；无候选时循环交互模式 |
| `@` | 打开文件选择器，把文件/PDF/图片加入输入 |
| Esc | 关闭面板、隐藏建议、中断 shell 命令或回答 |
| Ctrl+C / Ctrl+D | 退出 |

## Slash 命令

| 命令 | 行为 |
| --- | --- |
| `/help` | 查看帮助 |
| `/config` `/model` `/effort` | 配置 provider/model、切换模型、调整推理等级 |
| `/mode` `/context` | 切换交互模式、查看上下文占用 |
| `/clear` `/compact` `/resume` | 清屏、压缩上下文、恢复历史会话 |
| `/diff` `/undo` | 查看文件差异、回退上一轮文件修改与会话记录 |
| `/mcp` `/hooks` `/skills` `/themes` | 管理 MCP server、lifecycle hooks、skills、内置主题 |
| `/init` `/review` | 生成或评审 AGENTS.md、审查当前 Git 变更 |
| `/<skill-name> [args]` | 调用已启用 skill |

## Skills

skill 放在 `.echo/skills/<name>/SKILL.md`（项目级）或 `~/.echo/skills/<name>/SKILL.md`（用户级），同名时项目级覆盖用户级。每个 `SKILL.md` 需要 `name` / `description` frontmatter 加 Markdown 指令。用 `/skills` 启用或停用。

## 工具与授权

默认工具包括文件发现/搜索/读取、网页读取与搜索、bash 执行、`apply_patch` 编辑、skill 加载和用户提问；配置并启用后还有 MCP 工具。`apply_patch`、高风险 bash 和 `approval: "always"` 的 MCP 工具在执行前请求授权；plan 模式只暴露只读工具。工具没有沙箱，请只在信任当前工作区、模型和授权提示时允许执行。

## Lifecycle hooks

可在 `~/.echo/config.json` 的 `hooks` 节点为生命周期事件配置本地命令，也可用 `/hooks` 在 TUI 内查看、添加、编辑、启停、删除、保存并即时 reload。hooks 是 best-effort 旁路观察者：不能拦截或修改对话、工具、审批、压缩或模型请求；stdout/stderr、退出码和失败默认不显示到 TUI，不写入 transcript，不保存到 session，也不回传模型。

```json
{
  "hooks": {
    "assistant_turn_end": [
      {"command": "node ~/.echo/hooks/log-turn.js", "timeoutMs": 5000}
    ],
    "tool_call_end": [
      "node ~/.echo/hooks/tool-audit.js",
      {"command": "node ~/.echo/hooks/debug.js", "timeoutMs": 3000, "enabled": false}
    ]
  }
}
```

支持事件：`assistant_turn_start`、`assistant_turn_end`、`assistant_turn_error`、`assistant_turn_cancelled`、`tool_call_start`、`tool_call_end`、`compaction_end`。每个 hook 以当前工作目录运行，stdin 收到 JSON payload，并带有 `ECHO_HOOK_EVENT` 与 `ECHO_HOOK_CWD` 环境变量。对象格式 entry 可设置 `timeoutMs` 和 `enabled`；`enabled: false` 会保留在配置中供 `/hooks` 管理，但不会参与后续 lifecycle hook 执行。无效 hook 配置会被忽略，不影响 TUI 启动或对话。

`/hooks` 的 Test 动作用系统构造的 synthetic payload 验证单条命令的 cwd/env/stdin/timeout 契约；它不会提交消息、启动 assistant turn、触发真实 tool call/approval/tool execution、执行 compaction 或派发额外 lifecycle hook event。测试结果只在当前 `/hooks` 面板中显示 bounded stdout/stderr、exit code/timeout 和耗时，不进入 transcript/session/provider request/tool result。Synthetic payload 只用于测试契约，不能代表真实事件 payload 的完整业务覆盖。

## 主题与 MCP

- 主题配置在 `~/.echo/theme.json`，根字段 `theme` 选择内置主题，其余字段作为 override；用 `/themes` 即时切换。浅色终端可优先试 `default-light`、`macaron`、`paper-light`、`porcelain`、`rose-dusk`、`solarized-light` 或 `spring-mist`。
- MCP 配置在 `~/.echo/config.json` 的 `mcp` 节点（`enabled` 加按名组织的 `servers`，支持 stdio / http），用 `/mcp` 查看和管理。

## 会话存储

会话按工作目录分区保存为本地明文 JSON：

```text
~/.echo/echo_tui/projects/{cwd-hash}/sessions/{session-id}.json
```

清理历史可删除对应 session 文件或整个 `~/.echo/echo_tui/` 目录。

## 开发命令

```bash
npm run typecheck
npm test
npm run clean
```

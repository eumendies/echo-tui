# echo-tui

`@eumendies/echo-tui` 是一个运行在终端里的 AI 助手，支持流式回答、Markdown 与代码高亮、会话恢复、Skills、MCP 和本地工具调用。除了日常对话，还可以用它阅读项目、制定方案、修改代码或直接执行 shell 命令。

## 前置要求

- Node.js >= 20.3
- macOS、Linux，或 Windows Terminal + WSL2
- 建议安装 [ripgrep](https://github.com/BurntSushi/ripgrep)，用于文件搜索
- 使用真实模型时，需要相应服务的 API key；未配置时可先使用内置的 fake agent 体验界面

## 快速开始

```bash
npm install -g @eumendies/echo-tui
cd your-project
echo-tui
```

首次启动后，输入 `/config` 配置模型和界面偏好。Echo TUI 支持 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages 兼容服务，以及 DeepSeek、Kimi、Z.ai、Minimax、StepFun、OpenRouter、Xiaomi 等内置 Provider 预设。

如果希望使用 Codex 订阅模型，也可以选择 `openai-codex-oauth`。该方式会使用本机已有的 Codex/ChatGPT 登录状态；Echo TUI 不负责发起登录，登录失效时需要通过 Codex 或 OpenAI 重新登录。

配置保存在 `~/.echo/config.json`。请勿把 API key 提交到代码仓库。需要手动配置 Provider、模型或 MCP 时，可在 Echo TUI 中调用内置的 `echo-tui-setup` Skill 获取说明。

更新或查看当前版本：

```bash
npm install -g @eumendies/echo-tui@latest
echo-tui --version
```

## 单轮 CLI 对话

`--once` 适合脚本或命令行管道。它只输出本次回答，不进入交互界面，也不会保存为可恢复会话：

```bash
echo-tui --once "解释当前项目"
echo-tui --once explain this project
```

单轮模式默认只允许无需审批的安全操作。如果明确允许本次任务修改文件或执行其他受控工具，可以使用：

```bash
echo-tui --once --full-access "按要求修改文件并运行检查"
```

`--full-access` 仅对当前命令生效，可能执行破坏性操作，并且不提供 `/undo` 回滚。请只在信任当前项目和任务内容时使用。

## 交互模式

底部状态行会显示当前模式。按 Tab 可以循环切换，也可以使用 `/mode`：

| 模式 | 用途 |
| --- | --- |
| `normal` | 普通对话，允许模型按授权使用工具 |
| `plan` | 只读分析和制定方案，不修改文件 |
| `shell` | 执行 shell 命令，并把结果提供给模型 |
| `shell-local` | 只在本地执行和显示 shell 命令 |

## 常用按键

| 按键 | 行为 |
| --- | --- |
| Enter / Ctrl+J | 发送 / 插入换行 |
| Up / Down | 浏览历史、移动光标或选择候选 |
| Tab | 补全命令或 Skill；无候选时切换模式 |
| `@` | 选择文件、PDF 或图片并加入输入 |
| Esc | 关闭当前面板或中断正在执行的任务 |
| Ctrl+C / Ctrl+D | 退出 |

模型回答期间仍可编辑下一条消息，也可以使用 `/help`、`/status`、`/context`、`/usage` 和 `/copy`。提交的新消息会在当前回答结束后自动发送；同一时间最多保留一条待发送消息。

## 常用命令

| 命令 | 行为 |
| --- | --- |
| `/help` | 查看帮助 |
| `/config` | 配置模型、常规偏好和主题 |
| `/model` `/effort` | 切换当前会话的模型和推理等级 |
| `/mode` | 切换交互模式 |
| `/status` | 查看当前项目、模型和会话状态 |
| `/context` `/usage` | 查看上下文占用和本地 Token 用量 |
| `/clear` `/compact` `/resume` | 开始新会话、压缩上下文、恢复历史会话 |
| `/fork` | 从当前会话创建一个独立的对话分支 |
| `/reference` | 把一个历史会话作为下一条消息的参考 |
| `/diff` `/undo` | 查看文件改动、回退上一轮改动 |
| `/mcp` `/hooks` `/skills` | 启停已配置的 MCP Server，管理 Hooks 和 Skills |
| `/init` `/review` | 初始化项目指令、审查当前 Git 改动 |
| `/<skill-name> [args]` | 调用已启用的 Skill |

## 项目指令与扩展

### 项目指令

Echo TUI 默认读取 `AGENTS.md`，也可以在 `/config` 中改为 `CLAUDE.md`。把文件放在项目目录中，可以告诉助手项目结构、编码规范和验证方式；把文件放在 `~/.echo/` 下，则可以设置个人通用习惯。

如需完全替换默认的基础 System Prompt，可在项目中或 `~/.echo/` 下创建 `SYSTEM.md`。项目中的配置优先于用户级配置。

### Skills

项目级 Skill 放在 `.echo/skills/<name>/SKILL.md`，个人 Skill 放在 `~/.echo/skills/<name>/SKILL.md`。使用 `/skills` 可以启用、停用 Skill，并为显式调用选择模型。

### MCP、Hooks 与主题

- 使用 `/mcp` 启停已配置的 MCP Server。
- 使用 `/hooks` 在回答、工具调用或上下文压缩等事件发生时运行本地命令 (比如使用terminal-notifier在完成回答、需要审批时发送通知)。
- 使用 `/config` 的“外观”页面切换主题；自定义主题保存在 `~/.echo/theme.json`。

## 工具与授权

Echo TUI 可以读取和搜索文件、访问公开网页、执行 shell 命令、修改文件，并调用已配置的 MCP 工具。涉及文件修改、高风险命令或需要确认的 MCP 工具时，交互模式会先请求授权；`plan` 模式始终拒绝写操作。

这些工具不在沙箱中运行。授权前请检查操作内容，并确保你信任当前工作目录、模型服务和 MCP Server。

## 会话与本地数据

交互会话会按工作目录保存在 `~/.echo/echo_tui/` 下，方便通过 `/resume` 继续之前的对话。会话内容是本地明文，请不要在对话中输入不希望保存在磁盘上的敏感信息。

- `/clear` 会开始新会话，但不会删除历史会话。
- `/fork` 只创建对话分支，不会创建 Git 分支、worktree 或文件快照；不同对话分支仍共享同一个工作目录。
- `--once` 不保存可恢复会话。
- 如需清理全部配置和历史数据，请先备份，再删除 `~/.echo`。

## 卸载

```bash
npm uninstall -g @eumendies/echo-tui
```

卸载只移除程序，不会删除 `~/.echo` 下的配置和会话。

## 从源码运行

```bash
npm install
npm run build
npm start
```

开发检查：

```bash
npm run typecheck
npm test
```

实现与架构说明见 [docs/tui-architecture.md](./docs/tui-architecture.md)。

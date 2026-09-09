## Why

bash 沙箱（`tools.sandbox`）目前只能手写 `~/.echo/config.json`：档位名、布尔值、绝对路径数组全靠编辑 JSON，既不可发现也容易写错（非法档位会让配置解析直接失败）。`/config` 已是常规/模型/外观的统一配置中心，沙箱作为 bash 执行的核心边界应当有一致的 TUI 配置入口，且保存后无需重启即时生效。

## What Changes

- `/config` 新增「沙箱」Tab，Tab 顺序为：常规 → 模型与 Provider → 沙箱 → 外观；Tab 循环、现场保留与读取错误隔离按既有规则扩展到四个 Tab
- 沙箱 Tab 提供草稿编辑：档位三档循环（`off` / `read-only` / `workspace-write`）、网络访问开/关、`extraWritablePaths` 逐条展示并支持行内输入添加与 Enter 移除
- 保存经 `UserConfigContext` 原子写入 `tools.sandbox` 并发布新配置 revision，下一条 bash 命令即时按新边界执行，无需重启；`read-only` 档忽略 `extraWritablePaths`（保持 provider 既有语义）
- 校验就地展示错误（档位非法、路径非绝对/为空/重复），非法草稿不落盘；脏草稿接入现有 Esc 放弃确认
- 新增 `sandbox-config-editor` 草稿读写层（读缺省值与解析层一致：`workspace-write` + 网络开启 + 空数组），`host.config` 端口新增 `readSandboxDraft` / `saveSandboxDraft`

## Capabilities

### New Capabilities

- `config-sandbox-panel`: `/config` 沙箱 Tab 的面板交互（档位/网络/可写目录编辑）、草稿校验与保存生效语义

### Modified Capabilities

- `config-surface-settings`: 「Tab 配置中心」由三 Tab 扩为四 Tab（新增「沙箱」），Tab 循环、现场保留与脏草稿放弃确认覆盖新 Tab

## Impact

- 代码：`src/config/sandbox-config-editor.ts`（新）、`src/config/llm-config.ts`（导出 `SANDBOX_MODES`）、`src/config/user-config-context.ts`、`src/types/command.ts`、`src/app/command/model-command-ports.ts`、`src/commands/config/state.ts`、`src/commands/config/handler.ts`、`src/render/footer/config-surface.ts`
- 测试：`test/config/sandbox-config-editor.test.js`（新）、`user-config-context` / `config-command-handler` / `config-surface` 追加用例
- 兼容性：无破坏性变更——配置文件格式、默认值与解析语义不变，`/config` 之外的读取入口不受影响

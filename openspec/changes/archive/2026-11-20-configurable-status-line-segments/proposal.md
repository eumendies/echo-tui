## Why

普通输入态的 status line 目前是一行固定拼接的 8 个 segment：模型、effort、会话标题、`TOOLS all`、目录、`ctx`、mode、key hint。窄终端下右侧整体被丢弃、左侧再被截断，用户无法表达"我只关心模型和 ctx"或"我有 oh-my-zsh 式的目录提示，不需要 dir"这类偏好。项目已经有一套成熟的 `ui.*` 显示偏好管线（`ui.showReasoningSummary`、`ui.historyRenderLineLimit`、`ui.slashSuggestionMaxVisible`），但 status line 的各段仍是硬编码，是当前唯一没有配置入口的高频视觉区域。

## What Changes

- 新增 6 个独立布尔开关，分别控制 status line 的 6 个可选 segment 是否渲染：`model`（模型名，含 `(SKILL override)` 后缀）、`effort`（推理强度）、`title`（会话标题）、`dir`（项目目录名）、`contextUsage`（`ctx <used>/<window>`）、`approval`（`TOOLS all`）。
- 配置落盘为 `ui.statusLine.<segment>`，默认全部为 `true`；缺失、类型错误或非布尔值按字段独立回退默认值，不影响 `ui` 下的其他键和未知字段。
- `/config` 常规 Tab 在 `reasoningSummary` 行之后新增一行「状态栏显示项」，Enter 进入子面板；子面板包含固定顺序的 6 个开关行和一行「保存常规设置」，Enter / Left / Right 切换开关，Esc / Backspace 返回常规页，Tab 切到下一个 Tab。
- 子面板的开关直接读写常规 Tab 草稿，因此复用既有的 dirty fingerprint、显式保存和放弃确认语义，不引入第二套草稿。
- 渲染层按开关过滤 segment；status line 的 `mode` segment（含 spinner、`PLAN`、`SHELL` 和 subagent 视图标识）与 `keyHint`（如 `Esc 中断`）SHALL 保持固定不可配。
- `Ctrl+T` 模型调节（`model.kind === 'tuning'`）期间 SHALL 强制显示 `model` 与 `effort`，否则调节界面没有 `‹model›` 焦点反馈。
- 关闭全部 6 个 segment 后 status line SHALL 仍保留 mode segment，不产生空行占用 footer 高度。
- 保存或 config watcher 检测到 status line 段配置变化时 SHALL 只重绘 footer，不做 destructive replay、不清空 context usage、不追加 transcript record。
- 无 **BREAKING**：默认值等价于当前行为，既有配置无需迁移。

## Capabilities

### New Capabilities

- `status-line-segments`: 定义 status line 可选 segment 的配置 schema、归一化与写入语义、渲染期过滤规则、tuning 强制显示、全关降级、变化即时生效，以及 BTW / subagent 视图和 headless 路径的适用范围。

### Modified Capabilities

- `config-surface-settings`: 常规 Tab 的设置行集合新增「状态栏显示项」入口行，并定义其子面板的行集合、焦点、开关切换、保存与 Esc/Tab 层级行为。
- `terminal-tui-prototype`: `footer status line` 与 `status line 显示真实 context usage` 两条要求需要增加"由用户在配置中心显式关闭的 segment 除外"的例外，否则与新的配置能力冲突。

## Impact

- 配置：`src/config/app-settings-config.ts`（`StatusLineSegments` 类型、`DEFAULT_STATUS_LINE_SEGMENTS`、`statusLineSegments` 字段、`normalizeAppSettings`／`applyAppSettingsDraft`／`validateAppSettingsDraft`、`AppRenderPreferences` 与 `DEFAULT_RENDER_PREFERENCES`）。
- 状态派生：`src/app/state/app-context.ts`（`renderPreferences` 组装、`applyAppSettingsSnapshot` 新增变化标志）、`src/app/main.ts`（按新标志选择 footer 重绘路径）。
- 渲染：`src/render/footer.ts`（把 `renderPreferences` 下传到 footer surface）、`src/render/footer/composer-surface.ts`（`createLeftStatusSegments`／`createRightStatusSegments` 按开关过滤，`renderSubagentViewSurface` 接受同一份偏好）。
- 配置面板：`src/types/command/config-surface.ts`（`view: 'statusLine'` 变体）、`src/commands/config/state.ts`（行集合、子面板行投影与初始态）、`src/commands/config/handler.ts`（子面板事件分发、Esc/Tab 层级）、`src/render/footer/config-surface.ts`（入口行文案与子面板投影）。
- 测试：`test/config/app-settings-config.test.js`、`test/render/footer.test.js`、`test/render/config-surface.test.js`、`test/commands/config-command-handler.test.js`。
- 文档：`docs/configuration.md`、`docs/tui-architecture.md`。
- 不影响：transcript 与 journal 格式、session index、provider 输入、token 估算、compaction、MCP、tool approval 流程、主题系统，以及 headless `--once` 的既有行为（不渲染 footer）。

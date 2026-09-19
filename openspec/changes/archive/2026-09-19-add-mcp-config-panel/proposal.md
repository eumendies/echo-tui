## Why

`/mcp` 目前只支持启停：面板是单层列表，Space 切 enabled、Enter 保存并重载，配置字段只能手工编辑 `~/.echo/config.json`。与此同时 MCP 的原语已经从 tools 扩到 resources 与 prompts，manager 里已经有完整的运行事实（工具、资源、模板、prompt、诊断），但面板只显示一个 tool 计数。

用户诉求是把 `/mcp` 做成 `/config` 里 provider 配置那样的可编辑面板：一级总览，进入某个 server 编辑字段，并能查看该 server 的 tools / resources / prompts。

## What Changes

- `/mcp` 从单层列表升级为多视图面板（沿用 `/config` 的 `view` 判别联合与 handler/renderer 共享行投影的纪律）：
  - **overview**：全局开关 + 各 server 行（enabled、transport、tools/resources/prompts 三类计数或诊断）+ `[新增 server]` + `[保存并重载]`；
  - **server**：编辑 enabled、transport、`url`/`command`、`args`、`cwd`、`env`、`headers`、`timeoutMs`，并展示 runtime 事实（capabilities、三类计数、只读工具数、诊断）；
  - **entries / entryDetail**：`args`、`env`、`headers` 集合字段的增删改子视图；
  - **inventory**：只读浏览该 server 的 tools（含只读标记）、resources（含 templates）与 prompts（含参数签名）；
  - **discardConfirm / error**：未保存改动离开时确认；草稿校验失败时逐项报错而不是静默修正。
- 配置写回从"只写 enabled"扩展为字段级草稿写回：只更新面板展示的字段，**保留未知字段**，原子写；密钥字段用 `undefined` 表示"未改动"，写回时保留旧值。
- 密钥展示为掩码（`••••`，同 `/config` 的 `apiKey`），需要专用按键显式清空；空输入不覆盖已有凭据。
- 保存语义沿用现状并明确化：显式 `[保存并重载]` 行触发写回 → `reload()` → 清理 context usage；面板期间不写盘、不重连。
- 编辑场景对非法输入直接报错（名称为空/重复、stdio 缺 `command`、http 缺 `url`、`timeoutMs` 越界），不再沿用运行时的"静默归一为 unnamed"策略。
- 不改变 MCP 配置 schema（字段集合与语义不变），因此 `echo-tui-setup` skill 无需更新。

## Capabilities

### New Capabilities

- `mcp-config-panel`: 面板视图树与导航、server 编辑表单与校验、集合字段子视图、密钥掩码与"未改动"语义、显式保存与丢弃、运行事实与只读清单浏览。

### Modified Capabilities

- `interactive-mcp-command`: 面板从单层列表升级为多视图可编辑面板；键位模型从"Space 切换 + Enter 保存"扩展为"进入/编辑/确认 + 显式保存行 + 返回/丢弃"；原 `### Requirement: /mcp command 不编辑 server 细节` 被移除（行为反转，迁移到新能力）。

## Impact

- 配置层：`src/config/mcp-config.ts`（新增字段级草稿写回与校验）、`src/config/user-config-context.ts`（新增保存入口）。
- 命令层：`src/commands/mcp-command-handler.ts`（状态机扩展）、新增 `src/commands/mcp/state.ts`（行投影与草稿归一，避免 handler 过大）。
- 端口：`src/app/command/mcp-command-port.ts`（server 详情、清单读取、保存草稿；`saveServerStates` 被取代）。
- 类型与渲染：`src/types/command.ts`（`McpCommandSurface` 改为 `view` 判别联合）、`src/render/footer/mcp-surface.ts`（按 view 分派）。
- 测试：`test/commands/mcp-command-handler.test.js`（或同等位置）、`test/config/mcp-config.test.js`、`test/app/command-host.test.js`、渲染测试。
- 文档：`README.md`、`docs/tui-architecture.md`；`echo-tui-setup` skill 不涉及（无新增配置字段）。

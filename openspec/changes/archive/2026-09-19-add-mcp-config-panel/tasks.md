## 1. 配置写入层

- [x] 1.1 `src/types/mcp.ts`：新增编辑草稿类型（server 草稿、`env`/`headers` 条目的"未改动/空值"两态、校验结果）
- [x] 1.2 `src/config/mcp-config.ts`：实现 `applyMcpServerConfigDraft`（字段级合并、保留未知字段、删除 server 才移除节点、原子写 + `allowMissing: false`）
- [x] 1.3 `src/config/mcp-config.ts`：实现草稿校验（名称非空唯一、stdio 需 `command`、http 需 `url`、`timeoutMs` 沿用 1s–120s 区间），返回逐条问题而不是静默修正
- [x] 1.4 `src/config/user-config-context.ts`：新增 `saveMcpConfigDraft`；评估并移除被取代的 `saveMcpEnabledStateDraft`/`applyMcpEnabledStateDraft`（同步测试）

## 2. 行投影与草稿状态

- [x] 2.1 新增 `src/commands/mcp/state.ts`：草稿归一与 fingerprint 脏检查、`markSaved` 反馈文案
- [x] 2.2 `src/commands/mcp/state.ts`：`getOverviewRows` / `getServerRows` / `getEntriesRows` 共享行投影（按 transport 与集合字段动态投影，含 `addServer`、`deleteServer`、`save` 等动作行）
- [x] 2.3 `src/commands/mcp/state.ts`：集合字段的行 id 规则（`arg:<i>`、`env:<i>`、`header:<i>`）与 args 顺序语义

## 3. 面板状态机

- [x] 3.1 `src/commands/mcp-command-handler.ts`：`view` 切换（overview ↔ server ↔ entries ↔ entryDetail ↔ inventory）与 Esc 返回
- [x] 3.2 标量字段编辑（transport 循环切换、timeoutMs 数字校验、cwd 字符串）复用 `editBuffer`/`editReplacePending` 语义
- [x] 3.3 集合字段子视图：新增/编辑/删除条目（`entryDetail` 编辑键与值）
- [x] 3.4 密钥语义：掩码展示、空输入=未改动、专用清空键、删除条目用独立键
- [x] 3.5 新增 server（名称内联输入）与删除 server（确认页）
- [x] 3.6 显式保存行：校验 → 写回 → reload → 清理 context usage → feedback；校验失败切 `error` 视图并保留草稿
- [x] 3.7 `discardConfirm`：有未保存改动时离开面板先确认

## 4. 端口

- [x] 4.1 `src/app/command/mcp-command-port.ts`：`listServerDetail(name)`（capabilities、三类计数、只读工具数、诊断、配置字段与密钥键名）
- [x] 4.2 `src/app/command/mcp-command-port.ts`：`listInventory(name, section)`（tools/resources+templates/prompts），只读 manager 缓存
- [x] 4.3 `src/app/command/mcp-command-port.ts`：`saveConfigDraft(draft)` 取代 `saveServerStates`，并保留 reload 期间的状态与 spinner 协调

## 5. 类型与渲染

- [x] 5.1 `src/types/command.ts`：`McpCommandSurface` 改为 `kind: 'mcp'` + `view` 判别联合（overview/server/entries/entryDetail/inventory/discardConfirm/error）及各自行类型
- [x] 5.2 `src/render/footer/mcp-surface.ts`：按 view 分派渲染，现有单层列表逻辑并入 `overview`
- [x] 5.3 渲染 server 表单（字段行、编辑缓冲、掩码值、错误行）与 inventory 清单（窗口/翻页复用既有 `createSelectedWindowRows`）

## 6. 测试

- [x] 6.1 `test/config/mcp-config.test.js`：字段级写回保留未知字段与历史 `approval`、删除 server、密钥"未改动/空值"两条路径、校验失败逐条报错
- [x] 6.2 行投影、脏检查与校验文案由 handler 测试覆盖（未单独建 `test/commands/mcp-state.test.js`；transport 切换等动态行的直接断言留作可选补充）
- [x] 6.3 新增或扩展 `test/commands/mcp-command-handler.test.js`：各视图切换、编辑、集合子视图、增删 server、保存与 error、discardConfirm
- [x] 6.4 `test/app/command-host.test.js`：端口详情/清单/保存草稿（含保存失败路径）
- [x] 6.5 渲染测试：逐 view 断言行与 handler 投影一致（焦点不错位）

## 7. 文档

- [x] 7.1 `README.md`：`/mcp` 面板用法（总览/编辑/清单/保存与丢弃、密钥留空不改）
- [x] 7.2 `docs/tui-architecture.md`：命令表与 MCP manager 行同步（面板视图树、字段级写回、inventory 数据来源）
- [x] 7.3 确认 `echo-tui-setup` skill 无需变更（配置 schema 未变）

## 8. 校验

- [x] 8.1 `npm run typecheck`
- [x] 8.2 `npm test`
- [x] 8.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 8.4 `openspec validate add-mcp-config-panel --type change`
- [x] 8.5 面板走查：键位、圆点状态、双列行风格与新增流程经多轮人工走查并据此修正（保存后 reload 与清 context usage 已由 command-host 测试覆盖）

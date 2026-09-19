## Context

现状（代码事实）：

- `src/commands/mcp-command-handler.ts` 只有三个键位：Space 切 enabled、Enter 保存并重载、Esc 取消；`McpCommandSurface` 是单层列表（`servers: CommandMcpServerInfo[]` + `selectedIndex`）。
- `src/render/footer/mcp-surface.ts` 每行只渲染 `pill + 名称 + transport · N tools · 诊断 · summary`。
- 配置写入只有 enabled：`applyMcpEnabledStateDraft` 保留其它字段（`allowMissing: false`），经 `saveMcpEnabledStateDraft` 落盘。
- 运行事实已在 manager 上：`listTools()`（含 `readOnly`/description）、`listResources()`/`listResourceTemplates()`、`listPrompts()`（含参数）、`getDiagnostics()`；`/mcp` 端口目前只转发 tool 计数。

可照搬的既有纪律（来自 `/config`）：

- `kind: 'config'` + `view` 判别联合（general/models/appearance/sandbox/error/discardConfirm）；
- 每个视图独立 state（`draft`、`editBuffer`、`editReplacePending`、`formIndex`、`mode`、`initialDraftFingerprint`、`feedback`/`error`）；
- **行投影是 handler 与 renderer 共享的纯函数**（源码注释明确："handler 和 renderer 必须共享该结果以避免动态焦点错位"）；
- 脏检查用 fingerprint，保存成功写 `feedback: '✓ …已保存'`；
- 密钥用 `•` 掩码；集合字段（provider headers）走 `headerList`/`headerDetail` 子视图；列表类字段用 `path:<index>` 动态行 + `addPath`；
- 离开脏状态走 `discardConfirm`。

## Goals / Non-Goals

**Goals:**

- `/mcp` 成为 `/config` 风格的可编辑面板：总览 → server 编辑 → 集合子视图 → 只读清单。
- 复用既有纪律而非发明新交互：共享行投影、fingerprint 脏检查、编辑缓冲语义、discardConfirm、密钥掩码。
- 写回是字段级、保留未知字段、原子写；密钥"未改动"与"显式清空"必须可区分。

**Non-Goals:**

- 不改变 MCP 配置 schema（字段集合与含义不变），因此 `echo-tui-setup` skill 不更新。
- 不做单 server 重连／临时禁用（reload 仍是全局 close+bootstrap）。
- 不在面板里执行 MCP 调用（不做"调用工具"入口），inventory 只读浏览。
- 不引入 `@`/结构化表单之外的新 surface kind（沿用 `mcp` 与既有 `confirm`/`info`）。

## Decisions

### D1: 面板结构照搬 `/config` 的 view 判别联合与共享行投影

`McpCommandSurface` 改为 `{kind: 'mcp'; view: 'overview' | 'server' | 'entries' | 'entryDetail' | 'inventory' | 'discardConfirm' | 'error'; …}`；行集合由 `src/commands/mcp/state.ts` 的纯函数投影（`getOverviewRows` / `getServerRows` / `getEntriesRows`），handler 与 renderer 共用同一结果。

- 备选（被否）：把清单做成新 surface kind（`CommandSurface` 联合类型膨胀，且渲染文件重复）；给 `/mcp` 加子命令（`/mcp tools`）——用户明确要 `/config` 式的钻取式菜单。

### D2: 草稿模型按 server 维度显式建模，`undefined` 表示"未改动"

草稿形状：`{enabled: boolean; servers: McpServerDraft[]}`，每个 server 草稿含 `name`、`enabled`、`transport`、`url`、`command`、`args`、`cwd`、`timeoutMs`、`env: Array<{key, value?}>`、`headers: Array<{key, value?}>`；`value === undefined` 表示"保持原值"（密钥场景），空字符串表示"用户显式清空"。

- 理由：`/config` 的 apiKey 编辑天然是"用掩码覆盖"，MCP 的 env/headers 是映射，必须能表达"这一项我没动"。
- 备选（被否）：把旧值直接灌进草稿（密钥明文进内存与渲染路径，且无法区分"没动"与"改成同一个值"）；用哨兵字符串（易与真实值冲突）。

### D3: 写回是字段级合并，保留未知字段

新增 `applyMcpServerConfigDraft(root, draft)`：以当前 root config 为基线，只写入草稿显式覆盖的字段；server 的未知键、`approval`（历史字段，运行时已忽略）等一律原样保留；删除 server 才会移除该节点。写盘沿用 `updateRoot` 的原子替换与 `allowMissing: false`。

- 理由：与 `applyMcpEnabledStateDraft` 的既有纪律一致；避免面板保存把用户手写的额外字段擦掉。
- 备选（被否）：整段替换 `mcp.servers`（会丢未知字段，且与外部 revision 变化冲突时更危险）。

### D4: 密钥掩码 + 专用清空键；空输入永不覆盖

`env`/`headers` 的值在面板中显示为 `••••`；进入编辑时缓冲为空（不预填明文），提交空输入 = 不改；清空需要专用按键（`Ctrl+D`，与"删除整条"区分：删除条目用 `d`）。

### D5: 集合字段用 entries / entryDetail 子视图

`args`（有序数组）、`env`、`headers` 三者在 server 视图里各占一行（显示数量），Enter 进入 `entries` 列表（键/值摘要、`[新增]`、`d` 删除），Enter 进入 `entryDetail` 编辑键与值。`args` 用序号行（顺序即语义），env/headers 用键名行。

- 理由：与 `/config` 的 headers 子视图一致；单行文本解析无法可靠表达带空格/逗号的取值。

### D6: 显式保存行 + 保存前校验；非法输入进 error 而不是自动修正

保存动作只由 `[保存并重载]` 行触发：先跑草稿校验（名称非空且唯一、stdio 需 `command`、http 需 `url`、`timeoutMs` 必须在既有 1s–120s 区间），失败则切 `view: 'error'` 列出全部问题并保留草稿；成功则写回 → `reload()` → `clearContextUsage()` → `feedback: '✓ MCP 配置已保存'`。

编辑场景下**不沿用运行时的静默归一**（`normalizeToolNamePart` 把非法字符转 `_`、空名转 `unnamed`）：那套只服务于命名空间生成，面板里非法名称必须让用户看见。

### D7: 编辑期间以保存时刻的 root 为基线做字段级合并

外部 watcher 或其它面板可能同时修改配置；由于写回是"基线 + 显式字段"合并，面板不会把未展示字段回滚。若目标 server 在保存时已被删除，写回按"新增"处理并如实报错/成功。

- 备选（被否）：乐观指纹（`initialDraftFingerprint` 只用于脏检查，不用于拒绝写回）——字段级合并已经消除了大部分冲突面，加乐观锁会让"边看文档边改配置"的常见路径变烦。

### D8: inventory 只读，数据来自 manager 缓存

tools/resources(+templates)/prompts 直接读 manager 的 bootstrap 缓存（`listTools`/`listResources`/`listResourceTemplates`/`listPrompts`），不触发新连接、不调用 MCP。未初始化或配置无效的 server 在详情页只展示配置字段与诊断，清单入口按不可用呈现。

- 理由：面板不应引入网络副作用；`/mcp` 保存后的 `reload()` 已经刷新缓存。

## Risks / Trade-offs

- [handler 体积膨胀] → 行投影、草稿归一、校验与文案全部放 `src/commands/mcp/state.ts`（对齐 `/config/state.ts`），handler 只留状态机。
- [误清凭据] → `undefined` = 未改动 + 空输入不覆盖 + 专用清空键 + 单测覆盖"留空不改""显式清空"两条路径。
- [保存后全局 reload 抖动] → 只在保存行触发一次；UI 期间用既有 `mcpBootstrapStatus` + spinner 表达，文档写明新增/删除 server 必须重连。
- [写回擦掉手写字段] → 字段级合并 + 未知字段保留 + writer 单测（含 `approval` 等历史键）。
- [焦点错位] → 行投影共享纯函数 + 渲染测试断言行 id 与 handler 一致。
- [无效 server 的修复路径变化] → 旧 spec 规定"只展示诊断、不修复"；本次有意允许修复，但**不自动修复**（用户显式编辑才写入），需在迁移说明里记录。

## Migration Plan

- 无配置迁移：schema 不变，写回保留未知字段。
- 旧 `applyMcpEnabledStateDraft` / `saveServerStates` 被字段级写回取代；实施时若确认无其它调用方则删除并同步测试（`test/config/mcp-config.test.js`）。
- 旧 requirement `### Requirement: /mcp command 不编辑 server 细节` 被移除，其"保留未知字段"约束迁入新能力（`mcp-config-panel`）与 `interactive-mcp-command` 的保存要求。

## Open Questions

- 是否要在 server 视图提供"仅重连该 server"（需要 manager 新增单 server 生命周期，留作后续）。
- inventory 是否需要把条目写入剪贴板（本次明确不做，保持只读）。
- provider headers 已有 `headerList`/`headerDetail`，后续可考虑把两者的子视图组件合并复用（本次先按各自渲染文件实现，避免跨面板耦合）。

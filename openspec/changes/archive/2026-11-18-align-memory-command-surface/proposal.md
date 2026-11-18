## Why

`/memory` 把新增、编辑、删除三个管理动作全部绑定到字母键 `a` / `e` / `d`。其中 `a` 与 `e` 在全部 command surface 中是 `/memory` 独有的键位；`/mcp`、`/agents`、`/skills`、`/config` 的新增与编辑都已经采用“可聚焦行 + Enter”。这套键位带来三个具体问题：

1. **空列表死路**：user memory、catalog、item 列表为空时没有任何可 Enter 的行，`handleList` 在 `getSelected` 返回 `undefined` 后直接返回，用户只能从底部提示里找到“按 a 新增”，按错无反馈。
2. **Enter 语义分裂**：同一层里 `catalogs` 的 Enter 是“查看 items”，`user` / `items` 的 Enter 是“编辑”，而 Enter 与 `e` 完全重复，用户无法从行的形态预测 Enter 行为。
3. **破坏性操作不一致**：删除需先按 `d` 再进入只有 Enter/Esc 的文本确认页；`/mcp` 与 `/agents` 的删除都是“动作行 → 取消/确认选项”。

项目 spec 已有明确先例：`config-system-prompt` 规定系统提示词管理视图 SHALL NOT 使用字母快捷键触发操作，改用固定顺序的可操作行。`/memory` 是唯一尚未对齐该方向的管理面板。

需要说明的是，字母加速键在项目里并非只此一处（`/hooks` 的 `d`/`t`、`/tasks` 的 `r`/`s`、`/mcp` 的条目删除、`/resume` 的 `d`、`/config` 的 `d`/`s`）。本次变更只覆盖 `/memory`，其余面板的同类问题留待独立变更处理，不放进同一份 spec。

## What Changes

- 移除 `/memory` 的 `a` / `e` / `d` 字母快捷键，管理动作改为可聚焦动作行 + Enter。
- 每个列表层末尾常驻新增动作行（`+ 新增 memory`、`+ 新建 catalog`、`+ 新增 item`），空列表同样可 Enter 进入新建。
- 新增 user memory 详情层与 agent item 详情层，展示完整内容、启停开关、编辑与删除动作。
- catalog 列表层之外新增 catalog 详情层，承载名称/描述/启停、item 列表与 catalog 自身的编辑和删除。
- 删除确认层改为「取消」/「删除」两个可聚焦选项，默认焦点落在「取消」。
- 保留 Space 作为 toggle 行与列表条目的启停快捷方式，与 Enter 等效。
- **BREAKING**：`MemoryCommandSurface` 用 `rows` + `selectedIndex` 取代 `memories` / `catalogs` / `agentItems` 平行数组，`section` 取值改为分层命名。该协议仅存在于 handler 与 renderer 之间，不影响持久化格式、session journal 或 provider 请求。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `user-memory`: `/memory` 管理 command surface 的分层、键位与动作呈现方式变更——管理动作由字母快捷键改为可聚焦行 + Enter，新增动作行常驻，删除确认改为选项式。

## Impact

代码：

- `src/types/command/management-surface.ts`：`MemoryCommandSurface`、`MemoryCommandSection`、新增 `MemoryCommandRow`。
- `src/types/command/index.ts`：导出新增的行类型。
- `src/commands/memory-command-handler.ts`：分层状态、行投影与 Enter 分派。
- `src/render/footer/memory-surface.ts`：列表/详情行渲染，复用 `config-panel-rows.ts` 的共享行原语。

测试与文档：

- `test/commands/memory-command-handler.test.js`：按键路径与行投影断言。
- `docs/tui-architecture.md`：`memory` surface 的能力描述。

不受影响：

- `src/memory/memory-store.ts`、`src/memory/agent-memory-store.ts`、`src/app/command/memory-command-port.ts` 的存储与错误语义。
- provider transient 注入（`src/agent/context/memory-prompt.ts`）与内置 `agent-memory` skill 脚本。
- 编辑态的多行 composer、真实终端光标、catalog 表单与“保存失败保留草稿”行为。
- `Esc` 的层级返回顺序、session cache 与 catalog 刷新逻辑。

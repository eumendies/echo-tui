## Context

`/memory` 现在的实现把状态拆成两个维度：`section`（`types` / `user` / `catalogs` / `items`）和 `mode`（`list` / `edit` / `deleteConfirm`）。`MemoryCommandSurface` 同时携带三条平行数组（`memories`、`catalogs`、`agentItems`），渲染层按 `section` 分支决定画哪条数组，handler 用 `selectedIndex` 直接索引该数组。

这套结构有两个后果：

1. **Enter 语义无法从行形态推导**。渲染层只画"条目"，不画"动作"，所以新增和删除只能作为隐藏键位存在。
2. **空列表在渲染层退化成一个静态提示行**。`selectedIndex` 恒为 0，但没有任何行可聚焦，`handleList` 在 `getSelected()` 返回 `undefined` 后直接返回，按 Enter 没有任何反馈。

`/mcp` 已经解决了同一问题：`McpCommandSurface` 只携带 `rows: McpCommandRow[]` 与 `selectedIndex`，行带 `kind`，handler 用行 id 分派动作，渲染层复用 `src/render/footer/config-panel-rows.ts` 的共享行原语。本次设计把这个模型搬到 `/memory`。

约束：不改持久化、不改 provider 注入、不改 session journal、不引入新依赖、不使用 alternate screen。

## Goals / Non-Goals

**Goals:**

- 移除 `/memory` 的 `a` / `e` / `d` 字母快捷键，所有管理动作改为可聚焦行 + Enter。
- 让空列表、详情查看、删除确认都走同一条"行 + Enter"路径。
- 让 `/memory` 的视觉与交互原语和 `/mcp`、`/agents` 对齐，减少重复渲染代码。
- 保持现有编辑能力：多行 composer、真实终端光标、catalog 三字段表单、保存失败保留草稿。

**Non-Goals:**

- 不处理 `/hooks`、`/tasks`、`/mcp` 条目、`/resume`、`/config` 的同类字母加速键。
- 不改 `memory-store` / `agent-memory-store` 的存储格式、错误语义、原子写入。
- 不改 `agent-memory` skill 脚本或 provider transient 注入的展开/折叠逻辑。
- 不新增鼠标 hit region、不新增快捷键、不改变框宽与配色。

## Decisions

### 决策 1：层级放在 `section`，`mode` 只保留真正的模态

`mode` 收敛回 `'list' | 'edit' | 'deleteConfirm'`，分层全部由 `section` 表达：

```
types → user-list → user-detail
      → catalog-list → catalog-detail → item-detail
```

**理由**：`list` 和 `detail` 在渲染层是同构的——都是 `rows` + `selectedIndex`，都只响应 Up/Down/Enter。把它们拆成两个 `mode` 会让 Esc 分支必须同时判断 `mode` 和 `section`，且渲染入口要重复一次。分成两个 `mode` 的唯一收益是标题文案，而标题本来就由 `section` 决定。

**备选**：保留 `mode: 'list'` 并新增 `mode: 'detail'`。否决，因为它把一个正交维度塞进 `mode`，`edit` 和 `deleteConfirm` 才是真正阻断行导航的状态。

### 决策 2：surface 只携带 `rows`，结构化数据留在 handler

`MemoryCommandSurface` 用 `rows: MemoryCommandRow[]` 取代 `memories` / `catalogs` / `agentItems` / `selectedCatalog`。原始数据留在 handler 私有的 `MemoryData` 里，和 `McpPanelData` 持有 `draft` 的方式一致。

**理由**：双份状态（结构化数据 + 行投影）需要在每处 mutation 后同步更新两份，`/agents` 就是因为这个要在 `createAgentsSurface` 里重新投影。`/memory` 的数据量小、行语义简单，单份 `rows` 足够，且能保证渲染与分派永远同源。

**后果**：`MemoryCommandSurface` 是 breaking 的内部协议，测试里手工构造 surface 的位置必须同步（`test/commands/memory-command-handler.test.js` 的渲染用例）。

### 决策 3：新增动作行放在列表末尾，且始终存在

```ts
rows = [...entries, {id: 'action:add-user', kind: 'action', label: '+ 新增 memory'}]
```

**理由**：放末尾时条目在 `rows` 中的下标与在数据数组中的下标一致，`memories[selectedIndex]` 这类既有取值不需要整体偏移。放头部会让每个读取点都写 `selectedIndex - 1`，是最容易漏改的错误来源。

**备选**：头部放 `+ 新增`。否决，理由如上；虽然头部对空列表更显眼，但空列表本来就只有一行，位置差异不可见。

### 决策 4：删除目标显式记 id，不用 `selectedIndex` 反推

```ts
deleteTarget?: {kind: 'user' | 'catalog' | 'item'; id: string};
```

**理由**：现有 `confirmDelete` 用 `getSelected(data)` 按 `selectedIndex` 取删除对象。加入详情层后，`selectedIndex` 指向的是详情层的动作行（例如 `action:delete-user`），`getSelected` 会返回动作行或 `undefined`，结果是"确认后什么都没删"或删错对象，且没有错误提示。显式记 id 后，确认层只读该字段。

**测试要求**：必须有一条从详情层删除的用例，断言删除的是进入详情的那一条，而不是列表首项。

### 决策 5：从详情返回用 `focusId` 恢复焦点

```ts
focusId?: string;  // 进入 detail 前的行 id
```

进入详情时记录当前行 id，Esc 返回时 `rows.findIndex(row => row.id === focusId)`；行已不存在则回退到钳制后的索引。

**理由**：详情层里可能发生启停或删除以外的状态变化，索引会漂移；用 id 定位与行的稳定性一致。`/mcp` 用索引是因为它的 `fieldIndex` 与数据下标同构，`/memory` 的详情层 `selectedIndex` 指向动作行，不具备这种同构性。

### 决策 6：编辑返回目标也显式记录

```ts
editReturnSection?: MemoryCommandSection;
```

保存成功后回到进入编辑前的层级：

- user 新建（从 `user-list` 的新增行动作行进入）→ 回 `user-list`，焦点落在新条目。
- user 编辑（从 `user-detail` 进入）→ 回 `user-detail`。
- item 新建（从 `catalog-detail` 的新增行动作行进入）→ 回 `catalog-detail`，焦点落在新 item。
- item 编辑（从 `item-detail` 进入）→ 回 `item-detail`。
- catalog 新建与编辑 → 回 `catalog-list`，沿用现有 `refreshCatalogs` 的选中恢复。

**理由**：现有实现固定回 `mode: 'list'` 且 `section` 不变，加入详情层后会让"在详情层编辑后保存"落到列表层，丢掉上下文。

### 决策 7：删除确认层由「目标摘要 + 取消 + 删除」三行组成

```ts
rows = [
  {id: 'field:delete-target', kind: 'field', label: '目标', value: '<摘要>'},
  {id: 'option:cancel', kind: 'option', label: '取消'},
  {id: 'option:delete', kind: 'option', label: '删除', tone: 'danger'}
]
```

默认 `selectedIndex = 1`（取消）。摘要行是 `readonly` 字段，不参与动作执行，只用于让用户确认删的是哪一条。

**理由**：现有确认页是两行纯文本 + Enter 确认，没有"我在删哪一条"的显式呈现，也没有取消选项行。加上摘要行可以复用渲染层的 `kvRow`，不引入新原语。

### 决策 8：详情正文由渲染层折行并限高

surface 传原文 `detailContent: string`，渲染层用 `wrapText`（`src/render/layout.ts`）按当前 `contentWidth` 折行，超过预算时保留前 N 行并追加 `… 还有 M 行`。动作行始终可见。

**理由**：折行宽度只在渲染层可知，handler 提前折行会在终端 resize 后失效。memory 内容可能很长（catalog item 由 agent 写入），不限高会把动作行顶出 footer。

**备选**：详情层加滚动。否决，超出本次范围，且 `footer-mouse-wheel-scrolling` 已有独立机制，不在详情页重复实现。

### 决策 9：渲染复用 `config-panel-rows.ts`，删除本地重复实现

`memory-surface.ts` 现有的 `renderToggle`、`renderPlainOptions`、`selectedLine`、`topLine`、`bottomLine`、`line` 与 `config-panel-rows.ts` 的 `renderDot`、`actionRow`、`kvRow`、`moreRow`、`top`、`bottom`、`line` 职责重叠。改造后统一使用共享原语，与 `/mcp` 一致。

**理由**：`/mcp` 已经验证这套原语能表达 dot + 双列 + 动作 + more 提示；保留两份实现会让焦点条、active 背景、裁剪规则在三个面板之间漂移，与 `command-surface-ui-language` 的共享视觉语言要求相冲突。

### 决策 10：Space 保留，且与 Enter 等效

`kind: 'toggle'` 的行响应 Enter 和 Space；列表条目上的 Space 直接切换启停（沿用现状）。

**理由**：`/skills`、`/mcp`、`/agents` 都用 Space 做行内 toggle，这不是本次要清理的字母键；移除会破坏既有习惯与 spec 里"使用 Space 切换选中对象"的既有约束。

## Risks / Trade-offs

- **删除目标错位**（详情层的 `selectedIndex` 指向动作行）→ 决策 4 用显式 id，并新增"从详情层删除"的用例断言删除对象。
- **焦点漂移**（编辑、启停、删除后行数变化）→ 决策 5 用 `focusId` + 钳制兜底，用例覆盖"详情返回落在同一行"。
- **多层导航增加一次 Enter**（查看内容从 0 次变 1 次）→ 详情层同时承担"查看全文"和"动作入口"，对长 memory 是净收益；对短 memory 的编辑路径从 `e` 变成 `Enter → 编辑`，多一次按键，属于为了可发现性付出的成本，明确接受。
- **catalog 详情页行数膨胀**（2 个字段 + 1 个开关 + N 个 item + 3 个动作）→ 复用 `createSelectedWindowRows` 窗口化，并保证尾部动作行固定可见；预算不足时优先保留动作行与当前焦点行。
- **surface 协议 BREAKING** → 测试文件是 `.js`，`tsc` 不校验其字段，漏改会在运行时抛错而不是编译期报错；对策是在 tasks 中把"改测试"与"改类型"绑定在同一组，且渲染用例改为通过 handler 产出 surface，不再手工拼装。
- **行为回归**（catalog 列表的 Enter 从"进入 item 列表"变为"进入 catalog 详情"）→ 目标层级内容更丰富但目的相同，需要在手动验证清单里显式覆盖 catalog 进入/返回与 item 编辑往返。

## Migration Plan

无持久化迁移：`~/.echo/memories.json` 与 `~/.echo/agent-memory/` 格式不变，session journal 不变。

分四步落地，每步结束跑一次 `npm run typecheck && npm test`：

1. 类型 + 行投影 + 焦点/删除/编辑返回状态（handler 仍保留字母键兜底，保证该步测试全绿）。
2. 切换 Enter 分派、删除字母键分支、加新增动作行，改 user 相关用例。
3. 加 `catalog-detail` / `item-detail` / 三行确认层，改 catalog 相关用例。
4. 渲染层切到共享行原语 + 详情正文折行，改渲染用例，跑完整校验与手动验证。

回滚：整体 revert 该 change 的提交即可，无数据兼容问题。

## Open Questions

- 详情正文的行数上限取 7（与列表窗口一致）还是 10？倾向 10，并在 footer 高度不足时由 `constrainLayoutTail` 兜底裁剪。
- `kind: 'toggle'` 是否同时支持 ←/→（`/agents` 的 toggle 行支持）？倾向本次只做 Enter + Space，避免和"表格字段里左右移动光标"的未来需求冲突。
- catalog 详情页没有 item 时，是否保留原空状态文案（"当前没有 item"）？倾向保留，但文案改为指向新增动作行。

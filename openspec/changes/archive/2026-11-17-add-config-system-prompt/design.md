## Context

`SYSTEM.md` 的运行时链路已经完整且被测试锁住：

- `src/agent/context/system-prompt.ts` 的 `loadSystemPromptOverride()` 按“项目根 `SYSTEM.md` → `~/.echo/SYSTEM.md` → 内置”解析，项目根复用 `agent-instructions.ts` 的 `findProjectRoot()`（`.git` 或 `.echo` 标记，缺失时退化为 cwd）。
- `createBuiltInSystemPrompt()` 只把覆盖内容当作第一段基础文本，`Runtime environment`、`AGENTS.md` 指令链、`skill catalog`、`memory sections` 始终追加。
- `agent-loop-runtime.ts` 在每次 run 启动时通过 `resolveProviderPromptMaterials()` 读盘一次，同一 run 内（含 tool continuation）冻结，已有回归测试。

配置中心侧的结构也需要对齐：

- `ConfigCommandSurface` 是按 view 分支的联合类型，`ConfigCommandData` 按 Tab 存放独立 slot；模型 Tab 内部已有 `mode` 子状态机（`list`/`form`/`preset`/`modelDetail` 等）可作范式。
- `ConfigCommandHandler` 目前**没有** `handlePointer`，config surface 也不注册 hit region，测试里显式断言 `hasPointerHandler() === false`。因此本视图的“按钮”只能是“可聚焦行 + Enter”，与“保存常规设置”行同构。
- 常规 Tab 的行集合由 `getGeneralConfigRowIds()` 单点投影，handler 与 renderer 共用；dirty 由独立的 fingerprint 判断。
- `/memory` 已经给出“列表 + 内嵌多行 composer 编辑 + 光标定位”的现成写法（`composer.applyComposerEditEvent` / `insertNewline`，renderer 返回 `cursorRow`/`cursorColumn`/`showCursor`）。

约束：不引入第三方库；命令 handler 不得直接触碰 fs / renderer / terminal；新增结构化类型字段需要中文行内注释；核心 `src/app/`、`src/render/`、`src/terminal/` 新函数需要 JSDoc 风格方法注释。

## Goals / Non-Goals

**Goals:**

- 让用户在不离开 TUI 的前提下看见“当前到底用哪一份基础 system prompt、文件在哪、多大”。
- 用两条互不混淆的路径分别维护项目级与全局级 `SYSTEM.md`，消除“写入目标”这种隐式开关。
- 写盘与运行时 loader 使用同一份路径解析、同一份内容归一化口径，避免 UI 与运行期漂移。
- 原子写入，任何失败都不留下半写入或被清空的文件。
- 不改变运行期语义：优先级、动态段追加、run 内冻结、子 Agent 继承、headless 读取全部照旧。

**Non-Goals:**

- 不实现“完整真实 system prompt 逐字预览”（即把 registry、skill 快照、memory 全部重建后拼一遍）。动态段只做来源 + token 估算摘要，成本与漂移风险都不划算。
- 不提供 `$EDITOR` 外部编辑、不做鼠标点击、不新增 slash command。
- 不新增文件体积上限，也不展示体积指标：loader 本身不限制读取大小。
- 不写入 `~/.echo/config.json`，不改 transcript journal。
- 不做与外部同时修改的冲突合并（见 Risks）。

## Decisions

### 决策 1：作为 `/config` 内部的一级子视图，而不是独立 slash command

入口就在常规 Tab，用户是在“配置 system prompt”，与其它配置项同一心智。复用同一 command session 还能天然继承 Tab 切换、Esc 关闭、配置端口与 `hasPointerHandler()` 现状。

备选 `/system` 独立命令：更适合放大量输出，但会引入第二个进入路径与第二套关闭语义，且用户已明确选择挂在 `/config`。

### 决策 2：视图状态挂在 `ConfigCommandData.systemPrompt` slot，用 `mode` 五态

`mode: 'menu' | 'read' | 'edit' | 'confirmSave' | 'confirmReset'`，`target: 'project' | 'global'` 只由按钮写入并在 read/edit/confirm 全程携带。menu 不需要 target，因为它同时展示两份文件事实。

备选 A：塞进 `GeneralConfigState` —— 会让它的 draft/fingerprint/校验语义被无关状态污染。
备选 B：为该视图单独开一个 command handler —— command runtime 只维护一个 active session，代价是把 `/config` 拆成两个互斥界面。

不保留 `returnMode`：编辑一律从 menu 进入、Esc 一律回 menu，返回路径唯一，状态机不需要跨态跳转。

### 决策 3：路径解析、快照、写入、删除放回 `src/agent/context/system-prompt.ts`

读和写必须共享同一份契约：候选路径顺序、`findProjectRoot` 口径、CRLF 归一、trim、空文件视为不存在。把写入放到 `src/config/` 会立刻产生第二份口径，后续任一侧改动都可能造成“UI 说保存了但运行时读不到”。

因此在该模块新增 `resolveSystemPromptSnapshot()`、`writeSystemPromptOverride()`、`deleteSystemPromptOverride()`，并复用既有 `SYSTEM_FILE_NAME`、`getDefaultGlobalSystemPromptPath`、`findProjectRoot`。文件操作依赖可注入，便于 node:test 用假 fs 覆盖原子替换与 mkdir 分支。

### 决策 4：动态段摘要由 app 层端口组装，段级降级

摘要只需要“来源 + token 估算”，不需要逐字内容：

| 段 | 来源 | 估算方式 |
| --- | --- | --- |
| Runtime environment | cwd + 沙箱说明 | 直接构造同构文本后估算 |
| AGENTS.md | `loadAgentInstructions()` | 估算拼接后文本 |
| Skills | `createSkillManager` + `createSkillCatalogPromptProjection` | 复用 catalog 投影的 estimatedTokens |
| Memory | `resolveMemoryPrompt()` | 复用其 estimatedTokens |

skills 估算依赖模型 context window，配置不可读时该段降级为说明文案，其余段与按钮不受影响。备选“完整重建 prompt 全文”被否：要额外装配 registry 与 MCP 目录，与真实 run 仍可能因运行期参数不同而不一致，投入产出比不成立。

### 决策 5：按钮列表 + 阅读态两级，而不是共享方向键

menu 只保留状态事实与按钮，`↑/↓` 独占按钮焦点；正文阅读放到 `read` 态，`↑/↓` 与 `PgUp/PgDn` 独占滚动。这样两个方向键用途互不覆盖，也不需要引入 Tab 焦点分区（`/config` 的 Tab 已被用来切 Tab 页）。

备选“按钮与正文同屏、用 PgUp/PgDn 滚正文”：少一次进入，但两套滚动语义同时存在，用户难以判断方向键当前作用于谁。

### 决策 6：正文与草稿都按终端宽度折行，不做行尾截断

最初版本为省事用了「一个逻辑行 = 一个终端物理行」的假设，超宽部分被省略号截断；对 system prompt 这种长段落文本，等于把内容藏起来，用户无法阅读也无法确认自己在编辑什么。

改为折行：阅读态用 `wrapText` 把逻辑行展开成物理行（续行不重复行号），编辑态直接用 `renderComposer` 一次拿到折行后的可见行与真实光标行列。两处都与主 composer 共用同一套宽度口径，避免第三个换行实现。

代价是滚动偏移的单位从逻辑行变成物理行。为不让 handler 自己猜宽度，把投影抽成纯函数 `projectSystemPromptRead` 并由 renderer 导出，handler 只用 `host.status.getViewport()` 拿视口后取同一次投影的 `maxScroll`——这与 `/diff`、`/usage` 让 handler 调用 renderer 纯计算 helper 的既有做法一致。

已知取舍：折行按 grapheme 边界，不保证词边界完整，和主 composer 的行为一致；如果将来要做词级折行，应该一次性替换 `wrapText`，而不是在本视图引入第二套规则。

### 决策 7：保存一律确认，并且对“未变化 / 空内容”做前置拦截

- 一律确认：避免误覆盖，代价只是多一次 Enter。
- 未变化不写盘：避免无意义更新 mtime，也让用户明确“你的修改没有产生差异”。
- 空内容拒绝：loader 把空文件视为不存在，若允许写空，用户会以为“已覆盖成空 prompt”，实际等价于删除。指向删除动作语义更诚实。

### 决策 8：Esc / Tab 层级与 dirty 边界

`confirmSave`/`confirmReset` → 上一层；`edit`/`read` → menu；menu → 常规 Tab。`Tab` 在 menu/read 退出视图并切 Tab，在 edit/confirm 忽略（避免误丢大段草稿又切走）。草稿不进入 `discardConfirm`：它不属于任何 Tab 的 fingerprint，Esc 回退即丢弃。

### 决策 9：保存/删除成功后清 context usage

基础 prompt 变化会改变 system record 体积。复用 `app-context.ts` 已有的 `clearContextUsage()` 入口，与 `agentInstructionFileName` 变化时的处理一致，避免 `/context` 展示陈旧统计。

## Risks / Trade-offs

- **快照时差**：面板展示的是打开时的快照，外部可能已改动文件。→ 保存/删除成功后强制重新读取；提示固定写明“下一轮 assistant run 生效”；不做后台轮询。
- **与外部编辑的并发写**：保存基于快照内容判断“未变化”，不做三向合并，外部改动可能被覆盖。→ 确认框显式列出目标路径与“是/否覆盖”，让覆盖动作可见；这与仓库其它配置写入的取舍一致。
- **大文件编辑体验**：终端内编辑数万行不现实。→ 折行 + 滚动窗口，不设硬上限（loader 也没有），也不额外展示体积指标。
- **renderer 体积膨胀**：`config-surface.ts` 已 839 行。→ 新视图渲染放独立文件 `src/render/footer/system-prompt-surface.ts`，`config-surface.ts` 只做分支转发。
- **行集合变更影响既有测试**：常规 Tab 多一行会改变 `getGeneralConfigRowIds()` 的长度。→ 现有测试大多用 `indexOf(rowId)` 定位，风险集中在 `config-surface.test.js` 的行标签断言，需同步更新。
- **动态段摘要与真实 prompt 不完全一致**：skills 段可能因配置问题降级。→ 摘要区明确标注“运行时拼装、仅供估算”，不承诺逐字一致。

## Migration Plan

无数据迁移，纯增量功能。旧版本不会读取任何新文件或新配置节点；`SYSTEM.md` 本来就是普通文本文件，回滚只需不实现该视图即可，用户已写入的文件继续被 loader 正常读取。不改 `~/.echo/config.json` 结构，因此不存在配置版本兼容问题。

## Open Questions

- 编辑器是否需要在长时间编辑中支持撤销/重做：当前 composer 没有撤销栈，本次不引入，若后续需要应作为独立能力评估。

## Context

会话持久化以 append-only JSONL journal 为唯一事实来源，`sessions/index.json` 是可按 journal 指纹（`size` + `mtimeMs`）重建的轻量缓存。`TranscriptSessionSummary.title` 目前由 `createSessionTitle(records)` 从首条用户消息截取 60 字符派生，注释明确"不引入额外模型调用"。

现状的三个约束：

1. `listSessionSummaries` 在指纹失配时会重新 replay 并重算 `title`，因此任何写入 index 的生成标题都会在下一次消息落盘后被派生值覆盖。
2. `isSessionSummary` 要求 `title` 为非空字符串，空值会让整份 index 判定无效并全量重建。
3. 项目已有"用指定 model profile 发一次性无工具请求"的成熟实现：`src/app/tool-approval/resolver.ts` 的自动审批 reviewer，包含严格 profile 解析、effort 强制覆盖、独立 abort scope 与可选 usage 归因。

## Goals / Non-Goals

**Goals:**

- 让会话标题成为可继承、可持久化的权威值，跨进程重启与 journal 追加都保持稳定。
- 首条用户消息后异步生成标题，不阻塞 assistant turn 的首个响应。
- 标题生成模型可按 profile 配置，未配置时复用当前生效模型并强制 `low` effort。
- `/resume`、`/reference`、statusline 展示同一份标题，且不增加候选列表的 journal 读放大。
- 生成失败、超时或输出不合法时静默降级为现有派生标题。

**Non-Goals:**

- 不引入 `/rename` 或任何手动改名入口；本次只有派生与生成两种来源。
- 不把标题写入 journal 记录流，不改变 append-only 与 replay 语义。
- 不提升 `sessions/index.json` 的 `schemaVersion`。
- 不为已存在的历史会话补生成标题；只有会话创建后的首条用户消息触发。
- 不改变 headless `--once` 路径的标题行为，也不在 `--once` 中生成标题。

## Decisions

### 决策 1：以 `sessions/index.json` 作为标题权威值，不引入 sidecar 文件

`listSessionSummaries` 在指纹失配时已经持有 `indexed`，只需把
`title: createSessionTitle(...)` 改为 `title: indexed?.title ?? createSessionTitle(...)`，
指纹退回"只决定 `messageCount` 是否重算"的职责。`updateSessionIndex` 用
`state.title ?? existing?.title ?? '未命名对话'` 保留现值。

**备选方案**：新增 `{sessionId}.title.json` sidecar，照搬 `session-approvals-store` 的同目录派生模式。

**理由**：sidecar 需要新增文件生命周期、schema 校验、`deleteSession` 清理与跨 store 合并读取，约多出一个模块的成本；而标题丢失的最坏后果只是降级为截断文本，不影响会话可恢复性。复杂度与收益不成比例。

### 决策 2：用 `titleSource` 区分派生与生成，`title` 保持必填非空

`TranscriptSessionIndexState.title` 改为可选（省略 = 不修改），`TranscriptSessionSummary.title` 保持 `string` 且始终非空，同时新增可选字段 `titleSource: 'derived' | 'generated'`。

必须区分来源的原因：仅靠"保留已有标题"会让 `truncate_records` 移除首条用户消息后残留旧派生标题（已有测试 `session index rebuild derives count and title ... after truncate` 直接暴露该冲突）；仅靠"始终重算"又会覆盖生成标题。`generated` 永不被派生更新覆盖，`derived` 跟随当前 records 重算。

`titleSource` 缺失时按 `derived` 处理，因此旧 index 不会被判定无效，也就不会触发全量重建。`schemaVersion` 保持 1。

**理由**：`isSessionSummary` 依赖 `title.length > 0`；一旦允许空值，整份 index 会被判无效并丢失所有已有标题。不升 `schemaVersion` 是因为数据结构形状只是新增可选字段，升版本反而会触发一次主动的全量重建，把老标题清掉。

### 决策 3：生成请求复用 `createConfiguredAgent`，形状对齐审批 reviewer

新增独立模块，按以下步骤发起请求：

1. 读取 `getAppSettings().titleGenerationModelProfileId`。
2. 有值时用 `resolveLlmConfigForProfile(profileId)` 严格解析（失效即失败，不回退）；无值时用 `resolveLlmConfig({reasoningEffortOverride: 'low'})`。
3. 剥离 `reasoningSummary`，统一覆盖 `reasoningEffort: 'low'`。
4. `createConfiguredAgent(config)` 不传 tool registry，天然零工具。
5. `runTurn([{role: 'system', text: TITLE_SYSTEM_PROMPT}, {role: 'user', text: firstUserMessage}])`。
6. 从 `result.draft` 解析标题，失败返回 `null`。

**备选方案**：复用 `prepareAgent`。

**理由**：`prepareAgent` 会构建完整 tool registry、可选合并 MCP、创建 tool result store，对标题场景是纯开销；`createConfiguredAgent` 已在审批 reviewer 中验证过无 registry 的用法。

### 决策 4：`low` effort 强制适用于所有情况

即使配置了专用 profile，也覆盖为 `low`，不沿用 profile 自身的 `reasoning.effort`。

**理由**：标题生成是单行摘要，不需要推理；强制统一避免同一功能在不同 profile 下产生不可预期的延迟与 token 成本。与审批 reviewer 强制 `none` 是同一思路。

### 决策 4a：用独立布尔字段表达"不生成"

`AppSettings` 新增 `titleGenerationEnabled: boolean`（默认 `true`）。三态由两个字段组合表达：`enabled=false` 为不生成；`enabled=true` 且无 profile 引用为跟随当前模型；`enabled=true` 且有引用为指定 profile。

**备选方案**：在 `titleModelProfileId` 上用 `'off'` 等哨兵字符串表达关闭。

**理由**：哨兵值会侵占 profile id 命名空间，且让"引用失效"与"显式关闭"两种状态难以区分。独立布尔字段与现有 `toolApprovalMode` / `toolApprovalModelProfileId` 的组合方式一致，normalize 时可分别回退。切换到关闭时保留原 profile 引用，用户切回即可恢复选择，与 manual 模式下保留审批模型的行为一致。

### 决策 5：触发条件为"会话创建后的首条用户记录"

在 `runAssistantTurn` 中 `beginUserTurn` 之后判断：当前是主 transcript（非 `/btw`、非 subagent），且用户记录是本次会话的第一条。满足时 fire-and-forget 启动生成，不 `await`。

去重不依赖 index 内容（index 里永远有派生标题），而依赖"首条记录"这一结构条件，因此：

- 新会话首条消息 → 触发一次
- `/clear` 后的新会话 → 触发
- `resume` 老会话 → 不触发（标题已存在）
- `/fork` 新会话 → 不触发（继承源标题）

**备选方案**：用 `Set<sessionId>` 在进程内去重。

**理由**：进程内集合无法区分"新会话"与"恢复的会话"，会在重启后覆盖已生成的标题。

### 决策 6：`/fork` 继承源会话标题

`forkSession` 在 `updateSessionIndex` 时显式传入源会话的 `this.sessionTitle`，让新 session 的 index 条目立即带有同一标题，而不是等待新会话自行派生。

### 决策 7：statusline 标题紧随 model/effort

`StatusLineState` 新增 `sessionTitle?: string`，在 `createLeftStatusSegments` 中插入到 model 与 effort 之后、`TOOLS all` 与 `dir <project>` 之前，模型调节期间不渲染该段。

该位置让标题紧跟同属"当前会话上下文"的模型信息，而把工具授权标记与项目目录留在其后。现有 `renderStatusLineText` 从右截断左段，因此窄终端会先丢失标题尾部与项目目录，model 与 effort 仍可辨识。

标题在 statusline 内按固定字符预算截断，避免长标题把模型与 effort 挤出可见区。

### 决策 8：输出规范化

解析后执行：去首尾引号（含中英文引号与反引号）→ 压空白 → 去尾部 `.?!` → 按 grapheme cluster 截断到 60 字符。空结果视为失败，回退派生标题。

JSON 解析先尝试完整输出，再只取首个 `{...}` 对象；多段 JSON 或带解释文字的输出不会因为贪婪匹配整体失败。

截断口径与 `createSessionTitle` 共用 `splitGraphemes` 与同一 60 上限，避免派生标题与生成标题在 emoji 或 ZWJ 序列上产生不同边界。

### 决策 9：生成期间对外仍报未命名

`TranscriptContext` 增加 `sessionTitlePending` 中间态：进入等待后 `getSessionTitle()` 返回「未命名对话」，生成成功由 `applySessionTitle` 落定，失败由 `settleSessionTitle` 回落到派生标题。

**备选方案**：首条消息后不写派生标题，等生成结果再写。

**理由**：index 需要立即可用的非空标题支撑 `/resume` 与崩溃恢复，因此持久化仍写派生值；只有 statusline 这类高频可见的展示面才需要压住跳变。中间态在 `TranscriptContext` 内部，`render-context` 与 footer 不需要感知 pending 语义。

进入等待的前提是调用方确认会真正发起请求（生成开关开启）。关闭开关或非首条消息时直接使用派生标题，不产生未命名占位。

### 决策 10：左栏只放标题，选中项元数据移到右栏标题

`ResumeCommandSurface` 新增 `selectedMeta?: string`，由 `createSessionBrowserSurface` 从选中项的 `updatedAt` 与 `messageCount` 组装，渲染层拼到右栏标题 `预览 · …` 上；左栏 `createSessionItem` 只返回 `{label: title}`。

**备选方案**：把时间放在顶部面板标题行，或底部 hint 行。

**理由**：左栏列宽在有分栏时只有 22–38 列，日期固定占 17 列，最窄时标题只剩 3–5 个字。右栏标题是当前选中项的自然归属位置，切换选中项即可看到时间，且不占用稳定的行预算。右栏标题按自身列宽裁剪，窄终端先丢时间而不是标题。

该改动只影响 `kind: 'resume'` 的渲染路径，即 `/resume` 与 `/reference`；其他分栏 surface 各有独立 renderer，不受影响。

## Risks / Trade-offs

- **index 整份损坏时标题丢失** → `readSessionIndex` 返回 `null` 会全量重建并把标题降级为派生值。缓解：`writeSessionIndex` 已是 tmp + rename 原子写；降级后果仅为显示变差，不影响会话恢复。
- **首条消息后立即生成会缺少 assistant 上下文** → 首条消息过短（如"看看这个"）时标题可能不够准确。缓解：保留派生标题作为生成期间的展示值；这是为"首字响应不被阻塞"付出的代价，与 Claude Code 的取舍一致。
- **生成请求与主 turn 并发** → 两个请求共用 provider 配额，且小模型失败不影响主流程。缓解：生成侧使用独立 abort scope 与超时；失败静默。
- **`/fork` 继承标题后可能误导** → 分支会话标题与源会话相同。缓解：这是有意为之，用户可据 statusline 与 resume 列表中的更新时间区分。
- **statusline 空间竞争** → 窄终端下标题与项目目录都会被裁掉。缓解：沿用现有从右截断策略，不引入新的布局分支；model 与 effort 始终优先可见。

## Migration Plan

1. 先改存储层（`title?: string` + 继承逻辑），此时行为与现状等价，可单独验证。
2. 再接入配置项与生成器，默认不配置时不改变任何现有行为。
3. 最后接入展示（`/resume` 列表、statusline）与 `/fork` 继承。
4. 回滚：删除生成触发即可退回纯派生标题；index 中已写入的标题会作为派生值的替代继续存在，不影响回滚后的可用性。

## Open Questions

- 无。

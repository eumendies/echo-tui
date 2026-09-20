## 1. 生效来源投影（port）

- [x] 1.1 `src/types/command.ts`：为 `CommandAgentBuiltinInfo` 增加 `policy` 投影（`status: applied | ignored | none`、`sourceKind`、`sourcePath`、`fields`、`missingModelProfileId`），字段带中文领域注释。
- [x] 1.2 `src/app/command/agents-command-port.ts`：复用 `selectBuiltinSubagentOverride` 与同一 model profile 目录校验，在丢弃失效 override 之前投影来源状态，保持既有诊断文案不变。
- [x] 1.3 `test/app/agents-command-port.test.js`：覆盖 applied（用户级生效、项目级整体遮蔽）、ignored（引用不存在的 model profile）、none（未配置与无效 settings）三态。

## 2. 详情页与策略表单展示

- [x] 2.1 `src/commands/agents-command-handler.ts`：Built-in 详情新增只读 `policy` 行，区分"生效来源与路径 / 已声明但整体失效及其原因 / settings 无效 / 未配置"。
- [x] 2.2 详情页 model、effort、skills 值在当前由某个 scope 覆盖时标注来源；effort 为 `inherit` 时标注继承父 effort。
- [x] 2.3 详情页两个 scope 动作选项补充 `当前生效 / 被整体覆盖 / 已声明但未生效 / 未配置` 状态说明，并抽出共享 scope 查询 helper 消除重复查找。
- [x] 2.4 内置策略表单新增只读首行"生效策略"，说明本 scope 保存后是否立即生效；同步 `BUILTIN_FORM_ROW_IDS` 与既有 clamp 行为。
- [x] 2.5 `test/commands/agents-command-handler.test.js`：更新 builtin fixture 与行索引，覆盖详情页三态文案、动作行状态与表单首行。
- [x] 2.6 `test/render/agents-surface.test.js`：锁定 80 列下新增只读行的完整可读性与字段来源标注。

## 3. 文档与规格

- [x] 3.1 `docs/tui-architecture.md` 同步"详情页与策略表单显示当前生效来源"的行为说明；README 保持原样。
- [x] 3.2 实现完成后由归档流程把 `specs/agents-command/spec.md` 的 delta 同步进 `openspec/specs/agents-command/spec.md`。

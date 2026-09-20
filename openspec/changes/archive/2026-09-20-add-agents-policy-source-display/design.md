## Context

运行时已经存在唯一的内置 override 选择规则：`src/agent/subagent/settings.ts` 的 `selectBuiltinSubagentOverride` 按"项目级优先、无效高优先级 fail-closed、不跨来源逐字段合并"返回胜出的完整条目（`{override, sourceKind, sourcePath}`）。`/agents` 的 command port 已经调用同一函数，但在投影为 `CommandAgentBuiltinInfo` 时丢弃了 `sourceKind`/`sourcePath`，只保留 model、effort、skills 三个值。

可复用接缝：

- `agents` command port 的 `createBuiltinProjection` 已按名称计算胜出条目，并已处理"引用不存在的 model profile 时整体丢弃并产生诊断"的分支；
- 详情页与策略表单都是既有 field/action 行，renderer 支持任意长度的只读值与动作描述，不需要新增视觉语言或列宽规则；
- `snapshot.overrides` 已携带两个 sidecar 的读取状态与内容指纹，handler 可直接判断哪一侧是无效来源。

约束：

- 不得在 handler 里复制 fail-closed 选择规则，否则界面与运行时可能对"当前生效什么"给出不同答案；
- 列表行在 80 列下左列上限 30 字符、右列约 38 字符，现状已经发生截断，新增来源标记必然挤掉既有字段，因此本次不改列表；
- 内置 override 语义（整体遮蔽、不逐字段合并）不得被展示需求改变。

## Goals / Non-Goals

**Goals**

- 用户在 Built-in 详情页能一眼看出当前生效的是用户级、项目级还是父策略继承，并看到来源 sidecar 路径。
- 已声明但运行时被整体丢弃的 override 不再伪装成"未配置"。
- 策略表单在保存前告知本 scope 是否立即生效，避免"改了用户级但项目级一直在赢"的无效操作。
- 展示与运行时使用同一份选择结果，界面不会与下一 turn 的真实行为不一致。

**Non-Goals**

- 不改变列表行的列宽、字段摘要或 tab 结构。
- 不新增 scope 级开关、优先级配置或字段级合并能力。
- 不改变 `agents.settings.json` schema、写入校验、catalog 加载与诊断语义。
- 不为 `--once` headless 路径或主 Agent schema 增加展示。

## Decisions

### 来源状态由 port 投影，而不是 handler 重算

handler 只持有管理快照，不持有 fail-closed 规则。让 port 在调用 `selectBuiltinSubagentOverride` 的位置直接输出 `applied | ignored | none` 与胜出 scope，handler 只把这些字段拼成中文文案。备选方案（handler 直接读 `snapshot.overrides` 自行判断优先级）会在 UI 层复制选择规则，一旦运行时规则变化就会出现"界面说生效、实际不生效"的漂移。

### `ignored` 是独立状态，而不是并入 `none`

运行时对"引用了不存在 model profile 的 override"处理是整体丢弃并继承父策略。显示成"未配置"会让用户无法发现自己在项目里写的 override 从未生效。投影因此保留 `missingModelProfileId`，供界面点名失效引用。

### 列表行不动

80 列终端的实测：左列预算 30 字符、右列约 38 字符，现状已截断。把来源挤进任一列都会让 capability、effort、tools 等既有摘要更早消失，而详情页在 80 列下能完整承载新增内容。因此来源只在详情页与策略表单出现。

### 表单首行承载"保存后是否生效"

表单已有的 `remove` 行只能表达本 scope 是否有条目，无法表达"保存后会不会被更高优先级整体覆盖"。新增只读首行复用同一 formatter，覆盖"本 scope 生效 / 被更高优先级覆盖 / 已声明但失效 / 未配置 / 被无效 settings 阻断"五种情况。

## Risks

- 文案与实际状态不一致：由 port 单一投影与三态测试约束。
- 表单首行改变既有行索引：`BUILTIN_FORM_ROW_IDS` 是索引驱动的，新增只读行会让 `↑/↓` 顺序变化；新增行放在首位，并在 handler 测试中锁定行序与保存路径。
- 只读行被误当成可编辑项：该行不参与 `cycleFormField` 与 `activateBuiltinFormRow` 分支，Enter 与 `←/→` 为无操作，与既有 readonly 字段一致。

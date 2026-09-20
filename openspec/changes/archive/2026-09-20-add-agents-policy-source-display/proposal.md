## Why

`/agents` 允许为内置 `explorer` 与 `worker` 分别写入用户级和项目级 override，但界面只展示最终生效的 model、effort 与 Skills 值，不展示这些值来自哪个 scope。用户打开 Built-in 详情或策略表单时无法判断"当前到底是项目策略还是用户策略在生效"：

- 详情页只列出 `配置项目级策略` 与 `配置用户级策略` 两个动作，不标注哪个正在生效、哪个被整体覆盖；
- 策略表单只渲染所选 scope 的草稿，用户级 override 已配置而项目级 override 生效时，用户级表单看起来与"未配置"无异；
- 项目级 override 引用了当前配置中已不存在的 model profile 时，运行时整体丢弃该条目并回退父策略，界面显示的却是"没有配置"，与真实生效状态不可区分。

## What Changes

- 内置 Agent 的生效策略来源成为管理快照的一等投影：`agents` command port 复用运行时同一 `selectBuiltinSubagentOverride` fail-closed 规则，为每个内置定义输出 `applied | ignored | none` 状态、胜出 scope、sidecar 路径、实际覆盖字段与失效模型引用。
- Built-in 详情页新增只读 `policy` 行，明确显示当前生效来源与 sidecar 路径；未配置、被无效 settings 阻断、已声明但整体失效三种情况分别给出可读原因。
- 详情页的 model、effort、skills 值在当前由某个 scope 覆盖时标注来源（如 `fast-model（项目级策略）`），effort 为 `inherit` 时标注为继承父 effort。
- 详情页两个 scope 动作选项补充当前状态说明（当前生效 / 被整体覆盖 / 已声明但未生效 / 未配置）。
- 内置策略表单新增首行只读"生效策略"，说明本 scope 保存后是否立即生效。
- 列表行保持不变：Overview、Project、User 与 Built-in 列表的列宽与既有字段摘要不做改动。

## Capabilities

### Modified Capabilities

- `agents-command`："内置 Agent 仅开放模型策略"需求新增生效来源展示、失效 override 不得显示为生效、策略表单显示当前生效来源三类义务与场景。

## Impact

- 代码：`src/types/command.ts` 为 `CommandAgentBuiltinInfo` 增加 `policy` 投影；`src/app/command/agents-command-port.ts` 在丢弃失效 override 之前投影来源状态；`src/commands/agents-command-handler.ts` 生成详情页 `policy` 行、字段来源标注、scope 动作描述与表单首行。footer renderer 与列宽逻辑不变。
- 运行时语义：不改变 catalog 加载、fail-closed 选择、写入校验或持久化，只把已存在的选择结果暴露给管理界面。
- 测试：`test/app/agents-command-port.test.js` 覆盖 applied/ignored/none 三态；`test/commands/agents-command-handler.test.js` 覆盖详情页、动作行与表单文案；`test/render/agents-surface.test.js` 锁定 80 列下的可读性。
- 文档：`README.md` 与 `docs/tui-architecture.md` 同步呈现语义。

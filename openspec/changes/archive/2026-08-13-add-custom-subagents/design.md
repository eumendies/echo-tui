## Context

现有 Subagent 架构已经把 `name`、`description`、`prompt`、本地工具集合、MCP可见性和执行策略集中在 `src/agent/subagent/definition.ts`，并由 run-scoped `SubagentToolPort` 同时驱动 `run_subagent` schema和实际子runtime。每次委派拥有独立provider continuation、registry、Todo、compaction和transcript区域，内部过程通过`subagent` records持久化，所有子Agent均被禁止再次委派。该边界适合扩展定义来源，不需要重做主子loop或transcript协议。

本变更的复杂性集中在外部文件成为运行配置后产生的信任边界：目录优先级与无效遮蔽必须确定，provider-visible schema与执行定义必须避免TOCTOU，自定义prompt不能被当作授权，工具声明必须只能收窄现有Explorer/Worker上限，且动态名称不能向终端注入控制字符。Agent文件属于项目/用户资源，不属于`~/.echo/config.json`，因此不应进入`UserConfigSnapshot` revision或其watcher。

## Goals / Non-Goals

**Goals:**

- 支持用户级与项目级可版本控制的自定义Subagent Markdown文件，并以项目级高于用户级的确定性规则合并。
- 在父assistant run启动时形成冻结目录，让schema、名称解析、prompt、工具集合和策略使用同一份定义。
- 允许用户通过`readonly`与`general`模板创建专用角色，并在模板上限内显式收窄本地工具和MCP可见性。
- 保持内置Explorer/Worker、单层委派、四次预算、审批、plan/headless、取消传播和provider上下文隔离不变。
- 让加载器输出有界、可测试的结构化诊断，并让所有现有可见投影安全处理自定义名称。

**Non-Goals:**

- 不支持覆盖内置`explorer`或`worker`，也不支持改变内置定义。
- 不支持定义级模型profile、reasoning effort、system prompt覆盖、环境变量插值或动态脚本配置。
- 不新增`/agents`管理界面、启停状态文件、配置热更新watcher或安装命令。
- 不支持并行、后台、递归Subagent或可恢复执行栈。
- 不提供新的shell sandbox；获批后的general工具仍沿用现有本地执行信任边界。

## Decisions

### 1. 使用单文件 Markdown 定义和受限 frontmatter 子集

定义位置固定为：

```text
~/.echo/agents/<name>.md
<project-root>/.echo/agents/<name>.md
```

文件名（去掉`.md`）是唯一稳定名称，不再允许frontmatter重复声明`name`，避免目录名、遮蔽key、transcript身份和工具参数出现分歧。名称采用`[a-z0-9][a-z0-9_-]{0,63}`；`.md`匹配区分大小写，子目录和其他扩展名不参与发现。

文件示例：

```md
---
description: Review authentication and authorization risks with concrete evidence.
capability: readonly
tools:
  - read_files
  - glob
  - grep
mcp: false
---

# Security Reviewer

Prioritize authentication, authorization, credential leakage and command injection.
Return findings by severity with file paths and evidence.
```

为避免引入YAML依赖，解析器只实现该manifest需要的严格子集：顶层单值`description`、`capability`、`mcp`和`tools`缩进字符串序列；拒绝未知/重复key、anchor、tag、复合object、行内数组、模板和多文档语法。单值允许普通文本及成对单/双引号，但不做通用YAML转义求值。选择严格子集而不是JSON，是为了让角色正文保持自然Markdown；选择自行实现有界语法而不是通用YAML库，是为了维持项目无新增依赖并缩小配置执行面。

固定预算初值为：自定义定义最多32个、description最多500个Unicode code point、正文最多32KiB UTF-8、文件最多40KiB、诊断消息最多500字符。工具数量无需单独设限，因为去重后的合法工具天然受 readonly/general 固定能力集合约束。超限文件整体无效，不截断后继续执行，避免用户以为被截掉的安全约束仍然生效。

### 2. 分离 manifest、解析后定义与冻结目录

新增三个领域形态：

```text
CustomSubagentManifest
├─ description
├─ capability: readonly | general
├─ tools: manifest capability identifiers
├─ mcp
└─ instructions

SubagentDefinition
├─ name / description
├─ executionPolicy
├─ localToolNames: readonly string[]
├─ includeMcpTools
└─ prompt

SubagentCatalog
├─ listDescriptors()
├─ get(name)
└─ diagnostics
```

内置定义继续直接构造解析后定义；自定义manifest经过能力校验后转换为相同形态。来源层级和路径只属于加载候选与诊断，不进入执行定义。`localToolNames`从共享可变`Set`改为冻结数组，子runtime在构造registry时创建自己的`Set`，从而让目录保持不可变且每次委派仍获得独立执行集合。Catalog只通过方法返回descriptor或定义，不暴露可变Map。

主runtime在每个primary run中创建一次`SubagentToolPort`，Port构造时加载一次Catalog、上报诊断，并从该快照列出和解析定义。BTW和所有Subagent运行仍不创建Port。选择run-scoped snapshot而不是启动时全局扫描或每次委派重读，是为了让当前cwd、schema与执行定义一致，同时让文件修改自然在下一父run生效。

### 3. 采用“内置保留、项目覆盖用户、无效高层遮蔽低层”的合并算法

发现顺序为builtin、user、project，但自定义合并先按规范化文件名建立每层candidate索引，再解析胜出的最高层candidate：

1. `explorer`、`worker`始终指向内置定义；同名自定义candidate只产生诊断。
2. 普通名称存在项目candidate时只解析项目candidate；即使其内容无效，也不回退用户定义。
3. 不存在项目candidate时解析用户candidate。
4. 每层目录项按文件名排序；达到数量上限后的candidate按确定性顺序拒绝。

无效遮蔽能够防止项目作者提交了看似生效的限制文件，但运行时悄悄使用用户目录中权限不同的同名Agent。无法形成合法名称的文件只产生自身诊断，不遮蔽其他名称。根目录缺失按可选能力视为空；单个文件读取失败只使该candidate无效。

Catalog loader返回结构化诊断（code、sourceKind、sourcePath、message），正文不进入message。第一版诊断用于单元测试、debug/observation和后续只读管理surface的稳定接口，不为了展示诊断而把内容写入transcript或provider context；这避免每个assistant turn重复持久化相同警告。用户可依据文档和debug输出排查，后续可在不改变加载语义的情况下增加`/agents`。

### 4. 能力模板拥有权限，manifest只能选择子集

权限事实仍由代码拥有：

```text
readonly ceiling
  read_files, glob, grep, run_bash_command,
  web_fetch, web_search, use_skill

general ceiling
  readonly ceiling + file_edit + ask_user_questions,
  create_todos, complete_todo
```

`file_edit`是manifest级逻辑能力，转换时映射为`apply_patch`与`edit_file`两个候选名；默认registry只创建当前配置选中的handler，因此子provider最终只看到实际可用的一个编辑工具。这样Agent文件不必耦合用户的`tools.fileEdit.mode`。其他条目使用provider-neutral真实工具名。重复项、`run_subagent`、超出ceiling或未知条目使定义整体无效，而不是静默裁剪。

`readonly`固定映射现有`readonly_investigation`策略且强制`includeMcpTools=false`；显式`mcp: true`视为无效。`general`固定映射`general_purpose`，仅`mcp: true`时借用父MCP manager并合并其全部当前可用tools。MCP名称动态且由manager拥有，不进入静态tools列表。执行阶段仍使用现有风险分类：readonly未知Bash交互式升级、headless fail-closed；general继承normal/plan与deny/full-access。Prompt、任务文本和description均不参与授权决策。

### 5. 运行时组合固定基础约束和用户角色指令

现有Explorer与Worker prompt保持原文和行为，避免本变更顺带改变内置角色。自定义定义根据capability选择系统拥有的通用基础prompt，明确任务边界、项目指令优先级、审批、禁止递归和最终报告职责，再追加：

```text
# Custom Agent Instructions: <safe-name>
<manifest body>
```

最终组合文本作为现有`SubagentDefinition.prompt`传给`buildProviderRecords`的`rolePrompt`，委派任务仍是子transcript唯一user record。正文不替换主SYSTEM override、AGENTS、memory或skill catalog，也不成为自动审批的可信用户授权。自定义Agent继续使用父run的`modelProfileId`和`reasoningEffortOverride`，因此无需扩展`UserConfigSnapshot`或重复解析LLM profile。

### 6. 项目根与生命周期复用现有约定

项目目录通过现有`findProjectRoot(cwd, homedir, stat)`解析；找到`.git`或项目`.echo`标记时使用该根，否则使用当前cwd。用户目录固定在`os.homedir()/.echo/agents`。Loader接受cwd、homedir、readDir、readFile、stat等依赖，以便纯目录/解析测试不依赖真实home。

Agent文件像AGENTS、SYSTEM、memory和skills一样位于`UserConfigSnapshot`范围之外。每个父run只扫描一次，不注册长期watcher；活动run保持冻结，下一run重新发现。TUI与`--once`都经`createAgentLoopRuntime`使用同一loader，因此不增加headless专用分支。

### 7. 动态身份渲染使用共享安全格式化

新增无ANSI、无控制字符的Agent名称校验/格式化纯函数，catalog、外层pair renderer及需要从不可信旧record恢复身份的入口共享相同名称规则。内置Agent保留`Explorer · returned report`和`Worker · completed task`；合法自定义名称按连字符/下划线分词并生成例如`Security reviewer · completed`的通用状态。无法解析、超长或包含控制字符时回退`Subagent · completed`。

Subagent start records和活动中的`agentName`来自已解析Catalog，属于当前run受信任身份；journal replay仍执行现有结构校验，renderer再做防御性安全格式化。Transcript schema无需增加sourceKind或definition内容：恢复只需展示历史身份与过程，且不应重读定义或尝试续跑。

### 8. 不改变现有持久化和协议隔离

自定义定义只改变run启动时可选目录和子runtime配置。Start、assistant、reasoning、内部tool与terminal事件继续使用相同`subagent` role；主provider仍只消费外层`run_subagent` result。Catalog、manifest正文、来源和诊断不写journal，不进入compaction、conversation reference或token估算。这样旧session无需迁移，回滚后含自定义名称的records仍可按通用Subagent身份重放。

## Risks / Trade-offs

- [严格frontmatter子集与用户熟悉的完整YAML有差异] → 文档给出可复制示例和明确错误；解析器拒绝而不猜测，避免不同YAML实现产生权限差异。
- [每个父run扫描目录增加I/O] → 最多读取32个、单文件40KiB且每run仅一次；不为低成本本地目录引入复杂watcher/cache失效协议。
- [无效定义第一版没有专属管理UI] → 保留结构化有界诊断并接入debug/observation，文档提供排查方法；后续`/agents`可直接消费同一接口。
- [项目文件可以创建general写入Agent] → 文件只决定工具子集，不构成用户授权；写入、Bash与MCP仍受plan/headless和共享审批控制。
- [自定义prompt尝试社会工程或扩大权限] → Prompt始终位于不可信角色约束层，schema、真实registry、风险分类和审批在代码边界独立执行。
- [项目级损坏文件遮蔽用户级可用Agent] → 这是防止权限错配的fail-closed选择；诊断明确指出最高优先级来源。
- [动态名称污染终端或审批来源] → 入口采用固定小写名称规则，恢复和外层参数展示再做防御性校验与通用回退。
- [manifest工具名与当前文件编辑模式不一致] → 使用`file_edit`逻辑能力映射两个候选handler，最终registry自然只暴露当前配置选择。
- [定义目录变更不能立即影响活动run] → 这是schema/执行一致性的有意取舍；下一次assistant run自动重新扫描。

## Migration Plan

1. 先引入manifest解析、目录类型、内置定义不可变化和纯loader测试，不连接主runtime。
2. 将SubagentToolPort改为消费注入Catalog，在主run装配一次loader并验证内置行为、TUI和`--once`不回归。
3. 接入自定义prompt、能力模板、工具别名和MCP策略，补齐normal/plan/headless与伪造工具调用测试。
4. 接入安全身份格式化、debug诊断和文档，完成协议隔离、journal恢复及renderer回归测试。
5. 运行完整自动验证，由用户执行交互式TUI验证。

该变更不迁移`config.json`或session journal。回滚时可停止扫描自定义目录并保留通用名称renderer；已有自定义Subagent历史records仍可恢复，只是不再能启动同名新运行。

## Open Questions

无。定义级模型覆盖、启停状态、`/agents`诊断管理和并行调度留待后续独立变更。

## Context

`/config` 目前包含常规、模型与 Provider、沙箱、外观四个 Tab；`/agents` 管理内置及自定义 subagent。主运行通过 `prepareAgent` 构造本地 registry，再合并 MCP registry；子运行也复用这一工具装配入口，但通过定义拥有的 allowlist 和 `includeMcpTools` 裁剪能力。

变更前 `tools.fileEdit.mode` 同时进入常规设置和运行配置，公共 registry 据此只构造一种编辑 handler。本次完全移除该读取兼容及内部 `fileEditMode`、`includeBothFileEditTools`，公共工厂始终构造两个编辑 handler。主 agent loop 的 Todo 和 `ask_user_questions` 在普通 executor 之前短路执行，因此仅删除 provider schema 或过滤 executor 不能完整实现禁用。

实现继续使用现有 TypeScript、配置 snapshot、command surface、ANSI/raw-mode 和 Node 测试体系，不引入依赖或新的终端框架。

## Goals / Non-Goals

**Goals:**

- 提供清晰的主 Agent 工具配置，Bash 固定开启，两个 Todo 工具作为一项联动启停，其余工具按真实工具名独立选择。
- 统一 `apply_patch`、`edit_file` 的控制入口，支持零个、一个或两个编辑工具。
- 保证 provider definitions、特殊工具分支和 executor 遵守同一运行级工具集合。
- 缺失名单统一默认 `[]`，不再保留旧编辑模式行为；确保主 Agent 开关不影响 subagent 自身白名单。
- 保持配置分域保存、单次 snapshot 刷新和下一轮生效语义。

**Non-Goals:**

- 不把 `/agents` 重构成包含主 Agent 的统一角色管理器。
- 不为工具配置增加项目级、会话级或模型级覆盖。
- 不修改 Explorer、自定义 Agent 的工具白名单或 MCP／Skill 授权机制；Worker 仅从自身 definition 移除 `edit_file`，不改变共享工厂或其他角色的编辑策略。
- 不限制 Bash 能做哪些文件或网络操作，不替代沙箱和审批。
- 不更改用户主动触发的 `/diff`、`/undo`、`/compact`、shell-local、文件选择及直接 Skill 命令等本地功能。
- 除固定的 Todo 联动项外，不在本次加入通用工具分组批量开关、通配符、搜索器或新的 MCP 连接管理 UI。

## Decisions

### 1. 配置入口归属 `/config → 工具`

Tab 顺序为“常规”“模型与 Provider”“工具”“沙箱”“外观”。工具页标题注明“主 Agent 工具”，按“内置工具”与 MCP server 分节展示，仅在存在缺少定义的保留偏好时增加“未识别工具”分组。每行左侧保留真实工具名，右侧使用与其他配置页一致的右对齐中文短说明，不展开模型工具的完整 description；第三方 MCP 工具使用通用中文短说明，不猜测其功能。`run_bash_command` 显示已勾选及“运行 Bash 命令（必选）”，不参与切换。顶部不放策略说明，底部不重复选中工具详情，仅保留操作提示与保存／错误反馈；安全边界和默认策略由配置文档说明。

Todo 是唯一的联动项：页面只展示一个“Todo”开关和“创建与完成任务”短说明，两个真实名称 `create_todos` 和 `complete_todo` 的关联保留在配置文档，不得分别展示两个可操作开关。开启时同时启用两者，关闭时同时禁用两者。该分组只影响配置展示与选择，不新增名为 `todo` 的模型工具，也不合并两个真实工具的 schema 或执行语义。

沿用配置中心的方向键导航、显式保存、Tab 草稿保留及顶层 Esc 统一放弃保护。Space 和 Enter 切换普通工具项；MCP 工具过多时使用已有可滚动列表和 footer 高度预算，而非截断可选集合。

不采用 `/agents`，因为当前管理对象是 subagent；也不把几十项工具塞进常规 Tab。工具审批模式、审批模型、图片压缩仍保留在原位置，它们控制行为而非是否暴露某个工具。

### 2. 使用用户级禁用名单，而不是完整允许名单

配置示例：

```json
{
  "tools": {
    "mainAgent": {
      "disabledTools": ["edit_file", "web_search", "mcp__docs__search"]
    }
  }
}
```

- 缺失时默认 `[]`，与显式空数组相同；两个编辑工具及其他当前可用工具默认开启，不读取旧 mode 推导名单。
- 显式空数组表示没有禁用项，两个编辑工具都开启，而不是只有 Bash。
- 按完整工具名精确匹配，不支持通配符。新增工具默认开启；配置文档明确这一策略。
- Todo 使用真实工具名成对持久化：关闭时名单同时包含 `create_todos` 和 `complete_todo`，开启时同时移除。手写名单只包含任意一个时，归一化为两者均禁用，UI 显示 Todo 关闭；显式保存写入完整的一对，不为修复联动状态自动写盘。此规则在 TUI 和 headless 解析时共用，不能仅在 UI 联动。
- 对名称去重，忽略将 `run_bash_command` 列入名单的禁用尝试；保存也不写入该名称。Bash 不可关闭是运行规则，不只是 UI 限制。
- 未知工具名和暂未连接的 MCP 工具名保留为无效力的偏好，不据此注册 handler；将来同名工具可用时仍应用该偏好。保存可见工具时不能丢失这些名称。
- 名单类型错误或包含非字符串／空名称时，工具草稿和新的主运行给出明确配置错误，不静默变为“全部开启”。其他配置 Tab 可继续按自身读写规则使用。

选择禁用名单是为了保持现有默认能力，并避免每次增加内置工具或发现 MCP 工具都要求用户重建完整允许名单。它不是默认拒绝的安全策略。

### 3. 将工具候选目录与主运行筛选分开

保留 `main-agent-tool-catalog`：工具页从这一未应用主 Agent 禁用名单的轻量候选目录获取工具名称及可用状态，中文短说明由展示层维护，不再传递模型用的完整 description。目录不实例化 handler、扫描技能或依赖工作目录。不能从已筛选 registry 反向列举，否则关闭的工具无法重新开启。底层目录至少覆盖当前所有真实内置工具，包括两个编辑工具、两个真实 Todo 工具、提问、Skill、委派、两个 MCP 资源工具，以及已发现的 `mcp__*` tools；UI 将两个 Todo 工具投影为一个配置项。

工具偏好和当前可用性分开：未连接 MCP 时资源工具仍可配置但注明不可用；已记录的离线 MCP 名称可显示为暂不可用，保留其偏好。开关不会启动或关闭 MCP server，也不凭空生成工具。目录直接引用运行 handler 已导出的名称常量，并以真实 registry 的名称集合做一致性测试，避免目录漏项或名称漂移；不为共享名称和描述引入新的执行器工厂。配置页初始化只复制 snapshot 已归一化的草稿，配置读取、保存及运行入口继续承担校验；Tab 状态直接按同名字段读取，不维护重复映射。

主运行装配顺序：

```text
用户配置 snapshot ──→ 主 Agent 禁用名单
内置工具候选 + 已发现 MCP tools
               │
               ▼
        应用主 Agent 选择
               │
               ▼
      同一份最终运行 registry
          ├─ provider definitions
          ├─ executor
          └─ 特殊工具入口的已注册校验
```

筛选必须覆盖 MCP 合并后的结果，不能只筛选本地 registry 再不加限制地合并 MCP tools。公共工具工厂对主／子运行始终构造 `apply_patch` 与 `edit_file` 两个 handler，不再提供 `fileEditMode` 或 `includeBothFileEditTools` 构造分支；主运行按 `disabledTools`、子运行按自身 `allowedToolNames` 分别筛选。

### 4. 在特殊执行分支之前检查工具成员资格

主 loop 对每个 call 首先检查工具是否属于当前最终 registry；未注册或禁用的调用返回保留 call id／tool name 的失败结果，不进入 Todo、提问、风险审批、executor 或委派端口。后续仍按既有 mode、readonly policy、approval 和 sandbox 处理已注册调用。

这一检查保护真实边界，而非仅为测试添加分支。必须覆盖 `create_todos`、`complete_todo`、`ask_user_questions` 和 `run_subagent`，不能依赖模型只调用已公布 schema。授权缓存、自动审批和 headless `--full-access` 均不能重新启用被移除的工具。

normal/plan 在相同工具配置和 MCP 状态下共享相同 definitions；plan 的写入拒绝仍发生在执行层。只读旁路运行复用主运行工具选择，再叠加自身只读策略，不因此获得额外工具。

### 5. 主／子运行的配置职责显式分离

只在主运行装配入口应用 `tools.mainAgent.disabledTools`。子运行继续使用定义的 `localToolNames`（装配时转换为 `allowedToolNames`）、`includeMcpTools` 和 Skill scope；不能在共享 registry 工厂内部无条件应用主配置。

主 Agent 禁用 `read_files` 或某个 MCP tool 后，Worker／Explorer 不自动失去各自原本允许的能力。禁用 `run_subagent` 只阻止主 Agent 发起新委派。主 Agent 的 Bash 必选也不能扩展自定义 subagent 的工具 allowlist。

主配置不继承给子 Agent。Worker 的 definition 仅保留 `apply_patch`，通过现有 `allowedToolNames` 筛选掉 `edit_file`；其 provider schema 与执行 registry 均不含该工具，伪造调用在审批和执行前拒绝；Explorer 白名单不含编辑工具，仍不获得编辑工具；自定义 Agent 继续按自身白名单筛选。旧 `tools.fileEdit.mode` 对主／子运行均无效，不再保留内部兼容字段。

### 6. 停止读取旧编辑配置，不迁移或清理文件

主 Agent 的名单读取规则：

| 配置状态 | 主 Agent 初始禁用名单 |
| --- | --- |
| 新 `disabledTools` 存在且有效 | 按名称应用，排除 Bash，并将任一 Todo 禁用项补全为两个 |
| 新字段缺失，无论旧 mode 是否存在及其值 | `[]`，两个编辑工具及其他可用工具默认开启 |
| 新字段存在但结构非法 | 报错，不退回旧 mode 或默认全开 |

读取、启动、切换 Tab 不写盘、不迁移。完全停止读取 `tools.fileEdit.mode`，移除内部 `fileEditMode` 和 `includeBothFileEditTools`。旧 JSON 字段可作为未识别数据保留但不主动清理；用户显式保存工具页只写本页禁用名单，常规页也只写自身字段，不再持有旧编辑草稿或读写职责。无论新字段是否存在，修改旧 mode 都不影响主／子 Agent。

工具页只拥有 `tools.mainAgent.disabledTools`，以最新根配置为基础原子保存，不覆盖 Bash 参数、审批、沙箱、图片压缩、模型或其他 Tab 草稿。

### 7. 每次主运行冻结一次选择及工具目录

TUI、`--once` 和复用主运行入口的只读旁路都从本次配置 snapshot 构造工具集合。保存或 watcher 刷新只影响下一次运行；当前调用、后续 continuation 和已启动的委派不重建 registry。

沿用共享配置刷新链路，不额外同步读盘。选择导致实际 schema 变化时，使旧 context usage 快照失效；不删除历史 tool call/result，也不为设置变化追加 transcript 或完整重绘。各 provider 仅转换最终 definitions，历史调用依旧按原协议配对。

提示材料应与实际 registry 一致，不再无条件声称某工具可调用。关闭 `use_skill` 时不自动注入要求模型调用该工具的 Skill 目录；父运行捕获的 enabled Skill snapshot 仍保留，供独立 subagent scope 使用。用户主动调用 Skill 命令不重新授予任何工具。

## Risks / Trade-offs

- [保留 Bash 意味着仍能通过命令读取、编辑或联网] → 配置文档明确这是工具选择而非安全权限，真正的限制继续由沙箱、模式和审批负责。
- [主 Agent 限制不自动继承到 subagent] → 页面注明作用范围；需要阻止委派时可禁用 `run_subagent`，子能力仍由 `/agents` 管理。
- [离线 MCP 名称无法完整发现] → 保留既有偏好，只展示已发现或已记录项；不为列出工具主动建立新连接。
- [禁用名单使未来新增工具默认开启] → 将行为写入配置帮助和用户文档；默认拒绝策略不在本次范围内。
- [旧用户不再保持仅一个编辑工具的选择] → 文档明确旧 mode 无效、缺失名单默认全开；需要只保留一个编辑工具时在工具页显式禁用另一个。Worker 则由自身 definition 固定仅保留 `apply_patch`，不继承主选择，也不恢复旧配置兼容或工厂分支。
- [模拟 provider 测试被误解为模型行为保证] → 测试只声明配置、schema 和执行边界保证；不通过预设调用顺序证明模型一定选择某工具。

## Migration Plan

1. 引入独立工具偏好解析与草稿保存；补齐缺失默认 `[]`／旧 mode 无效／显式空数组／非法值／Bash／Todo 成对启停及手写单项禁用／未知工具名的测试。
2. 移除旧编辑模式读取及内部兼容字段，公共工具工厂始终构造双编辑 handler，再按主禁用名单或子白名单筛选；装配主运行最终 registry，并在特殊执行分支前做成员校验，保留未过滤候选目录。
3. 增加工具 Tab，移除常规编辑方式行，接入原有保存、刷新、草稿保护和 context usage 失效链路。
4. 更新文档并完成自动化和交互验证；不需要数据库、session journal 或配置文件的启动期迁移。
5. 回退到仍支持旧 mode 的版本时可能重新采用保留的旧值；旧版本会忽略新禁用名单，因此回退不保留本功能的工具精简效果，文档须明确这一点。

## Open Questions

无阻塞实现的未决项。已确认 MCP tools 也按名称单独配置、缺失名单及新工具默认开启、旧编辑模式完全停止读取、子运行独立按自身白名单筛选；公共工厂始终构造两个编辑工具，配置页未过滤候选目录保留。

# 配置

`/config` 按顺序提供 **常规**、**模型与 Provider**、**工具**、**沙箱**、**外观** 五个 Tab，按 Tab 循环切换。常规、模型、工具和沙箱分别显式保存，互不提交其他 Tab 的草稿；切换 Tab 保留草稿，顶层 Esc 关闭时统一保护未保存更改。外观选择立即保存。

## 常规设置

在 `/config` → **常规** 中编辑设置，选中“保存常规设置”并按 Enter 才会原子写入 `~/.echo/config.json`。调整选项只修改草稿；Esc 关闭时可选择放弃未保存的更改。保存会保留配置文件中的其他已知和未知字段。

“文件编辑方式”不再由常规页二选一设置，改为下面工具页的两个独立开关；工具审批、审批模型与图片压缩等行为设置仍在常规页。

### 历史重绘预算

主会话默认在 `/resume`、破坏性 resize、主题/显示偏好变化、Undo 后重建或从 BTW/子 Agent 独立视图返回时，重绘约 **1,000 行**近期历史，而不是展开全部活跃历史。

在常规页选中“历史重绘预算”，按 **← / →** 依次选择 **500、1,000、2,000、5,000、10,000 行、不限**，到两端时停留。配置字段为 `ui.historyRenderLineLimit`，数值 **`0` 表示不限**；不限恢复全部可见活跃历史的展示范围，大历史可能较慢。

```json
{
  "ui": {
    "historyRenderLineLimit": 1000
  }
}
```

仅上述六个数值有效。字段缺失、字符串 `"1000"`、`750`、负数、小数或 `null` 等非法值只使该字段回退到 `1000`，不影响其他有效设置；无需迁移既有配置或 journal。

- **软预算，不是硬上限。** 按当前终端宽度和 reasoning 显示偏好，从最新完整渲染块向前累计实际行数（包含块自身空行），保留跨过预算的整个边界块。工具 call/result 对、子 Agent 分组，以及折叠外层结果所依赖的连续过程区间不会被切断。例如最新两块分别为 600 和 700 行，预算 1,000 时可显示 1,300 行；最新单块为 5,000 行时也会完整保留，不在块内截断。
- 预算仅计算主会话稳定历史，不包含 banner、压缩/预算提示、当前流式 assistant/reasoning/shell、pending 或 footer。隐藏 role、关闭显示的 reasoning 和已过滤的并行子 Agent 过程不占预算。
- 调整只改草稿；**保存后立即生效**。外部编辑 `config.json` 后，watcher 检测到有效值变化也会即时应用。主会话可见时重新选择历史并重绘，配置面板保持打开；同一有效值的重复通知不重复重绘。仅预算变化不会覆盖当前 BTW/子 Agent 独立视图，返回主会话后采用新值，也不会中断正在运行的任务。
- 被省略的是终端投影，**不是记录或模型上下文**。预算不触发压缩、不移动驻留起点、不删除 journal，不改变 token/记录计数、`/copy`、`/fork`、历史引用或 Undo 的原有语义。压缩后的“不限”仍只显示驻留活跃区，不回读已压缩原文。
- 有更早可见历史未展开时，屏幕显示一条瞬时预算说明，指引调大预算或选择不限；它不写入 transcript/journal。向上滚动不会自动加载被省略的内容。
- **实际回看范围还受终端滚动历史（scrollback）上限限制。** 预算决定应用重绘多少历史行，不会调大终端自身的历史缓冲区，即使选择不限也不能保证终端保留全部输出。窗口高度只决定一屏可见多少行，不是滚动历史上限。
- **不是 scrollback 总量上限。** 普通新增和流式输出继续增量追加，不因超过预算主动清屏；终端 scrollback 可以继续增长，下一次破坏性重绘才重新选择后缀。BTW/子 Agent 独立视图、`/resume`/`/reference` 候选预览及 headless `--once` 的范围不受此设置影响，不切换 alternate screen。

压缩与显示窗口的区别见[压缩后的 transcript 内存与历史](compacted-transcript-memory.md)；已完成的排版测量见[历史重绘预算基准结果](history-render-budget-benchmark.md)。

### 状态栏显示项

普通输入态的 status line 由若干段拼成。在 `/config` → **常规** 选中“状态栏显示项”按 Enter 进入子面板：↑/↓ 移动焦点，Enter 或 ←/→ 切换开关，选中“保存常规设置”按 Enter，与常规页共用同一次校验与原子写入。Esc 或 Backspace 返回常规页，Tab 直接切到下一个 Tab 并保留草稿。

| 界面值 | 字段 | 关闭后隐藏的内容 |
| --- | --- | --- |
| 模型 | `ui.statusLine.model` | 模型名，含 `(SKILL override)` 后缀 |
| 推理强度 | `ui.statusLine.effort` | `effort <等级>` |
| 会话标题 | `ui.statusLine.title` | 当前会话标题 |
| 目录 | `ui.statusLine.dir` | `dir <项目名>` |
| 上下文用量 | `ui.statusLine.contextUsage` | `ctx <used>/<window>` |
| 全部工具已授权 | `ui.statusLine.approval` | `TOOLS all` |

默认全部为 `true`，等价于此前的固定行为；无需迁移既有配置。每个字段独立回退：字段缺失、非布尔值，或 `ui.statusLine` 不是对象时，对应项按开启处理，不影响 `ui` 下的其他已知与未知键。

```json
{
  "ui": {
    "statusLine": {
      "approval": true,
      "contextUsage": true,
      "dir": false,
      "effort": true,
      "model": true,
      "title": false
    }
  }
}
```

- 段的相对顺序、文本格式与配色不随配置改变。关闭的段不参与宽度计算，也不会留下多余分隔符，因此关掉长文本段常常能让右侧 `ctx` 重新显示出来。
- **`Ctrl+T` 模型调节期间强制显示模型与推理强度**，即使两者已关闭；返回普通态后重新按配置过滤。
- **运行模式段（`ready`、`PLAN`、`SHELL`、echo spinner、`subagent view`）与 `Esc 中断` 这类提示不可关闭**，所以即使六项全关，状态行仍不会退化成空行。
- 关闭“上下文用量”只影响显示，已缓存的 usage 仍然保留：`/context` 继续可用，重新开启后立即恢复。
- 保存成功或外部修改 `config.json` 生效时只需一次 footer 重绘：不重放 transcript、不追加记录、不清空 context usage、不中断正在运行的 assistant turn。
- 该配置作用于普通输入态和 `Ctrl+O` subagent 会话窗口的状态行，`/btw` 侧会话使用同一份偏好；`/status`、`/context`、`/usage` 等命令面板与 headless `--once` 不受影响。

## 主 Agent 工具

在 `/config` → **工具** 中查看“主 Agent 工具”，按方向键导航，Space 或 Enter 切换选中工具，再选中“保存主 Agent 工具”按 Enter。列表包含内置工具、MCP 资源读取工具与当前发现的 MCP tools，并区分开启偏好与当前可用性。保存只原子更新 `~/.echo/config.json` 的 `tools.mainAgent.disabledTools`，下一次主运行生效；正在运行的任务及其后续模型请求继续使用原工具集合。

例如，仅保留 `apply_patch` 作为编辑工具，同时禁用 `edit_file`、网页搜索、Todo 和一个 MCP 工具（这是自定义选择，并非默认值）：

```json
{
  "tools": {
    "mainAgent": {
      "disabledTools": [
        "edit_file",
        "web_search",
        "create_todos",
        "complete_todo",
        "mcp__docs__search"
      ]
    }
  }
}
```

- 按真实工具完整名称精确匹配并去重，不支持通配符；MCP 名称使用 `mcp__<server>__<tool>`，示例中的名称需对应实际 server/tool。未知或离线工具名仍作为偏好保留，保存不会丢弃；同名工具将来可用时仍被禁用，但偏好本身不会创建工具或启停 MCP 连接。
- 这是禁用名单：未列出的可用工具默认开启，后续新增内置工具或新发现的 MCP tools 也默认开启。`disabledTools` 缺失与显式 `[]` 相同，均表示不禁用任何工具，两个编辑工具及其他可用工具默认开启，不是仅保留 Bash。
- `apply_patch` 与 `edit_file` 是独立开关，可同时开启、仅开一个或同时关闭，不再由旧文件编辑模式二选一决定。
- UI 的 **Todo** 只占一个开关，但实际工具仍为 `create_todos` 和 `complete_todo`，禁用名单中成对加入或移除，没有名为 `todo` 的新工具。手写名单只禁用其中任意一个时，读取会归一化为两者均禁用；读取不改文件，显式保存工具页才写入完整的一对。
- `run_bash_command` 必需且不可关闭。即使手写到禁用名单中也会被忽略，保存时不会写入该名称。工具选择**不是安全权限隔离**：Bash 仍可能读取、编辑文件或联网，既有模式、审批和沙箱限制继续生效；启用工具也不等于自动授权。
- 仅影响主 Agent 的工具暴露与执行，TUI 和 headless `--once` 共用解析与筛选规则；审批、会话授权缓存或 `--full-access` 不能覆盖禁用决定。Subagent 不继承该名单：Worker 的 definition 仅保留 `apply_patch`，不暴露或执行 `edit_file`；Explorer 仍无编辑工具；自定义 Agent 继续使用自身白名单。禁用 `run_subagent` 可阻止主 Agent 发起新委派。用户主动执行的 slash 命令、shell-local 和文件选择等本地操作不受该名单控制。
- `disabledTools` 必须是非空工具名组成的字符串数组（允许空数组）。字段存在但不是数组，或包含非字符串、空白名称时，工具页和新的主运行会报配置错误，不会静默回退为全部开启；其他可读的配置 Tab 仍可使用。

### 旧字段处理与版本回退

旧 `tools.fileEdit.mode` 已停止读取，对主 Agent 和子 Agent 均无效，不再用于推导默认禁用名单。即使旧值为 `edit_file` 或 `apply_patch`，新 `disabledTools` 缺失时也一律按 `[]` 处理。

启动、读取或切换 Tab 不会自动迁移写盘。显式保存工具页只写本页的 `tools.mainAgent.disabledTools`；旧 `tools.fileEdit` 节点可作为未识别数据保留，既不读取也不主动清理。常规页保存同样只写本页字段，保留其他已知、未知字段。

回退到仍支持旧 mode 的版本时，该版本可能再次采用保留的旧值；旧版本会忽略新禁用名单，**不会保留本功能的工具禁用效果**。

## 工具授权的会话持久化

会话级授权（`Allow <tool> for this session`、`Allow this command for this session`、`Allow all tools for this session`，以及普通输入态的 `Shift+Tab`）跟随**会话**而不是进程。重启 echo-tui 后用 `/resume` 恢复同一个会话，之前批准过的工具与命令继续免审批。

授权写入与 transcript journal 同目录的 sidecar：

```
~/.echo/echo_tui/projects/<projectKey>/sessions/<sessionId>.approvals.json
```

```json
{
  "schemaVersion": 1,
  "sessionId": "2026-11-16T02-11-28-604Z-80dd43",
  "updatedAt": "2026-11-16T02:20:11.302Z",
  "allowAll": true,
  "tools": ["apply_patch", "mcp__docs__search"],
  "bashCommands": ["npm install"]
}
```

- 文件权限为 `0600`，采用「临时文件 + rename」原子替换，不会出现半写入 JSON。
- **只影响所属会话**：不写入 `~/.echo/config.json`，也不写入 transcript journal。
- `/fork` 创建的新会话继承当前授权；`/clear` 开启的新会话从空授权开始；通过 `/resume` 删除历史会话时一并清理该文件。
- `tools` 与 `bashCommands` 均为空且 `allowAll` 为假时文件被删除，「删除文件」与「撤销全部授权」等价。
- 读取失败一律按空授权处理：文件缺失、JSON 损坏、`schemaVersion` 不支持或 `sessionId` 不匹配都会回到需要审批，不会因为损坏的 sidecar 放行。
- 数组里的单个脏条目（空白字符串、非字符串）只丢弃该项，不会让同一文件的其余授权一起失效。
- `updatedAt` 只用于人工排查，缺失或格式异常不影响授权读取。
- 写盘失败会在 transcript 中提示一次，本次会话内仍按内存授权放行，代价是重启后需要重新审批。

`Shift+Tab` 的关闭方向同样写盘。只写打开方向会让 `TOOLS all` 在重启后复活，因此两个方向都落盘。

手工撤销：直接删除对应的 `.approvals.json`，或在该会话里用 `Shift+Tab` 关闭全部授权后重新打开所需项目。

`echo-tui --once` 不读取也不写入该文件，继续使用默认 deny 或显式 `--full-access`。

## Provider 流式重试

`~/.echo/config.json` 的 provider profile 支持两个可选字段，用于覆盖流式请求的重试行为。`/config` 面板不暴露它们，只在需要手写配置时使用。

```json
{
  "llm": {
    "providers": {
      "default": {
        "preset": "openai-responses-api",
        "apiKey": "sk-...",
        "streamMaxRetries": 3,
        "streamIdleTimeoutMs": 120000
      }
    }
  }
}
```

- `streamMaxRetries`：单个 provider turn 的流式重试预算，默认 **5 次**（即最多 6 次 stream）。写 `0` 表示关闭流式重试（只尝试一次）；合法整数超过 20 时限制为 20；非整数、负数或非数字回退默认值。
- `streamIdleTimeoutMs`：一次 stream attempt 无任何事件的最长等待，默认 **300000 毫秒**。合法整数低于 10000 时限制为 10000，高于 3600000 时限制为 3600000。

重试判定按失败语义分类，不依赖错误文案匹配：

- **连接中断、响应流提前结束**：指数退避，500ms 起、单次上限 60 秒、±20% 抖动。
- **限流、服务过载**：优先采纳服务端 `Retry-After`、`retry-after-ms` 或 `try again in 11.054s` 建议；取不到建议时按类别回退保守退避（限流 5 秒起、过载 2 秒起），最多 2 次。
- **请求无效、上下文超限、鉴权失败、配额不足、服务端 incomplete、内容策略拒绝**：不重试。

已向屏幕输出正文、已发出 reasoning 完成通知、已解析出完整工具调用或已产生 provider 私有推理记录的 attempt 不会自动重试；仅展示过 reasoning 预览时会先清空预览再重试。compaction 请求始终不重试。

## 响应期间发送消息

选中“响应期间发送消息”，按 **Enter、← 或 →** 在两种策略间切换：

| 界面值 | `ui.activeTurnMessagePolicy` | 行为 |
| --- | --- | --- |
| 排队（默认） | `pending` | 等当前回答结束后，作为下一轮消息发送。 |
| 即时引导 | `steer` | 普通消息素材准备成功后，尽快引导当前任务在同一轮继续。 |

```json
{
  "ui": {
    "activeTurnMessagePolicy": "pending"
  }
}
```

旧配置无须迁移。字段缺失、类型错误或枚举值非法时，仅该字段回退为 `pending`，其他有效设置仍保留。

策略在每个主 assistant turn 启动时固定。保存设置或外部配置刷新只影响下一轮，不会改变正在进行的任务，也不会重新解释已接收的消息。

**即时引导不强制停止工具。** 已启动工具（包括并行组和子代理调用）会先安全收尾，自动压缩也会先完成；长工具可能让引导等待。它不撤销已有文件或外部副作用，也不是紧急停止保证。Esc 仍遵循原有取消规则。

即时引导时，已输出正文按 Esc 中断的方式保存为普通 assistant 记录，不添加“未完成”标记；它位于新引导之前，并进入后续模型上下文。尚未完成的可读推理草稿保存为本地 reasoning summary，不发给模型；未完成的 provider 私有推理和工具参数仍丢弃。此前完成的记录和真实工具结果保留。需要下一轮路由的 slash/skill/shell 输入仍排队；BTW、子代理自身和 headless `--once` 的输入契约不受此设置影响。

自动审批会考虑已应用的引导原文，但 `@` 展开的文件内容不算用户授权。较长的用户指令仍按现有预算保留头尾并标记省略，继续交审批模型判断，不因指令超出投影预算而直接转人工；审批模型否决、请求失败等原有回退保留。运行开始时的审批配置不变。

每次普通消息提交使用当时选择的 mode；素材准备期间再次切换不会改写已接收消息。即时引导不因 normal/plan 切换而排队，新模式在消息应用后作用于后续请求与工具，已启动调用仍先收尾；workflow 明确指定的只读限制不会被 normal 模式解除。

主 assistant 响应期间也可以通过 Tab 为下一条消息选择 mode；单纯切换界面选项不会修改正在执行的任务，仍须提交消息后生效。审批等高优先级界面和其他响应锁继续遵循原有输入规则。

## 响应期间的输入与 Esc

- 普通消息和 `@` 文件素材准备成功后才抢占模型请求。composer 上方的引导卡片显示消息预览与 Esc 移除提示，保留准备中和准备失败提示，准备完成后不显示等待原因；等待工具或压缩的安全边界不变。
- 排队和未应用的引导共用一个槽位。槽位已有消息时，再按 Enter 不会覆盖它，新草稿与光标保持不变；响应期可用命令仍可立即执行。
- 文件素材准备失败时保留原文及失败卡片，不取消当前任务，也不覆盖后来输入的草稿。按 Esc 移除卡片后可重新提交。
- 没有审批、提问等更高优先级界面时，第一次 Esc 移除尚未应用的消息，下一次 Esc 才取消当前任务。移除引导不删除原回答已输出的正文；若模型请求已被抢占，它收尾后仍保存正文并继续原任务。消息应用后卡片消失，再按 Esc 不会撤销已记录的新指令。
- 若原任务先结束，准备成功的消息只作为下一轮发送一次，不重复读取附件。清空、切换会话或退出会移除未应用消息；恢复会话不自动重发它们。

## Subagent 启用与停用

在 `/agents` 选择 Agent，一级详情提供一个 **全局启用** 开关，所有项目共用，默认开启。Enter、Space 或左右键修改草稿，同层“保存更改”才写盘，Esc/取消丢弃未保存修改。列表状态标记启用/停用，详情底部提示未保存草稿；保存仅影响下一主运行，当前任务继续使用冻结目录。

开关按名称作用于内置 `explorer`、`worker` 及自定义 Agent，存储在 `~/.echo/agents.settings.json`：

```json
{
  "schemaVersion": 3,
  "enabled": {"explorer": false},
  "overrides": {}
}
```

- 用户全局文件支持 `enabled` 与必需的 `overrides`；`enabled` 可省略，名称缺省开启。名称不支持路径或通配符，值必须是布尔值。
- 策略、定义编辑与创建子表单围绕各自字段组织。往返保留全局草稿，子表单独立保存；仅保存开关只修改用户全局文件，保留定义与模型策略。
- 停用项仍可管理。定义先按来源优先级选择，再应用全局状态；全局停用某名称时，项目胜出定义不会回退同名用户定义。删除定义保留全局名称偏好；停用项仍计入 32 个自定义候选名称限额。
- 停用项不进入模型目录且不可伪造执行，全部停用时不注册 `run_subagent`。TUI 与 `--once` 使用相同规则，审批/full-access 不能绕过；主工具关闭时全局开启也不恢复委派。
- 全局文件无法安全读取或 JSON/schema 无效时，本轮全部委派关闭并输出有界诊断，其他主 Agent 能力继续可用，对应开关只读。
- 主工具配置异常时 `/agents` 仍可管理，委派工具状态显示不可用。
- 全局保存采用内容指纹与原子写入；冲突或 I/O 失败保留原文件与草稿。用户模型策略自身写入后，仅在原指纹一致时推进全局草稿基线；项目策略保存保留该基线，以检测全局文件的外部修改。

### 模型、effort 与 Skills 策略

内置 Explorer/Worker 的用户级和项目级策略可分别管理 model、effort 与 Skill allowlist，保持内置 prompt、工具和执行策略只读。自定义 Agent 保留定义创建、编辑和删除入口。

- 项目模型策略文件 `<project-root>/.echo/agents.settings.json` 写 version 2，读取支持 version 1/2。用户全局文件 `~/.echo/agents.settings.json` 写 version 3，读取支持 version 1/2/3；version 1 缺失的 Skill 策略按全部 enabled Skills 处理。
- 合法项目 override 整体覆盖同名用户 override；缺省继承父模型/effort，并允许全部 enabled Skills。高优先级策略异常或引用失效时完整继承父策略并诊断，不回退用户 override；全局状态独立由用户全局配置决定。
- 显式保存模型策略提交整条 override，即使各字段都继承父策略；项目显式继承会整体覆盖用户策略，与项目未配置不同。无效策略来源在入口报告有界错误。
- 用户模型策略写删保留同文件全局偏好及其他名称；`enabled` 与 `overrides` 均空时可删除全局 sidecar。删除最后一条项目 override 时删除对应模型策略 sidecar。

## 系统提示词（SYSTEM.md）

`/config` → 常规 → 系统提示词进入管理视图。面板展示两个写入目标的绝对路径、存在性与行数，并标出当前生效来源（不展示文件体积）：

- 项目根 `SYSTEM.md`（项目根按 `.git` 或 `.echo` 标记判定，缺失时取当前 cwd）。
- 用户级 `~/.echo/SYSTEM.md`。
- 两者都不存在或内容为空时，使用源码内置基础 prompt。

菜单提供六个按钮：查看当前生效、编辑项目、编辑全局、删除项目、删除全局、返回。使用 `↑/↓` + `Enter`，面板不提供字母快捷键，也不响应鼠标点击。

查看为只读阅读态：标题标明来源，正文按行号展示基础文本并按终端宽度折行（长行完整可见，续行不重复行号），`↑/↓` 逐行、`PgUp/PgDn` 翻页，不拼接动态段。编辑态预填目标文件内容，文件不存在时预填内置文本（等价于新建），草稿同样折行且光标位置与折行后一致；`Enter` 进入保存确认（只显示目标路径与是否覆盖），`Ctrl+J` 换行，`Esc` 丢弃草稿。

写入语义：

- 内容按 loader 口径归一化：CRLF/CR 转 LF 并去除首尾空白。
- 父目录缺失时递归创建，例如首次保存用户级文件会创建 `~/.echo/`。
- 使用同目录临时文件 + rename 原子替换，失败不会留下半写入文件。
- 归一化后与现有内容逐字相同则不写盘，并提示“内容未变化”。
- 归一化后为空则拒绝保存：空文件在 loader 视角等价于“未覆盖”，请改用删除动作。

删除只移除目标 `SYSTEM.md` 本身，确认框标明回落目标（另一目标或内置默认）；文件不存在时按钮灰显，`Enter` 只提示不写盘。

生效时机与边界：写入或删除在下一轮 assistant run 生效，同一 run 内（含 tool continuation）继续使用启动时冻结的基础文本；子 Agent 继承父 run 的冻结值。成功后会使 `/context` 的旧占用快照失效。覆盖文件只替换基础文本段，runtime environment、`AGENTS.md` 指令链、skill catalog 与 memory 段落始终由运行时追加。`echo-tui --once` 读取同一份文件并遵循同一优先级。面板不写入 `~/.echo/config.json`，也不追加 transcript record。

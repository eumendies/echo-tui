# user-config-context Specification

## Purpose
TBD - created by archiving change centralize-user-config-context. Update Purpose after archive.
## Requirements
### Requirement: 实例级用户配置上下文
系统 SHALL 为每个 TUI app 或 headless run 创建独立的用户配置上下文，负责 `~/.echo/config.json` 的内存 snapshot、revision 和资源生命周期。系统 SHALL NOT 通过模块级 singleton 在不同 app、headless run、工作目录或测试之间共享配置状态。

#### Scenario: 两个实例互不共享配置状态
- **WHEN** 同一进程创建两个使用不同配置路径或读取依赖的用户配置上下文
- **THEN** 每个上下文 SHALL 只返回自身来源的配置 snapshot
- **THEN** 一个上下文的刷新、写入或关闭 SHALL NOT 改变另一个上下文的 revision 或 selector 结果

#### Scenario: TUI 与 headless 使用不同生命周期
- **WHEN** TUI app 启动
- **THEN** composition root SHALL 创建用户配置上下文并启动长期 watcher
- **WHEN** `--once` headless run 启动
- **THEN** headless composition root SHALL 创建独立上下文且 SHALL NOT 启动长期 watcher

### Requirement: 单次读取形成不可变 revision snapshot
用户配置上下文 SHALL 通过单次文件读取和单次 JSON 解析形成不可变 revision snapshot。App settings、LLM、tools、MCP、hooks 和配置草稿 selector SHALL 复用该 snapshot；同一 revision 内调用任意数量的 selector SHALL NOT 再次读取配置文件。调用方 SHALL NOT 获得可修改的完整配置根对象或无关领域凭据。

#### Scenario: 多个 selector 共用一次读取
- **WHEN** 调用方初始化或刷新一个有效配置 snapshot，并依次读取 App settings、模型目录、LLM runtime、MCP 和 hooks 投影
- **THEN** 系统 SHALL 只读取并 JSON 解析源文件一次
- **THEN** 每个 selector SHALL 从同一个 revision 的内存根对象生成结果

#### Scenario: 重复 selector 不增加 I/O
- **WHEN** 调用方在 revision 未变化时重复解析不同 profile、reasoning override 或同一领域投影
- **THEN** 系统 SHALL 复用该 snapshot 的解析结果或解析图
- **THEN** 系统 SHALL NOT 为这些调用重新读取配置文件

#### Scenario: 编辑草稿不能污染 snapshot
- **WHEN** 配置中心取得一个可编辑草稿并修改其中的 provider、model、MCP、hook 或常规设置字段但尚未保存
- **THEN** 同一 snapshot 的 runtime selector SHALL 继续返回保存前的值
- **THEN** 后续重新打开草稿 SHALL NOT 继承未保存对象的意外引用修改

### Requirement: 领域 selector 保留既有解析语义
用户配置 snapshot SHALL 通过领域 selector 暴露最小投影，并 SHALL 保留各现有配置入口的严格、容错、默认值、诊断和脱敏错误语义。中心化 source 读取 SHALL NOT 强制所有领域采用相同的错误策略。

#### Scenario: malformed JSON 的严格 LLM 读取
- **WHEN** 当前 snapshot 的源文件不是有效 JSON 或根节点不是对象
- **THEN** LLM runtime、模型目录和严格 profile selector SHALL 返回现有语义的脱敏配置错误
- **THEN** 系统 SHALL NOT 使用旧 revision 的 LLM 凭据静默发起 provider 请求

#### Scenario: malformed JSON 的可选运行时设置
- **WHEN** 当前 snapshot 的源文件缺失、不可读或 malformed
- **THEN** App settings、MCP 和 hooks runtime selector SHALL 分别按照其既有容错规则返回默认值、空配置或诊断
- **THEN** 一个可选领域的错误 SHALL NOT 改变其他领域已有的字段级归一化规则

#### Scenario: 配置草稿保持缺失与损坏的区别
- **WHEN** App 或 LLM 配置草稿读取一个缺失的配置文件
- **THEN** selector SHALL 按既有行为返回可用于首次配置的默认或空草稿
- **WHEN** 同一草稿 selector 面对 malformed JSON、无效根节点或读取错误
- **THEN** selector SHALL 按既有行为报告明确错误而不是把损坏文件当作空配置

#### Scenario: 严格 profile 不回退全局模型
- **WHEN** 自动审批 reviewer 请求一个不存在的 model profile id
- **THEN** 严格 profile selector SHALL 报告该 profile 不存在
- **THEN** selector SHALL NOT 回退 `selectedModel`、当前 session model 或第一个 profile

### Requirement: 配置刷新去重与领域变化通知
用户配置上下文 SHALL 在显式刷新或 watcher 通知时只执行一次源读取，并 SHALL 使用不包含明文敏感数据的 fingerprint 识别语义相同的内容。只有安装不同内容或不同源状态时才 SHALL 创建新 revision；通知 SHALL 标明 App settings、LLM、tools、MCP 和 hooks 等已知领域是否发生变化。

#### Scenario: watcher 事件只触发一次共享刷新
- **WHEN** TUI watcher 检测到一次原子 rename 或一组 debounce 后的文件事件
- **THEN** 用户配置上下文 SHALL 只读取配置文件一次
- **THEN** ModelContext、App settings 和其他订阅者 SHALL 消费该次读取产生的同一个新 snapshot

#### Scenario: 相同内容不重复通知
- **WHEN** watcher 再次观察到与当前 snapshot 语义相同的配置内容，包括只改变 JSON 空白或缩进
- **THEN** 用户配置上下文 SHALL NOT 增加 revision
- **THEN** 系统 SHALL NOT 重复通知订阅者或执行配置变化副作用

#### Scenario: 已知领域变化被分类报告
- **WHEN** 新配置只改变 LLM、tools、MCP、hooks 或 App settings 中的一个已知领域
- **THEN** change notification SHALL 将对应领域标记为 changed
- **THEN** notification SHALL NOT 把未改变的已知领域标记为 changed

#### Scenario: watcher 失败不破坏当前 snapshot
- **WHEN** watcher 无法启动且轮询 fallback 也失败
- **THEN** 系统 SHALL 报告安全的 watcher 诊断并继续保留当前 snapshot
- **THEN** 普通 render 和当前 active turn SHALL NOT 因 watcher 资源失败而中断

### Requirement: 配置写入与内存 snapshot 同步
通过配置中心、MCP 或 hooks 执行的写入 SHALL 重新读取磁盘最新根对象、执行领域增量变换并原子替换目标文件。成功 rename 后，用户配置上下文 SHALL 立即安装写入结果形成的新 snapshot 并至多发布一次变化通知；写入 SHALL 保留不属于该领域的已知和未知节点。

#### Scenario: 写入不以陈旧 snapshot 覆盖外部字段
- **WHEN** 当前内存 snapshot 之后磁盘文件被外部进程加入未知字段，随后用户保存一个领域草稿
- **THEN** writer SHALL 以磁盘最新根对象应用该领域变换
- **THEN** 保存结果 SHALL 保留外部加入的未知字段和其他领域节点

#### Scenario: 保存成功立即可见
- **WHEN** 配置 writer 成功完成原子 rename
- **THEN** 后续 selector SHALL 无需等待 watcher 即可读取新 revision
- **THEN** 需要即时刷新的配置界面和模型状态 SHALL 可以消费该 snapshot

#### Scenario: watcher 不重复发布自身写入
- **WHEN** 保存成功已经安装新 snapshot，随后 watcher 观察到同一文件内容
- **THEN** 用户配置上下文 SHALL 通过 fingerprint 将事件识别为重复
- **THEN** revision、变化通知、MCP reload 和 UI 重绘 SHALL NOT 因该重复事件再次发生

#### Scenario: 写入失败保留当前 snapshot
- **WHEN** 最新磁盘根无效、领域校验失败、临时文件写入失败或 rename 失败
- **THEN** writer SHALL 报告现有语义的安全错误
- **THEN** 用户配置上下文 SHALL NOT 把未成功持久化的草稿安装为当前 snapshot

### Requirement: assistant turn 使用一致配置 snapshot
每次 assistant turn SHALL 在开始时捕获一个用户配置 revision。该 turn 的 provider/model、reasoning、工具 runtime、指令文件名、压缩阈值、skill catalog 比例和自动审批 reviewer SHALL 从该 revision 解析，并在所有 tool continuation 完成前保持不变；配置刷新只 SHALL 影响后续 turn。

#### Scenario: active turn 不受中途刷新影响
- **WHEN** assistant turn 已经捕获 revision，且在 provider streaming 或 tool continuation 期间配置文件发生变化
- **THEN** 当前 turn SHALL 继续使用捕获 revision 的 provider、reasoning、工具和压缩设置
- **THEN** 当前 turn SHALL NOT 混用新 revision 的任一配置领域

#### Scenario: 下一 turn 使用新 revision
- **WHEN** 配置上下文在两个 assistant turn 之间安装新 revision
- **THEN** 下一 turn SHALL 使用新 revision 解析模型、reasoning、tools 和 App runtime settings
- **THEN** 系统 SHALL NOT 为获取这些设置在同一 turn 内再次读取配置文件

#### Scenario: reviewer 与主 agent 同源
- **WHEN** auto approval 在一个 active turn 中调用独立 reviewer profile
- **THEN** reviewer SHALL 从该 turn 捕获的同一配置 revision 严格解析 profile
- **THEN** watcher 在 reviewer 调用前安装的新 revision SHALL NOT 改变本 turn 的 reviewer provider 或凭据

### Requirement: 用户配置 snapshot 的范围边界
用户配置上下文 SHALL 只管理 `~/.echo/config.json` 的配置根和领域投影。Theme、项目或用户指令、SYSTEM override、memory、skill 文件和启用状态、transcript、session sidecar 以及 Codex OAuth token 内容 SHALL 继续按各自现有生命周期读取。

#### Scenario: 动态请求上下文不被错误缓存
- **WHEN** agent 在两个 provider request 之间修改了 AGENTS/CLAUDE 指令、memory 或 skill 文件
- **THEN** 这些资源 SHALL 继续按各自现有请求边界重新解析
- **THEN** 用户配置 revision SHALL NOT 被当作这些资源内容的缓存版本

#### Scenario: 独立 theme 不共享 revision
- **WHEN** `~/.echo/theme.json` 变化而 `~/.echo/config.json` 未变化
- **THEN** 用户配置上下文 SHALL NOT 因 theme 变化增加 revision
- **THEN** theme SHALL 继续由现有独立配置生命周期处理

#### Scenario: OAuth token 保持可刷新
- **WHEN** LLM snapshot 包含 Codex OAuth auth file path 且 token cache 在 turn 边界发生刷新
- **THEN** snapshot MAY 缓存 auth file path
- **THEN** snapshot SHALL NOT 缓存 access token 内容并阻止现有 token 刷新流程


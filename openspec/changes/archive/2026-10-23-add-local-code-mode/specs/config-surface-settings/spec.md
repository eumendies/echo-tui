## ADDED Requirements

### Requirement: Code Mode 常规设置开关
系统 SHALL 在 `/config` 的“常规”Tab 中提供名为“Code Mode”的 boolean 开关，展示当前归一化的 `tools.codeMode.enabled` 开启/关闭状态，并说明其用于脚本编排本地只读工具、默认关闭且下一轮运行生效。缺失或非 boolean 值 SHALL 单独回退为关闭，SHALL 不影响其他有效配置。该设置 SHALL 复用现有四 Tab 配置中心，不新增独立 Tab、页面或 interaction mode；TUI 与 headless SHALL 读取同一配置字段及默认值。

#### Scenario: 常规页面显示关闭或已保存状态
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“Code Mode”开关和用途/生效时机说明
- **AND** 有效 boolean SHALL 显示对应开关值，缺失或非法字段 SHALL 显示关闭
- **AND** 其他有效常规设置 SHALL 继续正常显示

#### Scenario: 配置意图与运行时就绪分离
- **WHEN** 持久化开关为开启，但隔离运行时不可用
- **THEN** 页面 SHALL 仍展示开启的配置意图，不将其误称为运行时已就绪
- **AND** 系统 SHALL 不自动把持久化配置改回关闭
- **AND** 实际工具可用性 SHALL 遵守 local-code-mode 的不可降级规则

### Requirement: Code Mode 开关草稿与保存
用户在 Code Mode 行按 Enter、Left 或 Right 时，系统 SHALL 只切换常规设置草稿并更新 dirty 状态，不立即写配置或改变工具目录。草稿 SHALL 遵守既有跨 Tab 保留和关闭时未保存确认。用户激活“保存常规设置”时 SHALL 校验 boolean 值并原子写入 `tools.codeMode.enabled`，保留同节点未知字段、所有其他非本设置字段及其他 Tab 未提交草稿。调整或保存 SHALL NOT 执行脚本、请求模型或启动工具审批。

#### Scenario: 切换仅影响草稿
- **WHEN** 用户选中 Code Mode 并按 Enter、Left 或 Right
- **THEN** 草稿 SHALL 在开启和关闭之间切换并参与 dirty fingerprint
- **AND** 配置文件、当前运行工具与后续运行默认配置 SHALL 在保存前保持不变
- **AND** 切换 Tab 后返回 SHALL 保留该草稿

#### Scenario: 放弃未保存修改
- **WHEN** 常规草稿只修改了 Code Mode，用户尝试关闭配置中心
- **THEN** 系统 SHALL 显示既有未保存确认
- **AND** 取消关闭 SHALL 保留草稿，确认放弃 SHALL 不写配置或更改运行能力

#### Scenario: 保存保留相关配置和其他草稿
- **WHEN** 用户保存有效的 Code Mode 草稿，且已有 tools 设置、codeMode 未知子字段或其他 Tab 未保存修改
- **THEN** 系统 SHALL 仅按常规设置所有权合并写入，包括 `tools.codeMode.enabled`
- **AND** SHALL 保留其他 tools 配置、codeMode 未知子字段和其他根节点
- **AND** SHALL 不提交其他 Tab 草稿
- **AND** 成功后 SHALL 更新 dirty fingerprint 和成功反馈，保持配置中心打开

#### Scenario: 无效草稿或保存失败
- **WHEN** Code Mode 草稿不是 boolean，或原子配置写入失败
- **THEN** 系统 SHALL 显示可理解错误，不提交无效或半写入的配置
- **AND** SHALL 保留用户草稿和 dirty 状态供修正/重试
- **AND** 当前运行 SHALL 不因失败保存改变能力

#### Scenario: 设置动作不是执行操作
- **WHEN** 用户调整或保存 Code Mode 开关
- **THEN** 系统 SHALL 不发起 agent 请求、执行脚本或显示工具审批
- **AND** 开启 SHALL 不授予写入、Bash、MCP 或其他白名单外的脚本能力

### Requirement: Code Mode 开关按运行快照生效
配置中心成功保存或 `config.json` watcher 检测到开关变化时，系统 SHALL 通过既有共享用户配置刷新获得新 snapshot，更新后续运行的配置与设置投影；普通 render SHALL NOT 同步读取配置文件。当前 active assistant run 的工具目录、脚本能力及内部调用 SHALL 继续使用启动时 snapshot，下一次 assistant run SHALL 使用新值。系统 SHALL 清理因工具 schema 变化失效的 context usage，但 SHALL NOT 因开关变化完整重绘 transcript、追加会话记录或强制中断当前脚本。

#### Scenario: 当前开启运行期间保存关闭
- **WHEN** 当前 assistant run 以 Code Mode 开启启动，用户保存或 watcher 安装关闭配置
- **THEN** 当前 run 及其脚本 SHALL 继续使用原有能力，用户仍可显式中断
- **AND** 下一次 assistant run SHALL 不暴露 `run_code`
- **AND** 已持久化脚本记录 SHALL 仍可读取

#### Scenario: 当前关闭运行期间保存开启
- **WHEN** 当前 assistant run 未启用 Code Mode，用户保存或 watcher 安装开启配置
- **THEN** 系统 SHALL 不在该 run 中途新增工具定义
- **AND** 下一次运行在隔离运行时可用且准入通过时 SHALL 增加 `run_code`，并保留原生工具

#### Scenario: 刷新只做必要更新
- **WHEN** 一次配置刷新修改 Code Mode 和其他设置
- **THEN** 各消费者 SHALL 使用同一用户配置 revision，不重复为该开关读取配置文件
- **AND** 系统 SHALL 更新配置页面/footer 所需投影并清理失效 context usage
- **AND** 单独切换 Code Mode SHALL 不触发 destructive transcript replay 或追加 transcript record

#### Scenario: 保存后的 headless 使用相同配置
- **WHEN** 用户保存 Code Mode 后启动新的 `--once` 运行
- **THEN** headless SHALL 使用相同字段、默认值与归一化规则
- **AND** SHALL 继续遵守非交互、无 TUI 和既有审批策略

## MODIFIED Requirements

### Requirement: 常规设置即时刷新
TUI SHALL 在 app 创建时从实例级用户配置 snapshot 读取一次归一化常规设置并缓存到实例状态。配置中心保存或 `config.json` watcher 检测到设置变化时，系统 SHALL 从同一次共享配置刷新产生的新 snapshot 更新缓存，并根据变化类型执行必要重绘或清理已失效的 context usage；普通 render 热路径 SHALL NOT 同步读取配置文件。同一 watcher 通知 SHALL NOT 为刷新模型与常规设置分别重复读取 `config.json`。

#### Scenario: Slash 上限变化只重绘 footer
- **WHEN** slash suggestion 上限变化且 reasoning summary 可见性未变化
- **THEN** 系统 SHALL 使用新上限重绘 footer
- **THEN** 系统 SHALL NOT 为该变化清空 transcript 或追加 record

#### Scenario: Reasoning 可见性变化完整重绘
- **WHEN** reasoning summary 可见性发生变化
- **THEN** 系统 SHALL 执行 destructive replay 以重新投影现有 transcript
- **THEN** 重绘 SHALL 使用当前 theme、终端宽度和完整持久化 records

#### Scenario: 只有压缩阈值变化
- **WHEN** 只有自动压缩阈值发生变化
- **THEN** 系统 SHALL NOT 因该变化执行不必要的 transcript 重绘
- **THEN** 下一次 assistant run SHALL 使用新阈值

#### Scenario: 技能列表上下文占比上限变化
- **WHEN** 技能列表上下文占比上限发生变化
- **THEN** 当前 active assistant run SHALL 继续使用启动时的 catalog 投影
- **THEN** 下一次 assistant run SHALL 使用新比例和当前模型 context window 创建 catalog 投影
- **THEN** 系统 SHALL 清理旧的 context usage 快照
- **THEN** 系统 SHALL NOT 因该变化执行不必要的 transcript 重绘或追加 record

#### Scenario: watcher 同时更新模型和常规设置
- **WHEN** 一次配置文件变化同时修改模型配置和常规设置
- **THEN** TUI SHALL 通过一次用户配置刷新得到包含两个领域变化的新 snapshot
- **THEN** ModelContext 与 App settings cache SHALL 消费同一 revision 且 SHALL NOT 各自重新读取配置文件

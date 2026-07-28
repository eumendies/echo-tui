## ADDED Requirements

### Requirement: 文件编辑工具模式设置
系统 SHALL 将 `tools.fileEdit.mode` 作为 TUI 与 headless runtime 共用的文件编辑工具模式设置，并 SHALL 在 `/config` 的“常规”Tab 中提供可见、可编辑和可持久化的选择项。有效值 SHALL 为 `apply_patch` 和 `edit_file`，默认值 SHALL 为 `apply_patch`；运行时读取缺失或非法值时 SHALL 独立回退默认值而不阻断应用。

#### Scenario: 常规页面展示当前模式
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“文件编辑工具”或等价设置行
- **THEN** 设置值 SHALL 显示当前归一化的 `apply_patch` 或 `edit_file`

#### Scenario: 调整模式只修改草稿
- **WHEN** 用户选中文件编辑工具设置并按 Left 或 Right
- **THEN** 草稿 SHALL 在 `apply_patch` 与 `edit_file` 之间切换
- **THEN** 系统 SHALL NOT 在显式保存前改变当前配置文件或运行时工具集合

#### Scenario: 保存文件编辑工具模式
- **WHEN** 用户调整文件编辑工具并激活“保存常规设置”
- **THEN** 系统 SHALL 将归一化值写入 `tools.fileEdit.mode`
- **THEN** 保存 SHALL 保留 `tools` 下的 `bash`、其他已知或未知字段及所有其他根配置节点
- **THEN** 成功保存 SHALL 更新常规 Tab 的 dirty fingerprint 和成功反馈

#### Scenario: 配置变化下一轮生效
- **WHEN** 配置中心保存或 config watcher 检测到文件编辑模式变化
- **THEN** 当前 active assistant run SHALL 继续使用启动时的文件编辑工具
- **THEN** 下一次 assistant run SHALL 使用新模式创建 tool definitions 和 executor registry
- **THEN** 系统 SHALL 清理受工具 schema 变化影响的旧 context usage 快照
- **THEN** 系统 SHALL NOT 因该变化重绘完整 transcript 或追加 record


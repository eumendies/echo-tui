## ADDED Requirements

### Requirement: 超限图片自动压缩设置
系统 SHALL 将 `tools.readFiles.autoCompressImages` 作为 File Picker／`@` mention 与内置 `read_files` 工具共用的超限图片自动压缩开关，并 SHALL 在 `/config` 的“常规”Tab 中提供可见、可编辑和可持久化的设置行。该设置 SHALL 为 boolean 且默认值 SHALL 为 `true`；运行时读取缺失或非 boolean 值时 SHALL 独立回退默认值而不阻断 TUI 或 headless assistant run。

#### Scenario: 常规页面展示图片压缩开关
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示“超限图片自动压缩”或等价且不会与上下文自动压缩阈值混淆的设置行
- **THEN** 设置值 SHALL 显示当前归一化的开启或关闭状态

#### Scenario: 缺失或非法配置使用默认开启
- **WHEN** `tools.readFiles.autoCompressImages` 缺失或不是 boolean
- **THEN** TUI mention 图片读取与下一轮创建的 `read_files` handler SHALL 使用开启状态
- **THEN** 系统 SHALL NOT 因该可选字段无效而丢弃其他有效配置

#### Scenario: 调整开关只修改草稿
- **WHEN** 用户选中超限图片自动压缩设置并按 Left、Right 或 Enter
- **THEN** 常规设置草稿 SHALL 在开启和关闭之间切换
- **THEN** 系统 SHALL NOT 在显式保存前改变当前配置文件、mention 读取策略或 active assistant run 的工具策略

#### Scenario: 保存图片压缩开关
- **WHEN** 用户调整超限图片自动压缩设置并激活“保存常规设置”
- **THEN** 系统 SHALL 将 boolean 值写入 `tools.readFiles.autoCompressImages`
- **THEN** 保存 SHALL 保留 `tools` 下的 `bash`、`fileEdit`、其他已知或未知字段及所有其他根配置节点
- **THEN** 成功保存 SHALL 更新常规 Tab 的 dirty fingerprint 和成功反馈

#### Scenario: 配置变化按入口生命周期生效
- **WHEN** 配置中心保存或 config watcher 检测到图片自动压缩开关变化
- **THEN** 后续 File Picker／`@` mention 提交 SHALL 使用刷新后的设置
- **THEN** 当前 active assistant run SHALL 继续使用创建工具 registry 时的设置
- **THEN** 下一次 assistant run SHALL 使用新设置创建 `read_files` handler
- **THEN** 系统 SHALL NOT 因该变化完整重绘 transcript、追加 record 或清空 context usage

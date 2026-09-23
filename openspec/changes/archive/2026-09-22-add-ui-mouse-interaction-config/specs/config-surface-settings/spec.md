## ADDED Requirements

### Requirement: UI 鼠标交互设置
系统 SHALL 将 `ui.mouseInteractionEnabled` 作为 TUI 的“UI 鼠标交互”boolean 设置，并在 `/config` 的“常规”Tab 中提供可见、可编辑和可持久化的设置行。该设置控制终端鼠标报告以及 UI hover/点击能力，默认值 SHALL 为 `false`；缺失、非 boolean、不可读或非法配置 SHALL 独立回退为关闭而不得阻断 TUI 或 headless run。该设置 SHALL NOT 使用 footer 专属的配置字段或界面名称。

#### Scenario: 常规页面展示 UI 鼠标交互
- **WHEN** 用户打开 `/config` 的“常规”Tab
- **THEN** 页面 SHALL 显示名称为“UI 鼠标交互”的开关行
- **THEN** 该行 SHALL 展示当前归一化的开启或关闭状态

#### Scenario: 缺失或非法设置默认关闭
- **WHEN** `ui.mouseInteractionEnabled` 缺失、不是 boolean，或当前可选 App settings 无法读取
- **THEN** TUI SHALL 将 UI 鼠标交互归一化为关闭
- **THEN** 系统 SHALL 不因该字段阻断其他有效常规设置、TUI 或 headless run

#### Scenario: 调整开关只修改草稿
- **WHEN** 用户选中“UI 鼠标交互”并按 Enter、Left 或 Right
- **THEN** 常规设置草稿 SHALL 在开启和关闭之间切换
- **THEN** 系统 SHALL NOT 在显式保存前改变当前终端鼠标报告或运行时 hit region

#### Scenario: 保存 UI 鼠标交互设置
- **WHEN** 用户调整“UI 鼠标交互”并激活“保存常规设置”
- **THEN** 系统 SHALL 将 boolean 值写入 `ui.mouseInteractionEnabled`
- **THEN** 保存 SHALL 保留 `ui` 节点的其他字段、其他已知配置节点和未知根节点
- **THEN** 成功保存 SHALL 更新常规 Tab 的 dirty fingerprint 和成功反馈

### Requirement: UI 鼠标交互设置在当前 TUI 即时生效
TUI SHALL 在 app 创建、配置中心成功保存或 `config.json` watcher 安装新 App settings snapshot 后使用归一化的 `ui.mouseInteractionEnabled`。设置变化 SHALL 通过普通 footer 重绘即时更新鼠标交互投影；系统 SHALL NOT 为此 destructive replay transcript、追加 transcript record、改变 active assistant turn 或改变键盘输入语义。

#### Scenario: 开启设置后激活当前可操作 UI
- **WHEN** 当前 TUI 实例安装 `ui.mouseInteractionEnabled: true` 的新 App settings snapshot
- **AND** 当前可见 footer 存在既有可操作的 pointer consumer
- **THEN** 下一次 footer 重绘 SHALL 按终端鼠标交互规范启用该 consumer 的鼠标能力
- **THEN** 既有键盘焦点和业务 surface 状态 SHALL 保持不变

#### Scenario: 关闭设置时立即恢复普通终端鼠标行为
- **WHEN** 当前可见 footer 正在启用 UI 鼠标交互
- **AND** 配置中心保存或 watcher 将 `ui.mouseInteractionEnabled` 更新为 `false`
- **THEN** 下一次 footer 重绘 SHALL 移除可执行 hit region 并停用终端鼠标报告
- **THEN** 系统 SHALL 清理当前鼠标 frame 与未完成的坐标校准，且不得执行迟到鼠标事件的业务动作

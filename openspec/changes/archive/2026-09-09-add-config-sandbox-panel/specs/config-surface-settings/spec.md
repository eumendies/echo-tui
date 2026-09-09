## MODIFIED Requirements

### Requirement: Tab 配置中心
系统 SHALL 将纯 `/config` 命令投影为带“常规”“模型与 Provider”“沙箱”“外观”四个 Tab 的配置中心。配置中心 SHALL 使用现有 command runtime 和 footer command surface，不得写入 transcript、启动 agent loop、进入 tool approval flow 或切换 terminal alternate screen。纯 `/config` SHALL 默认打开“常规”Tab。

#### Scenario: 打开配置中心
- **WHEN** 用户在主 UI composer 中提交纯 `/config`
- **THEN** 系统 SHALL 清空 composer 并打开 active command session
- **THEN** 配置中心 SHALL 显示四个 Tab 并激活“常规”
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: 循环切换 Tab
- **WHEN** 配置中心处于活跃状态且用户按 Tab
- **THEN** 系统 SHALL 在四个 Tab 间单向循环切换
- **THEN** Tab strip SHALL 在常规页面和模型的 provider、header、model 子页面中保持可见

#### Scenario: 切换 Tab 保留现场
- **WHEN** 用户在某个 Tab 修改草稿、移动选择位置或进入子页面后切换到其他 Tab
- **THEN** 系统 SHALL 保留原 Tab 的草稿、选择位置、子页面和文本编辑 buffer
- **THEN** 用户返回该 Tab 时 SHALL 能继续原有编辑现场

#### Scenario: 配置读取错误按 Tab 隔离
- **WHEN** `~/.echo/config.json` 无法用于常规、模型或沙箱配置读取，但 `~/.echo/theme.json` 和内置主题可用
- **AND** 用户在配置中心切换到“外观”Tab
- **THEN** 系统 SHALL 允许用户查看和选择主题
- **THEN** `config.json` 错误 SHALL NOT 阻断外观 Tab

#### Scenario: 沙箱 Tab 读取错误隔离
- **WHEN** `~/.echo/config.json` 无法用于沙箱草稿读取
- **THEN** 沙箱 Tab SHALL 以错误态展示且不影响其他 Tab
- **THEN** 用户 SHALL 仍能切换到其他 Tab 继续操作

### Requirement: 分域保存和统一草稿保护
“常规”、“模型与 Provider”和“沙箱”Tab SHALL 分别提供显式保存动作，并只提交各自所有的配置字段；成功保存 SHALL 重置该 Tab 的 dirty fingerprint 且 SHALL NOT 自动关闭配置中心。“外观”主题选择 SHALL 立即持久化，不形成未保存主题草稿。配置中心在关闭顶层页面时 SHALL 检查所有已初始化 Tab 的未保存草稿。

#### Scenario: 保存一个 Tab 不提交另一个 Tab 草稿
- **WHEN** 常规和模型 Tab 都包含未保存修改，且用户只保存常规 Tab
- **THEN** 系统 SHALL 只持久化常规设置
- **THEN** 模型 Tab SHALL 继续保持未保存状态和原草稿

#### Scenario: 保存后保持配置中心打开
- **WHEN** 常规或模型 Tab 保存成功
- **THEN** 配置中心 SHALL 保持 active command session
- **THEN** 当前 Tab SHALL 显示成功反馈并把已保存草稿作为新的 dirty 比较基线

#### Scenario: 从其他 Tab 关闭时保护草稿
- **WHEN** 任一可保存 Tab 包含未保存修改，且用户在另一个 Tab 的顶层按 Esc 尝试关闭配置中心
- **THEN** 系统 SHALL 显示统一放弃确认并指出存在未保存修改的 Tab
- **THEN** 只有用户确认放弃后系统 SHALL 关闭配置中心且不写入这些草稿

#### Scenario: 模型子页面 Esc 先返回
- **WHEN** 用户在“模型与 Provider”Tab 的 provider、header 或 model 子页面按 Esc，且未处于文本编辑
- **THEN** 系统 SHALL 先返回该模型编辑器的上一级页面
- **THEN** 系统 SHALL 保留所有 Tab 草稿且不打开全局放弃确认

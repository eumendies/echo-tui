## MODIFIED Requirements

### Requirement: 主 UI `/config` 配置命令
系统 SHALL 提供 `/config` slash command，用于在主 UI 内打开包含“常规”“模型与 Provider”“外观”Tab 的配置中心；现有 provider 和模型配置面板 SHALL 位于“模型与 Provider”Tab。该命令 SHALL 使用 command runtime 和 footer command surface；打开、编辑、切换、保存或取消配置时 SHALL NOT 写入 transcript、启动 agent loop、进入 tool approval flow 或发起模型请求。

#### Scenario: 打开配置中心
- **WHEN** 用户在主 UI composer 中输入纯 `/config` 并提交
- **THEN** 系统 SHALL 清空 composer并打开 active command session
- **THEN** 系统 SHALL 打开配置中心并默认激活“常规”Tab
- **THEN** 用户 SHALL 能切换到“模型与 Provider”Tab使用原有 provider/model 编辑能力
- **THEN** 系统 SHALL NOT 追加 transcript record 或启动 agent loop

#### Scenario: 带参数的 config 文本不是命令
- **WHEN** 用户提交 `/config more` 或其他带额外文本的 config 前缀
- **THEN** slash command SHALL NOT 命中配置中心
- **THEN** 系统 SHALL 按普通用户消息处理该文本

#### Scenario: 取消无修改配置
- **WHEN** 配置中心位于任一顶层 Tab 且所有可保存 Tab 都没有未保存修改
- **AND** 用户按 Esc
- **THEN** 系统 SHALL 关闭 command session 并恢复普通 composer footer
- **THEN** 系统 SHALL NOT 修改 `~/.echo/config.json` 或 `~/.echo/theme.json`

#### Scenario: 模型配置保存后保持中心打开
- **WHEN** 用户在“模型与 Provider”Tab保存有效 provider/model 草稿
- **THEN** 系统 SHALL 按现有规则更新 `~/.echo/config.json` 的 LLM 配置
- **THEN** 配置中心 SHALL 保持打开并将当前模型草稿标记为已保存


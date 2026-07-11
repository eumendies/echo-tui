## ADDED Requirements

### Requirement: Status line 使用缓存模型展示状态
普通 composer status line SHALL 使用应用内缓存的模型展示状态显示当前 selected model 和当前模型 profile 显式配置的 reasoning effort。该缓存 SHALL 在应用内模型配置写入成功后更新；系统 SHALL NOT 承诺在外部进程或用户手动编辑 `~/.echo/config.json` 后实时更新当前 status line。

#### Scenario: 响应期间 status line 保持缓存展示
- **WHEN** assistant 响应期间 spinner 或 streaming preview 高频重绘普通 composer footer
- **THEN** status line SHALL 继续显示缓存中的当前模型 label 和 reasoning effort
- **THEN** 高频重绘 SHALL NOT 为了刷新该展示而重新读取用户级配置文件

#### Scenario: 应用内模型选择后 status line 更新
- **WHEN** 用户通过 `/model` 成功切换当前模型 profile
- **THEN** 后续普通 composer status line SHALL 显示新模型 profile 的模型 label
- **THEN** status line SHALL NOT 继续显示旧 selected model 的 label

#### Scenario: 应用内推理等级修改后 status line 更新
- **WHEN** 用户通过 `/effort` 成功修改当前模型 profile 的 reasoning effort
- **THEN** 后续普通 composer status line SHALL 显示新的 reasoning effort
- **THEN** status line SHALL NOT 继续显示旧 reasoning effort

#### Scenario: /config 保存后 status line 更新
- **WHEN** 用户通过 `/config` 成功保存包含 selected model 或 reasoning 配置变化的草稿
- **THEN** 后续普通 composer status line SHALL 基于保存后的模型配置展示模型 label 和 reasoning effort

#### Scenario: 外部编辑不实时刷新 status line
- **WHEN** Echo TUI 进程运行期间，外部编辑器或其他进程修改 `~/.echo/config.json`
- **THEN** 当前普通 composer status line MAY 继续显示应用内缓存的模型 label 和 reasoning effort
- **THEN** 系统 SHALL NOT 为了侦测该外部编辑而在普通 footer redraw 路径读取用户级配置文件

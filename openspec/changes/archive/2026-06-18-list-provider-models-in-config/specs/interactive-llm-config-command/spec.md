## ADDED Requirements

### Requirement: Provider 模型枚举
配置面板 SHALL 在 provider 详情页的显式 `+ add model` 选项下方提供显式 `list models` 选项。用户激活该选项时，系统 SHALL 使用当前 provider 草稿的 preset、API key、Base URL 和隐藏 headers 调用该 provider 对应的模型枚举接口，并在 `/config` command surface 内展示可选模型列表。该流程 SHALL NOT 写入 transcript、启动 agent loop、进入 tool approval flow 或保存配置文件。

#### Scenario: 从远端模型列表添加模型
- **WHEN** 用户在 provider 详情页已提交有效 API key，并激活 `list models`
- **AND** provider preset 支持模型枚举且厂商接口返回一个或多个模型 id
- **THEN** 系统 SHALL 在 `/config` 面板内展示远端模型列表
- **AND** 用户选择某个模型 id 后，系统 SHALL 将该模型加入当前 provider 草稿或聚焦已有同名模型
- **AND** 系统 SHALL 返回 provider 详情页且不写入 `~/.echo/config.json`

#### Scenario: 模型枚举使用当前草稿连接参数
- **WHEN** 用户在 provider 详情页修改并提交 API key 或 Base URL 后激活 `list models`
- **THEN** 系统 SHALL 使用当前 command session 草稿中的连接参数发起请求
- **AND** fixed Base URL preset SHALL 使用 preset catalog 中的固定 Base URL，而不是用户草稿中的 Base URL
- **AND** 系统 SHALL 合并 preset headers 和现有 provider profile 中隐藏保留的字符串 headers

#### Scenario: 模型枚举加载状态
- **WHEN** 用户激活 `list models` 且请求尚未完成
- **THEN** 配置面板 SHALL 显示模型枚举 loading 状态
- **AND** footer SHALL 在请求完成后自动重绘为结果、空列表或错误状态

#### Scenario: Provider 不支持模型枚举
- **WHEN** 用户激活 `list models` 且当前 provider 协议不支持模型枚举
- **THEN** 配置面板 SHALL 显示可理解的 unsupported 提示
- **AND** 用户 SHALL 仍可通过 `+ add model` 手动新增模型 API id

#### Scenario: 模型枚举失败时保护敏感信息
- **WHEN** 模型枚举请求因鉴权、网络或 provider 响应错误失败
- **THEN** 配置面板 SHALL 显示脱敏后的错误信息
- **AND** 错误信息 SHALL NOT 包含 API key、Bearer token、Authorization header、x-api-key 或隐藏 headers 的值
- **AND** 系统 SHALL 保留当前 provider 草稿并允许用户继续编辑或手动添加模型

#### Scenario: 模型枚举不重复添加模型
- **WHEN** 远端模型列表中的某个模型 id 已存在于当前 provider 草稿
- **AND** 用户选择该模型 id
- **THEN** 系统 SHALL NOT 重复添加同名模型
- **AND** 系统 SHALL 返回 provider 详情页并聚焦已有模型行

#### Scenario: 模型枚举不影响未保存配置
- **WHEN** 用户完成一次模型枚举并选择模型
- **AND** 用户随后按 Esc 取消 `/config`
- **THEN** 系统 SHALL 关闭 command session
- **AND** 系统 SHALL NOT 修改 `~/.echo/config.json`

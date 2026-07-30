## MODIFIED Requirements

### Requirement: ModelContext 缓存模型展示状态
系统 SHALL 由实例级 `ModelContext` 维护当前 session model profile id、可选 reasoning effort override、模型目录摘要和当前展示状态的内存缓存。该缓存 SHALL 支持普通 status line 派生当前 session 生效的 model label 与 reasoning effort，并 SHALL 保持在单个 `createApp()` 实例内隔离。普通 footer/status line render state 派生 SHALL 从该缓存读取，不得在每次 redraw 中同步读取用户级 LLM 配置或 session settings sidecar。

#### Scenario: 高频 footer redraw 不读取持久化配置
- **WHEN** spinner tick 或 streaming token render timer 触发普通 footer redraw
- **THEN** AppContext/RenderContext SHALL 从 `ModelContext` 的内存缓存派生 status line 模型状态
- **THEN** 本次 redraw SHALL NOT 因生成 model label 或 reasoning effort而读取或解析 `~/.echo/config.json` 或 session settings sidecar

#### Scenario: ModelContext 缓存保持实例隔离
- **WHEN** 测试或 CLI 创建多个 `createApp()` 实例
- **THEN** 每个实例 SHALL 拥有独立的 `ModelContext` session 模型状态缓存
- **THEN** 一个实例中通过 `/model`、`/effort` 或 composer tuning 更新的缓存 SHALL NOT 污染另一个实例

#### Scenario: 配置读取失败时 footer 保持稳定
- **WHEN** `ModelContext` 刷新模型目录或恢复 session settings 时无法读取或解析所需配置
- **THEN** `ModelContext` SHALL 保存可供 UI 使用的安全错误状态、回退状态或 unavailable 状态
- **THEN** 后续普通 footer redraw SHALL 使用该状态渲染稳定占位，而不是在 render path 抛出配置读取异常

### Requirement: 应用内模型配置写入刷新 ModelContext 缓存
系统 SHALL 在 `/model`、`/effort` 或 composer tuning 确认有效选择后立即刷新 `ModelContext` 的 session 选择缓存，并 SHALL 在 `/config` 成功写入用户级 LLM 配置后刷新模型目录和当前 profile 展示信息。Session settings sidecar 写入是尽力同步，失败 SHALL NOT 阻止缓存更新；全局配置刷新 SHALL NOT 在当前 session profile 仍有效时用新的 `llm.selectedModel` 替换它。

#### Scenario: /model 更新 session 后刷新缓存
- **WHEN** 用户通过 `/model` 成功保存当前 session 的新 model profile id
- **THEN** `ModelContext` SHALL 刷新当前 session 模型状态缓存并清除旧 effort override
- **THEN** 后续普通 render state SHALL 能从缓存读取新 model label 和其 profile 默认 effort
- **THEN** 用户级 `llm.selectedModel` SHALL 保持不变

#### Scenario: /effort 更新 session 后刷新缓存
- **WHEN** 用户通过 `/effort` 成功保存当前 session 的 reasoning effort override
- **THEN** `ModelContext` SHALL 刷新当前 session 模型状态缓存
- **THEN** 后续普通 render state SHALL 能从缓存读取新的有效 reasoning effort
- **THEN** model profile 的默认 `reasoning.effort` SHALL 保持不变

#### Scenario: /config 保存成功后保留有效 session 选择
- **WHEN** 用户通过 `/config` 成功保存 provider/model 配置草稿
- **AND** 当前 session model profile 在新配置中仍然有效
- **THEN** `ModelContext` SHALL 刷新 model catalog 和当前 profile 展示信息
- **THEN** 当前 session modelProfileId 和 reasoningEffortOverride SHALL 保持不变
- **THEN** 新的全局 `llm.selectedModel` SHALL 只作为后续新 session 的默认值

#### Scenario: /config 删除当前 session profile
- **WHEN** `/config` 保存后当前 session model profile 不再存在
- **THEN** `ModelContext` SHALL 回退新的有效全局默认 profile并清除旧 effort override
- **THEN** 系统 SHALL 清空旧 context usage，并在后续同步机会尽力更新 session settings

#### Scenario: 写入失败仍更新缓存
- **WHEN** `/model`、`/effort` 或 composer tuning 尝试保存当前 session settings但写入失败
- **THEN** `ModelContext` SHALL 用用户确认的选择或 effort 更新缓存
- **THEN** UI SHALL 展示新的有效模型状态，后续当前进程内请求 SHALL 使用它

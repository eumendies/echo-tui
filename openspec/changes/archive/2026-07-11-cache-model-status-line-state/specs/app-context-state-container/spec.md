## ADDED Requirements

### Requirement: ModelContext 缓存模型展示状态
系统 SHALL 由实例级 `ModelContext` 维护当前模型展示所需的内存状态缓存。该缓存 SHALL 至少支持普通 status line 派生当前模型 label 和当前模型 profile 显式配置的 reasoning effort，并 SHALL 保持在单个 `createApp()` 实例内隔离。普通 footer/status line render state 派生 SHALL 从该缓存读取模型展示状态，不得在每次 redraw 中同步读取或解析用户级 LLM 配置文件。

#### Scenario: 高频 footer redraw 不读取用户配置
- **WHEN** spinner tick 或 streaming token render timer 触发普通 footer redraw
- **THEN** AppContext/RenderContext SHALL 从 `ModelContext` 的内存缓存派生 status line 模型状态
- **THEN** 本次 redraw SHALL NOT 因生成模型 label 或 reasoning effort 而读取或解析 `~/.echo/config.json`

#### Scenario: ModelContext 缓存保持实例隔离
- **WHEN** 测试或 CLI 创建多个 `createApp()` 实例
- **THEN** 每个实例 SHALL 拥有独立的 `ModelContext` 模型状态缓存
- **THEN** 一个实例中通过 `/model`、`/effort` 或 `/config` 更新的缓存 SHALL NOT 污染另一个实例

#### Scenario: 配置读取失败时 footer 保持稳定
- **WHEN** `ModelContext` 刷新模型状态缓存时无法读取或解析用户级 LLM 配置
- **THEN** `ModelContext` SHALL 保存可供 UI 使用的安全错误状态或 unavailable 状态
- **THEN** 后续普通 footer redraw SHALL 使用该状态渲染稳定占位，而不是在 render path 抛出配置读取异常

### Requirement: 应用内模型配置写入刷新 ModelContext 缓存
系统 SHALL 在应用内模型配置写入成功后刷新 `ModelContext` 模型状态缓存。刷新 SHALL 基于写入后的用户级 LLM 配置重新解析模型 profile、当前选择和 reasoning effort。写入失败时系统 SHALL NOT 把未持久化的模型选择或 reasoning effort 写入缓存。

#### Scenario: /model 写入成功后刷新缓存
- **WHEN** 用户通过 `/model` 成功将新的模型 profile id 写入 `llm.selectedModel`
- **THEN** `ModelContext` SHALL 刷新模型状态缓存
- **THEN** 后续普通 render state SHALL 能从缓存读取新 selected model 的 label 和 reasoning effort

#### Scenario: /effort 写入成功后刷新缓存
- **WHEN** 用户通过 `/effort` 成功更新当前 selected model profile 的 `reasoning.effort`
- **THEN** `ModelContext` SHALL 刷新模型状态缓存
- **THEN** 后续普通 render state SHALL 能从缓存读取新的 reasoning effort

#### Scenario: /config 保存成功后刷新缓存
- **WHEN** 用户通过 `/config` 成功保存 provider/model 配置草稿
- **THEN** `ModelContext` SHALL 刷新模型状态缓存
- **THEN** 后续普通 render state SHALL 能从缓存读取保存后的 selected model 和 reasoning effort

#### Scenario: 写入失败不更新缓存
- **WHEN** `/model`、`/effort` 或 `/config` 尝试保存模型配置但写入失败
- **THEN** `ModelContext` SHALL NOT 用未持久化的选择或 effort 更新模型状态缓存
- **THEN** UI SHALL 继续展示写入前的模型展示状态或安全错误状态

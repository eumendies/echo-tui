## Context

`/config` 当前使用单个 command session state 管理 provider 列表、provider 表单、preset 列表和远端模型列表。provider 表单把每个模型投影成一行可编辑字符串，适合基础配置，但继续平铺 headers 和 context window 后会超过 footer 高度预算，也无法清晰表达字段归属。

运行时配置已经支持 provider 级 `headers` 和模型级 `contextWindow`。缺口集中在 `/config` 草稿模型、交互状态机、renderer 和 editor round-trip；provider adapters 和最终配置 schema 不需要改变。现有配置还可能包含 `reasoning.effort` 和 `reasoning.summary`，本变更不在 `/config` 暴露这些 API 深层概念，但保存时必须隐藏保留。

## Goals / Non-Goals

**Goals:**

- 在现有 footer command surface 内提供 provider、headers、models 和 context window 的分层配置。
- 支持自定义 header 的安全编辑，并保证 preset headers 与用户 headers 的合并语义不变。
- 支持模型 context window 的读取、编辑、校验与保存。
- 保证 `/config` 对已存在但不展示的 reasoning 配置执行无损 round-trip。
- 将 command surface 内置的动作、状态、说明和非技术标签统一改为中文。
- 保持窄终端、高度预算、raw mode、主屏重绘和 Esc 返回语义。

**Non-Goals:**

- 不允许用户编辑 preset 内置 headers、`agentType` 或 provider adapter 私有参数。
- 不增加 temperature、max output tokens、timeout 或其他尚未进入当前 LLM 配置模型的参数。
- 不在 `/config` 展示或编辑 reasoning effort、reasoning summary，也不新增 `/summary` 或 `/context-window` 命令。
- 不实现 API 连通性测试、header 模板市场或从远端模型 metadata 自动推断 context window。
- 不引入第三方 TUI、alternate screen 或新的配置文件格式。

## Decisions

### 1. 将 `/config` 扩展为分层状态机

面板层级采用：

```text
provider list
  └─ provider detail
      ├─ header list
      │   └─ header detail
      └─ model detail
```

provider 详情继续展示连接信息和模型概要，但模型行由“直接编辑字符串”改为“Enter 打开 model detail”。model detail 负责模型 API id、默认模型、context window 和删除动作。header list 负责显示脱敏后的自定义 header，并通过 header detail 新增或编辑。

command state 继续是可 `structuredClone` 的纯数据；通过扩展 `ConfigPanelMode`、focus index 和 edit target 表达页面与编辑状态，不引入持有终端或文件句柄的 controller。

选择该方案是因为 footer 高度有限，分层页面可以复用现有窗口化策略并保持每行单一职责。替代方案是在 provider 表单内展开每个模型的所有字段和所有 headers；该方案会让行数按模型数和 header 数成倍增长，窄终端下难以理解。

### 2. 草稿显式承载可编辑字段并隐藏保留 reasoning

`ConfigProviderDraft` 将自定义 headers 表达为可编辑条目集合，条目至少包含 name 和 value；保存时再序列化为 `Record<string, string>`。`ConfigModelDraft` 继续显式承载可编辑的可选 `contextWindow`，并以不参与 UI 投影的方式保留原模型 profile 中已有的 reasoning 对象。

读取、规范化和保存必须覆盖：

```text
provider.headers
model.contextWindow
model.reasoning（隐藏保留，不可编辑）
```

规范化和保存不得改写、补全或删除隐藏 reasoning 对象，包括显式 `reasoning.effort: "none"`。只有用户删除整个模型时，对应隐藏配置才随模型一起删除。

选择显式草稿字段而不是把未知 model JSON 整体透传，是为了让校验和 UI 状态可类型化，同时仅管理当前运行时正式支持的字段。与 LLM 面板无关的 root 和 `llm` 未知节点继续按现有 editor 策略保留。

### 3. Header value 一律按敏感信息处理

header list 和非编辑状态只显示 header name、配置状态和固定长度 mask，不显示 value。编辑已有 header 时，value 输入框初始为空；用户不输入新值并提交表示保留原值，显式删除行才会移除 header。新增 header 时 name 和 value 均必填。

header name 需 trim、非空、禁止 CR/LF，并按 ASCII 大小写不敏感检查重复；value 禁止 CR/LF。错误信息只能包含安全的 header name 或字段说明，不能包含 value。preset 内置 headers 仅显示为“由 provider 类型管理”的只读摘要，不进入用户 header 编辑集合。

替代方案是提供显示明文快捷键，但终端滚屏、录屏和共享会话容易泄漏凭据，因此不采用。

### 4. Model detail 只展示通用模型字段

context window 对所有模型展示，使用两种状态：

- `自动`：草稿不保存 `contextWindow`，运行时继续使用内置模型映射或默认窗口。
- 显式正整数：保存 `contextWindow`；清空输入恢复 `自动`。

UI 可复用或导出运行时的 context window resolver，在自动状态旁展示解析后的窗口作为说明，但该解析值不得被自动写回配置。

model detail 不展示 effort、summary 或 reasoning section。这些字段与 provider API 语义耦合较深，一般用户难以判断组合效果；effort 继续通过现有 `/effort` 专用入口修改，summary 继续由手写配置管理。

### 5. 关键动作使用显式可聚焦行

provider、model 和 header 删除，默认模型设置，新增 header/model 和保存配置都提供显式行。`d`、`s` 等已有快捷键可以继续工作，但只作为加速操作。删除动作至少需要在当前页面明确聚焦后 Enter 执行；删除最后一个 provider 或 model 后仍由保存前校验阻止无效配置落盘。

顶层存在未保存修改时按 Esc，打开确认 surface 或等价确认状态；确认放弃才关闭 command session。子页面 Esc 只返回上一级，不丢弃草稿。

### 6. 中文化以语义类别为边界

内置动作、状态、说明、section 标题和普通字段标签使用中文，例如“新增 provider”“保存更改”“未设置”“连接信息”“模型”“获取模型列表”。保留英文的范围限于：

- `Enter`、`Esc`、`Tab` 等按键名；
- `/config`、`~/.echo/config.json` 等命令和路径；
- `provider`、`model`、`API key`、`Base URL`、header、context window 等已作为配置/API 领域词使用的技术名词；
- preset、产品、协议和用户输入的名称或 id。

renderer 测试以去 ANSI 后的用户可见中文和技术词边界为主，避免绑定具体颜色字节。

## Risks / Trade-offs

- [Risk] 状态模式和 edit target 增多，使单个 handler 继续膨胀。→ Mitigation：保持事件处理为纯函数，并按页面拆分内部处理函数；只有出现真实重复时再抽取 controller。
- [Risk] header value 的“空输入表示保留”可能让用户难以主动设置空字符串。→ Mitigation：header value 规定为非空；需要移除时使用显式删除动作。
- [Risk] 自动 context window 的展示值与未来模型能力变化不一致。→ Mitigation：明确显示为本地解析值，不写回配置；用户可设置显式值覆盖。
- [Risk] 中文化误改模型名、协议名或 API 字段名。→ Mitigation：按语义类别维护文案映射，并增加保留技术词的渲染测试。
- [Risk] reasoning 不进入可编辑草稿后，重建 model JSON 时可能丢失字段。→ Mitigation：草稿保存隐藏的原始 reasoning 对象，并先完成无损 round-trip 测试。

## Migration Plan

1. 扩展草稿读取、类型、规范化、校验和原子保存，先保证旧配置无损 round-trip。
2. 扩展 command state 和事件处理，引入 header/model 子页面及显式动作。
3. 更新 config renderer、窗口化和中文文案。
4. 更新文档与自动化测试，完成交互式手工验证。

现有配置无需迁移，字段路径保持不变。回滚代码时，已由新 UI 保存的 headers 和 context window 仍是当前运行时支持的合法 JSON；隐藏保留的 reasoning 字段也继续由运行时读取。

## Open Questions

- 是否在自动 context window 旁显示本地解析值，还是只显示“自动”？设计默认显示解析值，若 footer 宽度不足可仅显示“自动”。
- 顶层未保存退出确认是复用通用 confirm surface，还是作为 config 内部 mode 渲染？实现时优先选择能保持同一 draft/session data 的最小方案。

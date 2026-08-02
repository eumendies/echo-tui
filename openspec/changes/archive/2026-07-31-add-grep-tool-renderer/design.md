## Context

当前 `grep` handler 已从 ripgrep JSON 事件中得到结构化的 `path`、1-based `line`、1-based `column` 和行文本，但在返回 `ToolExecutionResult` 前只把这些字段格式化为 `path:line:column: text`。通用 tool renderer 随后只能展示原始 arguments JSON 和有界纯文本，既无法可靠按文件分组，也无法区分工具截断与 TUI 展示省略。

项目已有相邻 call/result 聚合、专属 renderer 分发、safe render width、主题语义色和 tool details 持久化能力。本变更应复用这些基础设施，不改变 `grep` schema、ripgrep 执行方式、provider-visible result 文本或 transcript 的 append-only 语义。

## Goals / Non-Goals

**Goals:**

- 为 pending、孤立 call 和相邻 call/result pair 提供一致的 `Grep · “<pattern>”` 生命周期标题。
- 用弱化 metadata 表达 paths、glob、regex 和显式大小写选项，隐藏原始 arguments JSON。
- 使用文件树、行列 gutter 和低强调主题色展示有界匹配片段，避免搜索结果树产生过多视觉噪声。
- 通过结构化 display metadata 驱动结果投影，避免解析存在歧义的 provider-visible 文本。
- 明确区分无匹配、执行失败、handler 截断和 renderer 展示省略。
- 保持历史 transcript、窄终端、Tab、宽字符和 malformed 数据下的安全降级。

**Non-Goals:**

- 不改变 `grep` 的搜索算法、参数 schema、结果上限或 provider-facing 文本格式。
- 不为搜索命中新增背景色、主题 token、语法高亮或精确命中区间高亮。
- 不尝试用 JavaScript RegExp 复现 ripgrep regex 语义。
- 不为历史缺少 display metadata 的结果猜测或迁移结构化匹配项。
- 不在本变更中抽象所有专属 tool renderer 的统一 registry。

## Decisions

### 1. 成功结果携带可选结构化 display metadata

扩展 `GrepToolExecutionResult.details` 和对应 transcript details，使成功结果可携带：

```text
display.kind = "grep"
display.matches[] = { path, line, column, text }
```

handler 直接复用已经解析出的 `GrepMatch[]` 构造 metadata；无匹配成功结果携带空数组。`details.truncated` 继续作为 handler 是否达到返回上限的唯一结构化事实。失败结果不要求 display metadata。

选择 metadata 而不是解析 `path:line:column: text`，因为 POSIX 路径和命中正文都可能包含冒号及类似行列字段，文本反向解析无法守住事实边界。metadata 会与 result text 存在少量重复，但默认最多 100 条匹配，换取稳定 renderer 和可重放性是可接受的。

### 2. 使用 pair-aware renderer 统一标题和结果状态

新增 `src/render/tool-message-renderers/grep.ts`，提供 call renderer 和 pair renderer：

- call renderer 服务 footer pending preview 和孤立 call，显示 `searching`。
- pair renderer 同时读取 call request 与 result details，成功时显示结果数量或空状态，失败时显示有界诊断。
- arguments 或 display metadata 不可信时返回 `null`，由现有分发逻辑降级到 split/generic renderer。

孤立 result 不单独推断 query；它继续使用通用 result renderer。正常 transcript 中相邻且 call id 匹配的记录会走 pair renderer。

### 3. 标题、scope metadata 与状态采用固定信息层级

推荐投影：

```text
◆ Grep · “needle” · ignore case · 3 matches
  in src, test · glob *.ts
  ├─ src/tool.ts
  │    7:7 │ const needle = true;
  └─ test/tool.test.js
      42:5 │ assert.match(value, /needle/);
```

第一行表达“搜索什么、如何搜索、结果如何”：包含人类可读工具名、折叠并有界的 pattern、查询语义选项以及生命周期/结果状态。默认 fixed-string 不额外显示；`literal: false` 在第一行显示 `regex`；大小写只在调用显式提供 boolean 时于第一行显示 `case sensitive` 或 `ignore case`，避免推断 ripgrep 默认配置。第二行只表达“在哪里搜索”：始终显示搜索路径，并在 `glob` 存在时显示文件过滤条件。第一行过长时使用既有 continuation prefix 安全换行，不得为了保持单行而把查询语义混入 scope 行。

调用标记 `◆` 继续复用 success/error/neutral 状态色；标题保持普通文本，scope、树线、文件路径、行列 gutter、匹配正文和省略提示统一使用低强调的 `toolOutput` 语义色。不得写死 RGB 或 256 色值。

### 4. 结果按连续文件分组并保留匹配顺序

renderer 按 metadata 原始顺序扫描匹配项，只合并相邻且 path 相同的项，不跨位置重排同名路径。每个文件组使用 `├─`/`└─` 树节点，匹配行显示右对齐的 `line:column` gutter；续行与正文起始列对齐。

匹配正文不使用 syntax highlighter，和树线、文件路径及 gutter 一样使用 `toolOutput` 低强调语义色，保持结果树视觉层级一致。宽度计算必须忽略 ANSI 并按 grapheme/Tab 规则进行。

### 5. 同时保留 handler 截断和 renderer 省略语义

handler 返回的所有结构化 matches 用于计算本次捕获数量；`details.truncated: true` 时标题使用 `N matches shown · more available` 或等价文案，不把 N 表述为完整总数。

renderer 对最终可见结果区应用有界物理行预算。预算不足时只省略 TUI 投影，并在结果树末尾显示可计数的 `… N more matches`；单条超长正文可以安全换行后截断。renderer 省略不得修改 metadata、result text 或 handler 的 `truncated` 字段。

### 6. malformed 与历史记录保守降级

call parser 只接受预期 JSON object 和字段类型，并对 pattern、paths、glob、literal、case_sensitive 做展示所需的保守校验。display validator 要求 kind、数组、非空 path、正整数行列号和字符串正文均合法。任何整体形状错误都不得部分构造结果树。

历史 session 的 `grep` details 没有 display metadata 时继续走 generic result 投影；不从旧文本恢复匹配项，也不要求 journal migration。现有 transcript journal 对 `grep` details 的持久化会保留新增字段，renderer 重放时再次校验。

## Risks / Trade-offs

- [display metadata 与 result text 重复，增加 journal 大小] → metadata 受现有 `DEFAULT_MAX_MATCHES` 硬上限约束，不复制额外上下文或 match ranges。
- [低强调结果可能不如语法高亮醒目] → grep 结果优先保持紧凑、统一的树形层级；需要查看完整代码上下文时继续使用 `read_files`。
- [文件头和长匹配换行会快速消耗显示预算] → 以最终物理行为预算单位，并保留可计数省略提示；窄终端优先保证前缀、行列和至少一个正文片段可辨认。
- [非法 metadata 导致专属样式缺失] → 整体回退到通用 renderer，优先保留原始事实而不是显示可能错误的分组或数量。
- [查询语义进入标题后，第一行在长 pattern 或多个选项下更容易换行] → 复用 safe width、grapheme 和 continuation prefix 规则；scope 继续保持独立层级，footer pending 依据实际返回行数清理。

## Migration Plan

1. 先扩展 tool/transcript 类型与 handler display metadata，并保持 result text 不变。
2. 增加 grep renderer、分发与测试后启用专属投影。
3. 新 session 自动持久化 display metadata；旧 session 无需迁移并继续安全降级。
4. 回滚时可移除专属分发和 display 生产；额外 details 字段不会影响 provider continuation，旧版本若不接受该字段则应先保留宽松 journal 校验或在回滚前验证兼容性。

## Open Questions

无。第一版不使用语法高亮或精确命中词高亮；后者若需要，应单独设计 ripgrep byte offset 到终端 grapheme span 的转换及主题语义。

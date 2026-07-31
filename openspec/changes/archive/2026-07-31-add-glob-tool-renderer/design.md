## Context

当前 `glob` handler 已从 ripgrep 的 NUL 分隔输出中得到有序 `paths[]`，但在返回 `ToolExecutionResult` 前只把这些路径格式化为换行文本。通用 tool renderer 因此会展示原始 arguments JSON 和有界文本，无法可靠显示 pattern、搜索 roots、结果数量，也无法区分 handler 截断与 TUI 自身的展示省略。

项目刚为 `grep` 建立了可选 display metadata、pair-aware renderer、状态 marker、safe width 和历史 fallback 模式。`glob` 应复用这些已验证的边界，但其结果只有文件路径，不需要 grep 的文件分组、行列 gutter 或代码片段投影。

## Goals / Non-Goals

**Goals:**

- 为 pending、孤立 call 和相邻 call/result pair 提供一致的 `Glob · “<pattern>”` 生命周期标题。
- 在独立 scope 行展示搜索 roots，隐藏完整 arguments JSON。
- 用有界扁平路径树表达成功结果，并清晰显示数量、无文件、失败和截断状态。
- 通过结构化 display metadata 驱动投影，保留路径顺序和 session 重放稳定性。
- 保持低强调主题样式，并在窄终端、宽字符、Tab、控制换行和 malformed 数据下安全降级。

**Non-Goals:**

- 不改变 `glob` schema、ripgrep 参数、排序方式、结果上限或 provider-facing 文本。
- 不重建完整目录树、查询文件系统目录信息或对路径执行额外 stat。
- 不使用 syntax theme、文件类型图标、扩展名着色或新增主题 token。
- 不从历史换行文本猜测路径，也不要求 journal migration。
- 不在本变更中抽象所有专属 tool renderer 的统一 registry。

## Decisions

### 1. 成功结果携带可选结构化 display metadata

扩展 `GlobToolExecutionResult.details` 和对应 transcript details：

```text
display.kind = "glob"
display.paths[] = <handler 保留的原始路径>
```

成功匹配携带有序路径数组，无匹配携带空数组，失败省略 display。`details.truncated` 继续作为 handler 是否达到路径上限的唯一结构化事实。

不解析 provider-visible 换行文本：POSIX 文件名可以包含换行，文件名也可能与 `has_more: true` 等协议字面量相同，文本反向解析无法可靠区分路径和 formatter 尾注。metadata 最多包含现有上限内的 200 条路径，重复成本可控。

### 2. 使用 pair-aware renderer 统一调用与结果

新增 `src/render/tool-message-renderers/glob.ts`，提供 call renderer 和 pair renderer：

- call renderer 服务 footer pending preview 和孤立 call，显示 pattern、scope 与 searching 状态。
- pair renderer 同时读取 arguments 和 result details，成功时显示数量或无文件状态，失败时显示有界诊断。
- arguments、失败 envelope 或 display metadata 不可信时返回 `null`，交给现有 split/generic renderer。
- 孤立 result 不推断 pattern，继续使用通用 result renderer。

这种接入方式与 grep 一致，不引入新的 renderer registry 或工具专用调度抽象。

### 3. 标题和 scope 使用固定信息层级

推荐投影：

```text
◆ Glob · “**/*.ts” · 4 files
  in src, test
  ├─ src/app/runtime.ts
  ├─ src/tools/glob-tool-handler.ts
  ├─ test/render/app-renderer.test.js
  └─ test/tools/tool-execution.test.js
```

第一行表达 pattern 和生命周期/结果状态；第二行只表达搜索 roots。调用 marker 通过现有 `resolveToolCallPrefixStyle` 选择状态：pending 为中性，成功和无文件使用 `toolSuccess`，失败使用 `toolError`。标题保持普通文本，scope、树线、路径和省略节点统一使用 `toolOutput`。

pattern 和 roots 在展示前折叠控制换行并限制长度。paths 缺失或为 null 时 scope 规范化为 `in .`；roots 过多时只显示有界前缀和可计数省略。

### 4. 结果使用扁平文件路径树

renderer 按 metadata 原始顺序展示完整路径逻辑节点，只用 `├─`/`└─` 表达文件列表，不把路径段扩展成目录节点。相比重建层级目录树，这能让一条物理行通常对应一个文件，避免深目录消耗大部分展示预算，也无需处理虚拟目录合并和跨平台分隔符语义。

长路径可以按 safe width 换行，并为 continuation 保持稳定缩进；单个路径的物理行数应有小上限，超出部分以省略号结束。Tab 按当前终端列展开，CR/LF 折叠为空格，且这些规范化只影响可见投影，不修改 metadata。

### 5. 只使用共享物理行预算

路径树复用 `TOOL_RESULT_MAX_DISPLAY_LINES`，不再增加独立的“最多显示 N 个文件”限制。renderer 从预算可容纳的最大前序路径集合开始，根据实际换行后的物理行数减少可见路径，并在末尾显示 `… N more files`。

`details.truncated: true` 时，标题使用 `N files shown · more available`，其中 N 是 handler 实际保留数量；renderer 省略节点只统计 metadata 中未投影的路径。两种截断语义互不覆盖。

最终专属投影行必须再次验证 safe width。固定 tree prefix 或异常超长内容无法适配时，pair renderer 返回 `null`，使用现有通用 renderer 保留原始事实，而不是输出越界行。

### 6. 历史和 malformed 数据保守降级

call parser 只接受预期 JSON object、非空 pattern，以及缺失/null 或非空字符串数组 paths。display validator 要求 kind 为 `glob`、paths 为数组且每项是非空字符串。任一整体形状错误都不得部分构造路径树。

历史 session 的 glob details 没有 display metadata 时继续走 generic result 投影；不从旧文本恢复路径。session journal 已保留未知 details 字段，新 metadata 可以随 transcript 正常写入和重放。

## Risks / Trade-offs

- [display metadata 与 result text 重复，增加 journal 大小] → metadata 受现有 200 路径上限约束，且不复制目录节点或文件属性。
- [扁平路径树不如完整目录树直观] → 路径自身保留目录信息，同时显著提高有限终端行数中的文件密度。
- [超长路径换行会快速消耗预算] → 限制单路径物理行数，并根据最终物理行动态减少可见路径。
- [非法 metadata 导致专属样式缺失] → 整体回退通用 renderer，优先保留原始事实。
- [handler 截断和 renderer 省略同时出现可能混淆] → 标题只表达 handler 的 more-available，树末节点只表达当前 metadata 中被隐藏的路径数量。

## Migration Plan

1. 扩展 tool/transcript 类型与 glob handler display metadata，保持 result text 不变。
2. 增加 glob renderer、分发和自动化测试后启用专属投影。
3. 新 session 自动持久化 metadata；旧 session 无需迁移并继续通用 fallback。
4. 回滚时可移除专属分发和 metadata 生产；provider-visible 文本及 glob 执行协议不受影响。

## Open Questions

无。第一版固定采用扁平文件路径树；完整目录树、图标或文件类型着色若有需求，应作为独立视觉变更评估。

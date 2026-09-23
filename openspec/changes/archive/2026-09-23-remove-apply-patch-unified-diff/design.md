## Context

`apply_patch` 的 parser 同时把 unified diff 与 Begin Patch 转为同一个 `PatchOperation`；simulator 因此保留独立唯一匹配与顺序游标匹配两条路径。执行前的调用标签和审批投影也各自扫描 unified diff 文件头。Begin Patch 已具备 Add/Update/Delete、重复路径的虚拟状态和多文件模拟；`/diff` 则使用独立的 Git diff 解析器，不应受影响。

## Goals / Non-Goals

**Goals:**

- 使 `apply_patch` 只接受 Begin Patch 格式；对独立或混入的 unified diff fail closed，并说明期望格式。
- 删除仅供 unified diff 使用的解析、模拟及预览分支，保持 Begin Patch 的顺序匹配与现有文件安全边界。
- 同步 provider-visible 工具说明、审批和调用摘要、测试与架构文档。

**Non-Goals:**

- 不更改 `/diff` 的 Git diff 解析与展示，也不移除 apply_patch result 的 diff display metadata。
- 不改变 `edit_file`、bash、MCP 的语义；不为历史会话或旧 tool call 加入格式迁移、重解析或重新执行逻辑。
- 不收紧现有 Begin Patch 的数字 `@@ -… +… @@` 更新块头、路径解析、换行处理和公共缩进支持。

## Decisions

### 1. 在 parser 入口限定输入格式

`parsePatchText` 在现有 CRLF 归一化及 Begin Patch 前导空行/公共缩进处理后，只调用 `parseBeginPatch`；其他非空文本立即报格式错误。删除 unified diff 专用 parser 与 git 元数据处理，不保留“先尝试一种，失败再尝试另一种”的兼容分支。Begin Patch 块内若出现独立 git 文件头，由既有文件指令/更新块语法拒绝；作为 hunk 内容出现的 `---`、`+++` 等文本仍按行首操作符处理。

替代方案是仅在入口拒绝 unified diff 但保留后续死代码。它仍维护两套易混淆的语义，不满足简化目标。

### 2. 内部操作与模拟仅保留 Begin Patch 顺序模式

所有文件操作均来自 Begin Patch：新增、删除使用现有显式文件指令，更新沿用游标后的首次精确匹配。去掉仅供 unified diff 使用的 `matchMode` 分流和独立唯一匹配；Begin Patch Delete 无 hunk，保留文本文件校验、symlink 拒绝、原文件 removed metadata、虚拟状态归并及 change recorder。更新块中带行号的 `@@` 仅作既有格式校验，不使用行号定位。

替代方案是保留独立匹配作为 Begin Patch 的回退；它会改变重复上下文的现有定位规则，也会保留无用复杂度。

### 3. 审批与调用摘要仅扫描 Begin Patch 文件指令

`createApplyPatchCallLabel` 和审批的大 patch 操作摘要仅从 Begin Patch 的 `*** Add/Update/Delete File` 提取路径，保留 `delete <path>` 可见标记、截断预算与无法安全摘要时的 `manual_only` 回退。摘要不承担完整语法验证；输入不合法也不能绕过按工具名触发的审批。删除对 `diff --git`、`---` / `+++`、`/dev/null` 的路径归一化和删除推断；Begin Patch 中以 `a/`、`b/` 开头的路径是字面路径，不应被去前缀。

替代方案是复用执行 parser 做审批模拟：审批发生在执行前，不应引入读取文件或重复执行期校验。

### 4. 保留共享的结果展示边界

`ApplyPatchDisplayFile` 的 added/updated/deleted metadata、失败降级与 transcript 存储保持现状；这一 metadata 描述实际文件变化，不是受理 unified diff 的解析能力。相关的 `/diff` parser 和 renderer 不调整。

## Risks / Trade-offs

- 模型或用户仍提交旧格式 → schema 明示 Begin Patch，handler 返回明确失败且不写盘；不自动转换旧格式。
- 简化审批路径扫描可能遗漏无效请求的目标 → 不改变风险分类与审批流程；过长且不可安全摘要的请求走 `manual_only`。
- 大量现有测试以 unified diff 构造有效输入 → 改写为等价 Begin Patch 用例并增加拒绝测试，继续验证变更记录、显示和 all-or-nothing。

## Migration Plan

更新工具 schema 后，新工具调用必须使用 Begin Patch；旧格式调用失败并提示修正。不迁移或回放历史记录。需要回退时恢复旧 parser、simulator 和 schema，并运行完整验证。

## Open Questions

- 无；数字 Begin Patch 更新块头和历史 metadata 的处理边界已在变更 spec 中明确。

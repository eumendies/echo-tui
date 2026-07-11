## Context

Echo TUI 的 transcript 与 footer 渲染都依赖一个关键约定：renderer 返回的 `string[]` 中，每个元素应对应终端上的一条安全可见行。footer 局部重绘会记录上一帧的 `layout.lines.length` 并逐行清理；如果任一元素内部仍包含原始换行，或因为制表符宽度估算错误导致终端自动换行，清理高度就会少算，用户会看到旧的 `Bash · running` 块残留、rail 缺失或文本错位。

当前 bash tool renderer 已经有专属 rail 投影、heredoc 拆分、`-c` / `-e` 内嵌脚本预览和结果区预算控制。问题出在这些能力的边界：`parseInlineScriptCommand()` 可以在一个更大的多行 shell command 中匹配到 `node -e "..."`，然后把匹配前后的多行 shell 文本拼进单个 `headerLines` 元素；tool renderer shared wrapping 也没有像普通 message renderer 一样按当前列展开 tab。

## Goals / Non-Goals

**Goals:**

- 保证 bash tool call/result 与 pending preview 的每条返回行都是单物理行安全投影，不含原始 `\n` / `\r`，并遵守 safe render width。
- 让多行 shell command 中的 `node -e` / `python -c` 等普通命令保持逐逻辑行渲染，不吞并前后 shell 行。
- 保留安全可识别的 heredoc 和单行长 `-c` / `-e` 内嵌脚本预览能力。
- 将 tab 展开逻辑复用到 tool message wrapping，避免制表位导致终端额外物理换行。
- 用测试覆盖截图中的错位形态和 tab 形态。

**Non-Goals:**

- 不改变 bash 工具执行、approval、风险分类、timeout 或输出截断策略。
- 不改变 transcript record、tool result text、provider continuation、session persistence 或 compaction 输入。
- 不引入新的 terminal rendering 框架或第三方宽度计算依赖。
- 不重写 footer 清理机制；本次只收紧 renderer 输出约束。

## Decisions

### Decision 1: renderer 输出保持“单元素单可见行” invariant

所有 tool renderer 共享的 wrapping 边界应在返回前消除原始 `\r`，并按 `\n` 拆分逻辑行后逐行 wrapping。bash rail rows 进入 wrapping 之前也必须满足同样约束，不能把多行文本塞进一个 row。

替代方案是让 footer 清理按 `visualLineCount()` 估算物理行。该方案只能缓解残影，不能修复 rail prefix 缺失、行内控制字符污染和 transcript destructive replay 的同类风险，因此不作为主方案。

### Decision 2: inline `-c` / `-e` 解析采取保守边界

`parseInlineScriptCommand()` 只应在能确认匹配范围属于单个 shell 逻辑行，或整个 command 本身就是一个可安全拆分的 inline script command 时生效。若匹配前后存在其他 shell 逻辑行，则 renderer 应回退为普通多行 command 渲染，逐行显示原始命令。

替代方案是写完整 shell parser，把引用、管道、续行和命令替换全部建模。该方案复杂度高且容易引入误判；当前 TUI 只需要稳定可读投影，保守回退更符合“不要丢失审计信息”的原则。

### Decision 3: tab 投影与现有 layout 规则保持一致

tool message wrapping 应使用 `tabWidthAt(currentColumn)` 计算 tab 宽度，并输出对应数量的空格，而不是把 `\t` 原样写到终端。这样可以与 composer、用户消息和普通 block renderer 的行为一致，同时保留原始 transcript/tool result 内容。

替代方案是保留 raw tab 并调整宽度估算。该方案仍依赖不同终端的 tab stop 行为，且会让 safe width 约束难以验证，因此不采用。

### Decision 4: 测试用 display width 与控制字符断言保护回归

新增测试不仅要检查可见摘要，还要断言 strip ANSI 后的每个 renderer line 不含 `\n` / `\r`，且 `displayWidth(line) <= safeRenderWidth(width)`。对 footer pending preview 也应覆盖同一命令，确保运行中状态不会生成隐藏物理行。

## Risks / Trade-offs

- [Risk] 保守禁用部分多行 command 中的 inline script compact 会让某些命令显示更长。→ Mitigation：仍按 safe width wrapping，并保留 heredoc 与单独 inline script 的紧凑预览。
- [Risk] tab 展开后用户看到的是空格而不是原始 tab。→ Mitigation：仅改变可见投影，transcript 和 tool result 原文保持不变；这与 composer/user message 现有策略一致。
- [Risk] 只修 renderer 输出约束不能覆盖所有第三方终端的宽字符差异。→ Mitigation：本次聚焦确定性的 `\n` / `\r` / `\t` 问题，继续沿用现有 `displayWidth` 和 `safeRenderWidth` 策略。
- [Risk] 对共享 wrapping 的修改可能影响 read_files、use_skill 或通用 tool fallback 的换行快照。→ Mitigation：添加针对通用 tool wrapping/tab 的最小测试，并复用现有 render 测试验证输出仍 bounded。

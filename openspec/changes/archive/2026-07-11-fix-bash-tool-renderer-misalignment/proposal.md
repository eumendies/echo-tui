## Why

bash tool renderer 在渲染运行中或完成态的多行命令时，可能因为内嵌 `node -e` / `python -c` 等脚本识别过度、行内残留换行符或制表符宽度估算不一致，导致 footer/pending preview 与 transcript rail 出现错位、残影和重复 `Bash · running` 块。

该问题会破坏终端 TUI 的基本可读性，也会让用户误以为同一个 bash 工具调用被重复执行，因此需要为 tool renderer 增加更强的物理行安全约束。

## What Changes

- 修正 bash command structure 解析边界：仅在可安全限定到单个 shell 逻辑行或明确脚本边界时压缩 `-c` / `-e` 内嵌脚本；多行 shell 命令中的普通 `node -e` / `python -c` 不得把前后 shell 行合并成一个 renderer row。
- 强化 bash/tool renderer 的行安全 invariant：任一可见渲染行不得包含原始 `\n` 或 `\r`，也不得超过 safe render width。
- 统一 tool message wrapping 中的 tab 投影：工具调用、bash rail、工具结果和 pending preview 中的制表符应按当前可见列展开为空格参与宽度计算，避免终端自动换行造成 footer 清理高度少算。
- 增加覆盖 bash pending preview、transcript call/result、内嵌脚本和 tab 文本的回归测试。
- 不改变 transcript record、tool execution result、provider continuation、session persistence 或工具执行语义。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `tool-message-rendering`: 强化 bash/tool renderer 对多行命令、内嵌脚本、行内换行和 safe render width 的布局安全要求。
- `tab-safe-terminal-rendering`: 将制表符安全投影要求扩展到 tool message、bash rail 和 pending tool preview。

## Impact

- 影响代码：`src/render/tool-message-renderers/bash.ts`、`src/render/tool-message-renderers/shared.ts`，以及使用 tool call preview 的 pending/footer 渲染路径。
- 影响测试：新增或更新 `test/render/app-renderer.test.js`、`test/render/footer.test.js` 或相关 render 测试，覆盖本次截图中的错位模式。
- 不引入新运行时依赖，不改变 CLI 参数、配置文件、工具协议或 provider 适配器接口。

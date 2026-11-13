## Why

`/model` 与 `/effort` 目前只接受无参数形式：`match` 用 `text.trimEnd() === '/model'` 精确比较，任何带参数的输入都会落到链末尾的 skill fallback，被当作普通消息或不存在的 skill 处理。用户想切换到一个已经记得名字的模型或推理等级时，必须先打开面板再用方向键选择。`/mode` 已经支持 `/mode normal` 这类直接参数，两个高频命令缺少同等能力。

## What Changes

- `/model <模型名>` SHALL 直接切换当前 session 的模型，不打开选择面板。
- `/effort <级别>` SHALL 直接设置当前 session 的 reasoning effort override，不打开 scale 面板。
- 参数匹配 SHALL 与面板展示内容保持一致：`/model` 接受面板 `label` 使用的模型名，`/effort` 接受面板 `label` 使用的 effort 值，两者均大小写不敏感。
- 无参数输入 SHALL 保持现有面板行为不变。
- 无法唯一匹配时 SHALL 显示可用的候选或合法值列表，SHALL NOT 静默取第一个候选，也 SHALL NOT 退回普通消息路径。
- 成功应用 SHALL 静默完成，SHALL NOT 插入本地 notice；footer 状态行反映新值。
- 配置不可读与保存失败 SHALL 复用两个命令现有的错误 surface。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `session-model-settings`: 新增「Model 与 effort 命令支持直接参数」requirement，规定参数匹配语义、无参数回退、歧义与错误处理。

## Impact

- 代码：`src/commands/model-command-handler.ts`、`src/commands/effort-command-handler.ts`。
- 测试：`test/commands/slash-command.test.js` 中三处「带参数不匹配」断言需反转，并补充参数成功、歧义、非法值与配置错误用例。
- 不影响：`CommandHost` 端口签名、`CommandStartResult`、现有 select/scale surface 交互、鼠标与滚轮语义、`llm.selectedModel` 与 profile 的 `reasoning.effort` 不被改写。

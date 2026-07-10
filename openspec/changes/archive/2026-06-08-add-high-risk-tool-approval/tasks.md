## 1. 风险分类模块

- [x] 1.1 新增 `tool-risk-classifier` 模块，定义风险分类结果类型、风险展示元数据和 `classifyToolCallRisk(call)` 入口。
- [x] 1.2 将 `apply_patch` 分类为始终需要授权，并保留现有简洁授权展示。
- [x] 1.3 实现 `run_bash_command` 参数解析：无法解析 JSON 或 command 非字符串时不在 classifier 中执行工具，交由现有 executor/handler 错误路径处理。
- [x] 1.4 实现 bash 高危 pattern：删除/移动/复制/权限修改、shell 写入重定向、原地编辑、find 删除、包管理安装、破坏性 git 操作和远程脚本执行。
- [x] 1.5 增加 classifier 单元测试，覆盖高危命令触发授权和 `git status`、`rg`、`npm test` 等安全命令不触发授权。

## 2. Agent loop 授权编排

- [x] 2.1 将 agent loop runtime 中的 `requiresToolApproval()` 替换为风险分类结果处理。
- [x] 2.2 对 `approval_required` 结果调用 tool approval callback，并传入风险展示元数据。
- [x] 2.3 用户允许时继续调用普通 tool executor 执行原始 tool call。
- [x] 2.4 用户拒绝时跳过普通 tool executor，并生成不包含系统风险分类原因的 `ok: false` tool result。
- [x] 2.5 保持 `ask_user_questions` interactive tool 分支优先于普通风险分类，不进入 tool approval 流程。
- [x] 2.6 增加 agent loop 单元测试，覆盖高危 bash 允许执行、拒绝不执行、安全 bash 不请求授权、apply_patch 仍请求授权。

## 3. App 授权 UI 展示

- [x] 3.1 扩展 tool approval callback/request 类型，支持可选 title、message、reasons 和 preview 等展示元数据。
- [x] 3.2 更新 `ToolApprovalContext`，将风险说明和命令预览投影到 `ChoiceCommandSurface.message` 或等价可见内容。
- [x] 3.3 保持无额外展示信息的 `apply_patch` 授权 UI 简洁，只显示工具名和 `Allow once` / `Deny`。
- [x] 3.4 增加 app 层测试，覆盖高危 bash 授权 surface 显示 command preview、风险原因、允许和 Esc 拒绝。

## 4. Specs 与验证

- [x] 4.1 更新或补充 OpenSpec 主 specs 所需 delta 内容，确保高危工具授权、bash handler 边界和 agent loop 编排语义一致。
- [x] 4.2 更新现有 tool approval、agent loop 和 tool execution 测试断言，适配风险分类后的展示和回调签名。
- [x] 4.3 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。

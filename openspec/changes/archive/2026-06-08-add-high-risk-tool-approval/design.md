## Context

当前 agent loop runtime 已经在调用普通 tool executor 之前支持两类特殊流程：`ask_user_questions` 通过 app callback 收集用户选择，`apply_patch` 通过 tool approval choice surface 请求用户允许后再执行。这个位置天然位于 provider tool call 与本地 handler 执行之间，既能保持 continuation transcript 完整，也不会让具体 tool handler 持有 TUI 状态。

现有 `run_bash_command` handler 会直接通过非交互 shell 执行模型提供的 command。bash 是通用逃逸口，模型可以通过 `rm -rf`、重定向、`sed -i`、包管理命令、破坏性 git 命令、远程脚本管道等方式修改或删除本地内容。因此需要把“是否需要用户确认”从按工具名硬编码升级成对 tool call 及其参数的风险分类。

## Goals / Non-Goals

**Goals:**

- 在 agent loop 调用普通 tool executor 之前识别高危 tool call。
- 保留 `apply_patch` 必须授权的现有语义。
- 对 `run_bash_command` 的常见高危命令模式请求用户授权。
- 授权 UI 能展示风险说明和命令预览，帮助用户判断是否允许。
- 用户拒绝时不执行工具，并生成对应 tool result 参与后续模型 continuation。
- 将风险规则集中在独立 classifier 中，避免 agent loop 塞入大量 bash pattern。

**Non-Goals:**

- 不实现完整 shell parser、shell sandbox 或系统级安全边界。
- 不保证捕获所有 shell 绕过写法，例如复杂 quoting、alias、eval、编码逃逸或脚本内部写入。
- 不实现 session 级授权、pattern 级授权或用户自定义 policy。
- 不在 bash handler 或普通 tool executor 内访问 TUI / app callback。
- 不拦截 read-only 工具的潜在信息泄露风险，例如读取敏感文件；这是单独的权限维度。

## Decisions

### 在 agent loop executor 前做风险分类

风险拦截 SHALL 放在 agent loop runtime 中、普通 `state.executor.execute(toolCall)` 之前。这样可以复用现有 tool approval callback 和 choice surface，同时避免 bash/apply_patch handler 感知 UI 状态。

替代方案：在 bash handler 中执行前弹确认。该方案会让 handler 需要访问 app callback 或 stdin 状态，破坏 provider-neutral executor/handler 边界，也会使拒绝结果与 continuation 管理分散。

### 新增独立 ToolRiskClassifier

新增 `tool-risk-classifier` 模块，提供 `classifyToolCallRisk(call)`。agent loop 只消费分类结果，不直接维护 bash 正则细节。

建议返回结构：

- `safe`：直接调用普通 executor。
- `approval_required`：请求用户授权，携带标题、说明、风险等级、原因和预览。

第一版不引入 `blocked` 执行分支。极高危命令也先走显著的 approval，避免误判导致用户无法继续；后续若要强制阻止，可在 policy change 中引入 `blocked`。

### bash 风险分类采用保守 pattern 匹配

第一版不做完整 shell AST，而是对原始 command 做保守模式识别。需要授权的模式包括：

- 文件删除/移动/复制/权限修改：`rm`、`rmdir`、`unlink`、`mv`、`cp`、`chmod`、`chown`、`truncate` 等。
- shell 写入重定向：`>`、`>>`、`2>`、`&>`、`>|`。
- 原地编辑：`sed -i`、`perl -i`、`perl -pi`。
- 删除型 find：`find ... -delete`、`find ... -exec rm`。
- 包管理安装或修改依赖：`npm install`、`npm i`、`yarn add`、`pnpm install`、`pip install`、`cargo add`、`go get`、`brew install` 等。
- 破坏性 git 操作：`git reset`、`git clean`、`git checkout --`、`git restore`、`git rebase`、`git commit`、`git push`。
- 远程脚本执行：`curl ... | sh/bash`、`wget ... | sh/bash`。

默认安全的常见观察命令包括：`pwd`、`ls`、`cat`、`head`、`tail`、`wc`、`grep`、`rg`、不含删除动作的 `find`、`git status`、`git diff`、`git log`、`npm test`、`npm run typecheck`、`node --check`。

### 扩展 ToolApprovalRequest 展示元数据

当前 approval callback 只接收 `ToolCall`，UI title 只能显示 `<toolName> needs approval`。高危 bash 需要显示命令和原因，因此应新增轻量展示元数据，例如：

- `title`
- `message`
- `reasons[]`
- `preview`

`ToolApprovalContext.request()` 接收 `call` 与可选 display metadata；`getSurface()` 将 message/reasons/preview 投影到现有 choice surface。选项仍保持 `Allow once` / `Deny`，不引入 session allow。

### 拒绝语义复用现有 tool result continuation

用户拒绝高危 bash 或 apply_patch 时，runtime SHALL 不调用 executor，并创建 `ok: false` 的 tool result。普通 `Deny` / `Esc` 只表示用户拒绝执行，tool result 不应附带系统风险分类原因，避免把 classifier 判断误表达成用户反馈。只有后续显式的用户文本反馈流程才应把用户原因回传给模型。

## Risks / Trade-offs

- [Risk] bash pattern 匹配无法覆盖所有 shell 逃逸写法。→ 明确定位为高危确认 UX，不声称安全沙箱；优先覆盖常见破坏性命令。
- [Risk] 误报导致常用命令频繁弹窗。→ 维护常见只读/验证命令 safe 行为；第一版测试覆盖 `git status`、`rg`、`npm test` 等不弹窗路径。
- [Risk] UI 信息太少，用户难以判断。→ approval request 展示 command preview 与 reasons，而不是只显示 tool name。
- [Risk] agent loop 逻辑变复杂。→ classifier 独立模块承载规则，agent loop 只编排 safe / approval_required / deny / execute。
- [Risk] 拒绝后模型反复尝试同类命令。→ 第一版避免把系统分类原因伪装成用户反馈；后续通过显式用户文本反馈、模型提示或 session policy 处理重试策略。

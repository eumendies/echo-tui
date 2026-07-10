## 1. 协议与审批 UI

- [x] 1.1 扩展 `ToolApprovalDecision` 类型，新增 bash command 级会话授权决策并保持现有决策兼容。
- [x] 1.2 在 `ToolApprovalContext` 内增加当前 CLI 进程会话级授权状态，包括 allow-all、非 bash tool name 集合和 bash command 集合。
- [x] 1.3 更新 `ToolApprovalContext` 的 option 构造，按 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny`、`Tell model what to do` 顺序展示。
- [x] 1.4 为非 bash tool 生成 `Allow <toolName> for this session` 决策，为 `run_bash_command` 生成 `Allow this command for this session` 决策。
- [x] 1.5 保持 Esc 拒绝、Deny 拒绝和 `Tell model what to do` inline 输入行为不变。

## 2. Approval Context 授权缓存

- [x] 2.1 在 `ToolApprovalContext.request()` 入口检查会话授权缓存，命中时立即返回允许执行决策且不打开 choice surface。
- [x] 2.2 在用户选择会话级 allow 后记录对应授权，并 resolve 当前 approval request 为允许执行决策。
- [x] 2.3 对 `run_bash_command` 只按解析出的 command 文本缓存和匹配授权，不把整个 bash tool name 加入 tool 级授权。
- [x] 2.4 在 agent loop runtime 的 allowed decision 判断中加入 bash command 级会话授权决策，但不在 runtime 内保存授权缓存。
- [x] 2.5 确保会话授权不写入 transcript、persisted session、用户配置或 provider-facing continuation record。

## 3. 测试覆盖

- [x] 3.1 更新 app approval surface 测试，断言新增选项、allow 分组顺序和 bash command 级 label。
- [x] 3.2 增加 app 交互测试，覆盖选择 tool 级 session allow、all-tools session allow 和 bash command session allow 后返回的结构化 decision。
- [x] 3.3 增加 `ToolApprovalContext` 测试或 app 集成测试，覆盖 allow-once 不缓存、非 bash tool session grant 第二次不打开 surface、allow-all 后不同工具不打开 surface。
- [x] 3.4 增加 `ToolApprovalContext` 测试或 app 集成测试，覆盖同一 bash command 命中会话授权、不同 bash command 仍显示审批。
- [x] 3.5 更新 choice/footer 渲染测试，确认 renderer 保留 option 顺序并能显示新增 approval 选项。

## 4. 文档与验证

- [x] 4.1 更新 `docs/README.md` 的工具授权说明，解释新增 session allow 选项和 bash command 粒度。
- [x] 4.2 更新 `docs/tui-architecture.md` 的 tool approval context 和 agent loop runtime 描述。
- [x] 4.3 运行 `npm run typecheck`。
- [x] 4.4 运行 `npm test`。
- [x] 4.5 运行 `find bin src test -name '*.js' -exec node --check {} \;`。
- [x] 4.6 手动验证 apply_patch、高风险 bash、同一 bash command 复用授权、不同 bash command 重新审批、Esc/Deny/反馈路径。

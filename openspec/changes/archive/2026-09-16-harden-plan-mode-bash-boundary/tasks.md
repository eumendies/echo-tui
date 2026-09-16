## 0. 前置修正：macOS 沙箱探针

- [x] 0.1 探针目标二进制由 `/bin/true`（macOS 不存在）改为 `/usr/bin/true`，并导出常量供测试复用
- [x] 0.2 `test/sandbox/seatbelt-execution.test.js` 复用导出常量，真实执行用例不再静默 skip
- [x] 0.3 回归守卫：断言探针目标为绝对路径且在 darwin 上存在
- [x] 0.4 试运行失败的降级原因不再断言单一原因

## 1. plan 运行沙箱收紧派生

- [x] 1.1 `runAgentLoop` 在初始化前派生 plan 运行的 `read-only` 收紧（default 工具策略；显式声明优先），并同时用于 registry 包装、transient 注记、生效边界判定和 subagent port
- [x] 1.2 确认 `off`、headless `full-access` 豁免与声明 readonly 工具策略的运行（BTW）不参与派生
- [x] 1.3 `/status` 在 plan interaction mode 下按收紧后的 `read-only` 档位与禁网状态展示，`off` 与不可用降级原因保持既有语义

## 2. 分层分类与 Worker 继承

- [x] 2.1 `classifyToolCallRisk` 增加 bash 沙箱生效参数，plan 分支据此放行任意 bash；normal 分支行为不变
- [x] 2.2 主 loop 计算 plan 生效布尔并传入分类；fallback 保持严格白名单与既有拒绝文案
- [x] 2.3 subagent loop 用同一 resolver 计算生效布尔并传入 general Worker 分类，继承父运行收紧
- [x] 2.4 确认 plan 的写入型工具与 MCP 拒绝、只读子代理的审批路径不受影响

## 3. undo 失效豁免

- [x] 3.1 `executeBashCommand` 在生效只读沙箱内跳过 `changeRecorder.invalidate`（判定与 runner 包装同源）
- [x] 3.2 workspace-write 或沙箱不可用时保持既有文本失效语义

## 4. 文案与文档

- [x] 4.1 更新 plan mode 模型可见约束说明，描述沙箱/allowlist 分层边界
- [x] 4.2 `docs/tui-architecture.md` 同步 plan bash 边界、收紧派生与 undo 失效语义

## 5. 测试

- [x] 5.1 分类器：plan + 沙箱生效 → 任意 bash safe；plan + 未生效 → 白名单外 rejected；normal 不受影响
- [x] 5.2 主 loop：plan 运行向 `prepareAgent`/subagent port 传递派生的 `read-only` 收紧；沙箱生效时白名单外命令无审批执行，未生效时拒绝
- [x] 5.3 子 loop：plan Worker 继承收紧并在两分支表现与主 Agent 一致
- [x] 5.4 bash handler：只读沙箱上下文跳过失效；workspace-write / 不可用保持失效
- [x] 5.5 `/status` 在 plan mode 展示收紧后的档位与降级原因；文案断言更新

## 6. 验证

- [x] 6.1 `npm run typecheck`
- [x] 6.2 `npm test`
- [x] 6.3 `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 6.4 `openspec validate harden-plan-mode-bash-boundary --strict`
- [ ] 6.5 交互式手工验证：plan 模式沙箱生效/不可用两分支、plan Worker、`/status` 与 undo 可用性

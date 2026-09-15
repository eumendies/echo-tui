## 1. macOS 试运行探测与降级

- [x] 1.1 `macos-seatbelt` 增加最小 profile 试运行探测（5s 超时、实例内缓存），`isAvailable`/`wrapCommand` 使用探测结果
- [x] 1.2 `describeUnavailable` 区分"二进制缺失"与"试运行失败"两类降级原因
- [x] 1.3 规范 seatbelt provider 测试：试运行成功、试运行失败、缓存复用三个分支

## 2. 运行级收紧与边界判定

- [x] 2.1 `SandboxModeOverride` 类型与 `resolveEffectiveSandbox` 的 `modeOverride` 支持（仅非 `off`、非 full-access 时收紧为 `read-only` 且恒禁网）
- [x] 2.2 新增 `isReadonlyBashSandboxEffective`（provider 可用 且 生效档位为 `read-only`）
- [x] 2.3 `tool-registry`/`agent-setup` 透传 `sandboxModeOverride` 到 bash 包装与 transient 注记

## 3. 分类器与主 loop 豁免

- [x] 3.1 `classifyReadonlyToolCall(call, names, bashSandboxed)` 增加沙箱生效分支：任意 bash 返回 `safe`，否则维持严格白名单
- [x] 3.2 主 loop 在 `readonlyBashSandboxed` 时跳过文本风险分类与审批，命令直接进入 executor
- [x] 3.3 只读运行的 `run_subagent` 仅允许 readonly 执行策略目标，拒绝文案独立

## 4. 子代理边界继承

- [x] 4.1 `toolPolicy` 与 `sandboxModeOverride` 透传到子 loop 与子 registry
- [x] 4.2 只读父 run 下非 general 子代理改用 fail-closed 只读分类（无审批路径）
- [x] 4.3 default 父 run 的"未知 Bash 人工升级"行为保持不变

## 5. 文案与 notice

- [x] 5.1 `/review` workflow 声明 `toolPolicy: readonly` 与 `sandboxModeOverride: 'read-only'`，启动时追加本地只读 notice
- [x] 5.2 `/review` prompt 改写为描述内核边界（沙箱内任意 shell、无沙箱时严格 allowlist、不尝试测试/构建）

## 6. 测试与验证

- [x] 6.1 sandbox provider 两分支（可用与试运行失败）、判定函数、分类器、主 loop、子代理与 notice/prompt 文案用例
- [x] 6.2 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 通过
- [x] 6.3 `docs/tui-architecture.md` 的 agent workflow、Bash 沙箱与子代理边界描述同步

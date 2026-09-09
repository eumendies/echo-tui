## 1. 类型与配置

- [x] 1.1 在 `src/types/agent.ts` 定义 `SandboxToolConfig`(mode/network/extraWritablePaths)与沙箱协议类型,并把 `sandbox` 加入 `ToolRuntimeConfig`
- [x] 1.2 在 `src/config/llm-config.ts` 的 `parseToolRuntimeConfig` 中解析校验 `tools.sandbox`,默认值 `workspace-write`/`network: true`,非法档位抛 `LlmConfigError`
- [x] 1.3 在 `test/config/llm-config.test.js` 补充解析用例:默认值、显式各档位、network 开关、extraWritablePaths 校验、非法 mode 报错

## 2. 沙箱模块

- [x] 2.1 新增 `src/sandbox/types.ts`:`SandboxMode`、`SandboxPolicy`、`SandboxProvider`(wrapCommand 协议)及字段中文注释
- [x] 2.2 新增 `src/sandbox/macos-seatbelt.ts`:Seatbelt profile 生成纯函数(deny default + 定向 allow、可写集合、network 分支、scheme 字符串转义)
- [x] 2.3 在 profile 生成中实现可写路径 realpath 归一化(cwd/TMPDIR/extraWritablePaths)并内置 `~/.echo/agent-memory`、`/private/tmp`、`/dev/null`
- [x] 2.4 实现 Seatbelt provider:`/usr/bin/sandbox-exec` 可用性探测、`wrapCommand` 生成 `['/usr/bin/sandbox-exec', '-p', profile, shell, '-lc', command]`、不可用返回 null
- [x] 2.5 新增 `src/sandbox/provider.ts`:`resolveSandboxProvider(platform, availability)`,darwin → Seatbelt,其他平台 → null
- [x] 2.6 新增 `test/sandbox/` 纯函数测试:profile 文本(三档位、network 变体、路径转义、symlink 归一化)、平台解析、可用性降级

## 3. 执行链路与装配穿线

- [x] 3.1 `src/tools/bash-command-runner.ts` 增加 `sandbox` 选项:存在且 provider 可用时包装 spawn argv,timeout/abort/进程组 kill/输出捕获逻辑不变
- [x] 3.2 `src/tools/bash-tool-handler.ts` 与 `src/tools/tool-registry.ts` 接收并构建沙箱上下文:`mode: 'off'`、非 darwin、provider 不可用、headless full-access 时不包装
- [x] 3.3 `src/agent/agent-setup.ts`、`src/agent/loop-runtime/agent-loop-runtime.ts` 与 `subagent-loop-runtime.ts` 穿线 `executionMode` 到 `prepareAgent`/`createDefaultToolRegistry`,未传处默认按 interactive
- [x] 3.4 确认用户 shell 模式(`src/app/main.ts` 直调 `runBashCommand`)不传沙箱参数,行为不变
- [x] 3.5 在内置 transient 系统上下文中追加沙箱边界说明(生效档位 + 网络状态),不产生 transcript 记录

## 4. 可观测性

- [x] 4.1 在 `/status` 的 snapshot 与 surface 中展示沙箱状态:档位、网络、实现标识,provider 不可用时展示不可用状态
- [x] 4.2 在 `test/commands/` 或对应渲染测试中补 `/status` 沙箱行展示用例

## 5. 集成测试与回归

- [x] 5.1 新增 darwin-gated 集成测试(`test/sandbox/`):workspace-write 写工作区成功/写 `$HOME` 被拒、read-only 仅临时目录可写且恒禁网、network off 断网、Esc 中断与 timeout 语义不变;非 darwin skip
- [x] 5.2 `test/cli/one-shot.test.js` 补充:默认 deny 下命令被包装、`--full-access` 下不包装(one-shot 注入 runAgent 不适合真实包装断言;语义覆盖位于 `test/sandbox/provider.test.js` 与 `test/sandbox/seatbelt-execution.test.js` 的 registry 级用例)
- [x] 5.3 审计既有 bash 相关测试与 `LlmConfig` fixture:显式补 `tools.sandbox`,需要脱离沙箱的用例显式 `mode: 'off'`
- [x] 5.4 手动验证:agent-memory skill 在默认沙箱下可写入 `~/.echo/agent-memory`;`/status` 沙箱行;`/mode shell` 不受沙箱影响

## 6. 收尾

- [x] 6.1 运行完整验证:`npm run typecheck` → `npm test` → `find bin src test scripts -name '*.js' -exec node --check {} \;`
- [x] 6.2 更新 `docs/tui-architecture.md` 沙箱小节与 `ROADMAP.md` Feature 标记

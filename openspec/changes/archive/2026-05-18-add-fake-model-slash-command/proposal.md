## Why

现有 slash 命令运行时已经把命令路由、会话状态、surface 渲染和 effect interpreter 拆开，但目前只有 `/help` 能验证该架构。新增一个 fake 的 `/model` 命令可以用最小业务风险检验选择型命令的扩展路径，并为后续接入真实模型切换打下契约基础。

## What Changes

- 新增本地 slash 命令 `/model`，命中纯 `/model` 输入时打开模型选择 surface。
- 模型候选项先写死在 handler 内，不接入真实模型服务、不持久化用户选择。
- 用户可通过方向键在候选项中移动，Enter 确认选择，Esc 关闭选择界面。
- 确认选择后向 transcript 追加一条本地 assistant 提示，说明当前 fake model 选择结果。
- 保持未命中 slash 命令的普通消息路径不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 在既有 slash 命令运行时能力下增加 fake `/model` 选择命令及其交互契约。

## Impact

- 影响 `src/commands/`：新增 `/model` handler，并注册到 slash resolver。
- 影响 `src/app/main.js`：复用现有 command session/effect interpreter，必要时补齐选择事件到 effect 的映射。
- 影响 `src/render/footer.js`：复用现有 `select` command surface，不新增 renderer 对具体命令名的认知。
- 影响测试：补充命令解析、app orchestration、footer select surface 的覆盖。
- 不引入第三方依赖，不改变 CLI 启动方式。

## Why

目前响应期间提交的普通消息只能等待整个 assistant turn 结束，用户发现方向偏差时必须等待或手动取消任务。增加可选的即时引导策略，让补充指令尽快进入当前 agent loop，同时保留默认排队行为和正在执行工具的安全边界。

## What Changes

- 在 `/config` → 常规增加“响应期间发送消息”，提供“排队”和“即时引导”，持久化为 `ui.activeTurnMessagePolicy: pending | steer`，默认 `pending`。
- 每个主 assistant turn 固定使用启动时的策略；配置保存或 watcher 刷新只影响后续 turn，不重新解释已有待处理消息。
- 即时引导只针对普通用户消息：素材准备成功后抢占当前模型请求、响应流或重试等待，在同一个 turn 内继续请求模型。
- 普通 user record 使用提交时选择的 mode，同轮 normal/plan 切换不另行排队；后续运行约束在消息应用边界同步更新。
- 工具已启动时等待当前调用或已启动并行组安全收尾；跳过尚未启动的调用并补齐协议要求的工具结果，随后加入新指令。
- 区分请求级抢占和 Esc 的 turn 级取消，保留审批、提问、slash command、skill、shell 和自动压缩的既有边界。
- 被引导中止的已输出正文与 Esc 对齐，保存为普通 assistant 记录并进入后续上下文，不增加未完成标记；可读推理仅本地保留，未完成私有记录和工具参数不保留。
- 使用共享有界单槽、请求级回调隔离和唯一消息提交边界，避免覆盖草稿、重复发送、悬空工具调用与最终响应竞态。
- 第一版不实现 code-mode、工具后台运行、强制终止工具或对子代理广播引导。

## Capabilities

### New Capabilities

- `active-turn-steering`: 定义即时引导的消息接收、安全抢占、同轮 continuation、记录一致性、交互状态和竞态处理。

### Modified Capabilities

- `pending-message`: 将现有排队行为限定为 pending 策略或必须保留下一轮路由的输入，并与即时引导共享有界容量。
- `config-surface-settings`: 增加消息策略的草稿编辑、归一化、持久化及下一轮生效规则。

## Impact

- 提交与状态：`src/app/composer-submission-controller.ts`、`src/app/state/pending-message-context.ts`、`src/app/state/turn-context.ts`、主运行生命周期和用户消息预处理。
- Agent 协议与执行：`src/types/agent.ts`、`src/agent/loop-runtime/agent-loop-runtime.ts`、OpenAI Responses / OpenAI Chat / Anthropic adapters，以及必要的 transcript 转换和工具结果构造。
- 配置与显示：`src/config/app-settings-config.ts`、用户配置 snapshot、配置中心常规页面和 footer 消息卡片投影。
- 验证：配置、提交控制器、agent loop、provider 流取消、工具配对、持久化恢复和交互回归测试。
- 不增加第三方依赖，不改变 headless `--once` 输入契约，不切换 terminal alternate screen；本变更当前仅创建规范产物，不实施代码。

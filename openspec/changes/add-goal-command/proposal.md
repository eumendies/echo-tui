## Why

echo-tui 目前没有「常驻目标」机制：迁移、批量修复、长重构这类跨越多个回合的任务，需要用户在每轮模型回答结束后自行判断是否真正完成，并反复手动输入「继续」。Claude Code 与 Codex CLI 均已提供 `/goal`：用户声明一个可度量的完成条件，由与干活的模型分离的独立评估者判定是否达成，未达成则自动推进下一回合。本变更把该模式引入 echo-tui，复用现有命令系统、会话状态持久化与独立模型判断（自动工具审批）的成熟接缝。

## What Changes

- 新增 `/goal` slash command：
  - `/goal <condition>`：设置常驻目标（替换旧目标；空闲时立即开始第一个推进回合）
  - 裸 `/goal`：状态卡（条件、状态、已完成推进回合数、耗时、最近评估理由与操作提示）
  - `/goal pause|resume|clear`（`stop`/`off`/`reset`/`cancel` 为 clear 别名）
- `goalState` 作为 session 状态通过 journal 持久化（新增 `set_goal_state` 操作，对齐 `todoState` 模式）：`/clear` 清除、`/fork` 继承、`/resume` 恢复条件但置为 `paused` 并重置运行时基线
- 新增独立 goal 评估器：复刻自动工具审批的独立模型判断模式（严格解析专用 model profile、无工具 provider agent、组合超时、失败关闭、usage 记账），每回合完成后基于 transcript 中的有界证据投影判定 yes/no + 理由
- 自动续跑：goal `active` 时，主会话每个成功完成的回合结束后触发评估；未达成且未达 `maxTurns`（默认 20）时，通过独立入口自动开始下一个推进回合（不占用 pending 单槽）；用户 pending 消息或 command session 占用时让位等待
- 边界与安全：Esc 中断推进回合 → 目标自动暂停，需 `/goal resume`；评估超时、解析失败或回合失败 → 暂停并给出 local notice；`revision` 隔离迟到评估结果
- goal 上下文注入：`goalState` 按 `todoState` 同类方式作为 transient suffix 注入 provider records，使每个回合的模型保持定向
- 展示：设置/评估/完成/暂停均写入 local notice；footer 状态行新增 goal 徽标（状态 + 回合进度）；`/status` 面板新增 goal 摘要行
- 配置：`/config` 常规 Tab 新增 goal 评估模型设置（`goal.evaluationModelProfileId`，交互模式对齐工具审批模型设置）；未配置有效评估模型时 `/goal <condition>` 拒绝并提示
- headless `--once` 路径不接入 goal 循环

## Capabilities

### New Capabilities

- `goal-command`: `/goal` 命令语法与生命周期、goalState 会话状态与 journal 持久化、状态卡、footer 徽标与 `/status` 摘要、resume/fork/clear 边界语义
- `goal-auto-continuation`: 独立评估器（有界证据投影、严格判定协议、超时与失败关闭）、自动续跑循环（让位规则、maxTurns 边界、Esc 暂停、revision 隔离）、goal 的 provider records 注入

### Modified Capabilities

- `transcript-journal-persistence`: 会话状态操作清单新增 `set_goal_state`，replay 恢复 goalState
- `config-surface-settings`: 新增 goal 评估模型设置行与落盘字段
- `status-command`: 新增 goal 摘要行展示
- `session-fork-command`: 分叉会话快照包含 goal state，分叉继承后两分支独立演进

## Impact

- 代码（新增）：`src/types/goal.ts`、`src/commands/goal-command-handler.ts`、`src/app/goal/`（goal-controller、evaluator、evaluation-projection）、`src/app/command/goal-command-port.ts`
- 代码（修改）：`src/persistence/transcript-journal.ts`、`src/app/state/transcript-context.ts`、`src/app/state/app-context.ts`、`src/types/agent.ts`、`src/agent/loop-runtime/shared.ts`、`src/app/assistant-turn-runner.ts`、`src/app/main.ts`、`src/types/command.ts`、`src/app/command/command-host.ts`、`src/commands/resolve-slash-command.ts`、`src/config/app-settings-config.ts`、配置面板 handler/renderer、`src/types/render.ts`、`src/app/state/render-context.ts`、`src/render/footer/`、`src/app/command/status-command-ports.ts`
- 运行行为：goal active 时在用户不干预下自动连续消耗模型请求；由 `maxTurns`、评估失败关闭和 Esc 暂停兜底
- 兼容性：无 breaking change；未设置 goal 时所有现有行为不变；旧 journal 无 `set_goal_state` 时使用空目标
- 测试：命令解析、controller 边界（fake evaluator 注入）、评估器协议与失败关闭、journal 往返、app context 装载/清除/fork

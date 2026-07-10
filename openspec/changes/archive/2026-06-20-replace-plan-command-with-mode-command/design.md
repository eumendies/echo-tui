## Context

当前运行态使用 `InteractionMode = normal | plan | shell`，并额外用 `ShellContextPolicy = included | local` 区分 shell 输出是否进入模型上下文。用户实际感知到的是四种模式：normal、plan、shell、shell-local。Tab 已经按四态循环，但 slash 命令仍是 `/plan`，只能覆盖 normal/plan 两态。

为了避免新增一套 `AppMode` 与 `InteractionMode` 并存，本次设计直接把 `InteractionMode` 扩展为四态，让 mode 概念在 app、command、render 和 agent session 之间保持一致。

## Goals / Non-Goals

**Goals:**

- 将 `InteractionMode` 扩展为 `normal | plan | shell | shell-local` 四态。
- 用 `/mode` 替换 `/plan`，统一支持四种 interaction mode。
- `/mode` 无参数打开选择 surface，`/mode <mode>` 支持直接切换。
- 保持 Tab 四态循环行为不变。
- 更新 plan mode prompt 和测试中对 `/plan` 的引用。

**Non-Goals:**

- 不新增独立 `AppMode` 类型或 app mode facade。
- 不保留 `/plan` 兼容 alias；本次是替换而不是新增同义命令。
- 不改变四种模式的实际语义：plan 仍只读；shell 执行 bash 并进上下文；shell-local 执行 bash 但不进入模型上下文。

## Decisions

### Decision 1: InteractionMode 扩展为四态

将 `InteractionMode` 改为：

```ts
type InteractionMode = 'normal' | 'plan' | 'shell' | 'shell-local';
```

`shell` 表示 shell 命令结果进入模型上下文；`shell-local` 表示 shell 命令结果仅本地显示。这样 `/mode`、Tab 循环、status line 和 agent session 都可以围绕同一个 mode 类型表达。

理由：四态是用户真实心智模型，直接扩展 `InteractionMode` 比新增 `AppMode` 再映射更直观，避免 mode 类型重复。

备选方案：保留三态 `InteractionMode` 并新增 `AppMode` 映射层。该方案改动面较小，但会形成两套 mode 概念，命令层还需要理解映射关系，不够直接。

### Decision 2: 删除独立 ShellContextPolicy 状态

`shell-local` 成为 `InteractionMode` 的一员后，AppContext 不再需要持有独立 `shellContextPolicy`。需要判断是否执行 shell 时使用 helper，例如 `isShellInteractionMode(mode)`；需要判断是否进入模型上下文时使用 `mode === 'shell'`。

理由：上下文策略已经由 `shell` / `shell-local` 名称表达，继续保留 `ShellContextPolicy` 会重新引入重复状态和同步风险。

### Decision 3: `/mode` 直接操作 InteractionMode

CommandHost 的 mode facade 保持围绕 `InteractionMode`，`ModeCommandHandler` 直接读取和设置四态 `InteractionMode`。`/mode` 无参数打开 select surface；`/mode normal`、`/mode plan`、`/mode shell`、`/mode shell-local` 直接切换；非法参数打开 usage info surface。

理由：slash command 是 mode 的用户入口，直接使用四态 `InteractionMode` 能减少转换函数和中间类型。

### Decision 4: 删除 `/plan` 而非隐藏兼容

默认 slash command handlers 不再注册 `PlanCommandHandler`，并删除相关实现和测试预期。旧的 `/plan` 输入不再作为本地命令处理。

理由：用户明确希望替换 `/plan`；保留隐藏 alias 会让帮助、提示、测试和模型指引出现双入口心智负担。

## Risks / Trade-offs

- [Risk] `shell` 判断点需要改为同时识别 `shell` 和 `shell-local` → Mitigation：引入小型 helper 或集中判断，覆盖 shell 提交、状态栏、placeholder 和 transcript 投影测试。
- [Risk] agent/tool 层不需要区分 shell-local，但会收到四态类型 → Mitigation：agent loop 中只有 plan 需要特殊 registry/prompt；其他 mode 继续按 normal/default 工具边界处理。
- [Risk] 老用户输入 `/plan` 不再生效 → Mitigation：help、slash suggestions、plan mode prompt 全部更新为 `/mode`，让新入口可发现。
- [Risk] 测试中 `/plan` 分布较广 → Mitigation：集中更新 slash command、app main、system prompt 和 suggestions 相关测试，确保不遗留 `/plan` 外部入口。

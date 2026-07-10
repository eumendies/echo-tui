## Context

当前命令链路的状态边界是：`main.js` 创建 `AppContext`，command runtime 通过 `getContext()` 回调调用 `AppContext.createCommandContext()`，再把生成的聚合对象传给所有 handler。这个设计在命令数量较少时简单，但现在 `/model` 需要模型信息、`/resume` 需要 session metadata，未来新增命令会继续把字段塞进同一个 command context。

问题不在于 handler 返回 effect 的协议，而在于“读取依赖”被集中到 runtime 的通用上下文里：新增 handler 不仅要改自身，还要改 AppContext 的聚合方法；阅读 handler 时也无法从构造点看出它到底依赖哪些 app 状态。

目标架构应保持现有命令执行边界：runtime 仍负责 slash 路由、active command session、事件分发和 effect interpreter；handler 仍然只声明动作并返回 effect。变化集中在 handler 读取依赖的来源，以及 AppContext 内部状态组织方式。

```txt
当前：

AppContext.createCommandContext()
  ├─ composerText
  ├─ responding
  ├─ inputHistory
  ├─ modelCommandInfo
  └─ resumeSessions
        │
        ▼
command runtime ── start(text) / handleEvent(session, event) ──▶ 任意 handler

目标：

AppContext
  ├─ ComposerContext      src/app/composer-context.js
  ├─ TranscriptContext    src/app/transcript-context.js
  ├─ ModelContext         src/app/model-context.js
  ├─ TurnContext          src/app/turn-context.js
  └─ RenderContext        src/app/render-context.js
        │
        ▼
createDefaultSlashCommandHandlers(appContext)
  ├─ new HelpCommandHandler()
  ├─ new ModelCommandHandler({ modelContext })
  ├─ new ClearCommandHandler()
  └─ new ResumeCommandHandler({ transcriptContext })
        │
        ▼
command runtime ── start/handleEvent ──▶ matched handler
```

## Goals / Non-Goals

**Goals:**

- 让每个 handler 的读取依赖在注册点和构造函数中显式可见。
- 将 AppContext 拆成职责清晰的语义子 context，并把每个子 context 落到独立文件、独立 class，同时保留 AppContext 作为单个 app 实例的组合根。
- 移除 command runtime 对 app 业务大 context 的依赖，避免 runtime 成为所有命令数据的中转站。
- 保持 handler 返回 effect、runtime 解释 effect 的写入边界不变。
- 保持 `/help`、`/model`、`/clear`、`/resume` 的用户可见行为不变。

**Non-Goals:**

- 不新增新的 slash 命令。
- 不把 handler 改成直接操作 renderer、terminal、transcript store 或 composer 状态的命令式服务。
- 不引入第三方 DI 容器、事件总线或 TUI 框架。
- 不进行完整 TypeScript 迁移；继续使用 CommonJS + JSDoc/checkJs 风格约束。
- 不改变 transcript 持久化格式、LLM adapter 行为或 footer surface schema。
- 不再新增基于对象字面量/闭包返回值的“函数式 context”实现；context 统一采用 class 组织。

## Decisions

### 1. AppContext 保持组合根，但内部拆成独立文件的 class context

AppContext 继续由 `createApp()` 每次实例化，但只负责组合各语义 context class，不再自己保存 composer、transcript records、session 指针、response lock、pending、spinner、输入历史或渲染列宽等运行态。长期共享状态按语义拆分为多个独立 class，并分别放到独立文件，例如：

- `ComposerContext`：持有 composer 对象、输入历史和历史浏览索引，并提供文本读取、reset、历史浏览相关操作。
- `TranscriptContext`：持有 transcript records、current session 指针和 transcript store，并提供持久化、列出可恢复 session、加载 session、清空 transcript。
- `ModelContext`：持有模型信息读取能力，负责从默认 LLM 配置读取当前模型命令信息并做敏感信息脱敏。
- `TurnContext`：持有 assistant response lock、pending preview、spinner 状态，并编排用户/assistant turn 生命周期。
- `RenderContext`：持有 terminal 与上次渲染列宽，并提供 banner/render state 派生。

理由：用户希望彻底摆脱当前这类对象字面量/闭包风格的 context 组织方式，并且状态既然已经按语义拆分，就应该由对应子 context 自己管理，不能继续在 AppContext 中重复保存。独立文件 + class 让每个 context 的职责、构造依赖、状态所有权和公开方法都更直接，也更符合当前重构目标。

替代方案：继续让 AppContext 保存所有状态，再把引用传给子 context。这个方案虽然改动更小，但状态所有权仍然集中在 AppContext，子 context 只是包装层，不符合“AppContext 负责组合、子 context 管理状态”的目标。

### 2. handler 构造期接收最小 class context，而不是完整 AppContext

handler 升级为可实例化类，构造函数接收自身需要的子 context 或纯配置。例如：

```js
new ModelCommandHandler({ modelContext })
new ResumeCommandHandler({ transcriptContext })
new ClearCommandHandler()
new HelpCommandHandler()
```

理由：如果每个 handler 都接收完整 AppContext，可读性问题只是从 `createCommandContext()` 移到 handler 内部；构造期最小依赖能让新增命令的依赖在注册处一眼可见。

替代方案：保留 object singleton，并继续让 handler 在启动阶段读取通用 context。这个方案实现改动最小，但无法解决聚合上下文继续膨胀的问题。

### 3. 新增默认 handler 注册入口，集中装配 class context 依赖

在 `resolve-slash-command.js` 中提供 `createDefaultSlashCommandHandlers(appContext)` 注册入口，由它创建默认 handler 实例并返回数组给 resolver/runtime 使用。`resolveSlashCommand(text, handlers)` 仍保持简单顺序匹配。

理由：注册入口是“命令依赖图”的可读位置。新增命令只需新增 handler 文件并在注册入口显式接线，不需要改 runtime 的上下文构造逻辑。

替代方案：让 `resolve-slash-command.js` 直接 import AppContext 或在模块加载时创建 handler。这个方案会引入模块级状态或反向依赖，不适合测试和多 app 实例。

### 4. runtime 只保留命令运行态，不再拼装 app 业务上下文

command runtime 继续持有 `activeCommandSession`，但不再保留额外的 session config，也不再通过 `getContext()` 从 AppContext 拉取 `modelCommandInfo`、`resumeSessions` 等业务数据。

理由：runtime 的职责是“执行命令协议”，不是“知道所有命令可能需要的 app 数据”。业务读取依赖应由 handler 自己通过构造期依赖完成。

替代方案：把 `getContext()` 改成懒 getter map，例如 `{ getModelInfo, listResumeSessions }`。这能减少 eager 计算，但 runtime 仍然承担聚合所有命令依赖的职责，扩展性改善有限。

### 5. 写操作继续通过 effect interpreter 落地

即使 handler 拿到了 `transcriptContext`，也只允许读取命令启动所需的数据，例如 `/resume` 列出 metadata。清空 transcript、加载 session、重置 composer、追加 transcript record 等写操作仍然返回 effect，由 runtime 解释并调用 app/main 或 AppContext 的操作落地。

理由：这保留了当前命令行为的声明式边界，避免 handler 直接驱动 renderer 或绕开 runtime session 生命周期。

替代方案：让 handler 直接调用子 context 的写方法。这个方案会让单个命令实现更短，但会破坏统一 effect interpreter，也会让测试和渲染同步更难维护。

## Risks / Trade-offs

- [Risk] context 全部改成独立 class 文件后，文件数量会增加 → Mitigation：只为已有真实职责创建 class；避免再包一层无意义 facade 或空壳 manager。
- [Risk] AppContext 保留太多 getter/setter 门面后可能再次像状态容器 → Mitigation：只保留 `main.js` 顶层编排需要的少量门面；新增状态必须落到对应 context class，AppContext 不重复保存子 context 状态。
- [Risk] 类化 handler 和 class context 同时推进，迁移面变大 → Mitigation：先落独立 context class，再把 handler 构造依赖切到这些 class，最后收紧 runtime 和更新文档。
- [Risk] handler 拿到子 context 后可能绕开 effect 执行写操作 → Mitigation：在 spec、JSDoc 和测试中明确 handler 写入必须返回 effect；注入给 handler 的子 context 优先提供只读读取方法。
- [Risk] 迁移期间测试需要同时适配旧 AppContext 内联实现和新独立 class 文件 → Mitigation：重构完成后直接删除旧内联 context 路径，不保留长期双轨。
- [Risk] runtime 不再提供大 context 后，测试和 handler 可能残留旧的第三参数调用 → Mitigation：handler 协议统一收敛为 `handleEvent(session, event)`，命令会话内部状态放在 session data / surface 中表达。

## Migration Plan

1. 新建 `ComposerContext`、`TranscriptContext`、`ModelContext`、`TurnContext`、`RenderContext` 独立文件，并把现有职责迁移到这些 class。
2. 让 `AppContext` 只作为组合根，在构造函数里实例化并持有这些 class context；运行态字段由子 context 自己持有。
3. 为默认 slash commands 新增 handler 注册入口，让 handler 直接依赖对应 class context。
4. 将 `/help`、`/model`、`/clear`、`/resume` handler 迁移为类实例，构造期注入最小依赖。
5. 调整 command runtime，移除 `getContext()` 聚合业务上下文，并删除未使用的 session config 传递能力。
6. 删除 `AppContext.createCommandContext()` 和内联 context 实现，避免旧风格继续残留。
7. 更新测试和 `docs/tui-architecture.md`，并运行 `npm test` 与批量 `node --check`。

如果迁移中出现回归，可以先保留注册入口和实例 handler，同时临时保留旧 `createCommandContext()` 作为过渡；最终交付前应删除未使用的旧路径，避免双重协议长期共存。

## Open Questions

- `handleEvent(session, event)` 不再接收 runtime context；`start(text)` 也不接收未使用的 runtime context。
- 各个 context class 是否全部放在 `src/app/` 根目录，还是拆到 `src/app/context/` 子目录？当前先保持在 `src/app/` 下，减少路径变更和无收益目录层级。

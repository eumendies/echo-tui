## Context

当前 `src/app/main.ts` 是 TUI app 的生产装配入口，同时包含渲染闭包、输入路由、assistant turn 回调翻译、shell mode 执行、MCP bootstrap 和退出清理。`src/app/` 下已有多个语义模块，但全部平铺：context、command runtime/host、tool approval、user question 与 main 处于同级，目录结构没有体现职责分组。

这次重构的重点不是扩大抽象层，而是让主流程更容易扫读，并让 app 内部文件按粗粒度职责归类。用户已经明确反馈过“不希望拆得太细太杂”，因此设计必须克制：优先搬走 `main.ts` 中最重、最独立的 assistant turn 生命周期，其他与主流程强耦合的逻辑保留在 `main.ts`。

## Goals / Non-Goals

**Goals:**

- 让 `main.ts` 继续作为 app composition root，但明显降低单文件复杂度。
- 将 assistant turn 生命周期抽成一个粗粒度模块，集中管理 `runAgent` callbacks 到 AppContext/render 的翻译。
- 将 `src/app/` 文件归入少量职责子目录，同时让单个 assistant turn runner 作为 `main.ts` 的同级模块保留在 `src/app/` 根下。
- 保持现有行为不变：输入优先级、slash command、tool approval、ask_user_questions、shell mode、MCP bootstrap、resize recovery、响应中断和 transcript 追加语义都不改变。
- 保持此前清理出的装配入口简洁性，不新增测试专用 `options` / `dependencies` 参数。

**Non-Goals:**

- 不重写 AppContext、TurnContext、CommandRuntime 或 renderer 的领域模型。
- 不把 render coordinator、surface priority、shell controller、input router 全部拆成独立小文件。
- 不合并 `src/commands/` 与 `src/app/commands/` 的职责；前者仍是 slash command handler，后者只承载 app 内部 command runtime/host。
- 不引入新的 TUI 框架、构建工具或第三方依赖。
- 不改变 public CLI 入口或用户配置格式。

## Decisions

### 1. 只从 `main.ts` 抽出 assistant turn runner

`submitComposer()` 里最重的部分是普通 assistant turn：`beginUserTurn`、`beginAssistantTurn`、`runAgent` callbacks、streaming pending、tool call/result、complete、abort/error 收尾。它有清晰的业务边界，可以作为一次 assistant 响应生命周期整体移动。

替代方案是拆出 render coordinator、surface stack、shell controller 和 input router。这个方案会制造更多文件和回调对象，还会把一条按键路径分散到多处，不符合“不要拆太细”的约束。因此本次只新增粗粒度 runner，保留 shell、输入路由、MCP bootstrap 和 render 协调在 `main.ts`。

### 2. app 子目录按粗职责归类，而不是按单个函数拆分

目标目录建议为：

```text
src/app/
  main.ts
  state/
    app-context.ts
    composer-context.ts
    model-context.ts
    render-context.ts
    slash-suggestion-context.ts
    tool-approval-context.ts
    transcript-context.ts
    turn-context.ts
    user-question-context.ts
  command/
    command-host.ts
    command-runtime.ts
  assistant-turn-runner.ts
```

归类标准：

- `state/`：长期 app 状态、语义 context，以及 tool approval / user question 这类会占用 footer surface 的交互状态 context。
- `command/`：app 内部 slash command runtime 与受控 host facade。
- `assistant-turn-runner.ts`：单个 assistant turn 流程模块，直接放在 `src/app/` 根下；不为了一个文件单独创建 lifecycle 目录，也不为了对称强行添加 shell runner。

### 3. `main.ts` 仍保留主流程强耦合逻辑

渲染闭包依赖 renderer、terminal、AppContext、command runtime、tool approval、user question 和 MCP diagnostic surface；输入路由表达 TUI surface 优先级；shell mode 与 Esc 中断路径直接相关。这些逻辑留在 `main.ts` 更便于理解完整主流程，避免出现大 options bag 或跨文件跳转。

### 4. 路径迁移以 import 更新为主，不改变 runtime contract

移动文件后更新源码和测试 import/require 路径。由于项目使用 TypeScript 编译到 CommonJS，源码目录变化会反映到 `dist/`，但不改变 `bin/echo-tui.ts`、CLI 行为或配置读写。测试应适配新的生产结构，不为兼容旧路径增加 re-export shim，除非发现外部公开 API 明确依赖旧路径。

## Risks / Trade-offs

- [Risk] 目录迁移导致相对 import 路径遗漏或循环依赖暴露 → 通过 `npm run typecheck` 和 `npm test` 全量验证。
- [Risk] assistant runner 参数过多，变成新的 options bag → 参数必须表达真实运行边界，例如 AppContext、RunAgent、render/append 回调、tool/user state context；不得提供测试替换实现集合。
- [Risk] `src/app/command/` 与既有 `src/commands/` 名称相近 → 目录命名使用单数 `command`，并在设计中明确一个是 app runtime，一个是具体 slash handlers。
- [Risk] 过度追求目录整齐继续拆分 shell/render/input → 本次显式非目标，实施时以“只新增 assistant-turn-runner 一个流程文件”为上限。

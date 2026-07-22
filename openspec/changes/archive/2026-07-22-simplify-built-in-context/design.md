# Design: 简化并覆盖基础 system prompt

## Context

`BUILT_IN_SYSTEM_PROMPT` 原先包含八条常驻规则，其中工具必要性、具体工具选择和敏感信息提醒与工具 definitions、模型能力及运行时审批边界存在重复。该基础文本还直接写死在源码中，用户只能通过 AGENTS.md 追加指令，无法替换 Echo TUI 的身份和通用行为规则。

最终 provider system record 还包含 cwd、AGENTS.md、skills 和 memory。这些动态 section 具有独立职责，不属于 `SYSTEM.md` 的覆盖范围。

## Goals / Non-Goals

**Goals:**

- 将默认内置规则压缩为身份加三条稳定行为规则。
- 保留语言/回答风格、基于证据和非平凡多步骤 todo 生命周期语义。
- 让模型依据当前工具 definitions 和任务上下文自主选择工具。
- 支持用户级和项目级 `SYSTEM.md` 完整替换基础 prompt。
- 无论是否覆盖基础 prompt，都继续追加 cwd、AGENTS.md、skills 和 memory。

**Non-Goals:**

- 不修改工具 descriptions、schema、风险分类、审批或 plan mode。
- 不改变 AGENTS.md、skills、memory 或 cwd 的发现与拼接规则。
- 不通过 JSON 配置、模型 profile、环境变量或 slash command 配置 system prompt。
- 不合并用户级和项目级 `SYSTEM.md` 内容。

## Decisions

### 1. 删除全局工具编排与通用敏感信息规则

默认基础 prompt 不再规定何时使用工具，也不再指定 glob、grep、read_files、web_fetch、apply_patch 和 bash 的优先关系。工具 definitions 已随请求发送且更接近能力实现。通用敏感信息提醒不作为产品级安全边界；现有运行时审批、错误脱敏和工具约束保持不变。

### 2. SYSTEM.md 使用单一覆盖来源

运行时依次选择项目级与用户级文件：

1. 项目级 `<project-root>/SYSTEM.md`；项目根沿用 AGENTS.md 的 Git 或 `.echo` marker 解析，无 marker 时使用 cwd。
2. 用户级 `~/.echo/SYSTEM.md`。
3. 源码 `BUILT_IN_SYSTEM_PROMPT`。

项目级有效文件直接覆盖用户级文件，不做拼接。缺失、非普通文件、不可读或去除首尾空白后为空的候选会被忽略并继续 fallback。文件内容只统一换行和去除首尾空白，不设置字节上限或截断标记。

### 3. 覆盖基础文本而非完整 system record

system prompt 组合函数接收已解析的基础文本。它先放置该文本与 cwd，再按现有顺序追加 AGENTS.md、skills 和 memory。这样 `SYSTEM.md` 可以控制 assistant 身份和通用行为，但不能意外关闭运行环境、项目指令和持久上下文。

### 4. 每次 agent run 重新解析覆盖文件

`SYSTEM.md` 与 AGENTS.md 一样在单次 agent run 初始化时读取。一次 tool continuation 使用同一份快照；下一次用户提交会重新读取文件，兼顾一致性与本地编辑生效。

## Risks / Trade-offs

- **[自定义 prompt 删除默认行为约束]** → 这是完整基础覆盖的预期能力；工具审批、plan mode 和其他运行时硬边界不依赖该文本。
- **[项目文件意外遮蔽用户文件]** → 使用明确的项目优先单选规则，并通过测试固定 fallback 行为。
- **[大文件增加上下文占用]** → `SYSTEM.md` 是用户显式提供的基础 prompt，完整读取以保持覆盖语义，实际 provider context window 仍是最终请求边界。
- **[不同 provider 的行为一致性下降]** → 默认路径仍保留最小三条规则；所有 provider 继续消费同一个 transient system record。

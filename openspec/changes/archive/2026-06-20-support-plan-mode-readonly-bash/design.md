## Context

当前 plan mode 通过 `createReadOnlyToolRegistry()` 暴露 glob、grep、read_files、web_fetch、web_search 和 use_skill，完全不暴露 bash。这个边界避免了执行修改，但也让模型无法获取 git 层面的工作区状态和变更摘要。

现有 normal mode 已有 `run_bash_command`、timeout/max output 限制和高风险命令审批。plan mode 的目标不同：它不应该通过审批执行修改命令，而应该只允许确定只读的观察命令。

## Goals / Non-Goals

**Goals:**

- 在 plan mode 中提供 `run_bash_command`，支持只读 workspace inspection。
- 首版重点支持 git 只读命令，例如 `git status`、`git diff`、`git log`、`git show`、`git rev-parse`、`git branch --show-current`、`git ls-files`、`git merge-base`，以及 `pwd`。
- 对不在 allowlist 内、含 shell 管道/重定向/多命令语法、或可能写入状态的命令，直接返回失败 tool result，不执行命令。
- normal mode 的 bash、高风险审批和 apply_patch 行为保持不变。

**Non-Goals:**

- 不在 plan mode 中运行测试、构建、安装依赖、格式化、提交、切换分支或 fetch/pull 等会修改工作区或 `.git` 状态的命令。
- 不实现完整 shell parser 或沙箱；只做保守的单命令 allowlist。
- 不新增 provider-facing 工具名；继续使用 `run_bash_command`，但 plan mode 下由执行前 classifier 按只读策略拦截。

## Decisions

### Decision 1: plan mode 使用同名 bash 工具，执行前策略由 classifier 统一拦截

在 `createReadOnlyToolRegistry()` 中注册普通 `run_bash_command` handler，但所有 provider tool call 在进入 executor 前必须经过 mode-aware `classifyToolCallRisk()`。plan mode 下，不符合 readonly allowlist 的 bash 命令由 classifier 直接返回拒绝结果，不进入 executor，也不进入 approval flow。

理由：模型已经理解 `run_bash_command`，复用同名工具可以避免新工具学习成本；把 safe / approval / rejected 的执行前决策集中在 classifier 中，避免 runtime 和 handler 各自维护 plan mode 拦截逻辑。

备选方案：新增 `git_inspect` 工具。它更语义化，但需要 provider 学习新工具 schema，且当前需求主要是补齐 bash 工具在 plan mode 中的只读能力，首版不需要扩大工具面。

### Decision 2: 使用 allowlist 而不是 denylist

受限 bash 只允许明确列出的单命令 argv 形态。命令字符串如果包含管道、重定向、命令连接符、命令替换、多行等 shell 元语法，直接拒绝。

理由：denylist 很难覆盖 `python -c`、重定向、`tee`、`git diff --output` 等副作用路径。allowlist 更保守，适合 plan mode 的硬边界。

### Decision 3: plan mode 拒绝不安全命令，不进入 approval flow

normal mode 的高风险 bash 可以走用户审批；plan mode 下不安全命令直接返回 `ok: false` 的 tool result，并告诉模型需要退出 plan mode。

理由：plan mode 是“只读探索和规划”，不是“确认后也能执行计划”。如果允许审批执行修改，会削弱 plan mode 的核心语义。

### Decision 4: system prompt 明确 bash inspection 边界

plan mode prompt 需要从“当前只提供只读工具”调整为“当前提供只读工具和受限只读 bash inspection”。同时明确不要运行测试、构建、安装、提交、切换分支等命令。

理由：工具 schema 只能约束执行结果，prompt 能减少模型提出被拒绝命令的概率，提高规划体验。

## Risks / Trade-offs

- [Risk] allowlist 过窄导致部分合法观察命令被拒绝 → Mitigation：首版覆盖 review/规划高频 git 命令；后续按真实使用反馈扩展。
- [Risk] 简单 tokenizer 与真实 shell 行为不完全一致 → Mitigation：只接受无 shell 元语法的单命令；解析不确定时拒绝执行。
- [Risk] `git diff` 部分参数可能写文件，例如 `--output` → Mitigation：对允许的 git 子命令增加危险参数 deny 检查，拒绝 `--output` 等写入型参数。
- [Risk] plan mode 下 bash 返回失败可能打断模型流程 → Mitigation：失败文本需要清晰说明 allowlist 和退出 plan mode 的方式，引导模型改用允许命令或请求用户退出 plan mode。

## 1. Plan-safe bash 执行前策略

- [x] 1.1 扩展 mode-aware `classifyToolCallRisk()`，复用 `run_bash_command` 工具名和普通 bash handler。
- [x] 1.2 实现保守的单命令解析，拒绝管道、重定向、命令连接、命令替换、多行等 shell 元语法。
- [x] 1.3 实现 readonly allowlist：允许 `pwd` 以及 `git status`、`git diff`、`git log`、`git show`、`git rev-parse`、`git branch --show-current`、`git ls-files`、`git merge-base`。
- [x] 1.4 拒绝写入型 git 子命令和参数，例如 `git reset`、`git clean`、`git checkout`、`git restore`、`git commit`、`git push`、`git pull`、`git fetch`、`git diff --output`。
- [x] 1.5 对拒绝命令返回 `rejected` risk，runtime 转为 `ok: false` tool result，说明 plan mode 只允许 readonly inspection 命令且需要退出 plan mode 才能执行副作用命令。

## 2. Registry 与 prompt 集成

- [x] 2.1 在 `createReadOnlyToolRegistry()` 中注册普通 `run_bash_command`，同时继续排除 `apply_patch` 和 `ask_user_questions`。
- [x] 2.2 保持 normal mode `createDefaultToolRegistry()` 的 bash handler 和高风险 approval 行为不变。
- [x] 2.3 更新 plan mode system prompt，说明可使用受限 readonly bash inspection，并明确禁止测试、构建、安装、提交、切换分支、重置状态等副作用命令。

## 3. 测试覆盖

- [x] 3.1 更新工具 registry 测试，确认 plan mode registry 暴露 `run_bash_command` 且仍不暴露写入型工具。
- [x] 3.2 增加 plan mode classifier 测试，覆盖允许的 `pwd` / git inspection 命令判定为 safe。
- [x] 3.3 增加拒绝测试，覆盖 shell 元语法、副作用命令、写入型 git 子命令和写入型 git 参数不会进入 executor。
- [x] 3.4 更新 agent loop plan mode 测试，确认 provider 在 plan mode 下收到 `run_bash_command` 工具定义和更新后的 plan prompt。
- [x] 3.5 运行 `npm run typecheck`、相关 targeted tests、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。

## 1. Bash 执行 runner

- [x] 1.1 从 `src/tools/bash-tool-handler.ts` 抽取共享 bash runner，返回 command、stdout、stderr、合并 terminal output、exitCode、timedOut、truncated、durationMs 和 error 信息。
- [x] 1.2 调整 bash tool handler 使用共享 runner，并保持现有 tool schema、风险审批和结构化 tool result 文本不变。
- [x] 1.3 为共享 runner 和 bash tool handler 回归补充测试，覆盖 stdout/stderr、非 0 退出码、timeout 和 truncation。

## 2. Interaction mode 与输入切换

- [x] 2.1 将 `InteractionMode` 扩展为 `normal | plan | shell`，并在 AppContext 中提供 Tab 循环切换能力。
- [x] 2.2 调整输入事件分发：slash suggestion 可见时 Tab 继续补全，否则空闲状态 Tab 在三种模式间循环切换。
- [x] 2.3 更新状态栏或 render state，使当前模式能稳定传递给 composer/footer 渲染。

## 3. Shell submit 流程

- [x] 3.1 在 app submit 路径中新增 shell mode 分支，Enter 执行 composer 文本为 bash 命令，不创建 agent turn、不触发 tool approval。
- [x] 3.2 shell 命令执行期间设置 working/pending 状态并阻止重复提交，完成后恢复空闲状态。
- [x] 3.3 空 shell command 不执行、不追加 transcript，并保持 footer 正常重绘。

## 4. Shell transcript 与渲染

- [x] 4.1 新增 shell transcript record 类型，记录 command、terminal output、exitCode、timedOut、truncated、durationMs 等字段。
- [x] 4.2 为 transcript context / turn context 增加追加 shell execution record 的路径，并确保 session persistence / resume 能保留该记录。
- [x] 4.3 新增 shell message 渲染：显示 `$ <command>`、合并终端输出，以及轻量 `[exit N]`、timeout、truncated 标记，不使用 tool call/tool result 样式。

## 5. Provider context 投影

- [x] 5.1 更新 OpenAI Responses transcript converter，将 shell record 投影为 user message，说明用户执行的 bash 命令、退出状态和终端输出。
- [x] 5.2 更新 OpenAI Chat transcript converter，保持同样的 user message 投影语义。
- [x] 5.3 更新 Anthropic transcript converter，保持同样的 user message 投影语义。
- [x] 5.4 为三套 converter 补充 shell record 投影测试。

## 6. Mode-specific composer UI

- [x] 6.1 更新 composer/footer 渲染，普通模式使用现有青色边框，plan mode 使用紫色边框，shell mode 使用绿色边框。
- [x] 6.2 更新 composer 前缀/提示，shell mode 使用 `$`，plan mode 使用独立前缀，普通模式保持现有体验。
- [x] 6.3 补充 footer/render 测试，覆盖三种模式的边框颜色、前缀和 Tab 切换后的渲染状态。

## 7. 集成验证

- [x] 7.1 增加 app 级测试：Tab 在 normal/plan/shell 间循环，slash suggestion 可见时 Tab 仍补全。
- [x] 7.2 增加 app 级测试：shell mode 执行命令后追加 shell transcript，且不会调用 agent 或 tool approval。
- [x] 7.3 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。

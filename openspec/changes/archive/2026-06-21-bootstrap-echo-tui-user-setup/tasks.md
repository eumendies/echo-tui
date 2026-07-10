## 1. Bootstrap 模块与默认模板

- [x] 1.1 新增用户 setup bootstrap 模块，集中处理 `~/.echo`、默认 `config.json` 和默认 setup skill 的路径解析与幂等创建。
- [x] 1.2 定义默认 `config.json` 模板，包含 fake agent provider、默认 model profile、`selectedModel`，且不包含真实 API key、真实服务地址或用户本机路径。
- [x] 1.3 定义 `echo-tui-setup` 默认 skill 模板，包含有效 frontmatter，并说明 skill、MCP、provider 和 model 配置方式。
- [x] 1.4 确保 bootstrap 以目标文件存在性为边界：已有 `config.json`、已有 `SKILL.md` 和已有 `skills.json` 均不得被覆盖或修改。

## 2. 安装期与启动期接入

- [x] 2.1 添加安装 lifecycle 入口，使本地全局安装时尝试执行用户 setup bootstrap。
- [x] 2.2 在 CLI 正常启动 TUI 前接入首次运行 fallback bootstrap。
- [x] 2.3 确保 `--help`、`--version`、`echo-tui config`、`echo-tui init` 和其他未知命令路径不执行 bootstrap。
- [x] 2.4 确保 bootstrap 失败时错误可读且不会进入 TUI raw mode 半初始化状态。

## 3. fake agent 配置兼容性

- [x] 3.1 检查现有 provider preset catalog 和 agent setup，补齐默认 fake provider 配置所需的 preset/解析逻辑。
- [x] 3.2 确保默认 fake 配置可被普通启动路径解析并创建 fake agent。
- [x] 3.3 确保 `/config` 能读取默认 fake 配置，并允许用户后续保存真实 provider/model 配置。

## 4. Skill 发现与管理验证

- [x] 4.1 验证 bootstrap 创建的 `echo-tui-setup` 通过现有用户级 skill registry 被发现，`sourceKind` 为 `user`。
- [x] 4.2 验证 `use_skill` 和 direct slash 调用可以加载默认 setup skill 正文。
- [x] 4.3 验证项目级同名 skill 仍按现有规则覆盖用户级默认 setup skill。
- [x] 4.4 验证 `/skills` 可以展示和保存默认 setup skill 的启用状态，且 bootstrap 不修改 `skills.json`。

## 5. 测试与验证

- [x] 5.1 新增 bootstrap 单元测试，覆盖缺失文件创建、已有文件不覆盖、多次执行幂等和默认模板内容。
- [x] 5.2 新增 CLI 行为测试，覆盖正常启动 fallback 与 help/version/unknown command 不触发 bootstrap。
- [x] 5.3 新增或更新 skill registry 测试，覆盖默认 setup skill 的发现、加载和项目级覆盖。
- [x] 5.4 运行 `npm run typecheck`。
- [x] 5.5 运行 `npm test`。
- [x] 5.6 运行 `find bin src test -name '*.js' -exec node --check {} \;`。

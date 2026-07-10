## 1. CLI 入口与包安装元数据

- [x] 1.1 将 `package.json#bin.echo-tui` 改为指向 `dist/bin/echo-tui.js`，并确保本地 pack/install 包含运行所需的 `dist/` 产物。
- [x] 1.2 调整 `bin/echo-tui.ts`，让编译后的 bin 加载新的 CLI 路由层而不是直接加载 TUI app main。
- [x] 1.3 新增 `src/cli/main.ts`，支持无参数启动 TUI、`--help` / `-h` 输出帮助、`--version` / `-v` 输出版本。
- [x] 1.4 为未知子命令或非法参数提供清晰错误、帮助提示和非零退出状态。

## 2. 配置初始化

- [x] 2.1 删除 `echo-tui init` 实现和帮助文案，避免提供弱配置入口。
- [x] 2.2 将 `echo-tui init` 保持为未知命令，且不创建或修改 `~/.echo/config.json`。
- [x] 2.3 在文档中说明 provider/model 配置当前仍需手动编辑，后续由 `echo-tui config` 变更承接。

## 3. 测试覆盖

- [x] 3.1 为 CLI 路由添加单元测试，覆盖无参数启动委托、help、version、未知命令和不进入 TUI raw mode 的路径。
- [x] 3.2 为 `init` 添加单元测试，确认它作为未知命令处理且不会启动 TUI。
- [x] 3.3 添加 package/bin 相关测试或校验，确认 `package.json#bin.echo-tui` 指向 `dist/bin/echo-tui.js`，build 后产物存在且带 shebang。
- [x] 3.4 运行 `npm run typecheck`、`npm test` 和 `find bin src test -name '*.js' -exec node --check {} \;`。

## 4. 文档与本地安装验证

- [x] 4.1 更新 `docs/README.md`，说明 `npm link` / `npm install -g .`、手动配置和任意 cwd 下运行 `echo-tui`。
- [x] 4.2 文档明确本变更暂不发布到 npm registry，避免给出公共 registry 安装承诺。
- [x] 4.3 手动验证 `npm run build` 后通过本地安装方式运行 `echo-tui --help`、`echo-tui --version` 和 `echo-tui init` 未知命令路径。

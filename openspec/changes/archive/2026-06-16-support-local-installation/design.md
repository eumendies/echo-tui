## Context

当前 CLI 入口位于 `bin/echo-tui.ts`，`package.json#bin.echo-tui` 也指向这个 TypeScript 源文件。开发流程通过 `npm start` 先执行 `tsc`，再运行 `dist/bin/echo-tui.js`，因此仓库内开发可用；但 npm 全局安装或 `npm link` 期望 bin 是可执行的 JavaScript 产物，不能依赖用户运行 TypeScript 源码。

模型配置已经集中在 `~/.echo/config.json`，运行时由 `src/config/llm-config.ts` 读取，模型切换和推理等级命令也会写回同一个文件。本变更不新增配置写入入口；后续 provider/model 配置会通过单独的 `echo-tui config` TUI 设计承接。

## Goals / Non-Goals

**Goals:**

- 让 `npm link` 或 `npm install -g .` 后的 `echo-tui` 命令可以在任意 cwd 启动 TUI。
- 将 npm bin 指向编译后的 JavaScript，并保证本地 pack/install 场景包含必要产物。
- 增加普通 CLI 参数路由，支持 `echo-tui`、`echo-tui --help`、`echo-tui --version` 和未知子命令错误。
- 保持现有 TUI app 编排边界清晰，避免把参数解析、配置初始化和帮助输出混入 `src/app/main.ts`。

**Non-Goals:**

- 不发布到 npm registry，不处理 npm 账号、包名占用、`npm publish` 或 release automation。
- 不新增第三方 CLI 框架、交互式 prompt 依赖或 TUI 依赖。
- 不新增 `echo-tui init`、配置向导、密钥管理服务、系统 keychain 或加密存储。
- 不重构模型配置 schema，也不生成或修改 provider/model 配置文件。
- 不实现后续设想中的 `echo-tui config` 配置 TUI。
- 不改变 cwd 分区的 transcript persistence 行为。

## Decisions

### 使用 `echo-tui` 作为安装命令名

`echo-tui` 延续当前 `package.json#bin` 名称，避开 `echo` 这类 shell builtin 冲突，也比 `echo_tui` 更符合命令行命名习惯。即使将来包名采用 scoped package，例如 `@scope/echo-tui`，bin 名仍可保持 `echo-tui`。

备选方案：

- `echo`：过度冲突，不采用。
- `echo_tui`：与包名一致但命令体验较差，不采用。
- `etui`：短但不可发现，不采用。

### bin 指向 `dist/bin/echo-tui.js`

安装后的 bin 应该是 Node 可直接执行的 CommonJS JavaScript 文件，并保留 shebang。`package.json#bin.echo-tui` 改为 `dist/bin/echo-tui.js` 后，`npm link`、`npm install -g .` 和未来 `npm pack` 都使用同一入口。

源码入口仍保留在 `bin/echo-tui.ts`，由 `tsc` 编译到 `dist/bin/echo-tui.js`。入口解析不应依赖当前工作目录，而应通过 `__dirname` 定位同一包内的 `dist/src/...`。

### 新增 CLI 路由层而不是扩展 TUI app main

新增 `src/cli/` 作为普通命令行层，负责解析 `process.argv`、输出 help/version、处理未知子命令，默认无子命令时委托 `src/app/main.ts` 的 `run()` 启动 TUI。

预期边界：

```text
dist/bin/echo-tui.js
        │
        ▼
src/cli/main.ts
        ├─ no args          -> src/app/main.ts run()
        ├─ --help / -h      -> stdout help
        └─ --version / -v   -> stdout package version
```

这样可以让 TUI raw mode 初始化只发生在真正启动 TUI 时，避免 `--help`、`--version` 或错误命令意外进入 raw mode 或污染终端状态。

### 暂不提供 init，后续通过 config TUI 承接配置体验

`echo-tui init` 的非交互参数体验不适合 provider/model 配置场景，容易暴露密钥到 shell history，也不能自然支持多 provider、多 model 和后续校验。因此本变更删除 `init`，未知子命令统一报错；配置体验后续通过单独的 `echo-tui config` TUI 设计实现。

### 文档聚焦本地安装而非发布

README 应描述以下路径：

```bash
npm install
npm run build
npm link
cd /path/to/project
echo-tui
```

或：

```bash
npm install -g .
```

文档应明确“暂不发布 npm registry”，并继续说明当前版本需要手动创建 `~/.echo/config.json`。

## Risks / Trade-offs

- [Risk] `package.json#bin` 指向 `dist` 后，未 build 就执行 `npm link` 会得到缺失入口。→ 使用 `prepack` 或文档要求先 `npm run build`，并在测试中覆盖 dist bin 存在性。
- [Risk] 删除 `init` 后首次配置仍需手动编辑 JSON，体验较弱。→ 文档明确当前状态，后续用 `echo-tui config` 独立设计承接。
- [Risk] CLI 路由和 TUI app 边界不清会导致 help/error 进入 raw mode。→ 独立 `src/cli` 层，只有无子命令时调用 app `run()`。
- [Risk] 当前包名 `echo_tui` 与命令名 `echo-tui` 不一致。→ 第一版可以只稳定 bin 名；若未来发布 registry，再单独决定 npm 包名。

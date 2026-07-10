## ADDED Requirements

### Requirement: `/config` 运行源码模块使用 TypeScript
系统 SHALL 支持 `/config` 相关 slash command、配置编辑和配置 UI 运行源码模块使用 TypeScript，并通过现有编译管线输出 CommonJS JavaScript 到 `dist/`。

#### Scenario: `/config` 模块参与 build
- **WHEN** 开发者维护 `/config` 相关源码模块
- **THEN** 系统 SHALL 支持 `src/commands/config-command-handler`、`src/config/provider-presets`、`src/config/llm-config-editor`、`src/render/footer/config-surface` 和 `src/render/footer/command-surfaces` 这类模块使用 `.ts`
- **THEN** 这些模块 SHALL 通过仓库级 TypeScript 编译管线输出 CommonJS JavaScript 到 `dist/`

#### Scenario: `/config` 测试路径保持兼容
- **WHEN** `/config` handler、config editor 或 footer config surface 模块使用 TypeScript
- **THEN** 编译后的 command、render 和 config 测试 SHALL 能够通过相对路径加载 `dist/src/commands`、`dist/src/config` 与 `dist/src/render` 下的对应模块
- **THEN** `npm test` 的编译后测试路径 SHALL 保持可用

#### Scenario: `/config` 不引入新运行时依赖
- **WHEN** 开发者实现 `/config` 配置面板
- **THEN** 系统 SHALL 继续使用 Node.js、ANSI 控制序列和 stdin raw mode
- **THEN** 系统 SHALL NOT 引入第三方 TUI 库、bundler、ts-node、tsx 或自定义 loader runtime

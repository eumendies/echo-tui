## Why

当前项目主要通过 `npm start` 从仓库目录启动，用户不能在其他工作目录中直接调用稳定命令。为了让这个 TUI 从开发原型走向可试用工具，需要先支持本地/全局安装和普通 CLI 入口，但暂不发布到 npm registry。

## What Changes

- 将 CLI 安装目标定义为 `echo-tui`，安装后用户可以在任意 cwd 运行 `echo-tui` 启动 TUI。
- 支持通过本地包安装方式验证安装体验，例如 `npm link` 或 `npm install -g .`，暂不涉及 `npm publish`、npm 账号、registry 发布或版本发布流程。
- 调整包入口，使 npm 安装后的 bin 指向可执行的编译产物，而不是 TypeScript 源文件。
- 增加普通 CLI 参数入口，支持 `echo-tui --help` 和 `echo-tui --version`，未知子命令返回清晰错误。
- 不提供 `echo-tui init`；provider/model 配置后续将通过单独的 `echo-tui config` 配置 TUI 设计承接。
- 更新文档，说明本地安装、手动配置和在其他路径启动的推荐流程。

## Capabilities

### New Capabilities
- `installable-cli`: 覆盖 npm 本地/全局安装后的命令入口、帮助/version 输出、未知子命令处理和安装验证流程。

### Modified Capabilities
- `typescript-build-test-pipeline`: 包构建产物需要满足 npm 安装后可执行的 bin 入口要求，并在现有 TypeScript 编译/测试流程中验证。

## Impact

- 影响 `package.json` 的 `bin`、发布文件范围或 pack/build 相关脚本。
- 影响 `bin/` CLI 入口和可能新增的 `src/cli/` 参数路由、帮助/version 输出逻辑。
- 不改变 `src/config/` 现有配置读取、校验和写入能力。
- 影响 `docs/README.md` 中的安装和首次配置说明。
- 新增或更新覆盖 CLI 入口、未知子命令、包入口解析和构建产物可执行性的测试。

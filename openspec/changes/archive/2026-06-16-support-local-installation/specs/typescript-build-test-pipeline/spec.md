## ADDED Requirements

### Requirement: npm 安装使用编译后的 bin 产物
系统 SHALL 让 npm 安装后的 `echo-tui` bin 入口指向编译后的 JavaScript 产物，并确保该产物由现有 TypeScript build 管线生成。

#### Scenario: build 生成可安装 bin 入口
- **WHEN** 开发者运行 TypeScript build 命令
- **THEN** 系统 SHALL 在 `dist/bin/echo-tui.js` 生成带 shebang 的 CommonJS JavaScript bin 入口
- **THEN** 该入口 SHALL 能够定位并加载同一编译输出中的 CLI 应用代码

#### Scenario: package bin 指向 dist
- **WHEN** 开发者检查 package metadata 或执行本地 npm 安装
- **THEN** `package.json` 中的 `bin.echo-tui` SHALL 指向 `dist/bin/echo-tui.js`
- **THEN** npm 安装后的命令 SHALL NOT 直接执行 `bin/echo-tui.ts` 源文件

#### Scenario: pack 内容包含运行所需产物
- **WHEN** 开发者执行本地 pack 或全局安装当前包
- **THEN** 包内容 SHALL 包含 `dist/bin/echo-tui.js` 和其运行所需的 `dist/src/` 编译产物
- **THEN** 包内容 SHALL NOT 依赖用户机器上的源码 TypeScript 文件来启动 CLI

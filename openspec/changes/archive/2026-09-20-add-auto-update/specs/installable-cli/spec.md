## REMOVED Requirements

### Requirement: 暂不发布 npm registry
**Reason**: 包已经通过公共 npm registry 以 `@eumendies/echo-tui` 名称持续分发（npm `latest` 已发布多个版本），该需求描述的分发边界不再成立；启动更新检测能力也依赖公开发布这一事实。
**Migration**: 安装说明改为展示 `npm install -g @eumendies/echo-tui`；本地开发仍可使用 `npm link` 或 `npm install -g .`。原先“文档不得声明可经公共 registry 安装”的禁令移除，但“不得引导用户使用 `echo-tui init`”由新增需求继续保留。

## ADDED Requirements

### Requirement: 通过 npm registry 分发
系统 SHALL 通过公共 npm registry 以 `@eumendies/echo-tui` 名称分发，使用户可用 `npm install -g @eumendies/echo-tui` 安装 `echo-tui` 命令；安装说明 MAY 展示公共安装方式并 SHALL NOT 引导用户使用 `echo-tui init`。包管理器安装的副本 SHALL 在启动时参与 `startup-auto-update` 能力定义的有节制更新检测；源码运行与 npx 缓存运行的副本 SHALL NOT 参与。

#### Scenario: 文档说明公共安装方式
- **WHEN** 用户阅读安装说明
- **THEN** 文档 SHALL 展示 `npm install -g @eumendies/echo-tui` 的公共安装流程
- **THEN** 文档 MAY 同时保留 `npm link` 或 `npm install -g .` 的本地安装流程
- **THEN** 文档 SHALL NOT 引导用户使用 `echo-tui init`

#### Scenario: 安装副本参与启动更新检测
- **WHEN** 用户运行通过 npm registry 全局安装的 `echo-tui`
- **THEN** 启动更新检测 SHALL 按 `startup-auto-update` 能力执行
- **THEN** 从源码目录或 npx 缓存运行的副本 SHALL NOT 执行更新检测

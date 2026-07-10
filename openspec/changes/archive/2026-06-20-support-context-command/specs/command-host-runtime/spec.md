## MODIFIED Requirements

### Requirement: 新增命令的最小改动面
系统 SHALL 使新增本地 slash command 的主要改动集中在 command handler 和命令注册列表。只有当新增命令需要新的通用 app 能力时，才 SHALL 扩展 `CommandHost` 的受控领域接口。对于 mode 切换这类 app 状态，`CommandHost` SHALL 暴露受控的 interaction mode getter/setter，而不是要求 handler 直接操作完整 AppContext。对于 context usage 详情这类只读状态，`CommandHost` SHALL 暴露受控的 context usage getter，而不是要求 handler 直接读取完整 AppContext。

#### Scenario: 新增只使用已有 host 能力的命令
- **WHEN** 开发者新增一个只需要已有 host 能力的本地 slash command
- **THEN** 开发者 SHALL 只需要新增 handler 并在 slash command 注册列表中注册
- **THEN** 开发者 SHALL NOT 修改 `CommandRuntime` 的业务 switch 或 `main.ts` 的业务 callback

#### Scenario: 新增需要通用能力的命令
- **WHEN** 新命令需要当前 `CommandHost` 尚未暴露的通用 app 能力
- **THEN** 开发者 MAY 扩展 `CommandHost` 对应领域接口
- **THEN** 该扩展 SHALL 保持受控 facade 语义，而不是把完整 app 内部对象透传给 handler

#### Scenario: mode command uses interaction mode facade
- **WHEN** `/mode` command handler 需要读取或设置当前 interaction mode
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 mode 领域能力访问 interaction mode
- **THEN** handler SHALL NOT 直接访问完整 `AppContext`
- **AND** handler SHALL NOT 自行维护额外 mode 映射状态

#### Scenario: context command uses context usage facade
- **WHEN** `/context` command handler 需要读取最近一次 provider context usage
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 context usage 领域能力访问该状态
- **THEN** handler SHALL NOT 直接访问完整 `AppContext`
- **AND** handler SHALL NOT 自行重建 provider request 或重新估算当前 transcript

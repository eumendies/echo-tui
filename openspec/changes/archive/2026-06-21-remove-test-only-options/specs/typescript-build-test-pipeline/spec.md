## ADDED Requirements

### Requirement: 测试策略适配生产装配入口简化
系统 SHALL 允许删除或迁移依赖测试专用 options/dependencies 的测试，并保持 TypeScript 编译、Node test runner 和 JavaScript 语法检查作为最终验证手段。

#### Scenario: 删除脆弱高层 harness 测试
- **WHEN** 一个测试依赖生产装配入口暴露 fake renderer、fake terminal、fake config loader、fake provider 或 fake tool executor 来断言内部 glue 调用顺序
- **THEN** 实现 MAY 删除该测试
- **THEN** 实现 SHALL NOT 为保留该测试而重新引入测试专用生产 API

#### Scenario: 保留可维护的低层测试
- **WHEN** 行为可以通过低层模块、纯函数、provider adapter 或真实 public seam 测试
- **THEN** 实现 SHALL 保留或迁移对应测试
- **THEN** 测试 SHALL 不要求生产装配入口暴露测试专用 options/dependencies

#### Scenario: 变更后验证命令通过
- **WHEN** 删除测试专用 options/dependencies 并清理测试后
- **THEN** `npm run typecheck` SHALL 通过
- **THEN** `npm test` SHALL 通过
- **THEN** JavaScript 源测试语法检查 SHALL 通过

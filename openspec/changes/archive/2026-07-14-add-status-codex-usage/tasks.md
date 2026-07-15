## 1. Codex 用量查询边界

- [x] 1.1 定义 Codex usage 窗口与查询结果类型，实现 `rate_limit.primary_window`、`secondary_window` 的严格解析、百分比规范化和 reset 时间转换
- [x] 1.2 实现复用 `resolveCodexOAuthCredential` 的 usage endpoint GET 请求，携带 Bearer token 与可选账号 header，并对凭据、网络、HTTP 和响应错误做脱敏归一化
- [x] 1.3 为成功响应、百分比边界、过期凭据刷新、账号 header、异常响应和敏感错误脱敏补充 Codex usage 单元测试

## 2. Status 运行状态 facade

- [x] 2.1 为 `TranscriptContext` 增加当前 session id 的只读访问，并为当前 model/provider 增加不暴露配置秘密的 status 信息读取能力
- [x] 2.2 扩展 `CommandHost` status facade，按当前 cwd 聚合目录、AGENTS 来源、启用用户 memory 数量、有效 agent memory catalog、model/provider、session id 和 Codex usage 查询能力
- [x] 2.3 为 status facade 的有效数据、空状态、配置/文件读取失败和非 Codex provider 不发起远端请求补充测试

## 3. `/status` 命令生命周期

- [x] 3.1 定义 `StatusCommandSurface` 与用量加载/可用/不可用/不适用状态，实现 `/status` 精确匹配、命令注册、帮助与 slash suggestion 集成
- [x] 3.2 实现同步打开本地状态 surface、Codex 单次异步查询、request id 会话校验与安全 footer 重绘
- [x] 3.3 实现 Esc、Enter、`q` 关闭交互，并测试本地只读语义、额外参数拒绝、加载态更新及关闭或替换 surface 后的迟到结果隔离

## 4. Status 进度条渲染

- [x] 4.1 实现 status footer 卡片，展示目录、AGENTS、memory、model/provider、session，以及 5 小时和每周用量百分比、重置时间与填充/轨道进度条
- [x] 4.2 接入现有主题颜色、ANSI 可见宽度与 footer 最大行数约束，实现窄终端下按优先级裁剪且保留两个窗口核心进度信息
- [x] 4.3 为成功、查询中、不可用、不适用、空本地状态和窄终端布局补充 renderer 测试，并确认输出不包含 context 占用字段

## 5. 集成验证

- [x] 5.1 更新命令清单及相关用户文档，说明 `/status` 展示范围、Codex OAuth 限制和 `/context`、`/usage` 的职责边界
- [x] 5.2 运行 `npm run typecheck`、`npm test` 和 JavaScript 批量语法检查；交互式 UI 验证由用户在真实终端完成
